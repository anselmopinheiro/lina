# LINA-12-AUDIT-COMPLETE-EMBEDDING-LIFECYCLE-001

**Tipo:** Auditoria arquitetural (apenas análise — nenhum código, teste, schema ou migration alterado)
**Âmbito:** Ciclo completo de embeddings após LINA-07 a LINA-11
**Estado Git na auditoria:** `master`, HEAD `f5f840d`, working tree limpa

## 0. Método e limites da auditoria

- Verificado o estado Git antes de começar; `AGENTS.md` lido integralmente.
- Documentação lida integralmente: `LINA-11-IMPLEMENT-EMBEDDING-WORKFLOW-STATE-001`. Lida por secções/pesquisa dirigida: `LINA-11-AUDIT`, `LINA-09-IMPLEMENT`, `LINA-06-AUDIT/IMPLEMENT`, `README.md` e `docs/manual.md` (secções de sync). **Não lidos integralmente:** LINA-07/08/10 e restantes `docs/architecture/*`.
- Código lido: `embeddingWorkflowState`, `semanticCapability`, `deviceRuntimeState`, `embeddingUpdatePlan`, `embeddingWorkStatusController`, `embeddingOperationManager` (tipos e progresso), `embeddingWorker`, `embeddingScheduler`, `embeddingPolicyEngine`, `ownershipGate`, `artifactProvenanceValidation`, `producerState`, `companionConsumptionState` (avaliação), `sidebarStatusViewModel`, e as secções relevantes de `main.ts` e `linaSearchView.ts`.
- **Não lidos em detalhe:** `embeddingGenerator.ts` (1771 linhas), `embeddingPersistence.ts` (publicação), `runtimeEmbeddingIndex.ts`, `vectorContract.ts`. A afirmação "publicação canónica transacional" assenta em `AGENTS.md`, nos testes listados e na documentação, não numa leitura linha a linha.
- **Não executei a suíte de testes** (auditoria só de análise). Os resultados "1687 testes verdes" são os reportados em LINA-11.
- Cada problema abaixo indica o grau de certeza: **Confirmado no código** (cadeia de chamadas lida) ou **Plausível** (deduzido, por reproduzir).

---

## 1. Resumo executivo

O núcleo de escrita está bem desenhado: planeador de atualização, estado derivado por hashes, single-flight, checkpoints, publicação com rollback e política que impede consumo silencioso de APIs pagas. A pesquisa semântica exige identidade estrita do espaço vetorial e a idade não invalida vetores.

Os problemas concentram-se na **camada de apresentação e de estado em cache**, que continua a derivar a mesma pergunta ("há trabalho? está a correr?") por vários caminhos, e na **autoridade de escrita**, que não é revalidada durante a geração.

Achados de maior impacto:

| # | Severidade | Achado | Certeza |
|---|---|---|---|
| F1 | Alta | `DeviceRuntimeState` (Read Path da Sidebar) é uma cache que **não é atualizada** após publicação de embeddings, mudança de settings ou publicação do índice textual | Confirmado |
| F2 | Alta | Sem fencing de ownership/epoch entre a captura da proveniência e a publicação; `isAuthorizedSync()` é otimista; não existe lease | Confirmado |
| F3 | Média | O resolver do workflow (`canUpdate`) está morto; o botão usa condição própria que ignora `embeddingsEnabled` | Confirmado |
| F4 | Média | A linha "Embeddings" da Sidebar não segue o workflow: mostra "Atualização necessária" durante geração ativa; `semanticPreparing` degrada o texto da pesquisa mesmo com pesquisa disponível | Confirmado |
| F5 | Média | Fallback por idade ainda existe na Sidebar (`embeddingsFreshness` / `producerFreshness`), contrariando LINA-09 | Confirmado |
| F6 | Média | `workAvailable` indeterminado é convertido em `IDLE` ("Atualizados") | Confirmado |
| F7 | Média | Cada tick de progresso dispara `refreshState()`, que lê e faz digest de `notes.json` + `chunks.jsonl` | Confirmado |
| F8 | Média | "Trabalho existe" tem três definições diferentes (controller, `confirmAndRequest`, scheduler) | Confirmado (definições) / Plausível (caso limite) |
| F9 | Baixa | Ficheiros temporários de `producer-state.json` ficam na raiz de `.lina/` (sincronizada) | Confirmado |
| F10 | Baixa | `not-active-producer` não tem tratamento próprio; confirmação de custo aparece antes da verificação de ownership | Confirmado |
| F11 | Baixa | Documentação desalinhada com o código (LINA-11, AGENTS, settings de arranque) | Confirmado |

---

## 2. Arquitetura atual

### 2.1 Camadas e fontes de verdade

| Camada | Componente | Fonte de verdade | Persistente? | Sincroniza? |
|---|---|---|---|---|
| Artefactos canónicos | `.lina/index/manifest.json`, `notes.json`, `chunks.jsonl`, `embeddings.jsonl` | Disco | Sim | Sim |
| Autoridade | `.lina/ownership.json` + `.lina/ownership-history/` | Disco (epoch monotónico) | Sim | Sim |
| Telemetria | `.lina/producer-state.json` | Disco | Sim | Sim (por design) |
| Papel local | `.lina/devices/<id>.json` | Disco | Sim | Não deve |
| Operacional do produtor | `.lina/producer/{checkpoints,staging,backups}` | Disco | Sim | **Não** (depende de exclusão externa) |
| Credenciais | `SecretStorage` | Local | Sim | Não |
| Plano de atualização | `calculateEmbeddingUpdatePlan` (puro) | Derivado de disco | Não | — |
| Estado de trabalho | `EmbeddingWorkStatusController` | Memória (revisão + dirty) | Não | — |
| Operação ativa | `EmbeddingOperationManager` (via `MaintenanceEngine`) | Memória | Não | — |
| Agendamento | `EmbeddingScheduler` (+ backoff) | Memória | Não | — |
| Cópia binária derivada | `BinaryEmbeddingCopyController` | Memória + ficheiros derivados | Sim (derivada) | Sim |
| Índice runtime | `RuntimeEmbeddingIndexCache` (`Float32Array`) | Memória | Não | — |
| **Capacidade semântica (Read)** | `DeviceRuntimeState.embeddings` (`resolveDeviceRuntimeState`) | **Cache em `main.ts`** | Não | — |
| **Workflow (Write)** | `resolveEmbeddingWorkflowState` | Derivado on-demand | Não | — |
| Apresentação | `buildSidebarStatusViewModel` + `statusEl` + `stateContainer` | Derivado | Não | — |

### 2.2 Separação Read Path / Write Path

- **Read:** `evaluateSemanticCapability` → `DeviceRuntimeState.embeddings` → Sidebar, Diagnóstico, pesquisa híbrida. Correto na definição.
- **Write:** `EmbeddingWorkRuntimeState` + `EmbeddingOperationState` (+ fase da cópia binária) → `resolveEmbeddingWorkflowState`.
- A separação é **respeitada nos módulos puros** e **quebrada na apresentação** (F3, F4, F5): o Sidebar VM só reencaminha o workflow (`workflow: workflowState`, `sidebarStatusViewModel.ts:534`) e continua a calcular texto/estado de embeddings a partir de `embeddingsWorkAvailable`, `embeddingsChecking`, `semanticPreparing` e idade.

---

## 3. Fluxo completo (mapeado)

```
Nota alterada
 └─ evento do Vault → fila única (debounce por path, coalescing, single-flight)      [TextIndexWorker; só Active Producer]
     └─ publicação do índice textual (.lina/index/*) → controller.markDirty("text-index-published")
         └─ EmbeddingWorkStatusController: dirty → calculating (lazy, só com subscritor) → ready
             └─ refreshSummary(): readEmbeddingStatus + readEmbeddingUpdatePreview (plano)
                 └─ workAvailable = deriveEmbeddingWorkAvailability(summary)            [boolean | undefined]
                     ├─ Scheduler.markDirty() → (automatic-local-only + Ollama + producer) → quiet 30 s / max 5 min
                     │        → hasEmbeddingWork() → dispatchAutomatic()
                     └─ Sidebar: resolveEmbeddingWorkflowState → UPDATE_REQUIRED (+ botão se produtor autorizado)
Pedido do utilizador (botão / comando)
 └─ confirmAndRequestEmbeddingGeneration(origin)
     ├─ verifica capabilities + papel === producer          (NÃO verifica ownership)
     ├─ plano + política (evaluateEmbeddingUpdatePolicy) → modal de confirmação (externo ou manual)
     └─ requestEmbeddingIndexGeneration → MaintenanceEngine → EmbeddingWorker.requestGeneration
         ├─ canPublish() = OwnershipGate.isAuthorizedSync()  (cache; verdadeiro se nunca avaliado)
         ├─ coordinator.requestPreparation → drain fila textual → startGeneration (token de escrita)
         └─ runGenerateLocalEmbeddings
             ├─ provenance = evaluateProvenance()            (capturada UMA vez, em "validating")
             ├─ validação (≤3 chunks) → lotes sequenciais → checkpoints
             └─ "persisting" (ponto de não retorno) → publish.tmp → backup → embeddings → manifest → rollback em falha
 └─ pós-publicação: markEmbeddingWorkStatusDirty + invalidateRuntimeEmbeddingIndex + producer-state + cópia binária
Pesquisa semântica
 └─ getSemanticSearchAvailability (identidade estrita) → RuntimeEmbeddingIndexCache.getOrLoad (lazy, single-flight)
```

**Estados contraditórios identificáveis neste fluxo:** ver F1 (Read cache), F4/F5 (apresentação), F8 (definições de "trabalho").

---

## 4. Pontos corretos (a preservar)

1. **Invariante central cumprida no resolver:** `workAvailable && !generationRunning` → `update-required`, nunca `preparing` (`embeddingWorkflowState.ts:150-182`); `preparing` só com `operationState.status === "running"` ou `"cancelling"`.
2. **Frescura de embeddings não depende da idade no cálculo canónico:** `deriveEmbeddingWorkAvailability` e `calculateEmbeddingUpdatePlan` usam hashes, identidade e contagens (`embeddingUpdatePlan.ts`, `embeddingWorkStatusController.ts:100`).
3. **Proveniência é histórica e não bloqueante:** `evaluateArtifactProvenance` devolve `valid/stale/unknown/future` sem qualquer efeito em pesquisa, rebuild ou ownership (`artifactProvenanceValidation.ts:1-11`). Nenhum caminho de rebuild artificial encontrado.
4. **Política de custos:** `evaluateEmbeddingUpdatePolicy` só permite execução automática para provider local sem custo externo, com papel `producer`; qualquer outro caso exige confirmação. Companion é bloqueado (`embeddingPolicyEngine.ts:80-113`).
5. **Companion nunca gera:** `canGenerateEmbeddings`, `canPublish` e papel são verificados em `EmbeddingWorker`, `EmbeddingScheduler` e `confirmAndRequestEmbeddingGeneration`.
6. **Scheduler robusto:** quiet period, atraso máximo, backoff exponencial, pausa, e preservação do estado `dirty` em falha de leitura (`embeddingScheduler.ts:225-232`).
7. **Estado derivado tolera concorrência:** revisão + descarte de cálculos tardios + single-flight + follow-up refresh (`embeddingWorkStatusController.ts:188-237, 276-288`).
8. **Correção do lock da cópia binária** (LINA-11) devolve a fase a `idle` quando o lock é rejeitado; `isSemanticPreparationActive()` já não depende de fases binárias (`linaSearchView.ts:2603`).
9. **Limite `.lina/index/` vs `.lina/producer/`** está implementado nos caminhos de embeddings (commit `95821e2`) e documentado em README e manual.
10. **Falhas de escrita** (lock, provider, cancelamento) têm caminhos definidos: checkpoint preservado, rollback de publicação, `ERROR`/`CANCELLED`, backoff no modo automático.

---

## 5. Problemas encontrados

### F1 — Cache de `DeviceRuntimeState` desatualizada após publicação (Alta, Confirmado)

- `getDeviceRuntimeState()` devolve `this.deviceRuntimeState` sempre que existe (`main.ts:989-992`).
- A cache só é reescrita em `refreshDeviceRuntimeState()` e `getDeviceDiagnostics()`, chamados em: `loadDataFromDisk`, `changeDeviceRole`, abertura/refresh do diagnóstico (`main.ts:1185, 1200, 3607, 3672`, `linaSearchView.ts:2879`). LINA-06 documenta exatamente estes três pontos.
- **Não há refresh** em: publicação canónica de embeddings (`main.ts:2883-2885` só marca dirty e invalida o índice runtime), `refreshEmbeddingConfigurationState` (`main.ts:887`), publicação do índice textual, nem fim de operação.
- A Sidebar usa `runtimeState.embeddings.semanticAvailable/reasonCode/exists/contractState` (`linaSearchView.ts:2670, 2703, 2723-2726`). O `semanticCompatibility` calculado a fresco em `refreshState` (`:2659`) só serve de *fallback* (`??`) para o motivo.
- **Efeito:** num vault novo, após a primeira geração bem-sucedida, o Sidebar pode continuar a mostrar `text-only` / embeddings em falta (Read Path antigo) enquanto a pesquisa real já funciona. Idem em mudança de provider/modelo. Nos testes (`sidebarEmbeddingWorkflowState.test.ts`) o `runtimeEmbeddings` é injetado, pelo que esta ligação não é coberta.
- O `isOperational` da linha "Embeddings" depende diretamente desta cache (`sidebarStatusViewModel.ts:347-349`), logo o erro propaga-se à frescura apresentada.
- **Nota:** mesmo problema afeta o Companion após receber artefactos sincronizados (o follow-up de hot-reload já está registado em A2; aqui o problema é mais geral — nem o refresh local existe).

### F2 — Sem fencing/lease na autoridade de escrita durante a geração (Alta, Confirmado)

- `OwnershipGate.isAuthorizedSync()` devolve `true` quando `lastDecision === null` para papel `producer` (`ownershipGate.ts:186-188`). Um standby ainda não avaliado é tratado como autorizado.
- O construtor tem `autoClaim = true` por defeito (`:148`): num vault sem manifesto, o primeiro produtor a avaliar reivindica o ownership; dois produtores a arrancar em simultâneo com sync intermédio podem ambos escrever `epoch 1` (o `claimInitialOwnership` protege contra sobrescrita local, não contra divergência entre dispositivos sincronizados).
- O caminho de embeddings usa a cache (`isAuthorizedSync`, `main.ts:1410-1412`) e captura a proveniência **uma vez** antes de gerar (`main.ts:2789`). Não existe re-avaliação de ownership nem comparação de epoch antes de entrar em `persisting`: `embeddingPersistence.ts` e `embeddingGenerator.ts` só transportam a proveniência, não a validam.
- **Cenário:** produtor A começa a gerar (minutos, providers lentos); o utilizador promove B noutro dispositivo (epoch +1); o sync entrega o novo `ownership.json` a A, mas ninguém chama `evaluate()`; A publica `embeddings.jsonl` + manifesto com proveniência do epoch antigo por cima dos artefactos de B. A proveniência fica `stale` (não bloqueante), o que **regista** o problema mas não o impede.
- Não existe lease/TTL/heartbeat de ownership (é explícito em `ownershipTransferSafety.ts:13`); `deviceRuntimeState.ts:12` menciona "lease/fencing" no comentário, o que induz em erro.
- O fluxo de transferência assume sync quase imediato e que o produtor cessante já não escreve; não há proteção quando isso não se verifica.

### F3 — Lógica de "pode atualizar" duplicada; `canUpdate` morto (Média, Confirmado)

- `resolveEmbeddingWorkflowState` calcula `canUpdate` (`embeddingWorkflowState.ts`), mas nenhum consumidor o lê (pesquisa por `canUpdate` só devolve o próprio módulo).
- O botão usa outra condição (`linaSearchView.ts:2829-2834`): `isAuthorizedProducer && workAvailable && !running/cancelling && indexReady`. Diferenças face ao resolver: não considera `error` (canUpdate permitia retry), nem `embeddingsEnabled`, nem `checking`.
- **`embeddingsEnabled` nunca é verificado** nem no botão, nem em `confirmAndRequestEmbeddingGeneration`, nem no worker (a única ocorrência em `embeddingGenerator.ts:1623` lê o manifesto). Com embeddings desativados, `workAvailable` pode ser `true` (chunks em falta) e a Sidebar mostra "Embeddings: Desativados" + botão "Atualizar embeddings".
- O relatório LINA-11 descreve o botão como "produtor autorizado + manual + texto pronto"; o código não testa o modo manual (o resolver não recebe `embeddingUpdateMode`).

### F4 — Linha "Embeddings" e cabeçalho não seguem o workflow (Média, Confirmado)

- Durante `GENERATING`/`PERSISTING` com `workAvailable === true` (o estado normal durante uma atualização, até à publicação): `isOperational` verdadeiro + `embeddingsWorkAvailable === true` → `embeddingsStatus = "stale"` → texto "Atualização necessária" (`sidebarStatusViewModel.ts:354-357, 383-389`). A informação de progresso está em `statusEl`, mas o cartão de estado diz que ainda é preciso atualizar.
- `semanticPreparing` (fase `preparing`/`waiting-for-text-index`/`validating` da **geração**) altera o título "Pesquisa híbrida · A preparar pesquisa semântica" (`:417-426`) e entra em `isEmbeddingsChecking` (`:341`), mesmo quando `semanticAvailable` é `true` (a pesquisa continua a funcionar com os vetores existentes). É acoplamento Write → Read na mensagem: o que está a ser preparado é a *atualização*, não a pesquisa.
- Combinação `Atualização necessária` + `A preparar pesquisa semântica` é atingível durante uma geração real nas fases iniciais (não é o caso "sem geração real" proibido, mas o texto é enganador).
- `renderEmbeddingDiagnosticSummary` (`linaSearchView.ts:2906-2938`) é código morto e contém a string `Embeddings: Prontos · A preparar pesquisa semântica…`; deve ser removido para não reintroduzir a contradição.
- `cancelling` é mapeado para o estado `preparing` (`embeddingWorkflowState.ts:89-99`); o enum pedido não tem `CANCELLING`. Só a `message` distingue.

### F5 — Idade ainda influencia o estado de embeddings/produtor na Sidebar (Média, Confirmado)

- LINA-09 declara eliminado o TTL cronológico. Persistem dois caminhos:
  1. `sidebarStatusViewModel.ts:368-371`: quando não operacional, sem trabalho e sem `contractState` mismatch, usa `embeddingsFreshness` ou `companionState.embeddingFreshness`, que vêm de `evaluateTimestampFreshness` (24 h/48 h) sobre `producer-state.json` (`producerState.ts:259-287, 317`). Resultado possível: `"stale"` → "Atualização necessária" apenas por idade > 48 h.
  2. Alerta de degradação prioridade 4 `producer-stale` (>48 h) e 6 `producer-aging` (>24 h) (`:482-511`) baseados em `updatedAt` do `producer-state.json`. Um produtor legitimamente inativo (sem notas alteradas) gera avisos.
- `producerFreshness` também vira `"stale"` sempre que o epoch do `producer-state.json` difere do ownership (`producerState.ts:315`): depois de uma transferência, todos os Companions veem o aviso "produtor desatualizado" até o novo produtor gravar.
- A idade do índice textual também pode originar `textStatus = "stale"` (`:323-324`), embora aqui seja informação e não bloqueie a pesquisa.

### F6 — Tri-estado `workAvailable` colapsado em booleano (Média, Confirmado)

- `deriveEmbeddingWorkAvailability` devolve `undefined` quando `detailsAvailable === false` ou o plano é `indeterminate` (canónico ilegível) (`embeddingWorkStatusController.ts:100-105`).
- O resolver faz `Boolean(workState?.workAvailable)` (`embeddingWorkflowState.ts:61`) e, com `status === "ready"`, cai em `idle` (`:184-189`) — apresentando "Atualizados" quando o estado é, na verdade, desconhecido/ilegível.

### F7 — `refreshState()` pesado por cada tick de progresso (Média, Confirmado)

- `onEmbeddingOperationStateChange` chama `refreshState()` em cada mudança (`linaSearchView.ts:1977-1980`), incluindo cada `setProgress` (`embeddingOperationManager.ts`, `updateState`).
- `refreshState` executa `getTextIndexStatus`, `getSemanticSearchAvailability` e `readCompanionConsumptionState`, que **lê `notes.json` e `chunks.jsonl` completos e calcula digests** a cada chamada (`companionConsumptionState.ts:510-535`). Guardas de geração (`stateRefreshGeneration`) descartam resultados obsoletos mas não evitam o I/O.
- Em vaults grandes ou em mobile, isto concorre com a própria geração. `readCompanionConsumptionState` é também executado no Produtor.

### F8 — Três definições de "há trabalho" (Média, Confirmado / caso limite Plausível)

| Onde | Definição |
|---|---|
| `EmbeddingWorkStatusController` | `toGenerate>0 ∨ requiresPublication ∨ missing>0 ∨ stale>0 ∨ obsolete>0 ∨ duplicates>0 ∨ invalid>0` (ou `full-rebuild`) |
| `confirmAndRequestEmbeddingGeneration` / política | `toGenerate>0 ∨ requiresPublication ∨ isFullRebuild` |
| `Scheduler.hasEmbeddingWork` | `toGenerate>0 ∨ requiresPublication` |

- Se existirem `obsolete`/`duplicate`/`invalid` mas `requiresPublication === false` (por exemplo `chunks.length === 0`, `embeddingUpdatePlan.ts:314`), a Sidebar mostra "Atualização necessária" + botão, e o clique devolve "já atualizado" (`main.ts:1702-1704`) — o ciclo repete-se. **Plausível**; requer teste.

### F9 — Temporários de `producer-state.json` na raiz sincronizada (Baixa, Confirmado)

- `saveProducerState` cria `producer-state.json.tmp-*` e `.bak-*` em `.lina/` (`producerState.ts:406-409`), não em `.lina/producer/staging|backups`. A regra do manual para `.stignore` cobre `/.lina/producer/`, não estes nomes. Falhas a meio deixam lixo que o Syncthing propaga. O mesmo padrão deve ser verificado em `ownership.json` e `ownership-history/` (não lido nesta auditoria).

### F10 — `not-active-producer` sem tratamento; confirmação antes de ownership (Baixa, Confirmado)

- `confirmAndRequestEmbeddingGeneration` só valida capabilities e papel (`main.ts:1646-1657`); o modal de confirmação (potencialmente com custo) aparece antes de o `EmbeddingWorker` recusar por ownership. O resultado `not-active-producer` cai no ramo genérico `toastEmbeddingsError` (`main.ts:1736`). O botão da Sidebar está protegido; o comando de paleta e o diagnóstico dependem de `runtime.isActiveProducer`/gate.

### F11 — Desalinhamentos documentais (Baixa, Confirmado)

- LINA-11-IMPLEMENT §3 mostra `getEmbeddingWorkflowState()` com `freshness`/`operation`/`getEmbeddingFreshness()`; o código real usa `workState`, `operationState`, `binaryMaintenancePhase`, `isAuthorizedProducer`, `textIndexReady` (default `true`) e `getEmbeddingFreshness` não existe. Além disso, `main.getEmbeddingWorkflowState()` não tem chamadores; o resolver é invocado diretamente por `linaSearchView.ts:2675` (dois pontos de entrada com defaults diferentes de `textIndexReady`).
- `AGENTS.md` ("geração de embeddings é manual") contradiz o modo `automatic-local-only` já implementado (Fase 0.2.2).
- `generateEmbeddingsOnStartup` / `autoGenerateEmbeddingsOnStartup` são settings que apenas emitem `console.warn` (`main.ts:3685-3690`).
- `getDeviceRuntimeState()` (fallback sem cache) fabrica um `OwnershipManifest` com `reason: "initial"`, `acquiredAt: new Date()` e `epoch ?? 1` (`main.ts:1003-1010`), o que pode confundir diagnósticos.

---

## 6. Riscos

| Risco | Prob. | Impacto | Origem |
|---|---|---|---|
| Utilizador vê "sem pesquisa semântica" após gerar embeddings com sucesso e reinicia/refaz | Média | Alto (confiança) | F1 |
| Dois produtores publicam por cima um do outro após transferência com sync lento | Baixa | Alto (artefactos publicados incoerentes) | F2 |
| Auto-claim concorrente em vault novo com dois desktops | Baixa | Médio | F2 |
| Botão/estado para embeddings desativados | Média | Baixo | F3 |
| Sidebar lenta / consumo de bateria durante geração em mobile-produtor ou vaults grandes | Média | Médio | F7 |
| Avisos de "produtor desatualizado" injustificados após transferência ou inatividade | Alta | Baixo (ruído; erode confiança) | F5 |
| "Atualizados" mostrado com canónico ilegível | Baixa | Médio | F6 |

---

## 7. Dívida técnica

1. Duas fontes de estado de escrita (workflow resolver e VM da Sidebar) e três de "há trabalho" (F8).
2. `DeviceRuntimeState` como cache manual em `main.ts` sem contrato de invalidação (F1).
3. `EmbeddingWorkflowState.canUpdate` e `renderEmbeddingDiagnosticSummary` mortos (F3, F4).
4. `semanticPreparing` como flag booleana extra no VM em vez de derivar do workflow.
5. `readCompanionConsumptionState` faz I/O e digests completos em cada refresh (F7).
6. `linaSearchView.ts` com 7963 linhas concentra apresentação, orquestração e chamadas de I/O.
7. Documentação que descreve APIs inexistentes (F11).
8. Setting(s) de arranque sem efeito.

---

## 8. Recomendações (por ordem)

**R1 (F1) — Invalidar/refrescar `DeviceRuntimeState`.** Chamar `refreshDeviceRuntimeState()` (ou marcar dirty e resolver lazy) em: fim de publicação canónica, fim de recuperação, `refreshEmbeddingConfigurationState`, publicação do índice textual e no `refreshState` com `refreshSemanticAvailability: true`. Alternativa mais sólida: `getDeviceRuntimeState()` passar a ser derivado sem cache persistente, com revisão e invalidação explícita, à semelhança do `EmbeddingWorkStatusController`.

**R2 (F2) — Fencing mínimo, sem lease.** Antes de entrar em `persisting`, reavaliar `OwnershipGate.evaluate(expectedEpoch)` com o epoch capturado no início; se divergir, abortar como `CANCELLED/ownership-lost`, preservar checkpoint e não publicar. Fazer `isAuthorizedSync()` devolver `false` enquanto `lastDecision === null` para operações de escrita (ou exigir uma avaliação inicial). Considerar `autoClaim` só com confirmação do utilizador em dispositivos que não sejam o único produtor.

**R3 (F3, F4, F6) — Uma única fonte de apresentação de escrita.** O VM da Sidebar deve receber apenas `workflow` (e `semanticAvailable` do Read Path) e derivar: texto da linha "Embeddings", visibilidade do botão (`workflow.canUpdate`), e estados `checking/generating/persisting/error`. Remover `embeddingsWorkAvailable`, `embeddingsChecking` e `semanticPreparing` como entradas. Acrescentar ao resolver: `embeddingsEnabled`, `updateMode`/política, e um estado ou flag para `indeterminate` (não converter `undefined` em `idle`). Adicionar `cancelling` como estado explícito ou documentar a exceção. Remover `renderEmbeddingDiagnosticSummary`.

**R4 (F5) — Remover a idade do estado de embeddings e dos avisos.** Eliminar o fallback `embeddingsFreshness`/`companionState.embeddingFreshness` do cálculo de `embeddingsStatus`. Manter a idade só como texto secundário. Rebaixar/remover `producer-stale`/`producer-aging` como alertas de degradação (ou condicioná-los a `workAvailable` ou a `maintenance.status === "error"`). Não marcar o produtor como "stale" por diferença de epoch antes de existir uma publicação do novo produtor; mostrar "aguardar publicação do novo produtor".

**R5 (F7) — Reduzir I/O por evento.** Limitar `refreshState` durante `running`: atualizar apenas o modelo de workflow (barato) a cada progresso e fazer refresh completo em transições de estado terminal. Memoizar `readCompanionConsumptionState` por (mtime/size ou revisão dos manifestos); evitar digest completo de `notes.json` e `chunks.jsonl` em cada chamada.

**R6 (F8) — Unificar "há trabalho".** Expor uma única função `hasEmbeddingWork(preview)` e usá-la no controller, scheduler e `confirmAndRequest`; testar `chunks.length === 0` com registos `obsolete`.

**R7 (F9, F10, F11) — Higiene.** Mover temporários de `producer-state.json` (e verificar ownership) para `.lina/producer/staging`; tratar `not-active-producer` com mensagem própria e mover a verificação de ownership para antes do modal; corrigir LINA-11 e `AGENTS.md`; remover ou implementar as settings de arranque.

---

## 9. Matriz de estados

### 9.1 Workflow × condições (resolver)

| workState | operação | workAvailable | Autorizado + texto pronto | Resultado | Botão (resolver) | Botão (UI real) |
|---|---|---|---|---|---|---|
| ready | idle | false | — | `IDLE` | não | não |
| ready | idle | **undefined** | — | `IDLE` (**F6**) | não | não |
| ready | idle | true | sim | `UPDATE_REQUIRED` | sim | sim |
| ready | idle | true | não (companion/standby) | `UPDATE_REQUIRED` | não | não |
| ready | idle | true | embeddings desativados | `UPDATE_REQUIRED` | sim (**F3**) | sim |
| unknown/dirty/calculating | idle | — | — | `CHECKING` | não | não |
| error | idle | — | sim | `ERROR` | sim (retry) | **não** (**F3**) |
| qualquer | running/preparing/validating/waiting | — | — | `PREPARING` | não | não |
| qualquer | running/generating | — | — | `GENERATING` | não | não |
| qualquer | running/persisting | — | — | `PERSISTING` | não | não |
| qualquer | cancelling | — | — | `PREPARING` (**F4**) | não | não |
| qualquer | failed | — | — | `ERROR` | condicional | não |
| qualquer | cancelled + work | true | — | `UPDATE_REQUIRED` | sim | sim |
| qualquer | cancelled | false | — | `CANCELLED` | não | não |
| qualquer | idle + cópia binária a construir, sem trabalho | false | — | `FINALIZING` | não | não |

### 9.2 Read Path × Write Path (deve ser independente)

| Capacidade semântica | Workflow | Apresentação esperada | Apresentação atual |
|---|---|---|---|
| Disponível | `UPDATE_REQUIRED` | Híbrida completa + "Atualização necessária" | Correto |
| Disponível | `GENERATING` | Híbrida completa + progresso | Linha "Embeddings" diz "Atualização necessária" (**F4**) |
| Disponível | `PREPARING` | Híbrida completa + "A preparar atualização" | "A preparar pesquisa semântica" (**F4**) |
| Indisponível (sem vetores) | `UPDATE_REQUIRED` | Só texto + ação | Correto, se a cache do Read Path estiver atual (**F1**) |
| Disponível | `IDLE` após 3 dias | Sem aviso | Pode mostrar "Atualização necessária" por idade (**F5**) |
| Cache antiga (`text-only`) | `IDLE` após geração | Híbrida completa | Pode ficar `text-only` (**F1**) |

### 9.3 Papéis

| Papel/estado | Lê/pesquisa | Gera | Publica | Vê botão |
|---|---|---|---|---|
| Active Producer | sim | sim (com confirmação conforme política) | sim | sim |
| Standby Producer | sim | não (gate) — **mas `isAuthorizedSync()` otimista antes da 1.ª avaliação (F2)** | não | não |
| Companion (Desktop/Mobile) | sim (+ delta local efémero) | não | não | não |
| Unassigned | sim | não | não | não |

### 9.4 Proveniência

| Estado | Efeito na pesquisa | Efeito em rebuild | Efeito na UI |
|---|---|---|---|
| valid | nenhum | nenhum | nenhum |
| stale (epoch anterior) | nenhum | **nenhum** (confirmado) | Rótulo "Época anterior"; ruído após transferência (F5) |
| future | nenhum | nenhum | Rótulo "Futuro" |
| unknown (legado) | nenhum | nenhum | Rótulo "Sem metadados" |

---

## 10. Testes em falta

1. Sidebar real (não mock) depois de geração concluída: `DeviceRuntimeState` e linha "Embeddings" atualizam sem abrir o diagnóstico (F1).
2. Mudança de provider/modelo: Read Path e workflow atualizam na mesma sessão (F1).
3. Transferência de ownership durante geração: publicação abortada, checkpoint preservado, sem artefactos publicados com epoch antigo (F2).
4. `isAuthorizedSync()` para standby antes de qualquer `evaluate()` (F2).
5. Dois produtores em vault sem manifesto: apenas um obtém `epoch 1` (F2).
6. Botão vs `embeddingsEnabled=false`, vs modo automático, vs `error` (F3).
7. Linha "Embeddings" em `GENERATING/PERSISTING/PREPARING` com `workAvailable=true` (F4).
8. `semanticAvailable=true` + operação em `preparing`: cabeçalho não afirma "a preparar pesquisa semântica" (F4).
9. Embeddings com `producerFreshness/embeddingFreshness = stale` por idade e sem drift: estado não pode ser "Atualização necessária" (F5).
10. `workAvailable === undefined` com `status === "ready"` não resulta em `IDLE` (F6).
11. Contador de I/O em `refreshState` durante 200 ticks de progresso (F7).
12. `chunks.length === 0` com registos `obsolete/duplicate/invalid`: controller, scheduler e `confirmAndRequest` concordam (F8).
13. `saveProducerState` falha a meio e não deixa temporários fora de `.lina/producer/` (F9).
14. `not-active-producer` mostra mensagem própria e não abre modal de custo (F10).
15. Companion com settings de provider diferentes do produtor: sem "Atualização necessária" acionável (Plausível; ver perguntas abertas).

---

## 11. Decisões a congelar

1. **Duas dimensões independentes:** Read Path (`DeviceRuntimeState.embeddings`) responde a "posso pesquisar?"; Write Path (`EmbeddingWorkflowState`) responde a "há trabalho/estou a atualizar?". Nenhum texto de pesquisa depende do workflow e vice-versa.
2. **A idade nunca decide validade, estado de embeddings ou necessidade de atualização.** Só hashes, chunks, manifesto e plano.
3. **Uma só definição de "há trabalho"**, partilhada por controller, scheduler e pedido manual.
4. **A Sidebar consome o workflow canónico**; não recompõe estado a partir de flags soltas.
5. **Proveniência é histórica e não bloqueante**; `stale` nunca dispara rebuild, transferência nem bloqueio.
6. **Ownership vale no momento de publicar**, não apenas no arranque da operação (a implementar em R2).
7. **`.lina/index/` = canónico e sincronizado; `.lina/producer/` = operacional e não sincronizado; `.lina/producer-state.json` = telemetria observacional.** Nenhum temporário fora destes limites.
8. **Companion nunca gera, nunca agenda, nunca mostra ação de escrita.**
9. **Pesquisa textual permanece independente e disponível em qualquer estado semântico** (já garantido; congelar).

---

## 12. Perguntas finais obrigatórias

**1. O ciclo de embeddings está coerente?**
**Parcialmente.** O núcleo de escrita (plano → operação → checkpoint → publicação → invalidação) é coerente e bem protegido. A coerência quebra na *apresentação* (F3–F6) e na *cache do Read Path* (F1).

**2. Existem fontes duplicadas de estado?**
**Sim.** (a) "há trabalho" em três definições (F8); (b) estado de escrita na Sidebar entre `workflowState`, `embeddingsWorkAvailable`, `embeddingsChecking`, `semanticPreparing` e `statusEl`; (c) `DeviceRuntimeState` em cache vs `semanticCompatibility` fresco em `refreshState`; (d) duas rotas para o resolver (`main.getEmbeddingWorkflowState` sem chamadores vs chamada direta); (e) idade (`producer-state.json`) vs drift real (F5).

**3. A pesquisa semântica é confiável?**
**Sim quanto ao mecanismo** (identidade estrita, filtragem por `validForSearch`, cache runtime com invalidação, fallback para texto, checkpoint nunca pesquisável). **Não totalmente quanto ao estado apresentado**: F1 pode indicar indisponibilidade quando a pesquisa funciona, e F5/F6 podem indicar "atualizar"/"atualizado" sem base em drift.

**4. O workflow de geração é previsível?**
**Sim na execução** (single-flight, lotes sequenciais, cancelamento cooperativo, ponto de não retorno bem definido, backoff). **Menos no gatilho e na comunicação**: modo manual vs automático não está no resolver, o botão ignora `embeddingsEnabled`, o "trabalho" difere entre componentes (F3, F8) e a autoridade não é revalidada (F2).

**5. Producer e Companion estão corretamente separados?**
**Na escrita, sim** (capabilities, política, gate, workers, scheduler). **Pontos fracos:** `isAuthorizedSync()` otimista e sem fencing (F2); UX de Companion herda o texto "Atualização necessária" e o alerta de produtor desatualizado (F5) — em Companions cujo provider/modelo local difiram do publicado, o plano local pode devolver `full-rebuild` (Plausível, não verificado em runtime).

**6. O Lina está preparado para release?**
**Sim, condicionado.** Nenhum achado indica perda de dados, corrupção de embeddings ou envio de conteúdo a terceiros sem confirmação. Recomendo, antes de uma release pública: **R1 (F1)** e **R4 (F5)** como mínimos, por afetarem diretamente o que o utilizador vê; **R2 (F2)** pelo menos na forma "reavaliar ownership antes de `persisting`". Os restantes podem seguir em versão posterior. Esta conclusão não substitui a validação manual em Obsidian e a execução da suíte, que esta auditoria não fez.

---

## 13. Perguntas em aberto / não verificado

- Comportamento de `embeddingPersistence.ts` e `embeddingGenerator.ts` quanto a re-validação de ownership (só confirmei por pesquisa que não existe referência a ownership/epoch nestes ficheiros).
- Se `ownership.json` e `ownership-history/` também usam temporários na raiz de `.lina/` (F9).
- Comportamento em Companion com settings de provider diferentes das do produtor (`nextGenerationIdentity` vs contrato herdado).
- Reprodução em runtime de F1, F4, F5, F8 (todos deduzidos de leitura do código e das cadeias de chamada).

---

## 14. Confirmações de âmbito

- Nenhum ficheiro de código, teste, configuração ou schema foi alterado; apenas este relatório foi criado.
- Nenhuma nota do vault foi alterada; nenhum embedding foi gerado; nenhuma chamada externa foi feita.
- Nenhum commit foi realizado.

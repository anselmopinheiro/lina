# LINA-12B-AUDIT-SEMANTIC-STATE-CONSOLIDATION-001

**Tipo:** Auditoria complementar (apenas análise — nenhum código, teste, schema ou migration alterado)
**Origem:** `LINA-12-AUDIT-COMPLETE-EMBEDDING-LIFECYCLE-001`, achados F1, F3, F4
**Estado Git:** `master`, HEAD `f5f840d`, working tree limpa (exceto os relatórios de auditoria)

## 0. Método e limites

- O pedido chegou **truncado em "Fonte esperada:"** (secção F4). F1 e F3 foram auditados com as perguntas completas; F4 foi auditado pela definição do LINA-12 (Read Path = capacidade de pesquisa; Write Path = workflow de atualização) e pelas perguntas implícitas (existe acoplamento? onde? qual o contrato?). Se a especificação de F4 tinha perguntas adicionais, devem ser reenviadas.
- Método: pesquisa exaustiva por símbolo em `main.ts` e `src/**` (`resolveDeviceRuntimeState`, `getDeviceRuntimeState`, `refreshDeviceRuntimeState`, `workAvailable`, `canUpdate`, `embeddingsWorkAvailable`, `embeddingsChecking`, `semanticPreparing`, `workflowState`, `hasEmbeddingWork`, `requiresPublication`, `getSemanticSearchAvailability`) e leitura das funções envolvidas.
- **Não lido em detalhe:** `embeddingGenerator.ts` (só as referências a `readEmbeddingStatus`, `readCanonicalEmbeddingFileState` e `requiresPublication` na linha 1028), `runtimeEmbeddingIndex.ts`, `embeddingPersistence.ts`.
- **Não executei testes** nem reproduzi nada em runtime. Cada afirmação indica **Confirmado** (cadeia de chamadas lida) ou **Plausível**.
- Rectificação ao LINA-12: o impacto de F1 é **maior** do que reportado — a cache não afeta só a apresentação, **bloqueia a pesquisa semântica pura** (ver §1.4).

---

# Parte 1 — F1: `DeviceRuntimeState` e invalidação do Read Path

## 1.1 Onde é criado e por quem

`resolveDeviceRuntimeState` (função pura, `deviceRuntimeState.ts:138`) tem **três** chamadores de produção, com entradas diferentes:

| # | Chamador | Ficheiro | Ownership | Manifestos | `semanticAvailability` | `embeddingsEnabled` | Override de produtor | Escreve na cache? |
|---|---|---|---|---|---|---|---|---|
| A | `refreshDeviceRuntimeState()` | `main.ts:1016-1077` | lido do disco (`loadOwnership`) | lidos do disco | fresco (`getSemanticSearchAvailability`) | sim | não | **sim** (`:1076`) |
| B | `getDeviceRuntimeState()` (ramo sem cache) | `main.ts:989-1014` | **fabricado** a partir do `OwnershipGate.lastDecision` (`acquiredAt = agora`, `reason = "initial"`, `epoch ?? 1`) | **nenhum** | **nenhum** | sim | sim | não |
| C | `buildDeviceDiagnostics()` via `readDeviceDiagnostics()` ← `getDeviceDiagnostics()` | `deviceDiagnostics.ts:217`; `main.ts:963-987` | lido do disco | lidos do disco | fresco | **não** | não | **sim** (`main.ts:984`) |

Consequências (todas **Confirmadas**):

- O objeto em cache tem **origem variável**: depende de qual dos caminhos A ou C escreveu por último. `embeddings.configured` alterna entre valor real e `false` (o campo não é consumido em lado nenhum — dívida morta, não bug ativo).
- O ramo B, se usado, devolve `textIndexAvailable = false` e capacidade "sem contrato" por falta de manifestos. Só se aplica antes do primeiro refresh; o `onload` aguarda `loadDataFromDisk`, pelo que é uma janela pequena, mas o contrato do método permite-o.
- `deviceDiagnostics.ts:377` **recalcula `evaluateSemanticCapability` uma segunda vez** (secção `companionSearch`), com regra própria para `vectorContractState` (deriva só do estado Companion, ao passo que `resolveDeviceRuntimeState` dá prioridade ao `semanticAvailability`). Hoje coincidem, porque `targetVectorContract` nunca é passado (o estado `mismatch` é inatingível por este caminho), mas são duas implementações da mesma decisão.
- Entradas mortas: `isChecking` e `providerReachable` **nunca são passadas** em produção (`grep` só encontra a declaração e o uso interno). Logo `runtimeState === "checking"` e `reasonCode "provider-unreachable"/"runtime-checking"` são **inatingíveis**; `isCheckingFromRuntime` no Sidebar VM (`:340`) é código morto.

## 1.2 Quem mantém a cache

Único dono: `LinaPlugin.deviceRuntimeState` (`main.ts:303`). Sem revisão, sem dirty flag, sem timestamp, sem subscritores, sem single-flight. Os consumidores lêem-na de forma síncrona:

| Consumidor | Uso | Tipo de decisão |
|---|---|---|
| `linaSearchView.refreshState` (`:2670-2726`) | `semanticAvailable`, `reason`, `reasonCode`, `exists`, `contractState`, `effectiveMode`, `isActiveProducer` | Apresentação + botão |
| `linaSearchView.runSemanticSearchGrouped` (`:3755-3759`) | `semanticAvailable`, `reason` | **Decisão funcional: bloqueia a pesquisa semântica pura** |
| `main.getEmbeddingWorkflowState` (`:866-875`) | `isActiveProducer` | Autorização do botão/workflow |
| `settings.ts` (`:798, 832, 1144`) | papel, `isActiveProducer` | Resumos e ação de mudança de papel |
| `main.ts:715-718` (comando de diagnóstico) | papel, standby | Gating de ações da modal |

## 1.3 Eventos que alteram a capacidade semântica × invalidação existente

Legenda: ✔ atualiza `DeviceRuntimeState`; ✗ não atualiza; ◐ atualiza só de forma indireta.

| Evento | Altera Read Path? | Invalida cache do estado? | Invalida outros caches? | Evidência |
|---|---|---|---|---|
| Abertura/reload do vault | Sim | ◐ **ordem incorreta** (ver §1.5) | — | `main.ts:3605-3610, 3670-3675` |
| Geração concluída / publicação canónica | **Sim** | **✗** | índice runtime ✔, work-status dirty ✔ | `main.ts:2883-2885` |
| Recuperação de checkpoint publicado | Sim | ✗ | idem | `main.ts:2883` |
| Publicação do índice textual (batch automático, rebuild) | Sim (`textIndexAvailable`, contrato, `sourceTextGenerationId`) | ✗ | índice runtime ✔, work-status dirty ✔ | `main.ts:3520-3521, 2362` |
| Alteração de provider | **Sim** (`incompatible`) | **✗** | contrato ✔ (`loadCanonicalVectorContract`), índice runtime ✔, work dirty ✔ | `main.ts:887-893`, `settings.ts:1178` |
| Alteração de modelo | Sim | ✗ | idem | idem |
| Alteração de prefixo/`inputVersion` | Sim | ✗ | — | — |
| Alteração de papel | Sim | **✔** | — | `main.ts:1185, 1200` |
| Transferência de ownership (Definições/diagnóstico) | Sim (`isActiveProducer`) | ✔ só pelo `getDeviceDiagnostics` da modal | — | `main.ts:731-733` |
| Transferência de ownership (comando `transferir-ownership-dispositivo`) | Sim | **✗** | listeners ✔ | `main.ts:787-796` |
| Criação/remoção/atualização da cópia binária, ou mudança de preferência `prefer-binary` | Sim (`binary-required/stale/invalid`) | ✗ | índice runtime ✔ (`onBinaryPublicationReady`) | `main.ts:1494` |
| Sincronização externa de artefactos (Syncthing) a meio da sessão | Sim | ✗ | nenhum (não há watcher; `external-sync-detected` existe como tipo mas ninguém o emite) | grep `external-sync-detected` |
| Rollback de publicação | Sim | ✗ | índice runtime ✔ | — |
| Abertura da modal de diagnóstico | Sim (efeito colateral) | **✔ (cura a cache)** | — | `main.ts:963-987` |

A cache é atualizada em **3 situações programáticas** (arranque, mudança de papel, diagnóstico), nenhuma delas ligada aos eventos que mudam a capacidade semântica. O facto de "abrir o diagnóstico" curar a cache torna o defeito **intermitente e difícil de reproduzir**.

## 1.4 Impacto funcional confirmado

1. **Pesquisa semântica pura bloqueada pela cache** (`linaSearchView.ts:3755-3759`): `if (!runtimeState.embeddings.semanticAvailable) { … return; }`. Num vault novo, depois da primeira geração bem-sucedida, o modo "semântica" continua a recusar-se até se abrir o diagnóstico ou reiniciar.
2. **Pesquisa híbrida não é afetada** — `runHybridSearch` chama `getSemanticSearchAvailability` a fresco (`hybridSearch.ts:558`). Portanto o mesmo dispositivo tem **dois critérios** para "a pesquisa semântica está disponível": fresco (híbrida) e em cache (semântica pura e Sidebar).
3. **Sidebar** usa a cache para `isOperational` (`sidebarStatusViewModel.ts:347-349`), logo a linha "Embeddings" e o cabeçalho de modo dependem do estado antigo. O `semanticCompatibility` calculado a fresco em `refreshState` (`:2659`) só entra como *fallback* (`??`) do texto do motivo.
4. **Mudança de provider/modelo**: a cache mantém `semanticAvailable = true` até refresh; a pesquisa semântica pura prossegue e só é travada pelas verificações de identidade posteriores (`:3782+`), com mensagem diferente da do Sidebar.
5. **Troca de ownership pelo comando de paleta**: `isActiveProducer` fica desatualizado; o botão "Atualizar embeddings" pode continuar visível num dispositivo despromovido (a recusa ocorre depois, no `EmbeddingWorker`).

## 1.5 Achado adicional: ordem de arranque (Companion)

`loadDataFromDisk` faz `evaluate()` → `refreshDeviceRuntimeState()` → `initializeExclusionPolicy()` → `loadCanonicalVectorContract()` (`main.ts:3605-3610` e `3670-3675`). O contrato vetorial só é carregado **depois** de o estado runtime ser calculado, e `effectiveVectorContract` só é lido em `loadCanonicalVectorContract` (chamado no arranque e em `refreshEmbeddingConfigurationState`; `setEffectiveEmbeddingContract` não tem chamadores).

Para um **Companion**, `getEffectiveEmbeddingConfig()` devolve `provider: ""`, `model: ""`, `isAvailable: false` enquanto o contrato for `null` (`main.ts:2495-2507`). Assim `getSemanticSearchAvailability(app, "", "")` no primeiro refresh conclui `incompatible` (ou equivalente) e essa conclusão **fica em cache** — **Plausível** para o resultado final, **Confirmado** para a ordem e para a ausência de novo refresh. Além disso, se o produtor publicar um contrato novo durante a sessão, o Companion continua com o contrato antigo até mudar as settings ou reiniciar.

## 1.6 Respostas às perguntas de F1

**A cache atual é segura?** **Não.** É uma cópia mutável sem revisão, com três escritores heterogéneos, uma ordem de arranque que a preenche antes das suas dependências, e usada para decidir funcionalidade (não só UI).

**Existe algum mecanismo de invalidação?** Para este estado, **não**. Existem para (a) o índice runtime de embeddings (`invalidateRuntimeEmbeddingIndex`, com razões tipadas) e (b) o estado de trabalho (`EmbeddingWorkStatusController.markDirty`, com revisão). Ambos são disparados nos eventos certos, o que mostra que os pontos de invalidação já existem — só falta ligá-los ao Read Path.

**Qual seria o ponto arquitetural correto para invalidar?** Nos pontos de estrangulamento (*choke points*) que já invocam `markEmbeddingWorkStatusDirty` / `invalidateRuntimeEmbeddingIndex` (`main.ts:2884-2885, 3520-3521, 2362, 887-893`), mais os que hoje não invalidam nada: papel, ownership (qualquer via), contrato carregado, cópia binária, preferência de leitura, e sincronização externa. Devem convergir para **uma única primitiva** (`markCapabilityDirty(reason)`), e não para chamadas espalhadas a `refreshDeviceRuntimeState`.

**É preferível cache com invalidação explícita, resolução lazy ou coordenador orientado a eventos?**

| Opção | Prós | Contras | Veredicto |
|---|---|---|---|
| A. Cache + invalidação explícita | Mudança pequena; reaproveita o padrão do `EmbeddingWorkStatusController` | Depende de cada emissor lembrar-se de invalidar; sem revisão, corridas de escrita (A vs C) | Necessário mas insuficiente |
| B. Resolução lazy em cada uso | Sem estado a invalidar | Resolver faz I/O pesado (`readEmbeddingStatus` lê o `embeddings.jsonl` inteiro com guardrails; ver `embeddingGenerator.ts:1654`); a Sidebar refresca por cada tick de progresso → custo inaceitável, sobretudo em mobile | Rejeitada como estratégia única |
| C. Coordenador orientado a eventos com recálculo eager | Sempre atual | Recalcula I/O sem consumidor; viola "sem polling / sem trabalho sem necessidade" do `AGENTS.md` | Rejeitada na forma eager |
| **A+B híbrida ("C-lite")** | Estado derivado com **revisão**, `markDirty(reason)` O(1) nos choke points, **cálculo lazy, single-flight, protegido por revisão**, subscritores só para render; consumidores funcionais fazem `await getFresh()` | Exige um novo módulo pequeno | **Recomendada** |

A recomendação replica o contrato já validado do `EmbeddingWorkStatusController` (dirty → calculating → ready, descarte de cálculos tardios, sem trabalho sem subscritores) aplicado ao Read Path. Restrições de desenho:

1. **Duas metades:** identidade/papel/ownership (barata, síncrona, derivada de estado já em memória) e capacidade semântica (I/O, assíncrona). Um só snapshot imutável com `revision` compõe ambas.
2. **Grafo de dependências explícito:** o cálculo só arranca depois de: papel resolvido → ownership avaliado → contrato carregado → configuração efetiva resolvida. Isto elimina o problema do §1.5.
3. **Um único leitor de factos** (ver §2.6): o Read Path não deve reler o `embeddings.jsonl` que o Write Path já leu no mesmo ciclo.
4. **Decisões funcionais** (pesquisa semântica pura, botão) usam `getFresh()`; **render** usa `getSnapshot()` + `subscribe`.
5. **Sync externa sem polling:** validação por *impressão digital* na utilização (`stat` de `manifest.json`, `embeddings.jsonl`, `ownership.json`: mtime+size), executada à abertura da Sidebar e antes de uma pesquisa — O(1), sem timers. Alinha com a conservadora regra já adotada por `RuntimeEmbeddingIndexCache` (`sourceIdentity`).
6. **Uma só chamada a `evaluateSemanticCapability`** por snapshot; a secção `companionSearch` do diagnóstico consome esse resultado.
7. Remover os parâmetros mortos `isChecking`/`providerReachable`, ou passar a alimentá-los a partir do estado do coordenador (`calculating` → `checking`).

---

# Parte 2 — F3: unificação do estado de workflow

## 2.1 Inventário: quantas definições de "há trabalho" existem?

| # | Onde | Regra | Tipo | Estado |
|---|---|---|---|---|
| D1 | `EmbeddingWorkStatusController` — `hasEmbeddingWorkAvailable` + `deriveEmbeddingWorkAvailability` (`embeddingWorkStatusController.ts:85-105`) | `toGenerate>0 ∨ requiresPublication ∨ missing>0 ∨ stale>0 ∨ obsolete>0 ∨ duplicate>0 ∨ invalid>0`; `full-rebuild ⇒ true`; `indeterminate/sem detalhes ⇒ undefined` | `boolean \| undefined` | Vivo |
| D2 | `resolveEmbeddingWorkflowState` (`embeddingWorkflowState.ts:61`) | `Boolean(workState.workAvailable)` — colapsa `undefined` em `false` | `boolean` | Vivo |
| D3 | Sidebar VM (`sidebarStatusViewModel.ts:355, 366`) | `embeddingsWorkAvailable === true`, só em 2 ramos; ignorado quando `isEmbeddingsChecking` | `boolean` | Vivo |
| D4 | Botão da Sidebar (`linaSearchView.ts:2829-2834`) | `isAuthorizedProducer ∧ workAvailable===true ∧ !running ∧ !cancelling ∧ indexReady` | `boolean` | Vivo |
| D5 | `confirmAndRequestEmbeddingGeneration` (`main.ts:1674`) | `toGenerate>0 ∨ requiresPublication ∨ isFullRebuild` (recalculado com novo `readEmbeddingUpdatePreview`) | `boolean` | Vivo |
| D6 | `hasAutomaticEmbeddingWork` (`main.ts:2576-2585`) | `toGenerate>0 ∨ requiresPublication` (novo preview) | `boolean` | Vivo |
| D7 | Execução (`embeddingGenerator.ts:1028`) | decisão própria no arranque da geração: `totalToGenerate===0 ∧ plan.requiresPublication ⇒ publicar sem gerar` (plano recalculado; resto não lido) | — | Vivo |
| D8 | `buildEmbeddingStatusViewModel` (`embeddingStatusViewModel.ts:96-164`) | regra própria por `mode` (`full-rebuild`/`generate`/`update`) e `workAvailable` | — | **Sem chamadores** (só tipos importados em `linaSearchView.ts`), mas a Sidebar mantém `renderEmbeddingDiagnosticSummary/Details` e `handleEmbeddingDiagnosticAction` que dependem dele |
| D9 | `explainEmbeddingStatus` (modal de confirmação) | classificação por contagens `missing/stale/obsolete` | — | Auxiliar |

**Resposta 1:** seis definições semanticamente distintas em uso (D1, D3–D7), mais D2 (derivada de D1 com perda de informação) e duas auxiliares/mortas (D8, D9).

## 2.2 Divergências concretas

| Situação | D1 (controller) | D5/D6 (pedido/scheduler) | Efeito |
|---|---|---|---|
| Só há registos `obsolete`/`duplicate`/`invalid` e `chunks.length === 0` | `true` | `false` (`requiresPublication` exige `chunks.length > 0`, `embeddingUpdatePlan.ts:314`) | Sidebar: "Atualização necessária" + botão; clique: "já atualizado" — ciclo permanente (**Plausível**, falta teste) |
| `full-rebuild` sem chunks | `true` | `false` | idem |
| Canónico ilegível (`indeterminate`) | `undefined` → D2 `false` → `IDLE` | `toGenerate=0`, `requiresPublication=false` → `false` | Mostra "Atualizados" quando o estado é desconhecido (**Confirmado**) |
| `embeddingsEnabled = false` | `true` (não considera) | `true` (não considera) | Botão visível com embeddings desativados (**Confirmado**: nenhum dos caminhos lê `embeddingsEnabled`) |
| Companion com `full-rebuild` (settings locais divergentes) | `true` | — | "Atualização necessária" não acionável (**Plausível**) |
| Modo automático | `UPDATE_REQUIRED` durante o *quiet period* (30 s–5 min) com botão manual visível | Scheduler em `scheduled` | O estado "agendado/backoff" não chega à UI (**Confirmado**: `EmbeddingScheduler.getState()` não é consumido) |

### Estados paralelos adicionais (mesma pergunta, fontes diferentes)

| Pergunta | Fontes hoje |
|---|---|
| **Geração em curso** | `EmbeddingOperationState.status/phase` (canónica) · `EmbeddingWorker.state` (`idle/running/error`, notificações são *no-op*) · `isSemanticPreparationActive()` · `semanticPreparing` · fase da cópia binária (→ `FINALIZING`) · `statusEl` (mensagens imperativas) · `automaticDispatchInFlight` do scheduler · token do `IndexWriteCoordinator` |
| **Erro** | `operationState.error` · `workState.errorCategory` (`refresh-failed`) · workflow `ERROR` · `worker.state.lastError` · backoff do scheduler · `producer-state.json → maintenance.lastError` (persistido) · `statusEl` |
| **Concluído** | `operationState.status === "completed"` + `message` · **sem estado no workflow** (o resolver não tem ramo `completed`; cai em `checking → idle`) · `statusEl` |

**Concluído nunca é um estado do workflow.** Pior: `applyEmbeddingOperationState` escreve a mensagem de sucesso em `statusEl` (`linaSearchView.ts:2029-2031`), e imediatamente a seguir a mesma subscrição chama `refreshState()` (`:1977-1980`), cujo ramo final faz `setStatus("")` (`:2687`) sempre que a operação não está `running/cancelling/failed`. O feedback de conclusão é apagado pelo canal que devia mostrá-lo (**Plausível** quanto ao *timing*; **Confirmado** quanto ao código).

### Uso de `canUpdate`, `workflowState`, `embeddingsChecking`, `semanticPreparing`

- `canUpdate`: definido em todos os retornos do resolver; **zero leituras**.
- `workflowState`: calculado em `linaSearchView.ts:2675` e passado para o VM, que apenas o devolve em `workflow` (`sidebarStatusViewModel.ts:534`); **o render também não lê `sidebarStatus.workflow`**. É um campo transportado e nunca consumido.
- `embeddingsChecking` (`linaSearchView.ts:2702-2706`): recomposto localmente como `!semanticAvailable ∧ (work unknown ∨ calculating ∨ semanticPreparing)` — mistura Read (`semanticAvailable`), Write (`work`) e Write-de-execução (`semanticPreparing`).
- `semanticPreparing`: função de `operationState`; ver F4.
- `main.getEmbeddingWorkflowState()`: sem chamadores; o resolver é chamado diretamente pela Sidebar. Os defaults divergem (`textIndexReady ?? true` vs `indexReady` real).

## 2.3 Existe uma única fonte de verdade? — **Não.**

Existe uma fonte de **dados** razoavelmente única (`readEmbeddingUpdatePreview` → `calculateEmbeddingUpdatePlan`), mas **cinco reduções diferentes** desses dados para "há trabalho" (D1, D5, D6, D7, D8) e **uma camada de apresentação** (Sidebar VM) que não consome o único resolver existente.

## 2.4 Contrato único proposto

### Princípio

O plano de atualização (`EmbeddingUpdatePlanPreview`) é o único produtor de factos. Toda a decisão "há trabalho / que trabalho / é acionável" passa a ser calculada **uma vez**, num único módulo puro, e reutilizada por controller, pedido manual, scheduler, execução (para validação) e Sidebar.

### 2.4.1 Função única de trabalho

```
classifyEmbeddingWork(preview, ctx): EmbeddingWorkAssessment

EmbeddingWorkAssessment =
  | { kind: "none" }
  | { kind: "indeterminate", reason: "canonical-unreadable" | "details-unavailable" }
  | { kind: "pending", mode: "initial-build" | "incremental" | "full-rebuild" | "publish-only",
      toGenerate, stale, missing, obsolete, requiresPublication }
```

Regra única: `pending` ⇔ `toGenerate>0 ∨ requiresPublication ∨ mode==="full-rebuild"∧totalChunks>0`. Contagens de `obsolete/duplicate/invalid` **sem** publicação necessária deixam de contar como trabalho (passam a informação diagnóstica). `indeterminate` é estado próprio e nunca vira `none`. Decidir explicitamente o caso `chunks.length === 0` (recomendado: `none`).

### 2.4.2 Workflow estendido (contrato de saída)

```
EmbeddingWorkflowSnapshot {
  revision
  phase: idle | checking | indeterminate | update-required
       | preparing | generating | persisting | finalizing | cancelling
       | error | cancelled
  work: EmbeddingWorkAssessment                 // única definição de "trabalho"
  progress?: { processed, total, generated, reused, failed }
  lastOutcome?: { kind: completed | failed | cancelled, at, message?, errorCategory? }  // estado explícito de "concluído"
  trigger: { mode: manual | automatic-local, scheduled?: { at }, backoff?: { until } }
  action: {
    visible: boolean
    enabled: boolean
    blockedReason?: not-producer | not-active-owner | embeddings-disabled
                  | text-index-not-ready | operation-active | policy-blocked | companion
    requiresConfirmation: boolean
  }
}
```

- O `lastOutcome` substitui o uso de `statusEl` como transportador de "concluído".
- `action.*` substitui `canUpdate` **e** a condição ad-hoc do botão (D4), incluindo `embeddingsEnabled`, modo (manual/automático) e a decisão da política de custos.
- `cancelling` deixa de ser mapeado para `preparing`.
- Extensão de `ResolveEmbeddingWorkflowInput`: `embeddingsEnabled`, `updateMode`, `providerCapability` (ou o `EmbeddingPolicyDecision`), `schedulerState`, `role`.

### 2.4.3 O que a Sidebar deve receber

Só três blocos e nada mais:

```
SidebarInput {
  role:      { roleKey, canWrite }
  read:      SemanticCapabilitySnapshot      // Parte 1
  write:     EmbeddingWorkflowSnapshot       // acima
  textIndex: { usability, updatedAt, totalNotes? }
  info?:     { embeddingsPublishedAt?, textIndexPublishedAt? }  // só texto secundário
}
```

Remover das entradas: `embeddingsReady`, `embeddingsChecking`, `embeddingsWorkAvailable`, `semanticPreparing`, `embeddingsFreshness`, `runtimeEmbeddings` (substituído por `read`). O VM deriva a **linha "Embeddings"**, o **botão** e o **texto de progresso** exclusivamente de `write`, e o **cabeçalho de modo** exclusivamente de `read` + `textIndex`.

### 2.4.4 Tabela de decisão (verificável)

| `write.phase` | Linha "Embeddings" | Botão | `statusEl` |
|---|---|---|---|
| `idle` | "Atualizados" | não | vazio (ou `lastOutcome` efémero) |
| `checking` | "A verificar…" | não | vazio |
| `indeterminate` | "Estado desconhecido" | ação de refresh | vazio |
| `update-required` | "Atualização necessária" (+ agendada/backoff se aplicável) | `action.visible` | vazio |
| `preparing/generating/persisting/finalizing` | "A atualizar… (x/y)" | não (mostrar Cancelar) | progresso |
| `cancelling` | "A cancelar…" | não | — |
| `error` | erro + retry se `action.enabled` | idem | erro |
| `cancelled` | "Cancelado" (+ voltar a `update-required` se ainda há trabalho) | conforme trabalho | — |

## 2.5 Regra de propriedade

- **Um único resolver** exportado de `embeddingWorkflowState.ts`; `main.getEmbeddingWorkflowState` passa a ser o único ponto de acesso (ou é removido e o coordenador expõe o snapshot).
- **Um único `assess`** (2.4.1) usado por D1, D5, D6 e pela validação pré-execução (D7).
- `EmbeddingWorker.state` e `statusNotifications` (no-op) devem ser removidos ou passar a alimentar `write`, não coexistir.
- Eliminar `buildEmbeddingStatusViewModel`/`renderEmbeddingDiagnostic*` **ou** reencaminhá-los para consumir `write`; hoje são código morto que reintroduz regras.

## 2.6 Partilha de dados entre Read e Write (custo)

Num ciclo de refresh, o mesmo `embeddings.jsonl` é lido, no mínimo, por: `getSemanticSearchAvailability → readEmbeddingStatus` (Read), `refreshSummary → readEmbeddingStatus` (Write) e `readEmbeddingUpdatePreview` (Write), além de `readCompanionConsumptionState` (digest de `notes.json` + `chunks.jsonl`). Cada evento de progresso da geração dispara `refreshState()` com `refreshSemanticAvailability: true` (`linaSearchView.ts:1977-1980`), multiplicando estas leituras por tick.

Proposta: um **`EmbeddingCorpusFacts`** revisionado (identidade publicada, legibilidade, contagens válidas, preview do plano, impressão digital dos ficheiros), lido **uma vez** e consumido por Read e Write. Partilhar **dados** não viola a separação; partilhar **estados derivados** viola.

---

# Parte 3 — F4: separação entre Read Path e Write Path

## 3.1 Definições

- **Read Path:** "consigo pesquisar semanticamente com os vetores publicados neste dispositivo?" — função de `{artefactos publicados, contrato vetorial, configuração efetiva do dispositivo, disponibilidade de fontes (binário/JSONL)}`.
- **Write Path:** "há trabalho? há atualização em curso? posso/devo atualizá-la?" — função de `{plano, operação, política, ownership, papel, texto pronto}`.

## 3.2 O que está bem separado

1. `evaluateSemanticCapability` (`semanticCapability.ts`) é pura e **não importa nada do Write Path**.
2. `EmbeddingWorkStatusController` e `EmbeddingOperationManager` não importam o Read Path.
3. **Checkpoints não são pesquisáveis** — o Read Path ignora-os (`AGENTS.md`, testes de ciclo).
4. A pesquisa híbrida consulta a disponibilidade a fresco e não depende do workflow (mantém-se utilizável em `UPDATE_REQUIRED`, `GENERATING`, `ERROR`).
5. `embeddingUpdatePlan` usa a identidade *alvo* (configuração) e a *publicada*, sem consultar a capacidade de pesquisa.

## 3.3 Acoplamentos encontrados

| # | Direção | Onde | Descrição | Gravidade |
|---|---|---|---|---|
| C1 | Write → Read (apresentação) | `sidebarStatusViewModel.ts:417-426` | `semanticPreparing` (fase de *geração*) substitui o título "Pesquisa … disponível" por "A preparar pesquisa semântica", mesmo com `semanticAvailable = true` | Média |
| C2 | Write → Read (estado) | `sidebarStatusViewModel.ts:341`; `linaSearchView.ts:2702-2706` | `isEmbeddingsChecking` mistura `runtimeState`, `work.status` e `semanticPreparing` num único booleano | Média |
| C3 | Write → Read (alerta) | `sidebarStatusViewModel.ts:491-496` | O alerta de "pesquisa semântica indisponível" é suprimido por `!semanticPreparing ∧ !embeddingsChecking`: um estado de escrita esconde uma falha de leitura | Média |
| C4 | Read → Write (rótulo) | `sidebarStatusViewModel.ts:347-357, 362-363` | `isOperational` (Read) decide se `workAvailable` (Write) se apresenta como "stale"; `contractState === "mismatch"` (Read) também produz "Atualização necessária" (Write), mesmo em Companion onde não é acionável | Média |
| C5 | Read ← config (legítimo) | `hybridSearch.ts:123-128` | A capacidade depende da configuração local (a consulta tem de ser embebida com o mesmo modelo). É **legítimo**, mas obriga a invalidar o Read Path quando a configuração muda (F1) | — |
| C6 | Read gated por cache | `linaSearchView.ts:3755` | O Read Path decide a pesquisa via cache que o Write Path (publicação) não invalida | **Alta** (F1) |
| C7 | Write feedback perdido | `linaSearchView.ts:2029, 2687` | O canal imperativo `statusEl` faz de "concluído" e é apagado por `refreshState()` | Baixa |
| C8 | Duplicação do Read | `hybridSearch.ts:558` vs cache | Dois critérios de "semântica disponível" no mesmo dispositivo | Alta |
| C9 | Idade → estado | `sidebarStatusViewModel.ts:368-371, 482-511` | Fallback por idade (24 h/48 h) produz "Atualização necessária" e alertas; é um terceiro canal (telemetria) a decidir estado de embeddings | Média |
| C10 | Dados partilhados | §2.6 | Read e Write leem o mesmo ficheiro várias vezes por ciclo | Média (custo) |

**Resposta:** sim, existe acoplamento — **na camada de apresentação** (C1–C4, C9) e **na ligação Read↔cache** (C6, C8). Nos módulos puros e nos dados persistentes a separação está correta.

## 3.4 Regras de separação a impor

1. Nenhuma entrada de `write` pode alterar `read`, e vice-versa. O VM combina-os apenas para *layout*, nunca para criar estados novos.
2. Uma mensagem de pesquisa (`read`) nunca menciona "preparar/atualizar" (`write`); uma mensagem de atualização nunca afirma disponibilidade de pesquisa.
3. Alertas de Read (indisponibilidade) e de Write (erro) são independentes e podem coexistir; nenhum suprime o outro.
4. O contrato mismatch é um estado do Read (`unavailable/incompatible`); a **ação** consequente ("regenerar") é um `action` do Write, com `blockedReason: companion` quando aplicável.
5. A idade é informação e vive em `info`, fora de `read` e `write`.

---

# Parte 4 — Arquitetura-alvo e plano de migração

## 4.1 Camadas

```
L0 Artefactos em disco (.lina/index, ownership.json, producer-state.json)
L1 EmbeddingCorpusFacts        (revisionado; lido 1×; fingerprint de ficheiros)
L2a Read model:  SemanticCapabilitySnapshot   (puro: facts + contrato + config + fontes binárias)
L2b Write model: EmbeddingWorkflowSnapshot    (puro: assess(plano) + operação + política + scheduler + ownership)
L2c Role/Ownership snapshot   (papel resolvido + gate)
L3 Coordenador (revisão, markDirty(reason), lazy, single-flight, subscribe)
L4 Apresentação: SidebarInput = { role, read, write, textIndex, info }
```

Invalidação: `markDirty(reason)` a partir dos choke points do §1.6 (publicação de embeddings, publicação do índice textual, settings de provider/modelo/prefixo/preferência de leitura, papel, ownership, contrato carregado, cópia binária, fingerprint alterado na utilização).

## 4.2 Fases sugeridas (para um LINA-13; nenhuma implementada aqui)

| Fase | Conteúdo | Risco | Valor |
|---|---|---|---|
| P0 | **Testes de caracterização** dos defeitos (§5) | Baixo | Alto — fixa o comportamento antes de mexer |
| P1 | Correção mínima de F1: chamar um refresh único nos choke points (publicação, settings, ownership por qualquer via, contrato) e **reordenar o arranque** (contrato → estado); gating da pesquisa semântica pura por `getFresh()` | Baixo | Alto |
| P2 | Coordenador com revisão + `getFresh/getSnapshot/subscribe` + fingerprint na utilização; unificar os 3 chamadores de `resolveDeviceRuntimeState` | Médio | Alto |
| P3 | `classifyEmbeddingWork` único; usar em controller, pedido, scheduler; estado `indeterminate`; decidir `chunks.length===0` | Médio | Alto |
| P4 | Estender o workflow (`lastOutcome`, `action`, `trigger`, `cancelling`) e ligar `embeddingsEnabled`, modo e ownership | Médio | Alto |
| P5 | Cortar o Sidebar VM para `{role, read, write, textIndex, info}`; remover `semanticPreparing`, `embeddingsChecking`, `embeddingsWorkAvailable`, fallback por idade | Médio (UI) | Alto |
| P6 | Remoção de código morto (`buildEmbeddingStatusViewModel`/`renderEmbeddingDiagnostic*`, `canUpdate` antigo, `EmbeddingWorker.state`, parâmetros `isChecking/providerReachable`) e correção documental | Baixo | Médio |
| P7 | Reduzir I/O: `EmbeddingCorpusFacts` único; refresh completo só em transições, não por tick | Médio | Médio |

Ordem recomendada: **P0 → P1** já corrige o defeito visível e funcional; P2–P5 consolidam a arquitetura.

---

# Parte 5 — Testes em falta (caracterização e regressão)

1. Sidebar real (não `runtimeEmbeddings` injetado) após publicação: `semanticAvailable` passa a `true` sem abrir o diagnóstico.
2. `runSemanticSearchGrouped` após a primeira geração: não bloqueia.
3. Mudança de provider/modelo: Read Path passa a `incompatible` na mesma sessão; Sidebar e pesquisa semântica pura concordam com a híbrida.
4. Comando `transferir-ownership-dispositivo`: `isActiveProducer` atualizado; botão oculto no dispositivo despromovido.
5. Arranque de Companion: estado calculado **com** contrato carregado; novo contrato publicado durante a sessão é detetado (fingerprint).
6. Criar/remover cópia binária e trocar `embeddingStorageReadPreference`: Read Path reflete `binary-required/stale/invalid`.
7. `getDeviceDiagnostics` e `refreshDeviceRuntimeState` produzem objetos **iguais** para as mesmas entradas.
8. Paridade: `deviceDiagnostics.companionSearch.semanticCapability` ≡ `runtime.embeddings`.
9. Matriz de "há trabalho": D1 = D5 = D6 para `{sem chunks + obsoletos}`, `{full-rebuild sem chunks}`, `{canónico ilegível}`, `{duplicados}`; `indeterminate` nunca resulta em "Atualizados".
10. `embeddingsEnabled=false`: sem botão nem `UPDATE_REQUIRED` acionável; pedido manual recusado com motivo.
11. `write.phase` × linha "Embeddings" × botão (tabela 2.4.4) para todas as fases, incluindo `GENERATING/PERSISTING` com `work=pending` (não pode dizer "Atualização necessária").
12. `semanticAvailable=true` + `preparing`: o cabeçalho de pesquisa não menciona preparação.
13. Alerta de Read não é suprimido por estado de Write (C3).
14. Sucesso da geração: `lastOutcome=completed` visível após o `refreshState` seguinte.
15. Modo automático: `trigger.scheduled/backoff` chega ao snapshot.
16. Contagem de I/O: N ticks de progresso não geram N leituras de `embeddings.jsonl`/digests.
17. Companion: nenhuma linha de "Atualização necessária" acionável; mensagem "gerido pelo produtor".
18. Idade > 48 h sem drift: `write.phase = idle`, `read` inalterado, sem alerta de degradação.

---

# Parte 6 — Decisões a congelar

1. **`DeviceRuntimeState`/capacidade semântica não é cache não-supervisionada:** é um snapshot com revisão, invalidação por eventos nomeados e cálculo lazy single-flight.
2. **Decisões funcionais nunca dependem de um snapshot sem `getFresh()`;** render pode usar o último snapshot.
3. **Uma única definição de "há trabalho"** (`classifyEmbeddingWork`), com `indeterminate` como estado de primeira classe.
4. **O workflow tem `lastOutcome` explícito** e um bloco `action` que responde a "posso/devo atualizar?" (inclui `embeddingsEnabled`, modo, política, ownership, papel).
5. **A Sidebar consome `{role, read, write, textIndex, info}`** e mais nada; nenhum booleano auxiliar (`semanticPreparing`, `embeddingsChecking`).
6. **Read e Write não se influenciam nas mensagens** (regras §3.4); a idade é informação.
7. **Partilhar dados, não estados:** um leitor de factos por ciclo.
8. **Ordem de arranque:** contrato vetorial → configuração efetiva → estado semântico; nunca o inverso.
9. **Sem polling:** validação por impressão digital na utilização e nos choke points.

---

# Parte 7 — Respostas resumidas

**F1**
- *Cache segura?* Não.
- *Existe invalidação?* Não para este estado; existe para o índice runtime e para o estado de trabalho.
- *Ponto correto?* Os choke points de publicação/configuração/ownership/contrato/binário/sync, unificados numa primitiva `markCapabilityDirty(reason)`.
- *Estratégia preferível?* Cache com revisão + resolução lazy single-flight + invalidação por eventos (híbrido), com `getFresh()` para decisões e fingerprint na utilização para sync externo.

**F3**
1. Seis definições em uso (mais uma coerção e duas auxiliares/mortas).
2. Divergem em: obsoletos/duplicados/inválidos sem publicação necessária, `full-rebuild` sem chunks, canónico ilegível, `embeddingsEnabled=false`, modo automático, Companion.
3. Contrato: `classifyEmbeddingWork` → `EmbeddingWorkflowSnapshot { phase, work, progress, lastOutcome, trigger, action }`.
4. A Sidebar recebe `{ role, read, write, textIndex, info }`.

**F4**
Há acoplamento na apresentação (C1–C4, C9) e na ligação Read↔cache (C6, C8); nos módulos puros e nos dados a separação é correta e deve ser preservada.

---

## Confirmações de âmbito

- Nenhum ficheiro de código, teste, configuração ou schema alterado; apenas este relatório foi criado.
- Nenhuma nota do vault alterada, nenhum embedding gerado, nenhuma chamada externa, nenhum commit.

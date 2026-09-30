# LINA-14F4-B4-AUDIT-WIRING-RUNTIME-SIMPLIFICATION-001

**Tipo:** Auditoria (nenhum código, teste, schema ou documentação funcional alterado; sem commit)
**Fase auditada:** LINA-14F.4-B4 — simplificação de wiring/runtime após remoção de `EmbeddingWorkflowState`
**Estado Git:** `master`, HEAD `1991653` (`refactor(embeddings): remove legacy workflow state model (LINA-14F.4-B3)`), working tree limpa
**Prioridade das regras:** `AGENTS.md` › decisões LINA-14 › contratos/tipos públicos › esta prompt

---

## 0. Método, limites e conflitos

### 0.1 Método
- Leitura integral de `embeddingLifecycleAdapter.ts`, `embeddingLifecycleWritePath.ts`, `embeddingPolicyEngine.ts`, `embeddingWorker.ts` (1–300); leitura dirigida de `embeddingWorkStatusController.ts`, `embeddingScheduler.ts` (355–437), `main.ts` (860–1050, 1420–1530, 1690–1780, 2605–2680), `linaSearchView.ts` (2685–2860), `sidebarStatusViewModel.ts` (240–345, 415–490), `embeddingStatusViewModel.ts`, `deviceRuntimeState.ts`, `semanticCapability.ts`, `deviceDiagnostics.ts`.
- Pesquisa obrigatória por `workflow`, `state`, `resolve`, `adapt`, `legacy`, `fallback`, `compatib` (contagens em §3.6), mais `shadow`, `placeholder`/identidades sintéticas, campos declarados sem uso.
- **Verificação empírica:** um *script descartável* (fora do repositório, em diretório temporário da sessão; **não** faz parte do repo) importou os módulos reais e reproduziu 4 hipóteses críticas (§2.2). Nenhum ficheiro do repositório foi alterado.

### 0.2 Limites
- Não executei a suíte de testes nem a aplicação Obsidian; os achados F01–F05 estão **confirmados por leitura de código + script isolado**, não por reprodução na UI.
- Não li integralmente `main.ts` (3841 linhas) nem `linaSearchView.ts`; só as zonas de wiring de embeddings.
- Não auditei o Read Path fora do wiring do snapshot (LINA-14F.1).

### 0.3 Conflitos e desalinhamentos com a prompt
| # | Prompt | Realidade | Tratamento |
|---|---|---|---|
| C1 | "Branch: `main`" | O repositório só tem `master` (e `origin/master`); `AGENTS.md` e `PROMPT-MESTRA-LINA-002` fixam `master` | Usado `master`; nenhum branch criado |
| C2 | Tipo `EmbeddingLifecycleWritePathDecision` | O tipo real é `EmbeddingWritePathDecision` (`embeddingLifecycleWritePath.ts:19`) | Usado o nome real |
| C3 | "Commit apenas se o documento for autorizado" | — | **Não foi feito commit**; aguarda autorização |
| C4 | `AGENTS.md` dá LINA-14F.3 como "concluída" (cutover de Worker/Operation Manager) | O Worker **não** recebe `getLifecycleSnapshot` em produção (F04) | Registado como achado |

---

## 1. Estado atual

### 1.1 Fluxo de dados pretendido vs real

**Pretendido (prompt):** `Estado factual → EmbeddingLifecycleSnapshot → Decisão operacional → Consumidores`.

**Real (auditado):**

```
                      ┌─ getDeviceRuntimeState() (cache; F1 de LINA-12) ─────────────────────────────┐
 factos dispersos ──▶ │                                                                                │
 (plan, summary,      │   12 chamadas de produção a adaptCurrentStateToLifecycleSnapshot(...)          │
  operação, contrato, │   cada uma com um subconjunto diferente de entradas, defaults e sentinelas     │
  companionState,     └───────────────┬──────────────────────────────────────────────────────────────┘
  settings legadas)                   ▼
                          EmbeddingLifecycleSnapshot  (12 instâncias independentes, não partilhadas)
                                      │
                 deriveEmbeddingWritePathDecision(snapshot) ── chamada em 4 sítios de produção
                                      │
   ┌──────────────┬───────────────────┼──────────────────┬───────────────────┬──────────────────┐
   ▼              ▼                   ▼                  ▼                   ▼                  ▼
Controller   Policy engine     Scheduler (gate     confirmAndRequest    Sidebar VM /       Worker
(workAvail.) (…FromSnapshot)   sintético)          (main.ts)            Diagnostics /      (ramo por snapshot
                                                                        SemanticCapability NÃO ligado)
```

O snapshot **não é passado**: é **reconstruído** em cada consumidor, com informação diferente.

### 1.2 Módulos envolvidos (papel real)
| Módulo | Papel | Estado |
|---|---|---|
| `embeddingLifecycleModel.ts` | Modelo puro (`classifyEmbeddingWork`, `resolveEmbeddingLifecycle`) | Manter |
| `embeddingLifecycleWritePath.ts` | `deriveEmbeddingWritePathDecision` | Manter |
| `embeddingLifecycleAdapter.ts` | Converte estado heterogéneo → snapshot | **Ponto crítico** (§2) |
| `embeddingWorkStatusController.ts` | Estado runtime de trabalho; constrói o seu próprio snapshot | Simplificar |
| `embeddingPolicyEngine.ts` | Política a partir do snapshot | Manter |
| `embeddingScheduler.ts` | Timers + tipos/funções de decisão adicionais | Simplificar / remover parte |
| `embeddingWorker.ts` | Execução + ramo por snapshot **não ligado** | Migrar (decisão) |
| `sidebarStatusViewModel.ts`, `embeddingStatusViewModel.ts`, `semanticCapability.ts`, `deviceRuntimeState.ts`, `deviceDiagnostics.ts` | Consumidores; cada um com **fallback que fabrica snapshot** | Simplificar |
| `main.ts` | 4 construções de snapshot + leituras duplicadas do plano | Migrar |

### 1.3 Pontos positivos a preservar
`WorkflowState` removido sem resíduos de nome (`workflow` só surge 1× em `main.ts`/`src` no âmbito, sem código); `embeddingPolicyEngine.ts` é agora um módulo pequeno e coerente; `deriveEmbeddingWritePathDecision` é uma função pura única; `classifyEmbeddingWork` reutilizada; o Companion continua isolado no modelo (`write.applicable=false`).

---

## 2. Problemas encontrados

Severidade: **Crítica** (viola invariante de segurança/custo), **Alta** (comportamento incorreto provável), **Média** (arquitetura/risco latente), **Baixa** (higiene).

### 2.1 Tabela resumo

| ID | Sev. | Ficheiro:linha | Problema | Classificação |
|---|---|---|---|---|
| F01 | **Crítica** | `main.ts:1474-1507` | Gate do scheduler usa `settings.embeddingProvider`/`embeddingModel` (legado global, default `"ollama"`) e um snapshot **fabricado**; ignora o provider real do dispositivo | Migrar (hotfix) |
| F02 | **Alta** | `embeddingLifecycleAdapter.ts:90-92` | Qualquer `companionState != null` faz o dispositivo ser tratado como **Companion** (`isActiveProducer=false`) | Migrar (hotfix) |
| F03 | **Alta** | `linaSearchView.ts:2705-2715`; `main.ts:987-994` | Snapshots da Sidebar e do diagnóstico **sem plano/`workAssessment`** ⇒ `write.work=none` sempre | Migrar (hotfix) |
| F04 | **Alta** | `main.ts:1428-1471`; `embeddingWorker.ts:151,240-270` | `getLifecycleSnapshot` **nunca é fornecido** ao Worker; ramo canónico do F.3 é código morto em produção | Migrar / decidir |
| F05 | Média | `embeddingLifecycleAdapter.ts:129-152`; `main.ts:1714` | `plan.mode` (incl. override `full-rebuild`) é **ignorado**; ausência de identidades ⇒ `INCOMPATIBLE` | Simplificar |
| F06 | Média | 7 ficheiros (§2.5) | Identidades **sintéticas/sentinela** em produção (`"mismatch-*"`, `"default-producer"`, `contractId:"default"`, `768`) | Remover |
| F07 | Média | `embeddingLifecycleAdapter.ts:90-93`; `embeddingWorkStatusController.ts:135-162` | Defaults **fail-open** de autoridade (`producer`, `isActiveProducer=true`) | Simplificar |
| F08 | Média | 12 sítios (§3.1) | Snapshot reconstruído por consumidor; 6 *fallbacks* dentro de módulos de apresentação | Migrar |
| F09 | Média | `main.ts:1741, 2615-2634, 2639-2658` | Decisões/leituras duplicadas fora do snapshot (3 leituras do plano; `toGenerateCount===0` legado) | Simplificar |
| F10 | Baixa | vários (§3.4) | Código morto: saída `decision`/`lifecycleSnapshot` do controller, `buildEmbeddingStatusViewModel`, inputs do adapter sem uso, funções só de teste | Remover |
| F11 | Baixa | `embeddingLifecycleAdapter.ts:2-10`, `embeddingScheduler.ts:357`, 2 testes | Nomenclatura *shadow* residual | Simplificar |
| F12 | Média | `deviceRuntimeState.ts:235` ↔ `linaSearchView.ts:2712-2713` | Dependência **circular** de dados: `DeviceRuntimeState` deriva do snapshot e o snapshot da Sidebar deriva de `DeviceRuntimeState.embeddings` (cache) | Migrar |

### 2.2 Verificação empírica (script descartável fora do repositório)

| Hipótese | Entrada | Resultado observado |
|---|---|---|
| **H1 (F02)** Produtor ativo + `companionState` não nulo | `deviceRuntimeState.effectiveRole="producer"`, `isActiveProducer=true`, `companionState={isCompanion:false,…}` | `write.applicable=false`, `capability.blockedReason="companion"`, `canRequestUpdate=false` |
| **H2 (F03/F05)** Produtor sem plano nem identidades | idem, sem `workAssessment`/`updatePlan`/contrato | `write.work.kind="none"`, `updateRequired=false`; **`primary="INCOMPATIBLE"`** (identidades ausentes ⇒ `compareEmbeddingIdentity` incompatível) |
| **H3 (F01)** Gate do scheduler com snapshot fabricado, política `automatic-local-only` | identidade `ollama/nomic-embed-text/768`, custo `local` | `allowed=true`, `requiresConfirmation=false`, `reason="local-provider-auto-approved"` — **independente do provider real do dispositivo** |
| **H4 (F05)** Snapshot do pedido manual com `plan.mode="full-rebuild"` (`mistral`) e sem identidade publicada | `updatePlan.mode="full-rebuild"`, `isExternalProvider=true` | `write.work.mode="incremental"` (o modo do plano perde-se); `action="rebuild"` e `requiresConfirmation=true` só porque `primary="INCOMPATIBLE"` (por identidades em falta) |

### 2.3 Detalhe dos achados críticos e altos

#### F01 — Gate de despacho automático desligado do provider real (**Crítica**)
- **Origem:** commit `6682fb6` (LINA-14F.4-B2). Antes: `getEffectiveEmbeddingConfig()` + `getEmbeddingProviderCapability(config.provider)` + regra `isLocal && !hasExternalCost`. Depois: `this.settings?.embeddingProvider ?? "ollama"` e `this.settings?.embeddingModel`, mais uma identidade fixa (`dimensions:768`, `prefixMode:"none"`), `isExternalProvider: !providerCapability.isLocal` (ignora `hasExternalCost`) e um `workAssessment` **fabricado** com `kind:"pending"`.
- **Por que é grave:** `settings.embeddingProvider` é um campo global legado (`DEFAULT_SETTINGS.embeddingProvider = "ollama"`); a UI declarativa grava o provider por dispositivo (`getLocalEmbeddingsProvider()`). Nenhum escritor de produção atualiza o campo legado. Um dispositivo com provider real Mistral/OpenRouter e `embeddingUpdateMode = "automatic-local-only"` obtém `allowed=true` (H3). O passo seguinte, `hasAutomaticEmbeddingWork()` (`main.ts:2615`), usa a configuração **efetiva** e devolve trabalho pendente; o despacho (`requestEmbeddingIndexGeneration("automatic")`) **não volta a validar a política** (o ramo por snapshot do Worker não está ligado — F04).
- **Impacto:** possível **consumo automático de créditos externos** sem confirmação, contrariando `AGENTS.md` (Fase 0.2.2: "Zero consumo silencioso de créditos de APIs externas") e a regra de "nunca gerar automaticamente" para providers remotos. Pré-condições: modo `automatic-local-only` ativo + dispositivo com provider externo + campo legado a `ollama`.
- **Certeza:** confirmada por leitura e H3; não reproduzida na aplicação.

#### F02 — Papel inferido de `companionState` (**Alta**)
`const isCompanion = inputs.companionState != null || deviceRuntime?.effectiveRole === "companion"` (`embeddingLifecycleAdapter.ts:90`). `readCompanionConsumptionState` é chamado para **todos** os papéis (`linaSearchView.ts:2690`, `main.ts:975`) e devolve um objeto não nulo mesmo para o Produtor (com `isCompanion:false`). O adapter ignora esse campo. **Impacto:** o snapshot entregue à Sidebar e ao diagnóstico trata o Produtor ativo como Companion (H1): `write.applicable=false`, `blockedReason="companion"`, sem ações de escrita; `sidebarStatusViewModel.ts:585` calcula `canExecuteMaintenance=false` para o produtor ativo (o campo hoje não é consumido pela view, que usa `isAuthorizedProducer` — mitigação acidental).

#### F03 — Snapshots de apresentação sem informação de trabalho (**Alta**)
`linaSearchView.ts:2705` e `main.ts:987` constroem o snapshot **sem** `updatePlan`/`workAssessment`. `EmbeddingWorkStatusController` já calcula um snapshot com plano (`embeddingWorkStatusController.ts:166-209`), guardado em `EmbeddingWorkRuntimeState.lifecycleSnapshot`, mas **nenhum consumidor o lê** (F10). Consequências:
- `primary=UPDATE_AVAILABLE` é inatingível na Sidebar/diagnóstico de produção; a entrada legada `embeddingsWorkAvailable` do VM só é consultada no ramo de *fallback* (`sidebarStatusViewModel.ts:255-263`) que a produção nunca percorre (o snapshot é sempre fornecido).
- O botão "Atualizar embeddings" continua a depender de `embeddingWorkState.workAvailable` (`linaSearchView.ts:2838-2843`): a Sidebar pode dizer "Atualizados" e mostrar o botão em simultâneo — a classe de contradição corrigida em LINA-11 regressa por outra via.
- O diagnóstico de dispositivo perde modo/contagens/`severity` do trabalho.

#### F04 — Cutover do Worker não ligado (**Alta**)
`EmbeddingWorkerOptions.getLifecycleSnapshot` é opcional; `new EmbeddingWorker({...})` em `main.ts:1428-1471` **não o passa**. Em produção `requestGeneration` usa apenas `capabilities.canGenerateEmbeddings()`, `canPublish()` (cache `isAuthorizedSync()`, otimista) e `isTextIndexBusy()`. `evaluateOperationDecisionFromSnapshot`, `evaluateCanonicalDecision()` e (no scheduler) `evaluateSchedulerDecisionFromSnapshot` só têm chamadores em testes (`tests/maintenance/*` — 44 referências). Efeitos: (a) as garantias documentadas em LINA-14F.3 (bloqueio de `INDETERMINATE`, de auto-start com confirmação exigida, de perda de autoridade) **não se aplicam em produção**; (b) agrava F01 (sem segunda barreira); (c) B16 (fencing de ownership durante a geração, LINA-13-P0) continua por tratar.

#### F05 — Modo do plano ignorado e ausência de identidade ⇒ `INCOMPATIBLE` (**Média**)
O adapter não passa `plan.mode` ao classificador; só usa `mode==="incremental"` para **assumir** compatibilidade (`effectivePublished = targetSummary`, `:133-135, :180-184`). O override `isFullRebuild ? { ...updatePlan, mode: "full-rebuild" } : updatePlan` (`main.ts:1714`) é, por si, ineficaz; o rebuild só é reconhecido porque, sem identidades, `compareEmbeddingIdentity(undefined, undefined)` é incompatível e o `primary` passa a `INCOMPATIBLE` (H4). Ou seja, o resultado certo é **acidental**, e o mesmo mecanismo faz com que **qualquer** snapshot sem identidade (H2) surja como `INCOMPATIBLE`.

### 2.4 Achados médios e baixos

- **F06 — identidades sintéticas em produção** (round-trip booleano → identidade falsa → snapshot → booleano):
  | Ficheiro | Sentinela |
  |---|---|
  | `embeddingLifecycleAdapter.ts:99-119` | `"default-producer"/"default-model"/768`; `"mismatch-local"/"mismatch-model"/1024` |
  | `semanticCapability.ts:184-212` | `"mismatch-provider"/"mismatch-model"/1024`; defaults `ollama/nomic-embed-text/768` |
  | `sidebarStatusViewModel.ts:298-329` | `"mismatch-configured"`, `contractId:"default"`, defaults `ollama/nomic-embed-text/768` |
  | `embeddingStatusViewModel.ts:187-199` | `dimensions:1536` |
  | `embeddingWorkStatusController.ts:119-133` | defaults `ollama/nomic-embed-text/768`, `inputVersion:1` |
  | `deviceRuntimeState.ts:241-259` | defaults `ollama/nomic-embed-text/768` |
  | `main.ts:1480-1487` | identidade fixa `768/"none"` |
  Impacto: estados de produto podem derivar de strings inventadas; qualquer comparação de identidade nestes caminhos é sem significado.
- **F07 — defaults fail-open:** o adapter assume `deviceRole="producer"`, `isActiveProducer=true`, `embeddingsEnabled=true` quando falta o `deviceRuntimeState`; o controller usa `defaultProducerRuntime` (`isActiveProducer:true`, `semanticAvailable:true`, `exists:true`) se não lhe injetarem o estado. Contraria "dispositivos `unassigned` nunca reivindicam ownership nem executam escrita" (AGENTS.md, Invariantes de Papel).
- **F08 — reconstrução por consumidor:** 12 chamadas de produção ao adapter (tabela §3.1); 6 módulos de apresentação/capacidade (`sidebarStatusViewModel`, `embeddingStatusViewModel`, `semanticCapability`, `deviceRuntimeState`, `deviceDiagnostics` ×2) contêm um ramo `input.lifecycleSnapshot ?? adapt(...)`.
- **F09 — duplicações em `main.ts`:** (i) `confirmAndRequestEmbeddingGeneration` lê `readEmbeddingStatus` + `readEmbeddingUpdatePreview`, constrói um snapshot com `upstreamTextIndex:"ready"` fixo e ainda decide "sem trabalho" por `updatePlan.toGenerateCount === 0` (`:1741`, predicado legado D4 de LINA-13); (ii) `hasAutomaticEmbeddingWork` (`:2615`) volta a ler o plano e a montar outro snapshot; (iii) o controller (`:2639`) lê o mesmo plano uma 3.ª vez; (iv) `:2579` ainda referencia `settings.embeddingProvider` como *fallback*.
- **F10 — código morto:** `EmbeddingWorkRuntimeState.decision` e `.lifecycleSnapshot` (0 consumidores); `EmbeddingWorkSummary.deviceRuntimeState` (0 escritores/leitores úteis); `buildEmbeddingStatusViewModel` (0 chamadores de produção; 8+ testes dedicados); inputs do adapter sem uso no corpo: `textIndexAvailable`, `embeddingsDeclaredInManifest`, `vectorContractCompatibility` (e `activeSource` sem chamadores) — declarados e passados por 4/3/1 chamadores de produção **sem efeito**; `EmbeddingWorker.getState()`/`statusNotifications` (no-op em `main.ts:1451-1453`); `evaluateSchedulerDecisionFromSnapshot`, `evaluateOperationDecisionFromSnapshot`, `evaluateCanonicalDecision` (só testes).
- **F11 — nomenclatura:** cabeçalho do adapter ("Shadow Adapter… performs shadow comparison"), do scheduler ("Shadow Decision & Comparison Types"), `tests/maintenance/embeddingOperationLifecycleShadow.test.ts` (já não testa um módulo *shadow*).
- **F12 — circularidade de dados:** `deviceRuntimeState.ts:235` deriva `DeviceRuntimeState.embeddings` de um snapshot; `linaSearchView.ts:2712-2713` deriva o snapshot da Sidebar de `runtimeState.embeddings.exists/semanticAvailable`. A staleness da cache (F1 de LINA-12: só refrescada no arranque, mudança de papel e diagnóstico) contamina o novo snapshot. (`adapter` ↔ `deviceRuntimeState` é ainda um ciclo de tipos `import`.)

---

## 3. Mapa de dependências

### 3.1 Chamadas de produção a `adaptCurrentStateToLifecycleSnapshot` (12)

| # | Local | Entradas fornecidas | Fabrica/assume | Consumidor do resultado |
|---|---|---|---|---|
| 1 | `main.ts:987` (`getDeviceDiagnostics`) | runtime, operação, `companionState` (sempre), contrato, existência/pesquisável (da cache) | sem plano ⇒ trabalho `none`; F02 | `readDeviceDiagnostics` → modal |
| 2 | `main.ts:1490` (gate scheduler) | provider/modelo **legados**, identidade fixa, `workAssessment` fixo | tudo sintético (F01) | `evaluateEmbeddingUpdatePolicyFromSnapshot` |
| 3 | `main.ts:1712` (`confirmAndRequest…`) | runtime, plano, `upstream:"ready"`, existência do resumo | identidades ausentes ⇒ F05 | política + modal de confirmação |
| 4 | `main.ts:2624` (`hasAutomaticEmbeddingWork`) | runtime, plano, `canonicalExists` inferido do modo | `upstream:"ready"` fixo | `deriveEmbeddingWritePathDecision` |
| 5 | `embeddingWorkStatusController.ts:166` | resumo, plano (ou plano sintetizado), identidades por defeito | `defaultProducerRuntime` (F07), defaults 768 | `workAvailable`; `decision`/`lifecycleSnapshot` **sem consumidores** |
| 6 | `linaSearchView.ts:2705` (`refreshState`) | runtime (cache), operação, `companionState` (sempre) | sem plano (F03), F02, F12 | `buildSidebarStatusViewModel` |
| 7 | `sidebarStatusViewModel.ts:255` (fallback) | booleanos legados → runtime fictício | identidades `default`/`mismatch-configured` | Sidebar (só sem snapshot; testes) |
| 8 | `embeddingStatusViewModel.ts:181` (fallback) | resumo | `dimensions:1536` | (sem chamadores de produção) |
| 9 | `semanticCapability.ts:188` (fallback) | booleanos legados | `mismatch-provider` | `evaluateSemanticCapability` |
| 10 | `deviceRuntimeState.ts:235` (fallback) | `companionState`, manifesto | defaults `ollama/768` | `DeviceRuntimeState.embeddings` |
| 11 | `deviceDiagnostics.ts:378` (fallback) | runtime, artefactos | identidade = alvo | `buildDeviceDiagnostics` |
| 12 | `deviceDiagnostics.ts:530` (fallback) | `companionState`, manifesto | `canonicalExists` do manifesto | `readDeviceDiagnostics` |

### 3.2 Chamadores de `deriveEmbeddingWritePathDecision` (produção)
`embeddingPolicyEngine.ts:52`, `embeddingWorkStatusController.ts:194`, `main.ts:2632`, `embeddingWorker.ts:44` (este último inativo em produção — F04) e `embeddingScheduler.ts:378` (inativo). **Nenhum consumidor de UI recebe uma `EmbeddingWritePathDecision`**: a Sidebar/diagnóstico leem regiões do snapshot diretamente.

### 3.3 Cadeia de "há trabalho" (após B3)
Controller (`snapshot.write.work.updateRequired`) → botão da Sidebar (`workAvailable`) e VM (via snapshot **sem trabalho**, F03); `hasAutomaticEmbeddingWork` (snapshot próprio, `action ∈ {update,generate}`); `confirmAndRequest…` (política + `toGenerateCount===0` legado). São **três** cálculos do mesmo facto a partir do mesmo plano (lido 3 vezes) — menos que as 6 definições de LINA-13, mas ainda sem fonte única.

### 3.4 Onde a decisão é recebida sem reconstrução (conforme)
`embeddingPolicyEngine.evaluateEmbeddingUpdatePolicyFromSnapshot(snapshot, policy)` (recebe o snapshot). O restante reconstrói (§3.1).

### 3.5 Consumidores versus critério da prompt ("recebem snapshot/decisão e não reconstroem estado")
| Consumidor | Recebe snapshot? | Reconstrói? | Veredicto |
|---|---|---|---|
| Sidebar (`linaSearchView`/VM) | Sim (construído no view) | **Sim**, no view e no VM (fallback) | Não conforme (F02, F03, F08, F12) |
| Diagnósticos (`deviceDiagnostics`) | Opcional | **Sim** (2 fallbacks) | Não conforme |
| Policy Engine | Sim (parâmetro) | Não | Conforme (mas o chamador em `main.ts:1490` fabrica o snapshot — F01) |
| Scheduler | Não; recebe predicados injetados | Predicados reconstroem snapshots em `main.ts` | Não conforme |
| Worker | Opcional, **não injetado** | — | Não conforme (F04) |
| Operation Manager | Não usa snapshot (single-flight próprio) | — | Neutro (F.3 descreve validações que não ocorrem) |

### 3.6 Pesquisa obrigatória — contagens (`main.ts`, `src/index`, `src/maintenance`, `src/search`, `src/device`)
| Termo | Ficheiros com ocorrência | Comentário |
|---|---|---|
| `workflow` | 1 | Só documentação; sem código residual do modelo removido |
| `shadow` | 3 | Cabeçalhos/nomes (F11) + CSS não relacionado (`lina-shadow-none`) |
| `adapt` | 29 | Ver §3.1 |
| `fallback` | 16 | 6 são *fallbacks de reconstrução de snapshot* (F08); os restantes são de leitura binária/JSONL (legítimos, fora do âmbito) |
| `legacy` | 15 | Inclui `settings.embeddingProvider` (F01), predicado `toGenerateCount===0` (F09), `legacy-manifest` binário (legítimo) |
| `compatib` | 25 | Maioria = compatibilidade de identidade/contrato (legítima) |

---

## 4. Classificação

| Item | Classe | Justificação |
|---|---|---|
| `classifyEmbeddingWork`, `resolveEmbeddingLifecycle`, `deriveEmbeddingWritePathDecision`, `evaluateEmbeddingUpdatePolicyFromSnapshot` | **Manter** | Núcleo puro, testado |
| Gate do scheduler (`main.ts:1474-1507`) | **Migrar** (corrigir) | F01: usar configuração efetiva e regra `isLocal && !hasExternalCost` sem snapshot sintético |
| Inferência de papel por `companionState` (adapter) | **Migrar** (corrigir) | F02: usar só papel/autoridade do runtime |
| Snapshot da Sidebar/diagnóstico | **Migrar** | F03/F12: usar o mesmo snapshot (com plano) e não a cache R1 |
| Ramo por snapshot do Worker | **Migrar** ou **remover** | F04: ligar (decisão de produto) ou eliminar o código e os testes mortos |
| Adapter — identidades sentinela e defaults fail-open | **Remover / simplificar** | F05–F07 |
| Adapter — inputs sem uso (`textIndexAvailable`, `embeddingsDeclaredInManifest`, `vectorContractCompatibility`, `activeSource`) | **Remover** | F10 |
| 6 *fallbacks* `input.lifecycleSnapshot ?? adapt(...)` | **Remover** | F08 (snapshot passa a obrigatório) |
| `EmbeddingWorkRuntimeState.decision/lifecycleSnapshot` | **Simplificar** | Ou passam a ser a fonte partilhada (§5) ou saem |
| `EmbeddingWorkSummary.deviceRuntimeState` | **Remover** | Sem uso |
| `buildEmbeddingStatusViewModel` e testes | **Remover** (com confirmação) | 0 chamadores de produção |
| `evaluateSchedulerDecisionFromSnapshot`, `evaluateCanonicalDecision` | **Remover** salvo se ligados (F04) | Só testes |
| `confirmAndRequestEmbeddingGeneration` — decisão "sem trabalho" | **Simplificar** | Usar a decisão canónica |
| Leituras duplicadas do plano | **Simplificar** | Uma leitura por ciclo |
| Nomenclatura *shadow* | **Simplificar** | F11 |

---

## 5. Direção arquitetural proposta (sem novas abstrações)

Regras (todas consistentes com "menos código, menos estados, menos passagem de objetos"):
1. **Um só ponto de montagem do snapshot:** um método privado de `LinaPlugin` (p.ex. `getEmbeddingLifecycleSnapshot()`) que chama o adapter **uma vez**, com as entradas reais já existentes em memória (`workState.summary.updatePlan`, `operationState`, `deviceRuntimeState`, contrato efetivo, `upstreamTextIndex` real). **Não** é uma camada nova: substitui 4 chamadas em `main.ts` e a do `linaSearchView`.
2. **Consumidores recebem o snapshot (obrigatório) ou a decisão** e nunca o reconstroem: remover os 6 *fallbacks*.
3. **Adapter mais pequeno e fail-closed:** sem sentinelas, sem inferência de papel por `companionState`, papel/autoridade/`embeddingsEnabled` obrigatórios (sem defaults `producer`/`true`), `plan.mode` respeitado ou removido dos tipos de entrada.
4. **Política do scheduler:** função pura mínima sobre `providerCapability` + política + papel (o snapshot completo não é necessário para decidir "auto-despacho local permitido").
5. **Decisão do Worker:** ou ligar `getLifecycleSnapshot` (usando o método do ponto 1) com testes de integração, ou eliminar o ramo. Recomenda-se ligar, por ser a única barreira independente de F01 e B16.

Alvo de métricas (a verificar no fim de B4): chamadas de produção ao adapter **12 → 1**; identidades sentinela **7 ficheiros → 0**; *fallbacks* de snapshot **6 → 0**; leituras do plano por ciclo **3 → 1**; funções só de teste **3 → 0**; inputs do adapter sem uso **4 → 0**.

---

## 6. Plano B4 (lotes pequenos e reversíveis)

> **Regra:** os lotes B4.0 alteram **comportamento** (correções) e, por isso, são **pré-requisitos separados** da simplificação. B4.1–B4.4 só devem preservar comportamento. Cada lote = 1 commit, revertível isoladamente, com testes de caracterização escritos primeiro (`it.fails` que passam a `it` no mesmo PR).

| Lote | Conteúdo | Ficheiros | Risco | Testes | Reversão |
|---|---|---|---|---|---|
| **B4.0-a** (F01) | Gate do scheduler: provider/modelo do `getEffectiveEmbeddingConfig()`, regra `isLocal && !hasExternalCost`, sem snapshot fabricado; remover `settings.embeddingProvider` de `main.ts:1475,2579` | `main.ts` (+ teste novo) | Baixo (localizado), **prioridade máxima** | Provider externo + `automatic-local-only` ⇒ `canDispatch=false`; local ⇒ `true`; Companion/standby ⇒ `false` | `git revert` |
| **B4.0-b** (F02) | Adapter: papel/autoridade só do runtime (ou `companionState.isCompanion`) | `embeddingLifecycleAdapter.ts` (+ testes) | Baixo | Produtor + `companionState` não nulo ⇒ `applicable=true`; Companion ⇒ `false` | `git revert` |
| **B4.0-c** (F03) | Sidebar e diagnóstico passam o plano (`workState.summary.updatePlan`) ou reutilizam o snapshot do controller | `linaSearchView.ts`, `main.ts` | Médio (UI) | `UPDATE_AVAILABLE` alcançável; linha "Embeddings" e botão coerentes (sem "Atualizados"+botão) | `git revert` |
| **B4.0-d** (F04) | **Decisão:** ligar `getLifecycleSnapshot` ao Worker (com o método único) **ou** remover o ramo e os testes mortos | `main.ts`, `embeddingWorker.ts` | Médio | Integração: `INDETERMINATE`, perda de autoridade, confirmação com origem `automatic` bloqueiam em produção | `git revert` |
| **B4.1** (F10, F11) | Remover código morto e renomear: saída `decision/lifecycleSnapshot` do controller (ou consumi-la), `EmbeddingWorkSummary.deviceRuntimeState`, inputs sem uso do adapter, `buildEmbeddingStatusViewModel`+testes (se confirmado), funções só de teste (se F04 = remover), cabeçalhos *shadow*, renomear 2 testes | vários | **Muito baixo** (sem comportamento) | `typecheck`, suíte, lint strict, guardas de texto | `git revert` |
| **B4.2** (F05–F07) | Adapter fail-closed: sem sentinelas nem defaults de autoridade; `plan.mode` respeitado ou retirado; ausência de identidade tratada explicitamente (não como `INCOMPATIBLE` acidental); helper de teste para construir snapshots (65 usos em 8 ficheiros de teste) | adapter, controller, testes, `tests/helpers` | Médio (testes numerosos) | Matriz de entradas ausentes ⇒ estados esperados; invariantes I1–I11; caracterização de H2/H4 | `git revert` |
| **B4.3** (F08, F12) | Ponto único de montagem (`LinaPlugin.getEmbeddingLifecycleSnapshot()`); consumidores recebem snapshot obrigatório; remover os 6 *fallbacks* e `defaultProducerRuntime`; Sidebar deixa de derivar da cache R1 | `main.ts`, `linaSearchView.ts`, 5 módulos de apresentação/capacidade, testes | **Médio-alto** (maior superfície) | Paridade Sidebar/diagnóstico antes/depois em 10 cenários; teste estrutural: só 1 chamada de produção ao adapter | `git revert` (lote isolado) |
| **B4.4** (F09) | `confirmAndRequest…` e `hasAutomaticEmbeddingWork` usam o snapshot único; uma só leitura do plano por ciclo; remover `toGenerateCount===0` | `main.ts` | Médio | "Sem trabalho" pela decisão; leituras de I/O = 1 por ciclo (contador no `FakeAdapter`) | `git revert` |

**Ordem obrigatória:** B4.0-a → B4.0-b → B4.0-c → B4.0-d → B4.1 → B4.2 → B4.3 → B4.4. B4.0-a é independente e pode sair **imediatamente** como correção de segurança.

### 6.1 Critérios de aceitação (por lote e final)
- `npm run typecheck`, `npm test` (número de testes não inferior ao baseline, salvo remoção justificada de testes mortos), `npm run lint:obsidian:strict`, `npm run build`, `npm run release-check`, `git diff --check` — todos verdes.
- Nenhuma alteração de schemas, formato de embeddings, ownership persistente ou notas.
- Métricas de §5 atingidas no final de B4.4.
- `AGENTS.md`/`CHANGELOG.md` atualizados por lote, corrigindo o estado "F.3 concluída" (F04).

### 6.2 Riscos transversais
| Risco | Mitigação |
|---|---|
| B4.0-c altera a apresentação da Sidebar | Testes de VM + validação manual em Obsidian (produtor, standby, companion) |
| B4.2/B4.3 tocam ~65 usos em testes | Helper único de construção de snapshots; migração mecânica por ficheiro |
| Ligar o Worker (B4.0-d) pode bloquear pedidos legítimos se o snapshot estiver incompleto | Depende de B4.0-b/c; testes de integração de Producer ativo/standby/companion |
| Remover `buildEmbeddingStatusViewModel` elimina testes de UX | Confirmar com o responsável que não há plano de o reutilizar; caso contrário, migrar para ser usado |
| Cache R1 (F1 de LINA-12) continua a ser uma dependência de dados | Tratada em B4.3 apenas no que toca ao snapshot; a invalidação completa da cache é fase própria (LINA-13-P1-c/d) |

---

## 7. Decisões que requerem autorização
1. **Aprovar B4.0-a como correção imediata** (F01) antes de qualquer simplificação.
2. F04: **ligar** o ramo do Worker (recomendado) ou **remover** o código morto?
3. `buildEmbeddingStatusViewModel`: remover ou reutilizar na Sidebar?
4. Confirmar que B4.0-b/c são aceites como lotes de comportamento (correções) e não como parte da "simplificação".
5. Autorizar o commit deste documento (não foi feito).

---

## 8. Confirmações
- Apenas este documento foi criado; nenhum ficheiro de código, teste, schema ou documentação funcional foi alterado; **sem commit**.
- O script de verificação (H1–H4) ficou em diretório temporário da sessão, fora do repositório; nada foi escrito no vault.
- Nenhuma nota alterada; nenhum embedding gerado; nenhuma chamada externa.

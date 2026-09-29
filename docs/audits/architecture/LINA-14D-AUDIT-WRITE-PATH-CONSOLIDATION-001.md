# LINA-14D-AUDIT-WRITE-PATH-CONSOLIDATION-001

**Tipo:** Auditoria prévia à implementação (esta fase apenas acrescenta uma camada *shadow* pura; sem alteração de comportamento)
**Contrato:** `AGENTS.md`, `PROMPT-MESTRA-LINA-002`, LINA-14 (audit), 14A, 14B, 14B.1, 14C.1–14C.4
**Estado Git na auditoria:** `master`, HEAD `3c9678e`, working tree limpa

## 1. Âmbito e método

Ficheiros lidos para esta fase: `src/index/embeddingLifecycleModel.ts` (integral), `embeddingLifecycleAdapter.ts` (integral), `embeddingWorkStatusController.ts`, `embeddingWorkflowState.ts`, `embeddingUpdatePlan.ts`, `embeddingOperationManager.ts` (tipos e progresso), `maintenance/embeddingWorker.ts`, `embeddingScheduler.ts`, `embeddingPolicyEngine.ts`, `producerState.ts`, secções de `main.ts` (`confirmAndRequestEmbeddingGeneration`, `hasAutomaticEmbeddingWork`, `getEmbeddingWorkflowState`, `getDeviceDiagnostics`, publicação de embeddings, `updateProducerState`), `linaSearchView.ts` (botão) e `embeddingStatusViewModel.ts` (consumo do snapshot). Guias: `docs/agents/relatorio-final.md`, `docs/agents/indexacao-pesquisa.md`. `embeddingGenerator.ts` foi lido apenas nos pontos que decidem o plano (`:975-1050`).

Nenhum teste foi executado nesta auditoria; a validação da implementação consta de `LINA-14D-IMPLEMENT-WRITE-PATH-CONSOLIDATION-001.md`.

## 2. Escritores atuais do Write Path

| # | Escritor | Onde | O que escreve | Persistente? |
|---|---|---|---|---|
| W1 | Geração + publicação canónica | `embeddingGenerator.ts` → `embeddingPersistence.ts` (`publishCanonicalEmbeddings`) | `embeddings.jsonl`, `manifest.json` (secção `embeddings`, proveniência) | Sim (`.lina/index/`) |
| W2 | Checkpoints | `writeEmbeddingCheckpoint` | `.lina/producer/checkpoints/*` | Sim (local) |
| W3 | Publicação de limpeza | mesmo fluxo com `requiresPublication` | `embeddings.jsonl` sem obsoletos | Sim |
| W4 | Estado do produtor | `main.ts` `updateProducerState` (erro em `:2877`, sucesso em `:2920`; texto em `:2362/:2396`) | `.lina/producer-state.json` (`embeddings.lastSuccessfulPublicationAt`, `maintenance.*`) | Sim (telemetria sincronizada) |
| W5 | Cópia binária derivada | `BinaryEmbeddingCopyController` | `embeddings.*.f32/meta/manifest` | Sim (derivada) |
| W6 | Operação (em memória) | `EmbeddingOperationManager` | `status/phase/progress/error` | Não |
| W7 | Estado de trabalho (em memória) | `EmbeddingWorkStatusController` | `workAvailable`, `summary.updatePlan` | Não |
| W8 | Agendamento (em memória) | `EmbeddingScheduler` | `dirty/scheduled/backoff` | Não |

**Todos os escritores persistentes (W1–W5) já estão atrás de `OwnershipGate.isAuthorizedSync()`/`canPublish()` e do coordenador de exclusão de escrita.** Esta fase não altera nenhum deles.

## 3. Decisões duplicadas de "há trabalho / que ação"

| # | Local | Critério | Fonte | Equivalente no snapshot |
|---|---|---|---|---|
| D1 | `hasEmbeddingWorkAvailable` (`embeddingWorkStatusController.ts:85`) | `toGenerate>0 ∨ requiresPublication ∨ missing>0 ∨ stale>0 ∨ obsolete>0 ∨ duplicate>0 ∨ invalid>0`; `full-rebuild⇒true`; indeterminado ⇒ `undefined` | `readEmbeddingStatus` + preview | `write.work` (`classifyEmbeddingWork`) |
| D2 | `resolveEmbeddingWorkflowState` (`embeddingWorkflowState.ts:61`) | `Boolean(workAvailable)` + estado da operação | D1 + operação | `primary` + `process.phase` |
| D3 | Botão da Sidebar (`linaSearchView.ts`) | `isAuthorizedProducer ∧ workAvailable===true ∧ !running ∧ !cancelling ∧ indexReady` | D1 + operação + papel | `capability.canRequestUpdate` + `write.updateRequired` |
| D4 | Política em `confirmAndRequestEmbeddingGeneration` (`main.ts:1674`) | `toGenerate>0 ∨ requiresPublication ∨ isFullRebuild` | Novo preview | `write.updateRequired` |
| D5 | Scheduler `hasAutomaticEmbeddingWork` (`main.ts:2576`) | `toGenerate>0 ∨ requiresPublication` | Novo preview | `write.updateRequired` (só para local automático) |
| D6 | Execução (`embeddingGenerator.ts:999-1047`) | `totalToGenerate===0 ∧ requiresPublication ⇒ publicar sem gerar` | Plano recalculado | `write.work.mode === "publish-only"` |
| D7 | `resolvePolicy` (`embeddingPolicyEngine.ts`) | `hasPendingWork` + capacidade do provider + política + papel | Argumento | `capability.requiresConfirmation` (hoje passthrough) |
| D8 | `producer-state.json` | `maintenance.status/lastError`, `embeddings.lastSuccessfulPublicationAt` | Disco | `history.lastFailure/lastSuccess` |

### Divergências já conhecidas (LINA-13-P0 §2, B5–B7)
- `chunks.length === 0` com registos obsoletos: D1 ⇒ `true`; D4/D5 ⇒ `false` (exigem `requiresPublication`, que exige `chunks>0`); o modelo canónico classifica como `publish-only` (`obsoleteToDropCount>0`), coincidindo com D1 mas **não** com D4/D5.
- Canónico ilegível: D1 ⇒ `undefined`, D2 ⇒ `false`/`IDLE`; o modelo ⇒ `indeterminate`/`INDETERMINATE`.
- `embeddingsEnabled=false`: D1–D5 ignoram; o modelo ⇒ `write.applicable=false`.
- Companion: D1–D3 podem indicar trabalho; o modelo ⇒ `write.applicable=false`.
- Modo (`initial-build/incremental/full-rebuild/publish-only`), custo e severidade **não** existem em D1–D5; só em `write.work`.

## 4. Lacunas encontradas no modelo/adapter atual (relevantes para o Write Path)

| ID | Lacuna | Evidência | Tratamento nesta fase |
|---|---|---|---|
| WP-1 | Em produção o snapshot (`getDeviceDiagnostics`) é construído **sem `updatePlan`**; o adapter cai para o ramo `workflowState`, que fixa `mode:"incremental"`, `cost:"local"`, `severity:"action"` e perde `full-rebuild`/`publish-only`/contagens | `main.ts:995-1003`; `embeddingLifecycleAdapter.ts:151-160` | Alargar o tipo de entrada do adapter para `EmbeddingUpdatePlanPreview` (compatível: `EmbeddingUpdatePlan` é atribuível) e permitir que a camada shadow use `workState.summary.updatePlan`. **Sem** alterar `getDeviceDiagnostics` |
| WP-2 | O snapshot não expõe **ação recomendada** (`generate/update/rebuild/cancel/retry`) | `EmbeddingLifecycleSnapshot.capability` só tem `canRequestUpdate/blockedReason/requiresConfirmation` | Derivar a ação numa função pura separada (`deriveEmbeddingWritePathDecision`) **sem** alterar `embeddingLifecycleModel.ts` (14A fechado) |
| WP-3 | `capability.requiresConfirmation` é passthrough (`false` por defeito); `full-rebuild` não o implica | `embeddingLifecycleModel.ts:217, 655` | A decisão derivada impõe `requiresConfirmation=true` em `rebuild` e quando o custo é externo; compara-se com a política legada quando fornecida |
| WP-4 | `deviceIdentity` no adapter = contrato publicado (`vectorContract ?? publishedIdentity`); numa mudança de provider do Produtor `read` continua `compatible` e o estado é `UPDATE_AVAILABLE` com `work.mode=full-rebuild`, em vez de `INCOMPATIBLE` | `embeddingLifecycleAdapter.ts:124-127` | **Fora de âmbito** (Read Path; 14C). Registado como risco; a decisão derivada trata `mode=full-rebuild` como `rebuild` independentemente do `primary` |
| WP-5 | Perda de ownership durante a geração: `primary=UPDATING` (precedência do processo) com `blockedReason="standby"`; nada assinala a inconsistência | `embeddingLifecycleModel.ts:632-644, 690-698` | A decisão derivada expõe `ownershipLostDuringOperation` e a comparação regista-a como `divergence` face ao legado (o legado continua a mostrar `generating`, B16) |
| WP-6 | `history` no adapter só usa `producerState.maintenance.lastError` como *categoria* | `embeddingLifecycleAdapter.ts:169-172` | Comparação `producer-state` ↔ `history` como diferença informativa |
| WP-7 | Não existe função de comparação para o Write Path (só `compareLegacyWithLifecycleSnapshot`, que compara `workAvailable`/`primary`) | `embeddingLifecycleAdapter.ts:224-288` | Nova comparação dedicada (D1–D8 vs snapshot) |

## 5. Riscos

| # | Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|---|
| R1 | A camada shadow ser lida como fonte de decisão antes de tempo | Média | Médio | Nome/documentação `shadow`; **nenhum** consumidor de produção; teste estrutural que impede importação por módulos de UI/worker |
| R2 | Réplicas das regras legadas (D3–D5) divergirem do código real | Média | Baixo | Réplicas mínimas com referência de linha; testes que fixam cada réplica; D1 reutiliza a função exportada |
| R3 | Alargar o tipo do adapter partir chamadores | Baixa | Baixo | O tipo novo é um super-conjunto estrutural; `typecheck` + testes do adapter |
| R4 | Ação `rebuild` sugerir confirmação onde o legado não pede | Baixa | Baixo | Comparação classifica como `info`/`warning`, nunca altera fluxos |
| R5 | Fuga de dados sensíveis para o diff (erros do provider) | Baixa | Médio | O diff só contém enums, contagens e categorias; mensagens de erro não são copiadas (só presença) |
| R6 | Aumento de custo I/O | Muito baixa | Baixo | Módulo puro; o método do plugin só lê estado em memória e o `producer-state.json` **a pedido** |
| R7 | Companion/Standby obter ação executável | Muito baixa | Alto | Invariante testada: `write.applicable=false ⇒ action="none" ∧ canExecute=false` |
| R8 | Introduzir geração automática | Nula | Alto | Sem chamadas a `requestEmbeddingIndexGeneration`; teste estrutural |

## 6. Dependências

- **Entradas (só leitura):** `EmbeddingLifecycleSnapshot`, `EmbeddingWorkflowState`, `EmbeddingWorkRuntimeState` (incl. `summary.updatePlan`), `EmbeddingOperationState`, `ProducerStateV1`, decisão de política (`EmbeddingPolicyDecision`), `DeviceRuntimeState`.
- **Sem dependências** de `obsidian`, `App`, `Vault`, DOM, rede, filesystem ou providers.
- **Consumidores nesta fase:** nenhum em produção; um método on-demand de `LinaPlugin` para diagnóstico/depuração e os testes.

## 7. Plano de migração (LINA-14D em sub-fases)

| Sub-fase | Conteúdo | Comportamento | Estado |
|---|---|---|---|
| **14D-1 (esta)** | Camada shadow pura do Write Path: decisão derivada do snapshot + comparação com D1–D8; adapter aceita `EmbeddingUpdatePlanPreview`; método on-demand no plugin | **Nenhuma alteração** | Implementar agora |
| 14D-2 | `EmbeddingWorkStatusController`, política e scheduler passam a chamar `classifyEmbeddingWork` como única função de "há trabalho" (com testes de paridade D1=D4=D5 nos casos limite) | Corrige B7 | Próxima |
| 14D-3 | Botão da Sidebar e `confirmAndRequestEmbeddingGeneration` usam `deriveEmbeddingWritePathDecision` (`canExecute`, `requiresConfirmation`, `embeddingsEnabled`) | Corrige B6 | Depende de 14D-2 |
| 14D-4 | `lastOutcome`/`history` (sucesso/erro) a partir do snapshot; remoção do canal `statusEl` para "concluído" | Corrige B18 | Depende de 14D-3 |
| 14D-5 | Fencing de ownership durante o processo (`OWNERSHIP_LOST`) | Corrige B16 | PR próprio (P1b) |

## 8. Garantias desta fase

- Producer continua o único responsável por gerar/publicar/atualizar artefactos; Companion nunca gera, publica ou executa manutenção (invariante I9 + testes).
- Nenhuma geração automática introduzida; nenhum caminho novo chama providers.
- Sem alteração de schemas, notas, ownership persistente, formato de embeddings ou contratos externos.

## 9. Ficheiros previstos

| Ficheiro | Ação |
|---|---|
| `src/index/embeddingLifecycleWritePath.ts` | Novo (puro) |
| `src/index/embeddingLifecycleAdapter.ts` | Alargar tipo de `updatePlan` (super-conjunto) |
| `main.ts` | Método on-demand `getEmbeddingWritePathShadowComparison()` (leitura apenas) |
| `tests/index/embeddingLifecycleWritePath.test.ts` | Novo |
| `docs/audits/architecture/LINA-14D-IMPLEMENT-WRITE-PATH-CONSOLIDATION-001.md`, `AGENTS.md`, `CHANGELOG.md` | Documentação |

## 10. Confirmações
Esta auditoria não alterou código, testes, schemas ou notas do vault, não gerou embeddings e não efetuou chamadas externas.

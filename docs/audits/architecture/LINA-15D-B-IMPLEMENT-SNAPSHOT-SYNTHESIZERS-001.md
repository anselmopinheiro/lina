# LINA-15D-B — IMPLEMENTAÇÃO: FONTE CANÓNICA DE SNAPSHOT E REMOÇÃO DE SINTETIZADORES PARALELOS

> **Fase:** LINA-15D-B · **Data:** 2026-10-02 · **Branch:** `master`
> **Base factual:** `docs/audits/architecture/LINA-15D-A-AUDIT-SNAPSHOT-SYNTHESIZERS-001.md` (mantida; não apagada).
> **Regra central:** ausência de conhecimento permanece ausência de conhecimento; nunca é convertida num estado aparentemente válido.
> **Sem alteração de:** Scheduler, Worker, Operation Manager, OwnershipGate, fencing, schemas, `data.json`, formato dos embeddings, Vector Contract, configuração efetiva (15G).

## 1. Estado inicial

Árvore limpa em `726d681`. A 15D anterior declarava removidos `768`, `"nomic-embed-text"`, `"local-device"` e `"default"`; a auditoria 15D-A demonstrou que não era verdade (ver §10).

## 2. Divergências confirmadas (da 15D-A) e estado final

| ID | Divergência | Estado |
|---|---|---|
| S9 | Controller sem resumo ⇒ `INDEX_ONLY` / `cost none` / gate automático permitido | **Resolvida** |
| S2 | `768`, `inputVersion:1` fixo, `defaultProducerRuntime`, `upstream:"ready"` | **Resolvida** |
| S3 | `resolveDeviceRuntimeState` fabricava snapshot e identidade (768, 1, "none") | **Resolvida** |
| S8 | `getDeviceDiagnostics` montava snapshot a partir de booleanos derivados | **Resolvida** |
| S1 | Defaults fail-open do adapter | **Resolvida** (uma exceção documentada) |
| S4 | Fallbacks de `deviceDiagnostics` | **Removidos** |
| S5 | Fallback da sidebar (`device-1`, `"default"`, 768…) | **Removido** |
| S6 | Fallback de `evaluateSemanticCapability` | **Removido** |
| S7 | `embeddingStatusViewModel.ts` inalcançável | **RETAIN** (§5) |
| R1–R3 | Resíduos | §6 |

## 3. Implementação

- **S9 (`main.ts`):** sem resumo do controller o snapshot vivo leva `workAssessment: indeterminate` (`work-summary-unavailable`) ⇒ `INDETERMINATE`; o gate recusa início automático **e** manual. Para não bloquear o fluxo manual no arranque, `confirmAndRequestEmbeddingGeneration` faz refresh do resumo se ainda não existir.
- **S2 (`embeddingWorkStatusController.ts`):** `EmbeddingWorkSummary` declara `publishedIdentity` (identidade real do manifesto, via `readEmbeddingStatus`) e `textIndexStatus`. O builder usa a identidade publicada real (incluindo `inputVersion`); dimensões desconhecidas ou `0` ficam `undefined`; `defaultProducerRuntime` removido — sem runtime ou sem plano de atualização o estado é indeterminado; `upstreamTextIndex` vem de `getTextIndexStatus().usability` (preenchido em `refreshSummary`, `hasAutomaticEmbeddingWork` e `confirmAndRequestEmbeddingGeneration`) ou, na falta, do facto de runtime; `NO_TEXT_INDEX` é agora alcançável no snapshot vivo. `validForSearchCount` usa o valor real do estado (ou os registos canónicos reutilizáveis do plano).
- **S3 (`deviceRuntimeState.ts`, `semanticCapability.ts`):** sem snapshot explícito, a capacidade vem de factos (`evaluateSemanticCapabilityFromFacts`: existência de identidade/evidência, não identidades). Um snapshot explícito continua a ser preservado e usado. Equivalência com o caminho anterior verificada numa matriz de 324 combinações (`tests/search/semanticCapabilityFacts.test.ts`).
- **S8 (`main.ts`):** `getDeviceDiagnostics` consome `getEmbeddingLifecycleSnapshot()` (o mesmo da Sidebar/Worker), sobrepondo apenas a proveniência do `companionState`. Removida a contagem `semanticAvailable ? 1 : 0`.
- **S1 (`embeddingLifecycleAdapter.ts`):** sem runtime ⇒ papel `unassigned`, nunca Active Producer; contagem de vetores válidos desconhecida ⇒ `0` (não concede disponibilidade semântica); fonte de leitura = `jsonl` apenas se existir canónico (JSONL é canónico por invariante), senão `none`. **Mantido:** `embeddingsEnabled ?? true` (default de produto; só condiciona a leitura, a escrita exige produtor ativo atribuído).
- **S4:** `lifecycleSnapshot` obrigatório em `BuildDeviceDiagnosticsInput` e `ReadDeviceDiagnosticsOptions`; removidos os dois fallbacks (identidade publicada = alvo, `inputVersion:1`, `prefixMode:"none"`, contagem 0/1). A modal já não relê diagnósticos sem o callback de refresh do plugin.
- **S5:** `lifecycleSnapshot` obrigatório em `buildSidebarStatusViewModel`; removido o runtime/identidade fabricados.
- **S6:** `evaluateSemanticCapability` exige `lifecycleSnapshot`; sem reconstrução.

## 4. Fontes factuais utilizadas

`EmbeddingIndexStatus.publishedIdentity`; `updatePlan.targetIdentity`; `DeviceRuntimeState` real; `getTextIndexStatus()`; contagem de validForSearch do `EmbeddingStateSummary`; `getEmbeddingLifecycleSnapshot()`. Nenhuma nova fonte de verdade.

## 5. Decisão S7 — **RETAIN**

`embeddingStatusViewModel.ts` é inalcançável a partir de `main.ts` (esbuild metafile; sem importadores em `src/`), mas é descrito como consumidor de diagnóstico no baseline LINA-14 e tem 4 ficheiros de teste. Não existe decisão de o remover nem de o religar; `RECONNECT` exige autorização adicional. Retido **sem** fallback fabricado (`lifecycleSnapshot` obrigatório; removidos `1536`, `inputVersion:1`, `prefixMode:"none"`). **Não é consumidor de produção.** Remoção ou religação fica encaminhada.

## 6. R1–R3

- **R1 `resolveEffectiveEmbeddingRuntimeConfig` — MANTER (limpa):** sem chamadores de produção; os testes cobrem o ramo Companion. Removidos os defaults `"ollama"`/`"nomic-embed-text"` do ramo Producer (sem identidade ⇒ `isAvailable:false`). **Encaminhado:** os marcadores `dimensions:0`/`inputVersion:1`/`prefixMode:"none"` do config "indisponível" (exigidos pelo tipo) — exceção explícita na guarda estática.
- **R2 `semanticSearchModal` — ativo (comando de pesquisa semântica):** fonte correta = configuração efetiva (15G) passada por `main.ts`. Removidos os literais; sem provider/modelo mostra `semanticEmbeddingsUnavailableNoContract`.
- **R3 `src/ai/types.ts` — REMOVER:** inalcançável (metafile) e sem importadores; ficheiro removido.

## 7. Testes

Novos: `snapshotSourceS9`, `snapshotSourceS2` (inclui `readEmbeddingStatus → resumo → snapshot` com `inputVersion 7`), `semanticCapabilityFacts`, `deviceRuntimeStateNoSyntheticIdentity`, `deviceDiagnosticsLiveSnapshot`, `adapterNoFailOpenDefaults`, `noFabricatedSnapshotValues`. Helpers: `producerRuntimeState`, `completeWorkSummary`, `seedWorkSummary`, `diagnosticsFixtures`, `sidebarScenarioSnapshot`, `embeddingStatusScenario`, `capabilityFromFacts`. Os testes que exercitavam fallbacks foram migrados para cenários com factos explícitos (builders **só de testes**, com identidade declarada); testes de 15A/15B/15C/15F/15G intactos e verdes.

## 8. Guardas contra regressão

`tests/index/noFabricatedSnapshotValues.test.ts` (varre `src/` e `main.ts`): `768`, `1536`, `?? "default"` em provider/modelo, `"local-device"`, `inputVersion: 1`, `prefixMode: "none"`, `upstreamTextIndex: "ready"` e `defaultProducerRuntime`. Exceções legítimas (declarações de tipo, i18n, `EMBEDDING_INPUT_VERSION`, `NOMIC_PREFIX_MODELS`, `LEGACY_COMPATIBILITY_DEFAULTS`, `providerDefaults.ts`) não casam com os padrões; única exceção por ficheiro: `src/index/vectorContract.ts` (R1).

## 9. Riscos

Resolvidos: gate dependente de montante; Producer implícito; índice textual sempre "ready"; identidade tautológica no diagnóstico.
**Não resolvidos / encaminhados:** (i) o `DeviceRuntimeState` continua a basear-se em evidência booleana de disponibilidade (não numa contagem); (ii) `EmbeddingIndexStatus` mantém o sentinela `dimensions ?? 0` no tipo (o controller já não o usa); (iii) decisão sobre `embeddingStatusViewModel.ts`; (iv) um arranque sem resumo fica `INDETERMINATE` até ao primeiro refresh (mitigado no fluxo manual e nos diagnósticos).

## 10. Compatibilidade e retificação documental

Sem alteração de schema, `data.json`, ownership ou formato de embeddings. Retificados: `LINA-15D-IMPLEMENT-…` (nota no topo), `AGENTS.md` e `docs/INDEX.md`.

## 11. Quality gates

`npm test` 160 ficheiros / 2093 testes ✔ · `typecheck` ✔ · `lint:obsidian:strict` ✔ (0 avisos) · `build` ✔ (`main.js` restaurado) · `release-check` ✔ · `git diff --check` ✔.

## 12. Roadmap

LINA-15D-A (auditoria) e 15D-B (implementação) concluídas; segue LINA-15H (persistência), conforme `docs/INDEX.md`.

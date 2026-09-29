# LINA-13-P1-AB-AUDIT-IMPLEMENTATION-PLAN-001

**Tipo:** Auditoria técnica e plano de implementação (nenhum código, teste, schema, manifesto ou contrato alterado; sem commit)
**Âmbito:** P1-A (remover o bloqueio da pesquisa semântica pura por cache obsoleta) e P1-B (corrigir a ordem de inicialização do contrato vetorial)
**Estado Git:** `master`, HEAD `f5f840d`

---

## 1. Contexto

`LINA-13-P0` identificou dois defeitos funcionais de baixo risco e alto valor:

- **B1:** `runSemanticSearchGrouped` recusa pesquisar quando `DeviceRuntimeState.embeddings.semanticAvailable` (uma cache sem invalidação) é `false`, mesmo com vetores válidos publicados.
- **B3:** o estado runtime é calculado (`refreshDeviceRuntimeState`) **antes** de o contrato vetorial ser carregado (`loadCanonicalVectorContract`); num Companion, a configuração efetiva depende desse contrato.

Esta auditoria valida ambas as hipóteses **no código**, define a alteração mínima e prepara a execução por Codex. Testes não foram executados; "confirmado" significa cadeia de chamadas e testes existentes lidos.

### Limites
- Não corri a suíte nem reproduzi em runtime.
- Não li `embeddingGenerator.ts`/`embeddingPersistence.ts` para além do necessário (fora do âmbito de A/B).
- Os testes de `linaSearchView` existentes são maioritariamente **asserções sobre o texto do código-fonte**; isso condiciona a estratégia de testes (§6).

---

## 2. Estado atual

### 2.1 P1-A — cadeia de decisão da pesquisa semântica pura

```
runSearch()                                            linaSearchView.ts:3130
 ├─ parseLinaCommand → search
 ├─ getTextIndexStatus().isUsable ?                    :3156   (senão: erro de índice)
 ├─ readIndexedNotes / readIndexedChunks               :3165-3178
 ├─ safeChunks = filterChunksByUserContentRules        :3180   (exclusões por conteúdo)
 └─ selectedMode === "semantica" → runSemanticSearchGrouped(query, safeChunks)   :3198

runSemanticSearchGrouped                               :3754
 ① PRÉ-GATE (cache)  runtimeState = plugin.getDeviceRuntimeState()           :3755
                     if (!runtimeState.embeddings.semanticAvailable) → mensagem + return   :3756-3759
 ② Companion sem contrato/config indisponível → mensagem + return            :3762-3767
 ③ settingsProvider / settingsModel (Companion: contrato; produtor: settings locais)  :3768-3773
 ④ runtimeIndex = plugin.getRuntimeEmbeddingIndex(chunks)  → null ⇒ mensagem + return :3775-3779
 ⑤ provider do índice ≠ settingsProvider ⇒ mensagem + return                  :3786-3789
 ⑥ modelo do índice ≠ settingsModel ⇒ mensagem + return                       :3791-3794
 ⑦ inputVersion/prefixMode ≠ nextIdentity ⇒ mensagem + return                 :3797-3803
 ⑧ dimensions ≤ 0 ⇒ mensagem + return                                         :3809-3813
 ⑨ generateSingleEmbedding(query)  ← ÚNICO PASSO COM REDE                     :3820-3827
 ⑩ searchRuntimeSemanticIndex (devolve [] se dimensão da query ≠ do índice)   semanticSearch.ts:197
 ⑪ groupResultsByNote → renderGroupedCards (só ficheiros que resolvem para TFile)   :3837-3838
```

**O pré-gate ① é o único ponto que consulta a cache.** Todos os passos ②–⑩ são independentes dela.

### 2.2 O que `getRuntimeEmbeddingIndex` (passo ④) valida — `runtimeEmbeddingIndex.ts`

| Validação | Onde |
|---|---|
| Manifesto textual tem `embeddingsEnabled===true` + secção `embeddings` completa (provider, modelo, dimensões inteiras >0, `updatedAt`, `embeddingInput.version===1`, `prefixMode` válido) | `parseManifestEmbeddingInfo` `:172-198` |
| `embeddings.jsonl` existe e é ficheiro; tamanho ≠ 0 | `:235-237`, `:378-382` |
| Identidade da fonte estável antes/depois da leitura (`sameSourceIdentity`) | `:383, 455, 533` |
| Binário derivado só aceite se `publicationId`, dimensões, provider e modelo coincidem com o canónico | `:459` |
| Limites de recursos (JSONL/binário/pico estimado, bridge mobile) | `:494-524` |
| Só registos `validForSearch` (via `calculateEmbeddingState`); **`count===0` ⇒ `null`** | `:275-283` |
| Cache invalidada por publicação, rollback, settings e binário | `main.ts:2884-2885, 887-893, 1494` |

Ou seja, o passo ④ já é **fresco por identidade de fonte** e não depende de `DeviceRuntimeState`.

### 2.3 Consumidores de `semanticAvailable` / `getDeviceRuntimeState().embeddings`

| Local | Tipo | Impacto |
|---|---|---|
| `linaSearchView.ts:3756` | **Decisão funcional (pré-gate)** | Bloqueia pesquisa — **único** |
| `linaSearchView.ts:2703, 2723-2726` | Apresentação (Sidebar) | Não bloqueia pesquisa |
| `linaSearchView.ts:2909, 2919` | Código morto (`renderEmbeddingDiagnosticSummary`) | — |
| `deviceDiagnosticsModal.ts:276-278` | Apresentação | — |
| `settings.ts:798, 832, 1144`, `main.ts:715, 867` | Só papel/`isActiveProducer` | — |
| `search/semanticSearchModal.ts` (comando) | Verificações próprias frescas | Não usa a cache |
| `hybridSearch.ts` / `runHybridModeGrouped` | Sem pré-gate; usa passo ④ + identidade | Não usa a cache |

### 2.4 P1-B — fluxo de arranque atual

`onload` (`main.ts:487-489`) faz `await this.loadDataFromDisk()` **antes** de `registerView` (`:494`), portanto nada da UI corre antes do fim de `loadDataFromDisk`.

Dentro de `loadDataFromDisk` existem **dois ramos** com o mesmo final duplicado:

| Ramo | Linhas | Sequência final |
|---|---|---|
| Versão de settings futura (`unsupportedFutureVersion`) | `3584-3613` | `setDeviceSettingsContext` → `loadDeviceState` → `localDeviceState` → `evaluate()` (`3606`) → `refreshDeviceRuntimeState()` (`3607`) → `initializeExclusionPolicy()` (`3608`) → `loadCanonicalVectorContract()` (`3609`) |
| Normal | `3615-3677` | … → `evaluate()` (`3671`) → `refreshDeviceRuntimeState()` (`3672`) → `initializeExclusionPolicy()` (`3673`) → `loadCanonicalVectorContract()` (`3674`) |

### 2.5 Quando é carregado o contrato e quem depende dele

- `effectiveVectorContract` (`main.ts:309`) só é escrito por `loadCanonicalVectorContract()` (`:2455-2489`) e por `setEffectiveEmbeddingContract` (**sem chamadores de produção**, só testes).
- Chamadores de `loadCanonicalVectorContract`: arranque (2 sítios) e `refreshEmbeddingConfigurationState` (`:888`).
- `loadCanonicalVectorContract` lê **apenas** `.lina/index/manifest.json` e `embeddings.binary.manifest.json`; não usa papel, ownership, settings nem `DeviceRuntimeState`. Erros são engolidos (devolve `null`).

| Dependente do contrato | Como |
|---|---|
| `getEffectiveEmbeddingConfig()` (`main.ts:2491`) — Companion | sem contrato ⇒ `provider:""`, `model:""`, `isAvailable:false` |
| **`refreshDeviceRuntimeState`** (`main.ts:1051`) | `getSemanticSearchAvailability(app, provider, model)` com a config efetiva |
| `runSemanticSearchGrouped` / `runHybridModeGrouped` | `embeddingConfig.contract`, `isAvailable` |
| `EmbeddingWorkStatusController.refreshSummary` | `nextGenerationIdentity` a partir da config |
| `settings.ts:821` (resumo Companion), comando "pesquisar semanticamente" | contrato/config |

`resolveDeviceRuntimeState` em si **não** usa `effectiveVectorContract`: extrai o contrato do manifesto (`companionConsumptionState`). A dependência é indireta e passa exclusivamente por `getSemanticSearchAvailability(provider, model)`.

---

## 3. Problemas encontrados

### P-A1 — Pré-gate por cache (confirmado)
`linaSearchView.ts:3755-3759` recusa a pesquisa com base em `DeviceRuntimeState.embeddings.semanticAvailable`, que só é recalculado no arranque, na mudança de papel e ao abrir o diagnóstico (LINA-12B §1.3). Cenários: primeira geração num vault novo; mudança de provider/modelo revertida; Companion (P-B1).

### P-A2 — O pré-gate é redundante quanto a segurança (confirmado)
Comparação por caso (cache estava a decidir sozinha só no caso 1):

| # | Cenário | Antes | Depois de remover o pré-gate |
|---|---|---|---|
| 1 | Cache `false`, vetores válidos no disco | **Bloqueia (defeito)** | Pesquisa executa |
| 2 | Cache `true`, sem `embeddings.jsonl` / manifesto sem secção | Passa gate; ④ devolve `null` ⇒ mensagem | Igual |
| 3 | Cache `true`, provider ou modelo do dispositivo ≠ índice | Passa gate; ⑤/⑥ devolvem mensagem | Igual |
| 4 | Cache `false`, sem embeddings (estado vazio normal) | Mensagem específica *"Embeddings não existem ou estão vazios."* (texto bruto da cache) | ④ devolve `null` ⇒ **mensagem menos específica** (ver P-A3) |
| 5 | Cache `true`, prefixo/`inputVersion` diferentes | ⑦ mensagem | Igual |
| 6 | Companion sem contrato | ② mensagem (a seguir ao gate) | ② mensagem (primeiro passo) |
| 7 | Cópia binária inválida/desatualizada | ④ `null` + diagnóstico | Igual |

Nenhum caso em que a cache impedia uma chamada de rede indevida: **o único passo com rede (⑨) só é atingido após ④–⑧**, que não dependem da cache.

### P-A3 — Regressão de mensagem no estado "sem embeddings" (confirmado, tem de ser tratado no P1-A)
Num vault sem embeddings, `readRuntimeEmbeddingSourceIdentityResult` devolve `failureReason:"canonical-manifest-invalid"` / `errorCode:"canonical-manifest-invalid"` (ou `"jsonl-missing"` quando o ficheiro não existe) (`runtimeEmbeddingIndex.ts:230-237`). `getSemanticRuntimeLoadMessage()` (`linaSearchView.ts:2586-2601`) só reconhece `fallbackReason==="empty"` e `lastErrorCode==="jsonl-missing"`; o resto cai em `semanticCorpusLoadFailed` ("Não foi possível carregar…"), **enganador** para "ainda não geraste embeddings". Logo, remover o gate sem mapear estes códigos degrada a mensagem do estado vazio mais comum.

### P-A4 — Mensagens do pré-gate não são traduzidas
`runtimeState.embeddings.reason` é texto português bruto (`semanticCapability.ts`); removê-lo elimina um caminho não-i18n. As mensagens de ⑤–⑧ também estão *hardcoded* em português (dívida i18n pré-existente; **fora do âmbito**).

### P-A5 — Não há outros pré-gates semelhantes (confirmado)
`semanticAvailable`/`embeddings.*` só decidem funcionalidade em `:3756`. Híbrida, modal de pesquisa semântica e comandos não usam a cache para decidir.

### P-A6 — Adjacentes, fora de âmbito (não alterar no P1-A)
- Dimensão da query ≠ do índice: em modo puro `searchRuntimeSemanticIndex` devolve `[]` e o utilizador vê "sem resultados" (a híbrida devolve aviso).
- `embeddingsEnabled=false` não impede a consulta ao provider (nem antes nem depois).
- `getRuntimeEmbeddingIndex` é chamado com `safeChunks`; a cache guarda o primeiro conjunto pedido (pré-existente).

### P-B1 — Estado calculado antes do contrato (confirmado: ordem; plausível: efeito)
Para um Companion, `refreshDeviceRuntimeState` chama `getSemanticSearchAvailability(app, "", "")` porque `getEffectiveEmbeddingConfig()` ainda não tem contrato ⇒ `indexProvider !== ""` ⇒ `incompatible`, e o resultado fica na cache (que P1-A deixa de tornar bloqueante, mas continua a alimentar a Sidebar até P1-c/d).

### P-B2 — Não há dependência circular (confirmado)
`loadCanonicalVectorContract` não lê papel, ownership, settings nem `DeviceRuntimeState`. `refreshDeviceRuntimeState` precisa do contrato (Companion) e do papel (`localDeviceState`, já definido). Grafo acíclico:

```
localDeviceState ──┐
                   ├─→ getEffectiveEmbeddingConfig ─→ refreshDeviceRuntimeState
loadCanonicalVectorContract ─┘
ownership.evaluate ─────────────────────────────────→ refreshDeviceRuntimeState (via loadOwnership no próprio refresh)
initializeExclusionPolicy   (independente; escreve `.lina/exclusions.json`, nunca o manifesto textual)
```

### P-B3 — Outros efeitos da ordem atual
- O contrato só é relido em `refreshEmbeddingConfigurationState`; um contrato novo publicado durante a sessão não é visto (**fora de âmbito**, ver LINA-14/P1-d).
- O bloco final está duplicado nos dois ramos (risco de corrigir só um).

---

## 4. Alterações propostas

### 4.1 P1-A — alteração mínima segura

Em `src/search/linaSearchView.ts`:

1. **Remover o pré-gate** em `runSemanticSearchGrouped` (`:3755-3759`): apagar a leitura de `getDeviceRuntimeState()` e o `if (!runtimeState.embeddings.semanticAvailable) { … return; }`. O primeiro passo passa a ser o bloco `isCompanion` existente (`:3762`).
2. **Mapear os códigos de "sem embeddings" em `getSemanticRuntimeLoadMessage()`** (`:2586-2601`) para `this.L.semanticNoEmbeddings`, além do que já mapeia:
   - `diagnostic.lastErrorCode` ∈ `{"jsonl-missing", "canonical-manifest-invalid", "canonical-manifest-read-failed", "canonical-embeddings-empty"}`; ou
   - `diagnostic.fallbackReason` ∈ `{"empty", "canonical-manifest-invalid"}`.
   Ordem de precedência preservada: binário desatualizado/inválido e `no-safe-source` mantêm as mensagens atuais (não se sobrepõem aos códigos acima, porque só existem quando há fonte válida).
3. Não introduzir chamadas novas a `getRuntimeEmbeddingIndex` fora de `runSemanticSearchGrouped`/`runHybridModeGrouped` (o teste `runtimeEmbeddingIndex.test.ts:82-91` impede que a Sidebar passiva peça o índice).

Resultado (critério de aceitação): `cache antiga → validação runtime (④–⑧) → decisão correta`.

**Alternativas rejeitadas**
| Opção | Motivo |
|---|---|
| Substituir o gate por `await getSemanticSearchAvailability(...)` | Duplica ④–⑧ e adiciona uma leitura do `embeddings.jsonl` por pesquisa |
| Manter o gate só para escolher a mensagem quando ④ é `null` | Reintroduz dependência da cache e texto não-i18n; o mapeamento de códigos (2.) resolve o mesmo |
| Chamar `refreshDeviceRuntimeState()` antes do gate | Custo de I/O por pesquisa; pertence a P1-c/d, não a P1-A |

### 4.2 P1-B — alteração mínima segura

Em `main.ts`, nos **dois** ramos de `loadDataFromDisk`, mover `await this.loadCanonicalVectorContract();` para **imediatamente antes** de `await this.refreshDeviceRuntimeState();` (e após `await this.getOwnershipGate().evaluate();`):

```
ANTES                                   DEPOIS
evaluate()                              evaluate()
refreshDeviceRuntimeState()             loadCanonicalVectorContract()
initializeExclusionPolicy()             refreshDeviceRuntimeState()
loadCanonicalVectorContract()           initializeExclusionPolicy()
```

Pontos:
- `initializeExclusionPolicy` mantém a posição relativa; não interage com o contrato.
- Sem novas leituras materiais: `loadCanonicalVectorContract` lê o mesmo manifesto que `refreshDeviceRuntimeState` já lê (custo: uma leitura extra do JSON no arranque, desprezável).
- Sem alterações a `changeDeviceRole`, `refreshEmbeddingConfigurationState` ou à assinatura de qualquer método.

**Alternativa rejeitada para P1-B:** fazer `refreshDeviceRuntimeState` carregar o contrato internamente. Corrige também mudanças de papel/diagnóstico e contratos novos durante a sessão, mas altera a semântica de um método usado em 7 sítios; fica para P1-d/LINA-14.

Resultado: `contrato carregado → runtime state correto`.

### 4.3 Explicitamente fora do âmbito
Invalidação da cache (P1-c/d), correção da Sidebar (P1-e/f), coordenador, ownership (P1b), remoção de código morto (`renderEmbeddingDiagnosticSummary` — há um teste que exige a sua existência, `linaSearchViewHardening.test.ts:58-70`), i18n das mensagens de ⑤–⑧.

---

## 5. Ficheiros envolvidos

| Ficheiro | Alteração | Fase |
|---|---|---|
| `src/search/linaSearchView.ts` | remover pré-gate (`:3755-3759`); alargar `getSemanticRuntimeLoadMessage` (`:2586-2601`) | P1-A |
| `main.ts` | mover `loadCanonicalVectorContract()` (2 ramos: `3607-3609`, `3672-3674`) | P1-B |
| `tests/search/semanticSearchRuntimeGate.test.ts` (novo) | testes P1-A | P1-A |
| `tests/device/vectorContractStartupOrder.test.ts` (novo) | testes P1-B | P1-B |
| `CHANGELOG.md` | entrada curta | ambos |
| `AGENTS.md` | linha de estado da fase, se o projeto o fizer por fase | ambos |

Nenhuma alteração a `src/device/deviceRuntimeState.ts`, `src/search/hybridSearch.ts`, `runtimeEmbeddingIndex.ts`, schemas, manifestos ou persistência. **0 migrations.**

---

## 6. Testes necessários

### 6.1 Testes existentes que devem permanecer verdes
| Ficheiro | Relevância |
|---|---|
| `tests/device/deviceRuntimeState.test.ts` | resolver puro (não alterado) |
| `tests/device/deviceStateStartupIntegration.test.ts`, `deviceRoleRuntimeSafety.test.ts`, `deviceIdentityCanonical.test.ts` | chamam `loadDataFromDisk` (P1-B) |
| `tests/settings/companionEmbeddingInheritance.test.ts` | `loadCanonicalVectorContract` e config efetiva |
| ~15 ficheiros em `tests/settings/*` e `tests/device/*` | chamam `loadDataFromDisk` (regressão da reordenação) |
| `tests/search/runtimeEmbeddingIndex.test.ts` (`:82-91`) | fatia de código-fonte de `onOpen` até `runHybridModeGrouped`; **a função pura está depois**, mas não pode ganhar chamadas a `getRuntimeEmbeddingIndex` na Sidebar passiva |
| `tests/search/linaSearchViewHardening.test.ts`, `sidebarEmbeddingWorkflowState.test.ts`, `sidebarSimplificationUX.test.ts` | asserções de texto sobre `linaSearchView.ts`; nenhuma referencia o pré-gate (verificado) |
| `tests/search/semanticAvailabilityStatusConsistency.test.ts` | `getSemanticSearchAvailability` (não alterado) |
| `tests/index/embeddingLifecycle.integration.test.ts` | ciclo completo |

Não existe hoje **nenhum teste** que exercite `runSemanticSearchGrouped`.

### 6.2 Novos testes P1-A — `tests/search/semanticSearchRuntimeGate.test.ts`

**Estratégia:** o repositório testa a view sobretudo por texto de código-fonte. Propõe-se uma camada comportamental que evita `any`: instanciar a view com `Object.create(LinaSearchView.prototype)`, definir apenas os campos usados e invocar o método privado por acesso indexado (`view["runSemanticSearchGrouped"](…)`, permitido por TypeScript). Mock de `generateSingleEmbedding` com `vi.mock` do módulo de origem. Se o `mockObsidian` não suportar herdar de `ItemView`, recorrer à camada de texto (T-A0) como fallback.

| ID | Nome | Objetivo | Cenário | Resultado esperado |
|---|---|---|---|---|
| T-A0 | `pure semantic search does not read DeviceRuntimeState` | Invariante estrutural | Texto de `runSemanticSearchGrouped` (fatia entre `private async runSemanticSearchGrouped` e `private renderGroupedCards`) | `not.toContain("getDeviceRuntimeState")`, `not.toContain("semanticAvailable")`; `indexOf("getRuntimeEmbeddingIndex") < indexOf("generateSingleEmbedding")` |
| T-A1 | `searches when the cached capability says unavailable but the runtime index is valid` | Núcleo de P1-A | `getDeviceRuntimeState` lança se chamado; `getRuntimeEmbeddingIndex` devolve índice válido; identidade igual | `generateSingleEmbedding` chamado 1×; cartões renderizados; sem mensagem de bloqueio |
| T-A2 | `does not call the provider when no runtime index exists` | Segurança/privacidade | `getRuntimeEmbeddingIndex` → `null`; diagnóstico `lastErrorCode:"canonical-manifest-invalid"` | `generateSingleEmbedding` **não** chamado; mensagem = `semanticNoEmbeddings` (não `semanticCorpusLoadFailed`) |
| T-A3 | `maps missing or empty canonical embeddings to the no-embeddings message` | P-A3 | tabela: `jsonl-missing`, `canonical-manifest-invalid`, `canonical-manifest-read-failed`, `canonical-embeddings-empty`, `fallbackReason:"empty"` | `semanticNoEmbeddings` em todos |
| T-A4 | `keeps binary and resource messages unchanged` | Não regressão | `binaryFailureReason:"binary-outdated"`, `"binary-invalid"`, `fallbackReason:"no-safe-source"` | `semanticBinaryStale`, `semanticBinaryInvalid`, `semanticBinaryRequired`; `semanticCorpusLoadFailed` para o restante |
| T-A5 | `blocks provider mismatch before any provider call` | Identidade | índice `mistral/mistral-embed`, settings `ollama/…` | mensagem de provider; `generateSingleEmbedding` não chamado |
| T-A6 | `blocks model mismatch before any provider call` | idem | modelos diferentes | idem |
| T-A7 | `blocks prefix/input-version mismatch before any provider call` | idem | `prefixMode` diferente | idem |
| T-A8 | `companion without contract is blocked before the runtime index is requested` | Ordem ② | papel `companion`, `contract:null` | `semanticEmbeddingsUnavailableNoContract`; `getRuntimeEmbeddingIndex` não chamado |
| T-A9 | `companion with contract searches using the contract identity` | Paridade | contrato `nomic-embed-text-v2-moe`, índice igual | pesquisa executa |
| T-A10 | `paridade pura ⇔ híbrida` | Consistência | mesmo estado publicado; comparar disponibilidade efetiva | ambas usam o índice runtime; nenhuma consulta a `getDeviceRuntimeState` |

### 6.3 Novos testes P1-B — `tests/device/vectorContractStartupOrder.test.ts`

Base: padrão de `deviceStateStartupIntegration.test.ts` (`new LinaPlugin(app)`, `FakeAdapter`, `loadDataFromDisk`) e de `companionEmbeddingInheritance.test.ts` (papel via estado de dispositivo `role:"companion"` gravado com `saveDeviceState`); artefactos como em `semanticAvailabilityStatusConsistency.test.ts` (`embeddings.jsonl` + `manifest.json` com secção `embeddings`, `embeddingInput` e `vectorContract` válidos).

| ID | Nome | Objetivo | Cenário | Resultado esperado |
|---|---|---|---|---|
| T-B1 | `loads the vector contract before resolving runtime state` | Ordem (ramo normal) | `vi.spyOn` em `loadCanonicalVectorContract` e `refreshDeviceRuntimeState`; `loadDataFromDisk()` | `invocationCallOrder` do contrato < do refresh |
| T-B2 | `same order in the future-settings-version branch` | Ramo `unsupportedFutureVersion` | `settings.settingsSchemaVersion` superior ao suportado | idem |
| T-B3 | `companion runtime state is available after startup` | Efeito (B3) | papel companion, manifesto com contrato, `embeddings.jsonl` válido e chunks | `getDeviceRuntimeState().embeddings.semanticAvailable === true`; `getEffectiveEmbeddingContract()` não nulo; `provider/model` da config = contrato |
| T-B4 | `producer runtime state does not depend on the vector contract` | Não regressão | papel producer, settings locais = publicados | `semanticAvailable` igual antes/depois da reordenação |
| T-B5 | `startup tolerates missing or invalid manifest` | Robustez | sem `manifest.json`; e manifesto com JSON inválido | não lança; contrato `null`; estado `text-only`/`unavailable` coerente |
| T-B6 | `contract is not re-read by refreshDeviceRuntimeState` | Fixar âmbito | mudar o manifesto após o arranque e chamar `refreshDeviceRuntimeState` | contrato efetivo inalterado (documenta o limite; passa a mudar em P1-d) |
| T-B7 | `startup order does not change exclusion policy initialisation` | Isolamento | política ausente/presente | `initializeExclusionPolicy` continua a correr uma vez após o refresh |

**Modo de introdução:** T-A1, T-A2 (mensagem), T-A3 e T-B1–T-B3 são escritos primeiro como `it.fails(...)` (falham hoje com a asserção correta) e convertidos em `it(...)` no mesmo PR da correção.

### 6.4 Testes do ciclo de embeddings
`embeddingLifecycle.integration.test.ts` já valida "todos os modos de pesquisa" após publicação; T-A10 acrescenta a asserção de que a pesquisa pura não consulta a cache. Não são necessários novos testes de publicação.

---

## 7. Riscos

| # | Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|---|
| R1 | Mensagem do estado vazio piora (P-A3) | Certa se só se remover o gate | Baixo–médio (UX) | Alteração 4.1.2 + T-A2/T-A3 |
| R2 | Primeira pesquisa semântica pura passa a carregar o índice (I/O) mesmo quando a cache dizia "indisponível" | Média | Baixo | É o comportamento já existente da híbrida; carga lazy, single-flight, com limites de recursos |
| R3 | Query enviada ao provider quando não devia | Muito baixa | Alto (privacidade) | O passo com rede (⑨) só ocorre após ④–⑧; T-A2/T-A5–T-A7 verificam `generateSingleEmbedding` não chamado |
| R4 | Testes de texto de `linaSearchView.ts` partem | Baixa | Baixo | Verificado: nenhuma asserção referencia `getDeviceRuntimeState`/o pré-gate no bloco semântico |
| R5 | Reordenação altera algum teste que espia a ordem de `loadDataFromDisk` | Baixa | Baixo | Pesquisa por `invocationCallOrder`/`callOrder`: sem ocorrências |
| R6 | Corrigir só um dos dois ramos de `loadDataFromDisk` | Média (código duplicado) | Médio | T-B1 e T-B2 |
| R7 | Companion com contrato inválido/parcial deixa o refresh com config vazia | Já existe | Baixo | Comportamento inalterado; T-B5 |
| R8 | Falsa sensação de que a cache está corrigida | Média | Médio | P1-A/B **não** corrigem a Sidebar (continua a usar a cache até P1-c/d); documentar no CHANGELOG |
| R9 | Mudança de provider/modelo continua a ser tratada com mensagens diferentes entre híbrida (aviso genérico) e pura (mensagem específica) | Existe | Baixo | Fora de âmbito |
| R10 | Regressão de i18n | Muito baixa | Baixo | O mapeamento só usa strings já existentes (`semanticNoEmbeddings`) |

**Rollback:** dois commits independentes (um por fase); `git revert` de qualquer um restaura o comportamento anterior sem impacto em dados, schemas ou artefactos.

---

## 8. Plano de implementação Codex

Pré-requisitos e regras (AGENTS.md): trabalhar em `D:\_dev\obsidian\lina`; ler `AGENTS.md` e `docs/agents/*.md` relevantes (`indexacao-pesquisa.md`, `obsidian-plugin.md`, `ui-ux.md`, `relatorio-final.md`); não usar `eslint --fix`, `any`, `ts-ignore`, `localStorage`; texto de UI só com strings existentes; sem refactors oportunistas; **sem commit sem autorização explícita**.

**Passo 0 — Verificações de ambiente**
```powershell
Get-Location
git rev-parse --show-toplevel
git status --short
git branch --show-current
git rev-parse HEAD
git remote get-url origin
```
Parar se o root não for `D:/_dev/obsidian/lina` ou se houver alterações não previstas.

**Passo 1 — Baseline**
```powershell
npm ci
npm run typecheck
npm test
npm run lint:obsidian
```
Registar contagens (ficheiros/testes e 7 avisos históricos).

**Passo 2 — Testes primeiro (P1-B)**
Criar `tests/device/vectorContractStartupOrder.test.ts` com T-B1…T-B7; T-B1–T-B3 como `it.fails`. Correr só este ficheiro e confirmar que os `it.fails` passam (bug reproduzido).

**Passo 3 — Implementar P1-B**
Em `main.ts`, nos dois ramos de `loadDataFromDisk`, mover `await this.loadCanonicalVectorContract();` para antes de `await this.refreshDeviceRuntimeState();`. Converter os `it.fails` de T-B1–T-B3 em `it`. Correr o ficheiro e os testes de `tests/device/**` e `tests/settings/**`.

**Passo 4 — Testes primeiro (P1-A)**
Criar `tests/search/semanticSearchRuntimeGate.test.ts` com T-A0…T-A10; T-A0, T-A1, T-A2 (mensagem) e T-A3 como `it.fails`. Se a instanciação de `LinaSearchView` for inviável no `mockObsidian`, implementar T-A0/T-A3 por texto e registar a limitação no relatório.

**Passo 5 — Implementar P1-A**
Em `src/search/linaSearchView.ts`: (1) remover o pré-gate de `runSemanticSearchGrouped`; (2) alargar `getSemanticRuntimeLoadMessage` conforme §4.1.2. Converter `it.fails` em `it`. Confirmar que `runSemanticSearchGrouped` já não referencia `getDeviceRuntimeState`.

**Passo 6 — Validação obrigatória**
```powershell
npm run typecheck
npm test
npm run build
npm run release-check
npm run lint:obsidian
npm run lint:obsidian:strict
git diff --check
git status --short
```
Critérios: typecheck e testes verdes (número de testes = baseline + novos); lint normal sem erros e sem novos avisos face aos 7 históricos; `git diff --check` limpo; `main.js` só regenerado por build se o projeto o versiona — não o incluir na revisão de código. Se `esbuild` falhar com `spawn EPERM` no sandbox, repetir fora do sandbox e reportar.

**Passo 7 — Documentação**
`CHANGELOG.md`: duas linhas (pesquisa semântica pura já não depende da cache; contrato vetorial carregado antes do estado runtime). Se o projeto mantiver estado por fase em `AGENTS.md`, acrescentar "Fase LINA-13-P1-A/B concluída" **sem** declarar a Sidebar corrigida.

**Passo 8 — Validação manual sugerida (Obsidian)**
1. Vault novo, produtor: gerar embeddings; sem abrir diagnóstico, pesquisar em modo "semântica" → devolve resultados.
2. Vault sem embeddings: modo "semântica" → mensagem de "não existem embeddings", sem chamada ao provider.
3. Alterar modelo nas Definições: modo "semântica" → mensagem de modelo diferente, sem chamada ao provider.
4. Companion com `.lina/index` sincronizado: reiniciar o Obsidian; modo "semântica" e "híbrida" funcionam; diagnóstico mostra pesquisa completa.
5. Modo "textual" e "híbrida" inalterados.

**Passo 9 — Relatório final** (formato `docs/agents/relatorio-final.md`, com os campos de `AGENTS.md`): ficheiros lidos, alterados, comandos e resultados, `npm ci` executado, confirmar que não houve alterações a notas, que não foram gerados embeddings, que não houve chamadas externas (testes com mocks), que não houve alterações fora do âmbito, e o commit (ou a ausência dele).

**Commits (só se autorizado):**
1. `fix: load vector contract before resolving device runtime state`
2. `fix: validate pure semantic search against the runtime index instead of cached capability`

**Critérios de aceitação finais**

| | Antes | Depois |
|---|---|---|
| Pesquisa | cache incorreta → bloqueio | cache antiga → validação runtime (índice + identidade) → decisão correta |
| Startup | runtime state → contrato vazio | contrato carregado → runtime state correto |
| Mensagem sem embeddings (modo puro) | texto da cache | `semanticNoEmbeddings` (i18n) |
| Rede | inalterada | inalterada (⑨ só depois de ④–⑧) |
| Dados/schemas | — | 0 alterações, 0 migrations |

---

## 9. Perguntas do pedido — respostas diretas

**P1-A**
1. *Cadeia atual?* §2.1: pré-gate por cache → Companion → identidade sobre o índice runtime → rede → pesquisa.
2. *Validações reais depois do pré-gate?* §2.1 ②–⑩ e §2.2 (existência/validade do manifesto e do ficheiro, guardrails, identidade provider/modelo/prefixo, dimensão, `validForSearch`, estabilidade da fonte).
3. *Reduz segurança?* **Não.** A rede só ocorre após as validações independentes da cache. Reduz apenas a especificidade da mensagem do estado vazio, que o passo 4.1.2 repõe.
4. *Outros pontos semelhantes?* **Não** há outros pré-gates funcionais; os restantes consumidores são de apresentação (P1-e/f).
5. *Alteração mínima?* §4.1: remover o bloco `:3755-3759` e mapear os códigos "sem embeddings" em `getSemanticRuntimeLoadMessage`.

**P1-B**
1. *Onde ocorre?* `loadDataFromDisk`, dois ramos (`main.ts:3606-3609` e `3671-3674`), chamado por `onload` antes de `registerView`.
2. *Quando é carregado o contrato?* Depois de `refreshDeviceRuntimeState` e de `initializeExclusionPolicy`, e depois em `refreshEmbeddingConfigurationState`.
3. *Quem depende dele?* `getEffectiveEmbeddingConfig` (Companion) → `refreshDeviceRuntimeState`, pesquisa, controller de trabalho, Definições, comando de pesquisa semântica.
4. *Dependências circulares?* **Não** (§P-B2).
5. *Ponto mínimo seguro?* Mover `loadCanonicalVectorContract()` para antes de `refreshDeviceRuntimeState()` nos dois ramos.

---

## 10. Confirmações de âmbito
- Apenas este documento foi criado; nenhum ficheiro de código, teste, configuração, schema ou manifesto foi alterado.
- Nenhuma nota do vault alterada; nenhum embedding gerado; nenhuma chamada externa; nenhum commit.

# LINA-15F — AUDITORIA DA CONFIGURAÇÃO E DA SUA CONSISTÊNCIA COM O RUNTIME

> **Fase:** LINA-15F — Configuração / Runtime Configuration Consistency
> **Data:** 2026-10-02
> **Estado do código auditado:** `master` @ `862ce1f` (após LINA-15A a LINA-15E), árvore limpa
> **Autoridade documental:** `AGENTS.md` → `PROMPT-MESTRA-LINA-004` → `docs/INDEX.md` / `docs/architecture/` → esta auditoria
> **Origem dos findings:** `docs/audits/architecture/LINA-EMBEDDINGS-AUDITORIA-GLOBAL-POS-LINA14-001.md` (F-11, F-12 e correlatos)
> **Natureza:** auditoria factual **antes** de qualquer alteração de código de produção. Os findings foram **reverificados no código atual**, não assumidos.

---

## 0. Conflitos de autoridade identificados antes de implementar

| # | Conflito | Resolução |
|---|---|---|
| C1 | `PROMPT-MESTRA-LINA-004` indica o branch oficial `main`; `AGENTS.md` e `docs/INDEX.md` estabelecem `master`. | Prevalece `AGENTS.md`: commit em `master`. |
| C2 | A prompt-mestra manda aguardar autorização antes do push; a prompt LINA-15F manda não executar push. | Compatíveis: **não há push**. |
| C3 | `docs/INDEX.md` (LINA-DOC-001) lista a **LINA-15F** como "Persistência, Recuperação e Validação" (F-08/F-09/F-10) e a **LINA-15G** como "Custo/Privacidade e Limpeza de Settings" (F-11/F-12/F-15/F-22). A prompt desta fase define a LINA-15F como configuração/runtime (F-11/F-12). | O pedido explícito do responsável define o âmbito: esta fase trata F-11 e F-12. O `INDEX.md` é reconciliado no fecho da fase (persistência passa a 15G; F-15/F-22 permanecem abertos). |
| C3b | A prompt-mestra manda usar `getSettingDefinitions()` para settings; já é o caminho ativo (9N-D). | Sem conflito. Nenhuma UI nova é adicionada. |

---

## 1. Resposta resumida aos dois findings (estado verificado)

| Finding | Estado no código atual | Evidência |
|---|---|---|
| **F-11** — "local" decidido pelo id do provider | **CONFIRMADO, ainda presente.** `Ollama` é `isLocal: true` incondicionalmente; o endpoint nunca é considerado. | `src/ai/providerCapabilities.ts:15-34`; `main.ts:895-900, 1541-1544, 1739`; `src/index/embeddingWorkStatusController.ts:209`; `src/search/linaSearchView.ts:1749-1755` (análise de pasta) |
| **F-12** — `generateOnlyMissingEmbeddings=false` + `automatic-local-only` | **CONFIRMADO, ainda presente** (sem UI, mas persistível por `data.json` legado). A flag altera o **input de avaliação** (`updatePlan`), não só a execução. | `main.ts:1754, 2684, 2721, 2925`; `src/index/embeddingGenerator.ts:1569-1600` |

Nenhum dos dois foi resolvido pelas LINA-15A–15E.

---

## 2. Inventário da configuração (embeddings e IA)

Âmbito: chaves que determinam **provider, endpoint, modelo, política de geração e localidade**. Chaves de outros domínios (YAML, Inbox, pesos híbridos, exclusões) não fazem parte desta auditoria, salvo quando cruzam com embeddings.

### 2.1 Camadas de configuração

```text
data.json (sincronizável)
 ├─ LinaSettings (globais)           ← defaults em DEFAULT_SETTINGS (persistidos para TODOS os utilizadores)
 │    ├─ aiProvider/aiBaseUrl/aiAnalysisModel/…         (análise — legado global)
 │    ├─ embeddingProvider/BaseUrl/Model/…              (embeddings — legado global)
 │    ├─ embeddingsEnabled, embeddingUpdateMode         (políticas — UI ativa)
 │    ├─ generateOnlyMissingEmbeddings, generateEmbeddingsOnStartup   (sem UI)
 │    └─ aiProfiles[]                                    (legado; sem consumidor runtime)
 └─ deviceSettingsById[deviceId] (LinaDeviceSettings)    ← escrito pela UI ativa
      analysisProvider/Model/BaseUrl/Timeout, embeddingsProvider/Model/BaseUrl/Batch/Timeout,
      embeddingStorageReadPreference, maintainBinaryEmbeddingCopy, activeAiProfileId
app.secretStorage
      lina-analysis-api-key, lina-embeddings-api-key
```

### 2.2 Tabela de configuração (Configuração · Origem · Default · Normalização · Consumidores · Semântica)

| Configuração | Origem | Default | Normalização | Consumidores | Semântica |
|---|---|---|---|---|---|
| `embeddingsProvider` (device) | UI (`declarativeSettingRenderers`) → `setLocalProviderValues` | vazio | `resolvePureLocalProviderId`; legado ⇒ `ollama` | `getEffectiveEmbeddingConfig`, search view, adapters | Factual. Vazio ⇒ `normalizeSupportedProvider("")` ⇒ **`"ollama"`** (default silencioso) |
| `embeddingProvider` (global legado) | `data.json` | `"ollama"` (DEFAULT_SETTINGS) | idem | fallback em `getEffectiveEmbeddingConfig` | Sempre não-vazio após `Object.assign(DEFAULT_SETTINGS)` ⇒ nunca cai para o default de provider |
| `embeddingsBaseUrl` (device) | UI | vazio | `chooseProviderDefaultBaseUrl` | `getEffectiveEmbeddingConfig`, generator | Factual (endpoint) |
| `embeddingBaseUrl` / `embeddingLocalBaseUrl` / `aiBaseUrl` (global legado) | `data.json` | `http://localhost:11434` | idem | cadeia de fallback; **`aiBaseUrl` (análise) é fallback do endpoint de embeddings** | Mistura de domínios no fallback |
| `embeddingsModel` (device) | UI | vazio | `chooseProviderDefaultModel` | idem | Factual |
| `embeddingModel` (global legado) | `data.json` | **`"nomic-embed-text"`** | `chooseProviderDefaultModel` | `getEffectiveEmbeddingConfig`, resumo da UI (`settings.ts:827`) | **Contradiz** o default documentado (`nomic-embed-text-v2-moe`) — ver CR-03 |
| `aiAnalysisModel` (global legado) | `data.json` | **`"gemma4:12b"`** | — | `getActiveTextAiProfile` | **Contradiz** `gemma4:e2b` (catálogo/AGENTS) — ver CR-03 |
| `embeddingsTimeout` / `embeddingRequestTimeoutSeconds` | UI / legado | `60` | `normalizePureLocalTimeout`; `parseInt` | `getEffectiveEmbeddingConfig` | Validado no generator (`timeoutMs` finito > 0) |
| `embeddingsBatchSize` / `embeddingBatchSize` | UI / legado | `10` | `normalizeEmbeddingBatchSize` (1–50) | generator | Política de execução |
| `embeddingsEnabled` | UI | `false` | boolean | lifecycle (`DISABLED`), worker, scheduler | Política |
| `embeddingUpdateMode` | UI | `"manual"` | `normalizeEmbeddingUpdateMode` (`manual` \| `automatic-local-only`) | scheduler (`canDispatchAutomatically`), policy engine | Política operacional |
| **`generateOnlyMissingEmbeddings`** | **sem UI**; migrada de `autoGenerateEmbeddingsOnlyWhenNeeded` (v0→v1) | `true` | — | `main.ts` ×4 (`incremental:`) | **Altera a avaliação (`updatePlan`) e a execução** — ver §7 |
| `generateEmbeddingsOnStartup` / `autoGenerateEmbeddingsOnStartup` | sem UI | `false` | — | `runStartupEmbeddingAutomation` | **Inerte**: só emite `console.warn` e termina (AGENTS: nunca gerar no arranque) |
| `aiProfiles[]` + `activeAiProfileId` + `LinaAiProfile.isLocal` | `data.json` (legado) | 2 perfis (`ollama-local`, `mistral`) | `normalizeAiProfiles` (migração v0→v1) | **nenhum consumidor runtime** (só testes e migração) | Estrutura persistida sem efeito |
| `isLocal` (capability do provider) | `providerCapabilities.ts`, `pureLocalSettingsModel.ts` (**duas tabelas**) | `ollama:true`, restantes `false` | por id | scheduler, snapshot (`isExternalProvider`), confirmação, análise de pasta | Ver §5 |

### 2.3 Resolução de configuração efetiva (embeddings), tal como implementada

```text
provider  = normalizeSupportedProvider( local.embeddingsProvider || settings.embeddingProvider )
baseUrl   = chooseProviderDefaultBaseUrl( local.embeddingsBaseUrl || settings.embeddingBaseUrl || settings.embeddingLocalBaseUrl
                                          || (ollama ? settings.aiBaseUrl : "") || defaults.baseUrl ) || OLLAMA_DEFAULT_BASE_URL
model     = chooseProviderDefaultModel( local.embeddingsModel || settings.embeddingModel || settings.embeddingLocalModel
                                        || defaults.model ) || "nomic-embed-text"
```

Companion: `provider/model` herdados do `VectorContractV1` publicado; só `baseUrl` e credenciais são locais (conforme `AGENTS.md`).

A **UI ativa** resolve o valor mostrado como `chooseProviderDefaultModel(local.embeddingsModel, provider, …)` (ignora os campos globais legados) — ver CR-03.

---

## 3. Classificação: factual, política, apresentação

| Classe | Configurações | Entra no `EmbeddingLifecycleSnapshot`? |
|---|---|---|
| **Factual** | provider, modelo, Base URL (endpoint), dimensões (derivadas), timeout/batch (execução) | provider/modelo/dimensões/inputVersion/prefixo sim (identidade alvo); endpoint **só** através da **localidade** (`cost`) |
| **Política operacional** | `embeddingsEnabled`, `embeddingUpdateMode`, `generateOnlyMissingEmbeddings` | `embeddingsEnabled` ⇒ `DISABLED`; `embeddingUpdateMode` ⇒ Policy Engine/Scheduler (nunca altera o snapshot); **`generateOnlyMissingEmbeddings` altera o `updatePlan` que alimenta o snapshot** ⇒ viola a separação |
| **Apresentação** | `interfaceLanguage`, `embeddingDefaultLanguage` (apenas metadado) | não |

**Princípio verificado:** uma política operacional não pode alterar a **avaliação factual** de trabalho. `generateOnlyMissingEmbeddings` viola-o (§7).

---

## 4. Consumo por camada

| Camada | Configuração consumida | Nota |
|---|---|---|
| Generator (`runGenerateLocalEmbeddings`) | `getEffectiveEmbeddingConfig`, `generateOnlyMissingEmbeddings` (→ `incremental`) | A flag decide se o canónico é ignorado |
| Controller (`refreshSummary`) | `getEffectiveEmbeddingConfig`, flag | Estado derivado em cache |
| Scheduler (`canDispatchAutomatically`, `hasAutomaticEmbeddingWork`) | `embeddingUpdateMode`, papel, `isLocal` (por id), runtime configurado, flag | Ver §6 |
| Lifecycle (`buildEmbeddingWorkLifecycleSnapshot`) | provider/modelo/dims (plano), `isExternalProvider` (por id) | Sem endpoint |
| Confirmação manual (`confirmAndRequestEmbeddingGeneration`) | provider (capability por id), flag | Texto "Local, sem consumo de créditos" para qualquer Ollama |
| Search (`runSemanticSearchGrouped`) | provider/modelo locais ou do contrato (Companion) | Coerente com o índice publicado |
| Diagnostics | derivados do snapshot/estado | Sem leitura direta de settings |

---

## 5. Provider local vs. endpoint local

### 5.1 Modelos possíveis

| Modelo | Definição | Estado |
|---|---|---|
| **A** | `provider.id === "ollama"` ⇒ local | **É o que o runtime faz** (`providerCapabilities.ts:15-34`, `linaSearchView.ts:1754`) |
| **B** | local ⇔ endpoint efetivamente local | não implementado |
| **C** | provider *capaz* de ser local **E** endpoint efetivamente local | **semântica correta** (ver 5.2) |

### 5.2 Semântica correta segundo a documentação vigente

- `AGENTS.md`: "Zero consumo silencioso de créditos de APIs externas"; "O plugin não envia conteúdo de notas para serviços externos sem configuração explícita e ação explícita do utilizador"; `automatic-local-only` = geração automática **apenas local**.
- `docs/architecture/LINA-14-WRITE-PATH-DECISIONS-001.md` e `embeddingPolicyEngine.ts`: `cost: "local"` é o único custo auto-despachável; `external` exige confirmação.

O critério operacional é **"o conteúdo das notas não sai desta máquina"**. O nome do provider não garante isto: um Ollama pode estar num servidor remoto. Logo o modelo correto é **C**: *efetivamente local = provider capaz de execução local ∧ endpoint em loopback*.

### 5.3 Casos de endpoint (comportamento atual vs. correto)

| Endpoint (Ollama) | Atual | Correto (Modelo C) |
|---|---|---|
| `http://localhost:11434` | local | local |
| `http://127.0.0.1:11434` / `127.x.x.x` | local | local |
| `http://[::1]:11434` | local | local |
| `http://0.0.0.0:11434` | local | local (destino = host local; endereço não especificado) |
| `http://meupc.local:11434`, `http://192.168.1.20:11434` (LAN) | **local (falso)** | **não-local** — o conteúdo sai da máquina |
| `https://ollama.exemplo.com` | **local (falso)** | **não-local** |
| URL inválida / vazia / esquema não-HTTP | **local (falso)** | **não-local** (conservador; o generator já rejeita) |
| Mistral / OpenRouter (qualquer URL) | externo | externo (capability não-local) |
| provider desconhecido | externo | externo |

Decisão de desenho: **não** usar heurísticas de rede frágeis (DNS, ranges privados, resolução de hostname). Apenas a **forma sintática** do host, normalizada pelo `URL` WHATWG (`localhost`, `*.localhost`, `127.0.0.0/8`, `::1`, `0.0.0.0`, normalizações tipo `127.1`/`2130706433`). Tudo o resto é tratado como remoto — o lado seguro. Endereços de LAN são deliberadamente **não-locais**: "local" significa "não sai desta máquina", não "não sai da minha rede".

---

## 6. Consequências para auto-dispatch (mapa de `isLocal`)

| Ponto | Mecanismo atual | Problema |
|---|---|---|
| Scheduler `canDispatchAutomatically` (`main.ts:1540-1544`) | `getEmbeddingProviderCapability(config.provider).isLocal` | por id |
| `getEmbeddingLifecycleSnapshot` — ramo indeterminado (`main.ts:895-900`) | `isExternalProvider: !capability.isLocal` | por id |
| `buildEmbeddingWorkLifecycleSnapshot` (`controller:209`) | `isExternalProvider` por `targetIdentity.provider` | por id; **sem acesso ao endpoint** |
| Snapshot ⇒ `cost` ⇒ `evaluateSchedulerDecisionFromSnapshot` / `deriveEmbeddingWritePathDecision` | `cost === "external"` ⇒ confirmação | herda o erro (cost `local` para Ollama remoto) |
| Operation Manager / Worker (`evaluateOperationStartGate`) | bloqueia `automatic` se `requiresConfirmation` | só protege se o snapshot disser `external` |
| Confirmação manual (`main.ts:1739`, `prepareEmbeddingUpdateConfirmation`) | `hasExternalCost`/`isLocal` por id | modal diz "Processamento local sem consumo de créditos" para endpoint remoto |
| Análise de pasta (`linaSearchView.ts:1749-1755, 6922`) | `isLocal = provider === "ollama"` | **salta `confirmRemoteFolderAnalysis`** para Ollama remoto ⇒ conteúdo de notas enviado sem a confirmação de privacidade |

**Verificação das barreiras (não-contornáveis pela classificação):** a decisão final de início é `evaluateOperationStartGate(deriveEmbeddingWritePathDecision(snapshot), origin)`, partilhada por Worker e Operation Manager; o snapshot vivo (`getEmbeddingLifecycleSnapshot`) compõe ownership atual e operação em curso; a LINA-15A mantém o *fencing*. A classificação local/remota influencia **apenas** `cost` (e portanto `requiresConfirmation` e `canDispatch`); não substitui ownership, lifecycle, write-path, manager nem worker. Isto mantém-se após a correção: o endpoint decide apenas "local vs externo" **dentro** do snapshot.

**Risco de cache:** o snapshot em cache do controller é construído no último `refresh`; uma alteração de Base URL **não** dispara `refresh-embedding-configuration-state` (apenas provider/modelo — `settingsRuntimeAdapters.ts:337-343`). Logo qualquer decisão de **escrita/despacho** tem de usar a localidade **viva**, não a do cache. (Decisão: ver §10.)

---

## 7. `generateOnlyMissingEmbeddings`

| # | Pergunta | Resposta (verificada) |
|---|---|---|
| 1 | Onde nasce? | `DEFAULT_SETTINGS.generateOnlyMissingEmbeddings = true` (`settings.ts:748`); migrado de `autoGenerateEmbeddingsOnlyWhenNeeded` (`settingsMigrations.ts:127-128`) |
| 2 | Default? | `true` |
| 3 | Persistência? | `data.json` (global; `saveDataToDisk` persiste o objeto `settings` inteiro) |
| 4 | Onde é lido? | `main.ts:1754` (confirmação), `:2684` (`hasAutomaticEmbeddingWork`), `:2721` (`refreshSummary` do controller), `:2925` (generator) — sempre `?? autoGenerate… ?? true` |
| 5 | Que comportamento altera? | `incremental=false` faz `readEmbeddingUpdatePreview`/`generateEmbeddingsForChunks` **ignorarem o canónico** (`canonicalRecords: []`, `canonicalReadability: "missing"`, `publishedIdentity: {}`) |
| 6 | Só incremental ou também rebuild? | Transforma qualquer execução em reconstrução total, sem passar por `INCOMPATIBLE`/confirmação de rebuild |
| 7 | Altera automatic dispatch? | **Sim**: `hasAutomaticEmbeddingWork` e `canDispatch` leem o plano afetado |
| 8 | Altera `updatePlan`? | **Sim** — causa raiz |
| 9 | Altera o `EmbeddingLifecycleSnapshot`? | **Sim**, indiretamente (plano ⇒ `work.counts/mode` ⇒ `UPDATE_AVAILABLE`/`INDEX_ONLY`) |
| 10 | Pode provocar regeneração repetitiva? | **Sim** (ver abaixo) |
| 11 | Existe UI? | **Não** (nenhum controlo no blueprint; 47 IDs) |
| 12 | A documentação descreve-o? | `AGENTS.md` ("A atualização de embeddings deve ser incremental") contradiz uma flag que desliga o incremental; nenhuma doc descreve a flag |

### 7.1 Ciclo (`false` + `automatic-local-only`)

```text
run (incremental:false) → publica N vetores válidos
  → hasAutomaticEmbeddingWork(): preview(incremental:false) → canónico ignorado → toGenerate = N, mode "initial-build"
  → snapshot: INDEX_ONLY / action "generate", cost local → canDispatch ✔
  → Scheduler (hasRemainingWork = true) → markDirty() → debounce 30 s → dispatch
  → repete indefinidamente (cada ciclo regenera o vault inteiro com o provider local)
```

O estado **nunca estabiliza** porque o critério de "há trabalho" depende da flag e não do estado factual dos artefactos. A Sidebar mostra "atualização disponível" permanentemente.

**Reprodução controlada:** teste de caracterização (§12) que, com o canónico completo e válido, mostra `toGenerate = N` para `incremental:false` e `0` para `incremental:true`, e que mostra que o estado **não estabiliza** após uma execução completa com `incremental:false`.

**Causa raiz:** contrato de configuração (uma política de *execução* a alterar a *avaliação*), não o Scheduler. Corrigir só o Scheduler (p. ex. ignorar `hasWork` após sucesso) deixaria a Sidebar, a confirmação e o snapshot inconsistentes.

---

## 8. Profiles (`aiProfiles`)

| Pergunta | Resposta |
|---|---|
| Existe configuração global e de profile? | Sim: `aiBaseUrl/aiAnalysisModel/…` globais **e** `aiProfiles[]` + `activeAiProfileId` (device) |
| Qual prevalece? | **Nenhum dos dois decide o runtime**: o runtime (`getActiveTextAiProfile`, `getEffectiveEmbeddingConfig`) lê `deviceSettingsById[…]` → global legado → defaults. `getActiveAiProfile()`/`normalizeAiProfiles()` não têm consumidores fora de testes e da migração |
| O runtime usa o mesmo profile que a UI apresenta? | A UI não apresenta profiles |
| `isLocal` pode divergir entre profile e configuração efetiva? | Sim: `LinaAiProfile.isLocal` é persistido (`profile.isLocal ?? fallback.isLocal ?? provider === "ollama"`) mas **nunca consultado**; o runtime usa `provider === "ollama"` |
| provider/model/baseUrl parcialmente definidos? | `normalizeAiProfiles` preenche com defaults do provider (`baseUrl ?? fallback`), nunca deixa ausente |
| Defaults fabricados? | `settings.ts:222-247` (`gemma4:e2b`, `mistral-small-latest`) — reais (catálogo). Ver CR-03 para os defaults globais |
| A LINA-15D foi respeitada? | Parcialmente: `768`/`"nomic-embed-text"` ainda existem em `embeddingWorkStatusController.ts:165,173`, `deviceRuntimeState.ts:244,256`, `semanticCapability.ts:186`, `sidebarStatusViewModel.ts:321,328`, `vectorContract.ts:361`, `main.ts:2653` — **resíduos da 15D**, fora do âmbito desta fase (encaminhados, CR-05) |

Conclusão: `aiProfiles` é **dívida técnica** (estrutura persistida e migrada sem efeito). Não é alterada nesta fase.

---

## 9. Settings sem UI (embeddings/IA)

| Chave | Tipo | Default | Consumidores | Efeito | Doc | Classificação |
|---|---|---|---|---|---|---|
| `generateOnlyMissingEmbeddings` | boolean | `true` | `main.ts` ×4 | altera avaliação+execução | nenhuma | **Dívida técnica com risco (F-12)** → corrigida nesta fase |
| `generateEmbeddingsOnStartup` / `autoGenerateEmbeddingsOnStartup` | boolean | `false` | `runStartupEmbeddingAutomation` | **nenhum** (só `console.warn`) | AGENTS: "nunca gerar no arranque" | Legado inerte; manter, sem UI (a UI sugeriria uma função inexistente) |
| `aiProfiles`, `activeAiProfileId`, `LinaAiProfile.isLocal` | estrutura | 2 perfis | nenhum em runtime | nenhum | — | Dívida técnica (candidata a remoção em fase própria com migração) |
| `embeddingProvider/BaseUrl/Model/BatchSize/RequestTimeoutSeconds`, `embeddingLocal*` | legado global | defaults | fallback em `getEffectiveEmbeddingConfig` | ativo quando o valor *device-local* está vazio | — | Legado ativo; origem de CR-03 |
| `aiProvider/aiBaseUrl/aiAnalysisModel/aiRequestTimeoutSeconds`, `ollamaUrl`, `chatModel`, `openrouterUrl` | legado global | defaults | `getActiveTextAiProfile`, fallback de embeddings (`aiBaseUrl`) | idem | — | Legado ativo; mistura análise→embeddings |
| `embeddingDefaultLanguage` | enum | `pt-PT` | só UI (metadado) | nenhum operacional | AGENTS (metadado) | Legítima (informativa) |

Não é adicionada UI nesta fase (não demonstrada necessidade).

---

## 10. Migrações (`settingsSchemaVersion`)

- `CURRENT_SETTINGS_SCHEMA_VERSION = 1`; um único passo `v0 → v1` (`settingsMigrations.ts`): campos legados → canónicos (`provider`→`aiProvider`, `ollamaUrl`→`aiBaseUrl`, `chatModel`→`aiAnalysisModel`, `embeddingLocal*`→`embedding*`, `autoGenerateEmbeddingsOnlyWhenNeeded`→`generateOnlyMissingEmbeddings`), normalização de `aiProfiles`, promoção de `local*` para `deviceSettingsById[deviceId]`.
- Versão futura (`> 1`): preservada sem alteração (`unsupportedFutureVersion`) — correto.
- Idempotente; não remove campos legados.
- `generateOnlyMissingEmbeddings` migrado **preserva um `false` legado** sem validação semântica ⇒ alimenta o ciclo de §7.
- `DEFAULT_SETTINGS` é `Object.assign`ed **antes** de qualquer fallback, logo os campos globais legados são **sempre não-vazios** e persistidos para todos os utilizadores (não distinguem "default" de "escolha"); isto impede qualquer migração que tente inferir intenção a partir deles (condiciona CR-03).
- **Sem alteração de schema nesta fase.** Qualquer correção de CR-03 que mude o modelo efetivo exige fase própria com plano de migração.

---

## 11. Casos obrigatórios (§12 da prompt)

Legenda: **A** = comportamento anterior à fase; **D** = depois. "Prova" = teste desta fase ou verificação por leitura.

| # | Caso | A (antes) | D (alvo) | Prova |
|---|---|---|---|---|
| 1 | Ollama local (loopback) | local; auto-despacho se `automatic-local-only` | **igual** | `endpointLocality`, `providerEndpointCapability`, scheduler |
| 2 | Ollama remoto | tratado como local ⇒ auto-despacho/modal "sem custos" | **não-local**: sem auto-despacho (`external-provider-blocked`); manual com aviso de endpoint remoto | idem |
| 3 | Provider não-Ollama | externo | igual | idem |
| 4 | Endpoint inválido | local (se Ollama) ⇒ auto-despacho que falha no generator ⇒ backoff | **não-local**; sem auto-despacho | idem |
| 5 | Provider ausente | `normalizeSupportedProvider("")` ⇒ `ollama` (default documentado D6) | sem alteração (legado aceite; ver CR-06) | leitura |
| 6 | Model ausente | `chooseProviderDefaultModel` ⇒ default do provider; fallback final `"nomic-embed-text"` | sem alteração (CR-03/CR-05) | leitura |
| 7 | Profile incompleto | `normalizeAiProfiles` completa com defaults | sem alteração | leitura |
| 8 | `generateOnlyMissingEmbeddings=true` | incremental | incremental | teste |
| 9 | `generateOnlyMissingEmbeddings=false` | avaliação e execução ignoram o canónico; ciclo | **ignorada**; incremental; sem ciclo; `console.warn` técnico único | teste |
| 10 | `automatic-local-only` | só `isLocal` por id | só **endpoint efetivamente local** + todas as barreiras | teste |
| 11 | Geração manual | confirmação sempre; texto "local" para qualquer Ollama | confirmação sempre; aviso específico para endpoint remoto | teste |
| 12 | Atualização incremental | conforme | conforme | existente |
| 13 | Rebuild | confirmação (15B/15C/15E) | inalterado | existente |
| 14 | Companion | `write.applicable=false` | inalterado | existente |
| 15 | Standby | bloqueado | inalterado | existente |
| 16 | Ownership perdido | fencing 15A | inalterado | existente (15A) |
| 17 | `INDETERMINATE` | bloqueado | inalterado | existente |
| 18 | `resource-limit-exceeded` | `INCOMPATIBLE`/`rebuild` (15C) | inalterado | existente (15C) |
| 19 | provider/model incompatível | `INCOMPATIBLE`/`rebuild` | inalterado | existente |
| 20 | Settings de versão antiga | migração v0→v1 | inalterada (a flag `false` migrada deixa de ter efeito de execução) | existente + teste |

---

## 12. Findings desta auditoria

| ID | Sev. | Título | Decisão nesta fase |
|---|---|---|---|
| **CR-01** (F-11) | HIGH | Localidade por id do provider: Ollama remoto classificado como local (auto-despacho, texto "sem custos", salto da confirmação de análise de pasta) | **Corrigir** (Modelo C: capability ∧ endpoint em loopback) |
| **CR-02** (F-12) | MEDIUM | `generateOnlyMissingEmbeddings=false` altera a avaliação do plano ⇒ regeneração perpétua com `automatic-local-only` | **Corrigir na causa**: política única de geração incremental; flag legada ignorada e sinalizada |
| **CR-03** | MEDIUM | Defaults/valores efetivos divergentes entre UI e runtime: a UI mostra `local \|\| default do provider` (p. ex. `nomic-embed-text-v2-moe`, `gemma4:e2b`); o runtime usa `local \|\| settings legado (nomic-embed-text, gemma4:12b)`. Um dispositivo sem valor local mostra X e gera com Y | **Não corrigir nesta fase** (muda o modelo efetivo/identidade publicada de utilizadores existentes; `DEFAULT_SETTINGS` persistido impede distinguir escolha de default). Documentar e encaminhar com opções |
| **CR-04** | LOW | A localidade em cache do controller pode ficar desatualizada após alterar Base URL (sem efeito de refresh) | **Mitigar**: decisões de escrita/despacho usam localidade viva; cache só informativa |
| **CR-05** | LOW | Resíduos da 15D: `768`/`"nomic-embed-text"` em controller, `deviceRuntimeState`, `semanticCapability`, `sidebarStatusViewModel`, `vectorContract`, `main.ts` | Encaminhar (fase de limpeza de defaults); fora do âmbito de configuração |
| **CR-06** | LOW | Provider ausente/desconhecido ⇒ `ollama` silenciosamente (`normalizeSupportedProvider`); `isAvailable` do `getEffectiveEmbeddingConfig` é quase sempre `true` | Encaminhar com CR-03 |
| **CR-07** | LOW | `aiProfiles`/`LinaAiProfile.isLocal` sem consumidor runtime; fallback de endpoint de embeddings usa `aiBaseUrl` (análise) | Dívida técnica; encaminhar |
| **CR-08** | INFO | `generateEmbeddingsOnStartup` inerte (só `console.warn`) | Manter; documentar |
| **CR-09** | INFO | Duas tabelas de capacidades de provider (`providerCapabilities.ts`, `pureLocalSettingsModel.ts`) | Manter nesta fase; a localidade passa a ter **uma** definição (`providerCapabilities.ts` + `endpointLocality.ts`); unificação das tabelas encaminhada (F-22) |

---

## 13. Plano de implementação (decisões)

1. **`src/ai/endpointLocality.ts` (puro):** `classifyEndpointLocality(baseUrl): "loopback" | "remote" | "invalid"` (apenas sintaxe do host via `URL`).
2. **`src/ai/providerCapabilities.ts`:** `isProviderEndpointLocal(providerId, baseUrl)` = capability local ∧ loopback; `resolveEndpointProviderCapability(providerId, baseUrl)` devolve a capability com `isLocal` efetivo. A tabela estática passa a descrever "pode ser local", não "é local".
3. **Pontos de consumo (main.ts / controller / search view):** usar a capability **efetiva** (viva) em: scheduler `canDispatchAutomatically`, `getEmbeddingLifecycleSnapshot`, `confirmAndRequestEmbeddingGeneration`, `hasAutomaticEmbeddingWork`, `refreshSummary` (campo informativo do summary) e `getActiveTextAiProfile`.
4. **Snapshot:** `buildEmbeddingWorkLifecycleSnapshot` aceita a localidade efetiva do endpoint (parâmetro explícito); sem ela, mantém o comportamento por provider (compatibilidade dos testes), mas todos os caminhos de produção passam-na.
5. **Confirmação manual:** mensagem específica para endpoint remoto (i18n pt-PT/en) e `requiresConfirmation` forçado.
6. **`generateOnlyMissingEmbeddings`:** política única (`embeddingUpdateSettings.ts`) — geração/avaliação **sempre incrementais**; a flag legada deixa de ter efeito; `console.warn` técnico (inglês) uma vez no arranque se estiver `false`; sem alteração de schema nem escrita em `data.json`.
7. **Sem:** novo estado paralelo, flags redundantes, decisões no Scheduler/UI, alteração do Vector Contract, do formato de embeddings, do ownership/fencing.
8. **Testes:** classificação de endpoints; capability efetiva; scheduler/lifecycle/gate com Ollama remoto; confirmação; causa raiz e estabilização da flag; guarda estática de `main.ts`.
9. **Documentação:** `LINA-15F-IMPLEMENT-…`, `INDEX.md`, `AGENTS.md` (estado + regra permanente).

---

## 14. Respostas finais da auditoria (antes da implementação)

1. Provider local/remoto classificado corretamente? **Não** (CR-01).
2. Ollama remoto pode ser tratado como local por engano? **Sim** (CR-01).
3. `automatic-local-only` respeita o endpoint efetivo? **Não**.
4. `generateOnlyMissingEmbeddings` tem semântica determinística? **Não** (CR-02).
5. Existe ciclo de regeneração automática? **Sim**, com `false` (§7.1).
6. Settings e runtime usam os mesmos valores efetivos? **Não** (CR-03).
7. Profiles e configuração global têm precedência inequívoca? **Não existe precedência**: profiles não são consumidos (CR-07).
8. Defaults reais ou fabricados? **Mistos**; resíduos fabricados persistem (CR-05).
9. Settings antigas migradas corretamente? **Sim** (v0→v1), com a ressalva da flag `false` migrada (CR-02).
10. Settings sem UI que constituam dívida? **Sim** (§9).
11. A configuração altera indevidamente o lifecycle? **Sim** — só através da flag (CR-02) e do `cost` por id (CR-01).
12. Scheduler/Manager/Worker protegidos? **Sim** nas barreiras; a entrada `cost` estava errada.
13. Companion e Standby isolados? **Sim** (inalterado).
14. Ownership/Fencing 15A intacto? **Sim**; esta fase não toca em ownership.
15. Encaminhar para outra fase? **Sim**: CR-03, CR-05, CR-06, CR-07, CR-09.

# LINA-15F — IMPLEMENTAÇÃO: CONSISTÊNCIA ENTRE CONFIGURAÇÃO E RUNTIME

> **Fase:** LINA-15F — Configuração / Runtime Configuration Consistency
> **Data:** 2026-10-02
> **Auditoria de referência:** `docs/audits/architecture/LINA-15F-AUDIT-CONFIG-RUNTIME-CONSISTENCY-001.md`
> **Findings tratados:** CR-01 (F-11), CR-02 (F-12), CR-04 (mitigação). Encaminhados: CR-03, CR-05, CR-06, CR-07, CR-09.
> **Sem alteração de:** schema de settings, formato dos embeddings, `VectorContractV1`, ownership/fencing (LINA-15A), Operation Manager/Worker/Scheduler (lógica), UI de settings.

---

## 1. CR-01 — Localidade por provider em vez de por endpoint

### Causa
`providerCapabilities.ts` declara `ollama` como `isLocal: true` e todos os consumidores usavam essa tabela estática como se descrevesse **onde o serviço corre**. Um Ollama configurado com uma Base URL remota (LAN, servidor, serviço alojado) era tratado como local: `automatic-local-only` despachava geração automática, o modal de confirmação dizia "Processamento local sem consumo de créditos externos" e a análise de pasta saltava a confirmação de envio de conteúdo para um serviço remoto.

### Comportamento anterior
| Cenário | Antes |
|---|---|
| Ollama `https://ollama.exemplo.com`, `automatic-local-only` | `cost: "local"` ⇒ `canDispatch = true` ⇒ geração automática, sem confirmação |
| Mesmo endpoint, geração manual | Modal com texto "Processamento local…" |
| Mesmo endpoint, análise de pasta | `isLocal = true` ⇒ sem `confirmRemoteFolderAnalysis` |
| Ollama com URL inválida | tratado como local (o generator rejeita depois ⇒ falha ⇒ backoff) |

### Comportamento corrigido (Modelo C: *capaz de ser local* ∧ *endpoint em loopback*)
- **`src/ai/endpointLocality.ts` (novo, puro):** `classifyEndpointLocality(baseUrl)` ⇒ `"loopback" | "remote" | "invalid"`, apenas pela **sintaxe do host** normalizada pelo `URL` WHATWG: `localhost`, `*.localhost`, `127.0.0.0/8` (incl. `127.1`, `2130706433`), `0.0.0.0`, `::1`, `::`, IPv4-mapped loopback. Qualquer outro host (LAN, `.local`, IP privado, DNS) é `remote`; vazio/mal formado/esquema não-HTTP é `invalid`. **Sem** DNS, ranges privados ou heurísticas de rede.
- **`src/ai/providerCapabilities.ts`:** `isProviderEndpointLocal(provider, baseUrl)` e `resolveEndpointProviderCapability(provider, baseUrl)`. A tabela estática passa a documentar "pode ser local"; `hasExternalCost` não muda (um Ollama remoto não é faturado por chamada, mas o conteúdo sai do dispositivo ⇒ `isLocal=false`).
- **`main.ts`:** `getEffectiveEmbeddingEndpointCapability(config)` (sempre **viva**, a partir da configuração efetiva) usada em: scheduler `canDispatchAutomatically`, `getEmbeddingLifecycleSnapshot` (ramo indeterminado **e** ramo normal — a localidade viva sobrepõe-se à do resumo em cache), `confirmAndRequestEmbeddingGeneration`, `hasAutomaticEmbeddingWork` e `refreshSummary`.
- **`embeddingWorkStatusController.ts`:** `EmbeddingWorkSummary.targetEndpointIsExternal?` alimenta `isExternalProvider` ⇒ `cost` do snapshot. Sem o campo, mantém-se a capability estática (compatibilidade); **todos os caminhos de produção passam-no** (guarda estática em teste).
- **Confirmação manual:** `prepareEmbeddingUpdateConfirmation` mostra, para endpoint remoto, a nova mensagem i18n `confirmEmbeddingUpdateRemoteEndpointWarningText` (pt-PT/en) e força `requiresConfirmation`.
- **`linaSearchView.getActiveTextAiProfile`:** `isLocal = isProviderEndpointLocal(provider, baseUrl)` ⇒ a confirmação de análise de pasta deixa de ser saltada para Ollama remoto.

### Cadeia resultante (inalterada nas barreiras)
```text
configuração efetiva (provider + Base URL)
   ↓  localidade do endpoint (nova, pura)
estado factual → EmbeddingLifecycleSnapshot (cost: local | external)
   ↓
deriveEmbeddingWritePathDecision()
   ↓
Scheduler / Operation Manager (evaluateOperationStartGate) / Worker / Ownership Fencing
```
A localidade só decide `cost`; **não** contorna ownership, lifecycle, write-path, manager nem worker (testado: Companion e Standby permanecem bloqueados em ambos os endpoints).

### CR-04 (mitigação)
Alterar a Base URL não dispara `refresh-embedding-configuration-state`. Por isso as decisões de **escrita/despacho** usam a localidade **viva** (`getEmbeddingLifecycleSnapshot`, scheduler, confirmação); o resumo em cache só alimenta apresentação (Sidebar).

---

## 2. CR-02 — `generateOnlyMissingEmbeddings = false`

### Causa
Uma política de **execução** ("regenerar tudo") entrava na **avaliação** de trabalho: com `incremental:false`, `readEmbeddingUpdatePreview` ignora o canónico (`canonicalReadability: "missing"`, `publishedIdentity: {}`) e o plano passa a `initial-build` com todos os chunks. Como a avaliação usa o mesmo plano, o estado nunca estabiliza após uma execução concluída.

### Comportamento anterior (reproduzido por teste com o código real)
```text
run → N vetores válidos publicados
 → hasAutomaticEmbeddingWork(): toGenerate = N, mode initial-build, canDispatch ✔
 → Scheduler: hasRemainingWork → markDirty → 30 s → dispatch → …
```
Regeneração total perpétua e Sidebar com "atualização disponível" permanente.

### Comportamento corrigido
- **`embeddingUpdateSettings.ts`:** `EMBEDDING_GENERATION_INCREMENTAL = true` e `isLegacyFullRegenerationPreferenceSet(settings)`. Geração **e** avaliação são **sempre incrementais**; a preferência legada deixa de ter efeito. Um rebuild total continua a ser decidido pelo planeador (identidade/legibilidade — LINA-15B/15C) ou pedido explicitamente (`isFullRebuild`, LINA-15E), sempre sob confirmação.
- **`main.ts`:** os quatro pontos (`confirmAndRequestEmbeddingGeneration`, `hasAutomaticEmbeddingWork`, `refreshSummary`, `runGenerateLocalEmbeddings`) usam a constante; a leitura de `generateOnlyMissingEmbeddings`/`autoGenerateEmbeddingsOnlyWhenNeeded` foi removida.
- **Sinalização (não silenciosa):** `runStartupEmbeddingAutomation` emite um `console.warn` técnico (inglês) se o valor persistido for `false`. Sem escrita em `data.json` e sem migração de schema: a chave continua preservada na lista de chaves de `loadDataFromDisk`.
- A causa foi corrigida no **contrato de configuração**, não no Scheduler (que não foi alterado).

---

## 3. Configuração envolvida

`embeddingUpdateMode` (`manual` | `automatic-local-only`), `embeddingsProvider`/`embeddingsBaseUrl` (device), `embeddingProvider`/`embeddingBaseUrl` (legado), `generateOnlyMissingEmbeddings` / `autoGenerateEmbeddingsOnlyWhenNeeded` (legado, agora ignorados), `aiProvider`/`aiBaseUrl`/`aiAnalysisModel` e `analysisProvider`/`analysisBaseUrl` (análise de pasta).

## 4. Impacto

- **Utilizadores com Ollama em `localhost`/`127.x`/`::1`:** nenhuma alteração.
- **Utilizadores com Ollama noutro host (LAN/remoto) e `automatic-local-only`:** a geração automática deixa de ocorrer (passa a manual com confirmação e aviso de endpoint remoto). Comportamento intencional: o conteúdo das notas sai da máquina.
- **Utilizadores com `generateOnlyMissingEmbeddings=false` persistido:** deixam de ter regeneração total em ciclo; a atualização é incremental. Nenhuma ação necessária.
- **Análise de pasta com Ollama remoto:** passa a pedir a confirmação de envio de conteúdo.
- **Sem impacto** em Companion, Standby, ownership/fencing, Vector Contract, formato de embeddings, persistência de settings.

## 5. Testes

| Ficheiro | Cobertura |
|---|---|
| `tests/ai/endpointLocality.test.ts` (40) | loopback (`localhost`, `*.localhost`, `127.x`, `127.1`, inteiro decimal, `0.0.0.0`, `::1`, IPv4-mapped), remoto (LAN, `.local`, DNS, `128.0.0.1`, `localhost.example.com`), inválido (vazio, esquema não-HTTP, malformado); capability efetiva por provider/endpoint |
| `tests/maintenance/embeddingEndpointLocalityDispatch.test.ts` (16) | `cost` local/externo no snapshot; `canDispatch`/`external-provider-blocked`; gate de início `automatic` recusado e `sidebar` permitido; Policy `manual`/`automatic-local-only`; Companion/Standby permanecem bloqueados; compatibilidade sem informação de endpoint; mensagem de confirmação (pt-PT/en); política incremental; guarda estática do wiring de `main.ts` e da search view |
| `tests/index/embeddingIncrementalFlagStabilization.test.ts` (4) | causa raiz (incremental:false nunca estabiliza, `canDispatch` verdadeiro); contrato corrigido (canónico completo ⇒ `READY`, sem trabalho; faltantes ⇒ 1 execução e estabiliza) |

## 6. Compatibilidade

Sem alterações de schema, `settingsSchemaVersion` inalterado (1). `data.json` existente é lido como antes; a chave legada é preservada. A API pública nova é aditiva (`endpointLocality`, `isProviderEndpointLocal`, `resolveEndpointProviderCapability`, `EmbeddingWorkSummary.targetEndpointIsExternal`, `EMBEDDING_GENERATION_INCREMENTAL`).

## 7. Dívida técnica restante (encaminhada)

| ID | Tema | Nota |
|---|---|---|
| CR-03 | Defaults/valores efetivos divergentes entre UI e runtime (`nomic-embed-text` vs `nomic-embed-text-v2-moe`; `gemma4:12b` vs `gemma4:e2b`; campos globais legados persistidos para todos) | **Decisão do responsável necessária:** corrigir altera o modelo efetivo/identidade publicada de utilizadores existentes. Opções: (A) runtime segue a UI/defaults do provider (pode gerar `INCOMPATIBLE` explícito em dispositivos que nunca escolheram modelo); (B) UI mostra o valor efetivo atual e só instalações novas recebem o default documentado. Requer fase própria com plano de compatibilidade |
| CR-05 | Resíduos da LINA-15D: `768`/`"nomic-embed-text"` em controller, `deviceRuntimeState`, `semanticCapability`, `sidebarStatusViewModel`, `vectorContract`, `main.ts` | Limpeza de defaults fabricados |
| CR-06 | Provider ausente/desconhecido ⇒ `ollama` silencioso | Com CR-03 |
| CR-07 | `aiProfiles` / `LinaAiProfile.isLocal` sem consumidor; `aiBaseUrl` como fallback do endpoint de embeddings | Remoção em fase própria com migração |
| CR-09 | Duas tabelas de capacidades de provider (F-22) | Unificação |
| — | `generateEmbeddingsOnStartup` inerte (sem UI) | Manter; sem ação |

## 8. Critérios de conclusão (prompt §18)

| # | Pergunta | Resposta |
|---|---|---|
| 1 | Provider local/remoto classificado corretamente? | **Sim** — capability ∧ endpoint em loopback |
| 2 | Ollama remoto pode ser tratado como local por engano? | **Não** (testado) |
| 3 | `automatic-local-only` respeita o endpoint efetivo? | **Sim**, com localidade viva |
| 4 | `generateOnlyMissingEmbeddings` tem semântica determinística? | **Sim** — ignorada; sempre incremental |
| 5 | Existe ciclo de regeneração automática? | **Não** (teste de estabilização) |
| 6 | Settings e runtime usam os mesmos valores efetivos? | **Parcial** — endpoint/locality e incremental alinhados; defaults de modelo divergem (CR-03, encaminhado) |
| 7 | Profiles e configuração global têm precedência inequívoca? | Profiles não são consumidos (CR-07); precedência runtime: device-local → global legado → default |
| 8 | Defaults reais ou fabricados? | Resíduos fabricados persistem (CR-05, encaminhado); esta fase não introduziu novos |
| 9 | Settings antigas migradas corretamente? | **Sim** (v0→v1 inalterado) |
| 10 | Settings sem UI que constituam dívida? | **Sim**, documentadas (auditoria §9) |
| 11 | A configuração altera indevidamente o Lifecycle? | **Não** — a flag deixou de alterar a avaliação; o endpoint só decide `cost` |
| 12 | Scheduler/Manager/Worker protegidos? | **Sim** — lógica inalterada; gate partilhado testado |
| 13 | Companion e Standby isolados? | **Sim** (testado nos dois endpoints) |
| 14 | Ownership/Fencing 15A intacto? | **Sim** — nenhum ficheiro de ownership alterado |
| 15 | Algo a encaminhar? | **Sim**: CR-03 (decisão do responsável), CR-05, CR-06, CR-07, CR-09 |

## 9. Validação

Ver relatório final desta fase para os resultados dos gates (`npm test`, `npm run typecheck`, `npm run lint:obsidian:strict`, `npm run build`, `npm run release-check`, `git diff --check`).

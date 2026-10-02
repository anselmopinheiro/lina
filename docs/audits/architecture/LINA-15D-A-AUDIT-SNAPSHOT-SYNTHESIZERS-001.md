# LINA-15D-A — AUDITORIA DOS SINTETIZADORES PARALELOS DE SNAPSHOT

> **Fase:** LINA-15D-A (apenas auditoria; sem alteração de produção)
> **Data:** 2026-10-02
> **Código auditado:** `master` @ `726d681` (após LINA-15A–15G), árvore limpa no início
> **Natureza:** reverificação factual do estado **atual**. Existe uma auditoria/implementação anterior (`LINA-15D-AUDIT-…-001.md`, `LINA-15D-IMPLEMENT-…-001.md`); nenhuma das suas conclusões foi assumida.
> **Evidência:** leitura de código, `grep` global (`src/`, `main.ts`, `tests/`), análise de alcançabilidade por *metafile* do esbuild e três *probes* executáveis (código de produção real, compilado em scratchpad fora do repositório). Probes marcadas **[probe]**; leitura de código **[código]**.

---

## 0. Autoridade e registo

| # | Item | Estado |
|---|---|---|
| A1 | `PROMPT-MESTRA-LINA-004` **não existe no repositório**; só existe cópia externa em `D:\anselmo\downloads`. | Registado. Não recriada nem assumida como vigente; `AGENTS.md` prevalece. |
| A2 | Branch oficial: `master` (`AGENTS.md`, `docs/INDEX.md`). A prompt-mestra externa indica `main`. | `master`. Sem branches. |
| A3 | Esta fase não altera código, testes, schemas, `data.json`, nem gera embeddings/chamadas a providers. | Cumprido (ver §17). |

---

## 1. Resumo executivo

1. **Os "seis sintetizadores" já não são os mesmos.** A LINA-15D removeu os valores mais vistosos (`default-producer`, `mismatch-*`, `contractId:"default"`, `1024`) mas **a documentação da 15D sobre-afirma**: o `docs/audits/architecture/LINA-15D-IMPLEMENT-…` declara eliminados os `768`/`"nomic-embed-text"`/`"local-device"` no controller e `"default"` no resto, e o código atual ainda os contém (§4). O baseline `AGENTS.md` ("fallbacks cegos … removidos") deve ser lido com esta ressalva.
2. **Inventário atual:** 9 pontos de construção de snapshot/identidade fora do núcleo canónico + 3 resíduos de valores fabricados sem construção de snapshot. Destes, **4 estão ativos em produção** (S1 adapter, S2 controller, S3 `resolveDeviceRuntimeState`, S8 `getDeviceDiagnostics`), **1 é latente em produção** (S9 ramo sem resumo do controller, executado no arranque antes do primeiro refresh) e **4 não são executados em produção** (S4 `deviceDiagnostics`, S5 sidebar, S6 `semanticCapability`, S7 `embeddingStatusViewModel`) mas continuam a ser **a única coisa que muitos testes exercitam**.
3. **O risco material não é a identidade fabricada em si** (a maioria é tautológica: publicada = alvo, por construção, logo nunca produz `INCOMPATIBLE`); é a **conversão de ausência/desconhecimento em valores aparentemente válidos**, que atravessa as barreiras:
   - **[probe]** Sem resumo do controller (estado de trabalho desconhecido) e com provider **externo**, `getEmbeddingLifecycleSnapshot()` devolve `INDEX_ONLY`, `cost:"none"`, `requiresConfirmation:false` e o gate de início **`automatic` permite** (`autoGate: allowed`). A ausência de avaliação de trabalho vira "sem trabalho/sem custo" (`no-work-assessed`).
   - `defaultProducerRuntime` (Active Producer, `canPublish:true`, `semanticAvailable:true`) é injetado quando falta o runtime — *fail-open* de autoridade (não atingido hoje porque `main.ts` passa sempre `runtime`).
   - **[probe]** Alvo de dimensões desconhecido vira `768` e aparece em `read.compatibility.device.dimensions` (`INDEX_ONLY`), valor que o runtime não possui.
4. **`upstreamTextIndex: "ready"` continua fixo** em `buildEmbeddingWorkLifecycleSnapshot` (`embeddingWorkStatusController.ts:244`): `NO_TEXT_INDEX` continua inalcançável no snapshot vivo (finding F-07 da auditoria global pós-LINA-14, ainda aberto).
5. **Existe fonte factual melhor, não usada:** `EmbeddingIndexStatus.publishedIdentity` (identidade publicada real: provider, model, dimensions, **inputVersion**, prefixMode) já viaja no objeto do resumo do controller (por *spread*) mas o tipo `EmbeddingWorkSummary` não a declara, por isso o controller **reconstrói** a identidade e **fixa `inputVersion: 1`**.
6. **Nada nesta fase exige nova fonte de verdade.** Todas as correções propostas usam fontes factuais existentes (§7). O plano 15D-B é pequeno, sequencial, com testes de caracterização primeiro (§14–15).

---

## 2. Arquitetura esperada

```text
Estado factual real (manifesto, plano, config efetiva, ownership, operação)
        ↓  transformação fiel, determinística, verificável
EmbeddingLifecycleSnapshot
        ↓
deriveEmbeddingWritePathDecision()
        ↓
Consumidores (Sidebar, Diagnóstico, Policy, Scheduler, Manager, Worker, Search)
```

Critério (da prompt): não eliminar objetos chamados `snapshot`; eliminar **representações paralelas** que possam divergir da realidade ou **fabricar identidade/estado** que o runtime não possui.

---

## 3. Inventário completo

### 3.1 Produtores de `EmbeddingLifecycleSnapshot` (produção)

| ID | Local | Função | Produção? | Chamador | Consumidor |
|---|---|---|---|---|---|
| **N0** | `src/index/embeddingLifecycleModel.ts` | `resolveEmbeddingLifecycle` | sim | adapter | todos |
| **S1** | `src/index/embeddingLifecycleAdapter.ts:82-216` | `adaptCurrentStateToLifecycleSnapshot` | **sim** | S2, S3(fallback), S8, S9, S4–S7 | todos |
| **S2** | `src/index/embeddingWorkStatusController.ts:158-258` | `buildEmbeddingWorkLifecycleSnapshot` | **sim** | controller (cache), `main.getEmbeddingLifecycleSnapshot`, `confirmAndRequestEmbeddingGeneration`, `hasAutomaticEmbeddingWork` | Worker, Manager, Scheduler, Policy, Sidebar |
| **S3** | `src/device/deviceRuntimeState.ts:235-260` | ramo `input.lifecycleSnapshot ?? adapt…` em `resolveDeviceRuntimeState` | **sim** (`main.ts:1073,1139` e `deviceDiagnostics.ts:221` chamam sem snapshot) | `getDeviceRuntimeState`, `refreshDeviceRuntimeState`, `buildDeviceDiagnostics` | `DeviceRuntimeState.embeddings` → `getLiveAuthorityRuntimeState`, sidebar, diagnóstico |
| **S8** | `main.ts:1050-1057` | `getDeviceDiagnostics` | **sim** (comando e Sidebar) | `DeviceDiagnosticsModal` | apresentação (modo, badges, razão) |
| **S9** | `main.ts:903-920` | ramo "sem resumo/indeterminado" de `getEmbeddingLifecycleSnapshot` | latente (corre quando o controller ainda não tem resumo) | Worker e Manager (`getLifecycleSnapshot`) | **gate de início de operações** |
| **S4a** | `src/device/deviceDiagnostics.ts:378-398` | fallback em `buildDeviceDiagnostics` | **não** (`lifecycleSnapshot` é obrigatório no tipo, `:201`) | testes | — |
| **S4b** | `src/device/deviceDiagnostics.ts:530-545` | fallback em `readDeviceDiagnostics` | latente (chamado sem opções em `deviceDiagnosticsModal.ts:608`, só quando falta `onRefreshRequested`, que ambos os chamadores de produção fornecem) | modal | apresentação |
| **S5** | `src/search/sidebarStatusViewModel.ts:268-332` | fallback `input.lifecycleSnapshot ?? adapt…` | **não** (`linaSearchView.ts:2704-2725` passa o snapshot vivo) | 5 ficheiros de teste sem `lifecycleSnapshot` | — |
| **S6** | `src/search/semanticCapability.ts:179-203` | fallback em `evaluateSemanticCapability` | **não** (os dois chamadores passam `lifecycleSnapshot`) | 2 ficheiros de teste | — |
| **S7** | `src/search/embeddingStatusViewModel.ts:191-220` | fallback em `buildEmbeddingStatusViewModel` | **não — módulo inalcançável** (metafile; sem importadores em `src/`) | 4 ficheiros de teste | — |

### 3.2 Resíduos de valores fabricados sem construção de snapshot

| ID | Local | Valor | Estado |
|---|---|---|---|
| **R1** | `src/index/vectorContract.ts:360-361` (`resolveEffectiveEmbeddingRuntimeConfig`) | `"ollama"`, `"nomic-embed-text"` | **função sem chamadores** (morta) |
| **R2** | `src/search/semanticSearchModal.ts:161,164` | `"ollama"`, `"nomic-embed-text"` | modal legado de pesquisa; só usado se `config` vazio |
| **R3** | `src/ai/types.ts:20` | `embeddingModel: "nomic-embed-text"` | ficheiro inalcançável |

Fora do âmbito (legítimos): `embeddingGenerator.ts:163` (`NOMIC_PREFIX_MODELS` — tabela de modelos com prefixo, categoria A), `settings.ts:793` (`LEGACY_COMPATIBILITY_DEFAULTS`, LINA-15G, categoria C), `providerDefaults.ts` (fonte de defaults documentada).

### 3.3 Número de sintetizadores vs. "seis"

A auditoria global pós-LINA-14 listava **seis**: adapter, controller, `deviceRuntimeState`, `semanticCapability`, `sidebarStatusViewModel`, `deviceDiagnostics`. Hoje: os seis continuam a existir como código, mas (i) `semanticCapability`, `sidebarStatusViewModel` e `deviceDiagnostics:378` **deixaram de ser executados em produção**; (ii) **apareceram** dois pontos não listados que **são** executados em produção — **S8** (`main.getDeviceDiagnostics`, snapshot montado a partir de booleanos derivados) e **S9** (ramo sem resumo) — e um módulo morto com um valor novo (`1536`, S7). Total relevante: **9 pontos + 3 resíduos**.

---

## 4. Ficha por sintetizador (modelo da prompt §7)

### S1 — `adaptCurrentStateToLifecycleSnapshot`
```text
ID: S1
Ficheiro/linha: src/index/embeddingLifecycleAdapter.ts:82-216
Produção ou teste: produção (e 13 ficheiros de teste)
Chamador: S2, S3, S8, S9 (+ fallbacks S4–S7)
Consumidor: todo o runtime via snapshot
Dados utilizados: runtime do dispositivo, plano, identidades, contrato, operação, companion
Dados inventados:
  - deviceRole ?? "producer"; isActiveProducer ?? true; embeddingsEnabled ?? true   (L89-92)  [fail-open de autoridade]
  - activeSource ?? "jsonl"                                                         (L123)    [fonte de leitura inventada]
  - validForSearchCount ?? (canonicalExists ? 1 : 0)                                 (L120-122)[contagem sintética]
  - deviceIdentity ← targetIdentity ?? vectorContract ?? publishedIdentity           (L96-98)  [tautologia: compat. sempre "compatible"]
  - publishedIdentity ← targetIdentity quando plano "incremental" e publicada ausente(L128-131,L152-156) [derivação do plano; ver nota]
Fonte factual correta: o chamador deve fornecer papel/autoridade/enabled/contagem/fonte; o adapter só converte.
Porque existe: ponto único de conversão heterogénea → canónico (LINA-14B).
Risco: defaults permitem snapshot "válido" a partir de entradas vazias. [probe] adapter({}) → NO_TEXT_INDEX, applicable:true; adapter({canonicalExists}) → INCOMPATIBLE (identidade ausente ⇒ incompleta — fail-closed aceitável).
Classificação: B (adaptador legítimo) com resíduos G (defaults fail-open) e F-leve (tautologia deviceIdentity←published).
Correção proposta: tornar obrigatórios (ou explicitamente `unknown`) papel/autoridade/enabled; remover `?? "jsonl"` e a contagem sintética (propagar `undefined` ⇒ `semanticAvailable:false`/estado explícito); remover a tautologia `deviceIdentity ← published` quando não há alvo.
Dependências: S2/S3/S8/S9 e os testes do adapter.
Testes necessários: caracterização do comportamento atual por combinação de entradas; depois "ausência ⇒ estado explícito".
```
*Nota sobre `publishedIdentity ← target` (plano `incremental`):* é derivação fiel (um plano `incremental` só existe se a identidade publicada for completa **e** compatível com o alvo, `embeddingUpdatePlan.ts:247-283`), portanto categoria **B**, mas implícita; deve ser documentada ou substituída pela identidade publicada real (ver S2).

### S2 — `buildEmbeddingWorkLifecycleSnapshot`
```text
ID: S2
Ficheiro/linha: src/index/embeddingWorkStatusController.ts:158-258
Produção: sim (controller cache + snapshot vivo + confirmação + scheduler)
Chamador: deriveEmbeddingWorkDecisionAndAvailability; main.ts:898, :1777, :2711
Consumidor: Worker/Manager (gate de início), Scheduler, Policy, confirmação manual, Sidebar
Dados utilizados: EmbeddingWorkSummary (provider, model, dimensions, updatePlan, exists, canonicalReadability, manifestPrefixMode…), DeviceRuntimeState
Dados inventados:
  - dimensions: targetDimensions ?? 768                         (L171)  alvo de dimensões desconhecido vira 768
  - dimensions: summary.dimensions ?? plan.target.dimensions ?? 768 (L179) [0 não é nullish: dims 0 sentinela passa]
  - inputVersion: 1 (publicada)                                  (L180)  hard-coded; o real existe em summary.publishedIdentity.inputVersion
  - prefixMode ?? "none"                                          (L172,L181)
  - defaultProducerRuntime: deviceId "local-device", Active Producer, canPublish:true, semanticAvailable:true (L186-212) [fail-open]
  - upstreamTextIndex: "ready"                                   (L244)  fixo ⇒ NO_TEXT_INDEX inalcançável
Fonte factual correta: summary.publishedIdentity (real); updatePlan.targetIdentity; DeviceRuntimeState real (obrigatório); estado real do índice textual (`readTextIndexStatus()` / `textIndexLoaded`).
Porque existe: montar o snapshot a partir do resumo do controller (LINA-14D/F).
Risco: ALTO-MÉDIO. [probe] caso C (initial-build, alvo sem dimensões): compat.device.dimensions = 768 (fabricado), INDEX_ONLY/generate. Caso D (sem provider/model): INDEX_ONLY/generate, canExecute:true (identidade ausente não bloqueia). Caso B: dimensions=0 ⇒ identity incompleta ⇒ INCOMPATIBLE/rebuild (correto por acidente — plano diz full-rebuild). upstream "ready" esconde índice textual ausente (F-07).
Classificação: B (adaptador) + F (identidade fabricada: 768, inputVersion:1) + G (defaultProducerRuntime fail-open; upstream fixo).
Correção proposta: (1) usar summary.publishedIdentity; (2) dimensions/inputVersion/prefixMode do alvo só do plano — sem plano/identidade ⇒ identidade `undefined` (estado explícito); (3) runtime obrigatório (remover defaultProducerRuntime) ou snapshot `INDETERMINATE`; (4) receber o estado real do índice textual.
Dependências: S1; tipo EmbeddingWorkSummary (declarar publishedIdentity); main.ts (3 chamadas); controller tests.
Testes necessários: caracterização dos casos A–D; integração controller→snapshot com manifesto real; NO_TEXT_INDEX alcançável.
```

### S3 — `resolveDeviceRuntimeState` (fallback de snapshot)
```text
ID: S3
Ficheiro/linha: src/device/deviceRuntimeState.ts:235-260
Produção: sim — main.ts:1073 e :1139 e deviceDiagnostics.ts:221 chamam sem lifecycleSnapshot
Chamador: getDeviceRuntimeState(), refreshDeviceRuntimeState() (arranque e settings), buildDeviceDiagnostics
Consumidor: DeviceRuntimeState.embeddings.{exists, semanticAvailable, effectiveMode, contractState, vectorFileState, compatibility, readiness} → getLiveAuthorityRuntimeState (configured/exists/textIndexAvailable), sidebar (runtimeEmbeddings), diagnóstico, getDeviceDiagnostics (validForSearchCount)
Dados utilizados: manifesto de texto cru, companionState, semanticAvailability (hybridSearch)
Dados inventados:
  - dimensions ?? 768 (L244, L256)
  - inputVersion: 1 e prefixMode: "none" fixos (L245-246, L257-258)  — o manifesto real tem embeddingInput.{version,prefixMode}
  - validForSearchCount ∈ {0,1} derivado de booleanos (L228-229)
Fonte factual correta: extractVectorContract(manifest) / parse de manifest.embeddings + embeddingInput (parsePublishedEmbeddingIdentity); contagem real de validForSearch quando disponível, senão `unknown`.
Porque existe: DeviceRuntimeState é "estado derivado" calculado sem I/O pesado.
Risco: MÉDIO. [probe] snapshot interno é tautológico (publicada = alvo) ⇒ não produz INCOMPATIBLE por si; o resultado correto vem dos overrides (`vectorContractState`, `semanticAvailability`). Mas o snapshot interno mostra `compatibility` incoerente com o `contractState` e propaga `exists`/`effectiveMode` calculados a partir de contagem sintética.
Classificação: E (sintetizador paralelo: reconstrói snapshot com informação parcial enquanto o resumo/plano reais existem noutro sítio) + F (768, inputVersion:1, prefix "none").
Correção proposta: DeviceRuntimeState não deve fabricar snapshot; deve (a) ler identidade real do manifesto e (b) receber/derivar disponibilidade semântica de forma explícita (`semanticAvailability`), sem snapshot sintético; ou receber o snapshot canónico por injeção (já suportado por `input.lifecycleSnapshot`).
Dependências: S6 (semanticCapability), S8, getLiveAuthorityRuntimeState, sidebar/diagnóstico.
Testes necessários: caracterização de resolveDeviceRuntimeState (1 ficheiro hoje) com manifestos reais (completo/legado/sem dims); equivalência antes/depois dos campos embeddings.*.
```
`DeviceRuntimeState` **não deve** tornar-se fonte de verdade para a identidade: é derivado. A identidade real está no manifesto/contrato.

### S8 — `main.getDeviceDiagnostics`
```text
ID: S8
Ficheiro/linha: main.ts:1050-1057
Produção: sim (comando "mostrar-diagnostico-dispositivo" e botão da Sidebar)
Consumidor: DeviceDiagnosticsModal (modo, badges, razão, artefactos) — apresentação
Dados utilizados: DeviceRuntimeState (derivado), companionState, vectorContract canónico, operationState
Dados inventados:
  - canonicalExists: runtimeState.embeddings.exists          (derivado de S3)
  - validForSearchCount: runtimeState.embeddings.semanticAvailable ? 1 : 0   (booleano ⇒ contagem 0/1)
  - publishedIdentity = vectorContract; deviceIdentity = targetIdentity ?? vectorContract (adapter L96) ⇒ AMBAS são o contrato publicado
Fonte factual correta: o snapshot vivo (`getEmbeddingLifecycleSnapshot()`), que já compõe plano, operação e autoridade; ou, para diagnóstico read-only, a mesma composição.
Porque existe: diagnóstico montado antes de existir o snapshot vivo (LINA-14C.3).
Risco: MÉDIO. A modal apresenta `snapshot.read.effectiveMode`/`semanticAvailable`/`upstream`/`reasons` como verdade; compatibilidade é tautológica (contrato vs si próprio) — a incompatibilidade só aparece se o override `semanticAvailability` for aplicado noutro ramo; `primary`/`reasons` do snapshot podem contradizer o modo mostrado.
Classificação: E (sintetizador paralelo; existe fonte canónica — `getEmbeddingLifecycleSnapshot`).
Correção proposta: usar `this.getEmbeddingLifecycleSnapshot()` (live) em `getDeviceDiagnostics`; não duplicar composição.
Dependências: S1, S2, S3; DeviceDiagnosticsModal; testes de diagnóstico.
Testes necessários: modal com snapshot vivo em cenários A (compatível), mismatch, Companion, índice ausente.
```

### S9 — ramo "sem resumo" de `getEmbeddingLifecycleSnapshot`
```text
ID: S9
Ficheiro/linha: main.ts:903-920
Produção: latente — corre sempre que o controller ainda não tem resumo (arranque, antes do 1.º refresh) ou o resumo é indeterminado
Chamador: Worker/Manager (porta getLifecycleSnapshot) → evaluateOperationStartGate
Consumidor: GATE DE INÍCIO de geração
Dados utilizados: runtime vivo, operationState, isExternalProvider (15F)
Dados inventados: ausência de resumo ⇒ SEM workAssessment ⇒ defaultWork {kind:"none", cost:"none", reasons:["no-work-assessed"]} (embeddingLifecycleModel.ts:~559); upstream undefined ⇒ do runtime derivado
[probe] runtime.exists=false, provider EXTERNO: primary INDEX_ONLY, work none, cost "none", requiresConfirmation false, canExecute true, autoGate {allowed:true}
[probe] runtime.exists=true: INCOMPATIBLE/rebuild (identidades ausentes) — fail-closed por acaso
Fonte factual correta: sem resumo, o estado é DESCONHECIDO ⇒ `workAssessment: indeterminate` (como já é feito quando o resumo existe mas é ilegível) ou aguardar/forçar o primeiro refresh antes de autorizar.
Porque existe: ramo de fallback para quando o controller não calculou.
Risco: ALTO (segurança operacional): desconhecimento ⇒ "sem trabalho/sem custo" ⇒ gate permite `automatic`. Hoje mitigado a montante (scheduler só despacha local; manual passa pela confirmação), mas o gate — a última barreira — não deveria depender disso.
Classificação: G (fallback perigoso).
Correção proposta: ausência de resumo ⇒ `kind:"indeterminate"` (fail-closed), igual ao caso "resumo ilegível".
Dependências: S1/S2; Worker/Manager tests (`embeddingWorkerSnapshotInjection`, `embeddingOperationManagerSnapshot`, `embeddingLiveLifecycleSnapshotProvider`).
Testes necessários: gate com controller sem resumo (local/externo; manual/automatic); arranque.
```

### S4 — `deviceDiagnostics` (fallbacks)
S4a (`:378-398`): inputVersion `1`/`prefixMode:"none"`, `publishedIdentity == targetIdentity` (tautologia) — **não executado** (campo obrigatório no tipo). S4b (`:530-545`): fallback com `validForSearchCount: available?1:0` — **latente**. Classificação: **E**, não ativo. Ação: tornar `lifecycleSnapshot` obrigatório também em `readDeviceDiagnostics` e remover os dois fallbacks; ajustar 7+3 ficheiros de teste.

### S5 — `sidebarStatusViewModel` (fallback)
Fabrica **runtime inteiro** (`deviceId:"device-1"`, `deviceName:"Device"`, `assignmentState:"assigned"`, `ownershipExists:true`), `provider/model:"default"`, `dimensions:768`, `inputVersion:1`, e `workAssessment` com `cost:"local"`/`mode:"incremental"` a partir de um booleano. **Não executado** em produção (Sidebar passa o snapshot). **5 ficheiros de teste** não passam `lifecycleSnapshot` e por isso **validam este caminho artificial**. Classificação: **E+F** (dead-in-prod); testes **D** com falso-positivo potencial. Ação: tornar `lifecycleSnapshot` obrigatório; converter os 5 testes para snapshots reais.

### S6 — `semanticCapability.evaluateSemanticCapability` (fallback)
`provider/model:"default"`, `dimensions:768`, `inputVersion:1`, `prefix:"none"`; identidade publicada == alvo (tautologia). Não executado (chamadores passam snapshot). 2 ficheiros de teste. Classificação **E+F** (dead-in-prod). Ação: tornar `lifecycleSnapshot` obrigatório.

### S7 — `embeddingStatusViewModel` (fallback + módulo)
`dimensions:1536` (valor novo, nunca existiu na lista anterior), `inputVersion:1`, `prefix:"none"`. **O módulo inteiro é inalcançável** a partir de `main.ts` (metafile) e sem importadores em `src/`; 4 ficheiros de teste (incl. `embeddingStatusActionDerivation`) validam código sem consumidor. Classificação **E+F** + código morto. Ação: remover módulo e testes, ou religar a um consumidor real (decisão separada; fora da 15D-B).

### R1–R3
R1 `resolveEffectiveEmbeddingRuntimeConfig` — função sem chamadores (**remover**). R2 `semanticSearchModal` — modal legado: `|| "ollama"`/`|| "nomic-embed-text"` (**substituir por estado explícito ou remover o modal se obsoleto**). R3 `ai/types.ts` — ficheiro inalcançável (**remover**).

---

## 5. Classificação A–G

| Ponto | Classe | Ativo em produção | Ação |
|---|---|---|---|
| N0 `resolveEmbeddingLifecycle` | **A** | sim | MANTER |
| S1 adapter | **B** (+G nos defaults) | sim | MANTER; REMOVER defaults fail-open |
| S2 controller builder | **B + F + G** | sim | SUBSTITUIR identidade/runtime/upstream |
| S3 `resolveDeviceRuntimeState` | **E + F** | sim | SUBSTITUIR (sem snapshot sintético; identidade do manifesto) |
| S8 `getDeviceDiagnostics` | **E** | sim | SUBSTITUIR pelo snapshot vivo |
| S9 ramo sem resumo | **G** | latente (gate) | BLOQUEAR (indeterminate) |
| S4a / S4b | **E** | não / latente | REMOVER fallbacks |
| S5 sidebar fallback | **E + F** | não | REMOVER; testes → **D** reais |
| S6 semanticCapability fallback | **E + F** | não | REMOVER |
| S7 embeddingStatusViewModel | **E + F** + morto | não | REMOVER módulo (decisão) |
| R1 | morto | não | REMOVER |
| R2 | **F** (legado) | marginal | SUBSTITUIR/REMOVER |
| R3 | morto | não | REMOVER |
| `LEGACY_COMPATIBILITY_DEFAULTS` (15G) | **C** | sim | MANTER (documentado) |
| `NOMIC_PREFIX_MODELS` | **A** | sim | MANTER |
| `selectEmbeddingValidationCandidates`, etc. | n/a | — | fora de âmbito |

Nenhuma ocorrência foi classificada como dívida só por existir um objeto `EmbeddingLifecycleSnapshot` local.

---

## 6. Identidade dos embeddings (campos reais)

Definida por (código): `PublishedEmbeddingIdentity` {provider, model, dimensions, inputVersion, prefixMode} (`embeddingState.ts:19-25`, parse em `embeddingGenerator.ts:1622-1643` a partir de `manifest.embeddings.*` e `manifest.embeddingInput.{version,prefixMode}`); `VectorContractV1` {schemaVersion, provider, model, dimensions, metric, prefixMode, inputVersion, contractId} (`vectorContract.ts`); `contractId` = hash de {provider, model, dimensions, metric, prefixMode, inputVersion}. **Proveniência (producerDeviceId, epoch)** é metadado de artefacto, **não** parte da identidade vetorial; `endpoint`, timestamps e credenciais excluídos.

| Ponto | provider/model | dimensions | inputVersion | prefixMode | contractId | Fabricados |
|---|---|---|---|---|---|---|
| S1 | reais (entrada) | real | real | real | real | `activeSource`, contagem, tautologia device←published |
| S2 | reais (summary/plan) | **768** se desconhecido; 0-sentinela | **1 fixo** (publicada) | `"none"` por defeito | — | 768, inputVersion:1 |
| S3 | reais (manifesto) | **768** | **1 fixo** | **"none" fixo** | — | 768, 1, "none" |
| S8 | reais (contrato) | reais | reais | reais | real | tautologia; contagem 0/1 |
| S5/S6 | **"default"** | **768** | 1 | "none" | — | todos (dead-in-prod) |
| S7 | reais (config) | **1536** | 1 | "none" | — | 1536, 1, "none" |
| S4 | reais (manifesto) | reais | **1 fixo** | **"none" fixo** | — | 1, "none" |

Papéis semânticos: `768` nunca representa um facto (dimensões do modelo vêm do provider/manifesto); `"nomic-embed-text"` residual é só default legado (R1–R3); `"default"` é placeholder puro; `inputVersion:1` é o valor **atual** de `EMBEDDING_INPUT_VERSION` mas, hardcoded no lado "publicado", impede detetar um manifesto com versão ≠ 1 (a comparação publicada↔alvo fica trivialmente igual); `mismatch-*` e `contractId:"default"` **já foram removidos** (confirmado por `grep`).

---

## 7. Fonte factual correta (apenas fontes existentes)

| Necessidade | Fonte factual existente | Usado hoje? |
|---|---|---|
| Identidade publicada (completa) | `EmbeddingIndexStatus.publishedIdentity` (via `readEmbeddingStatus`) | **Não** (controller reconstrói) |
| Identidade alvo | `EmbeddingUpdatePlan(Preview).targetIdentity` | sim |
| Contrato publicado | `extractVectorContract(manifest)` / `loadCanonicalVectorContract()` | parcial (S8) |
| Runtime/autoridade | `DeviceRuntimeState` + `OwnershipGate.isAuthorizedSync()` (live) | sim (mas com fallback fail-open) |
| Estado do índice textual | `readTextIndexStatus()` | **não** no snapshot (`"ready"` fixo) |
| Disponibilidade semântica real | `getSemanticSearchAvailability` / runtime index | sim (como override) |
| Snapshot canónico para UI/diagnóstico | `LinaPlugin.getEmbeddingLifecycleSnapshot()` | Sidebar sim; Diagnóstico **não** |

`DeviceRuntimeState` é **derivado** (calculado a partir de manifestos/ownership/capabilities); contém campos factuais (`configured`, `textIndexAvailable`, papel, ownership) e campos **derivados de snapshot sintético** (`semanticAvailable`, `effectiveMode`, `contractState`, `exists`). Os factuais são fonte legítima; os derivados **não** devem alimentar um novo snapshot (circularidade, S8).

---

## 8. Impacto nos consumidores

| Mudança futura | Consumidores | Campos que podem mudar |
|---|---|---|
| S9 ⇒ `indeterminate` sem resumo | Worker/Manager no arranque | `primary` (INDEX_ONLY/INCOMPATIBLE → INDETERMINATE), `action`, `canExecute`, `blockedReason`; gate passa a recusar até ao 1.º refresh |
| S2 identidade real/sem 768 | Scheduler, Policy, Sidebar, confirmação | `read.compatibility.*`, `primary` em casos com dims/inputVersion divergentes (passam a ser detetados), `action` |
| S2 `upstream` real | Sidebar, Worker | `primary` ⇒ `NO_TEXT_INDEX`, `effectiveMode` ⇒ `unavailable`, `capability.blockedReason` ⇒ `text-index-not-ready` |
| S2 sem `defaultProducerRuntime` | controller cache, snapshot vivo | `write.applicable`, `capability` (nunca mais "Active Producer" implícito) |
| S3 sem snapshot sintético | Sidebar (runtimeEmbeddings), `getLiveAuthorityRuntimeState`, diagnóstico | `embeddings.exists/semanticAvailable/effectiveMode/contractState` |
| S8 ⇒ snapshot vivo | `DeviceDiagnosticsModal` | modo, badges, razão, status |
| Remover S4–S7 | só testes | nenhum em produção |
| `cost`/`requiresConfirmation` | confirmação, Scheduler | podem passar de `none`→`external` quando a localidade é conhecida (S9) |

**`semanticAvailable`, `write.applicable`, identidade publicada** não devem mudar em instalações saudáveis (o caminho vivo normal já usa dados reais); mudam apenas nos casos de ausência de dados.

---

## 9. Segurança (incerteza ⇒ estado explícito)

| Entrada incerta | Hoje | Deve ser |
|---|---|---|
| Controller sem resumo (S9) | `INDEX_ONLY`/`cost:none`/`allowed` **(probe)** | `INDETERMINATE` (fail-closed) |
| Falta de runtime (S2) | Active Producer implícito | erro/`INDETERMINATE` |
| Dimensões desconhecidas (S2) | `768` | `undefined` + estado explícito |
| Índice textual ausente (S2) | `"ready"` | `NO_TEXT_INDEX` |
| Manifesto legado sem dims (S2, caso B) | `dims 0` ⇒ `incomplete-identity` ⇒ rebuild | manter (correto), sem sentinela 0 |
| Contagem válida desconhecida (S1/S3/S8) | `0/1` sintético | `unknown`/ausência explícita |

Nenhum caminho de produção atual autoriza uma operação **externa/destrutiva** a partir destes valores (o Scheduler restringe a local e as confirmações manuais mantêm-se), pelo que não há exploração demonstrada; há **barreira final dependente de montante** (S9), a corrigir.

---

## 10. Riscos

1. **Falso-positivo de testes:** 5+2+4+7 ficheiros exercitam fallbacks que a produção nunca executa; a suíte verde não prova o caminho vivo (ex.: `NO_TEXT_INDEX` inalcançável passou despercebido).
2. **Documentação sobre-afirmada:** `LINA-15D-IMPLEMENT-…` e a entrada de `AGENTS.md` da 15D descrevem remoções que o código não reflete (768/"nomic-embed-text"/"local-device"/"default"). Deve ser retificada na 15D-B.
3. **Gate dependente de montante (S9).**
4. **Acoplamento circular** DeviceRuntimeState ↔ snapshot (S3→S8).

---

## 11. Testes existentes

| Sintetizador | Ficheiros de teste | Avaliação |
|---|---|---|
| S1 adapter | 13 (`embeddingLifecycleAdapter`, shadow validation, …) | protegem conversão; fixtures com identidade explícita; **não** cobrem defaults fail-open |
| S2 controller | 4 (`embeddingPlanLifecycleReconciliation`, `mainRuntimeSnapshotConsolidation`, …) | cobrem planos; **não** cobrem `upstream`, `defaultProducerRuntime`, dims desconhecidas |
| S3 | 1 (`deviceRuntimeState.test`) | fraco |
| S5 | 8 (5 sem `lifecycleSnapshot`) | **falsos positivos** nos 5 |
| S6 | 2 | idem |
| S7 | 4 | testam código morto |
| S8 | `deviceDiagnostics*`, `semanticAvailabilityDiagnosticsAlignment` | passam snapshots montados à mão |
| S9 | `embeddingLiveLifecycleSnapshotProvider`, `embeddingWorkerSnapshotInjection` | fixtures de snapshot injetado; **não** testam o ramo real sem resumo |

Não foram alterados testes nesta fase.

---

## 12. Testes necessários para a 15D-B

1. **Caracterização S2** (A–D desta auditoria) e **S9** (controller sem resumo × local/externo × manual/automatic) — *antes* de qualquer alteração.
2. Integração `readEmbeddingStatus` → controller → snapshot com **manifesto real** (completo, legado sem dims, sem `embeddingInput`).
3. `NO_TEXT_INDEX` alcançável (índice textual ausente com canónico presente).
4. `resolveDeviceRuntimeState` com manifestos reais; equivalência dos campos `embeddings.*` antes/depois.
5. `getDeviceDiagnostics` com snapshot vivo; modal por cenário.
6. Conversão dos 5+2 testes de sidebar/semanticCapability para snapshots reais; remoção/religação dos testes de S7.
7. Guardas estáticas: sem `768`, `"default"` como provider/model, `"local-device"`, `1536` em `src/` (exceções documentadas).
8. Regressão 15A (fencing), 15B (`plan↔snapshot`), 15C (`resource-limit-exceeded` ≠ `unreadable`), 15F (localidade/incremental), 15G (config efetiva).

---

## 13. Dependências

```text
S9 (independente)  →  primeiro (fecha o gate)
S2 depende de: tipo EmbeddingWorkSummary.publishedIdentity; estado real do índice textual
S3 depende de: leitura de identidade real do manifesto (já existe parse)
S8 depende de: S2/S3 corrigidos (snapshot vivo estável)
S4–S7, R1–R3 dependem de: testes migrados para snapshots reais
S1 (defaults) depende de: S2, S3, S8, S9 já a fornecer dados explícitos
```

---

## 14. Proposta de implementação (15D-B)

Pequena e sequencial; **um sintetizador de cada vez**, cada passo: teste de caracterização → substituição → quality gates.

1. **S9** — sem resumo ⇒ `workAssessment: indeterminate` (reaproveita o ramo existente). Sem tocar em Scheduler/Manager/Worker.
2. **S2-a** — declarar `publishedIdentity` em `EmbeddingWorkSummary` e usá-la; remover `inputVersion:1` fixo.
3. **S2-b** — remover `?? 768` (identidade `undefined` quando dims desconhecidas); remover sentinela 0.
4. **S2-c** — runtime obrigatório (remover `defaultProducerRuntime`); falha ⇒ `INDETERMINATE`.
5. **S2-d** — `upstreamTextIndex` real (fornecido pelo chamador a partir de `readTextIndexStatus()`/`textIndexLoaded`).
6. **S3** — `resolveDeviceRuntimeState` sem snapshot sintético; identidade do manifesto (`extractVectorContract`/parse existente).
7. **S8** — `getDeviceDiagnostics` usa `getEmbeddingLifecycleSnapshot()`.
8. **S1** — remover defaults fail-open e contagem sintética (agora todos os chamadores fornecem dados).
9. **S4–S7, R1–R3** — tornar `lifecycleSnapshot` obrigatório, migrar testes, remover fallbacks e código morto.
10. **Documentação** — retificar `LINA-15D-IMPLEMENT-…`, `AGENTS.md`, `docs/INDEX.md`.

Fora de âmbito da 15D-B: ownership/fencing, Scheduler, Worker, Manager, schemas, `data.json`, formato dos embeddings, Vector Contract.

---

## 15. Ordem segura de remoção

`S9 → S2 (a,b,c,d) → S3 → S8 → S1 → S5/S6/S4 → S7/R1/R3 → R2`. Racional: primeiro fechar o gate (segurança), depois os produtores vivos (que fornecem dados explícitos), por fim o que só afeta testes e código morto. Nenhum passo remove código antes de existir o teste que prova equivalência no caminho vivo (prompt-mestra: shadow → comparação → cutover → remoção).

---

## 16. Riscos de regressão

| Risco | Mitigação |
|---|---|
| `INDETERMINATE` no arranque bloqueia geração até ao 1.º refresh | O refresh é disparado ao abrir a Sidebar/diagnóstico e por `markDirty`; confirmar no passo 1 que o fluxo manual (`confirmAndRequestEmbeddingGeneration`) constrói o seu próprio resumo (já o faz) |
| `NO_TEXT_INDEX` passa a aparecer onde antes havia `UPDATE_AVAILABLE` | Esperado e correto; atualizar expectativas da Sidebar |
| Remover tautologias revela `INCOMPATIBLE` real em diagnóstico | Esperado; documentar |
| Reintroduzir divergência `plan↔snapshot` (15B) | Teste de equivalência 15B mantido no gate |
| Reintroduzir `unreadable` por `resource-limit` (15C) | Teste 15C mantido |
| Alterar localidade/cost (15F) | Teste de localidade mantido; S9 deve receber `isExternalProvider` live |
| Alterar defaults/config efetiva (15G) | Nenhum acesso a `settings.ts`; testes 15G no gate |
| Falsos negativos nos 5+2 testes migrados | Migrar com snapshots reais por cenário, um ficheiro de cada vez |

---

## 17. Critérios de aceitação (15D-B)

1. `grep` em `src/`: sem `768`, sem provider/model `"default"`, sem `"local-device"`, sem `1536`, sem `inputVersion: 1` hard-coded no lado publicado (exceções documentadas: `EMBEDDING_INPUT_VERSION`, `NOMIC_PREFIX_MODELS`, `LEGACY_COMPATIBILITY_DEFAULTS`).
2. Probe S9: controller sem resumo ⇒ `INDETERMINATE`, gate `automatic` e `manual` recusados.
3. `NO_TEXT_INDEX` alcançável no snapshot vivo.
4. `getDeviceDiagnostics` e Sidebar derivam do mesmo snapshot vivo.
5. `lifecycleSnapshot` obrigatório em todos os consumidores; nenhum fallback sintético; testes de S5–S7 convertidos ou removidos.
6. Quality gates verdes; testes 15A/15B/15C/15F/15G intactos.
7. Documentação retificada (impl 15D, `AGENTS.md`, `INDEX.md`).

---

## 18. Critérios de conclusão da auditoria (respostas)

| # | Pergunta | Resposta |
|---|---|---|
| 1 | Quais são todos os sintetizadores? | §3: S1, S2, S3, S4a/b, S5, S6, S7, S8, S9 + R1–R3 |
| 2 | Quais estão ativos em produção? | S1, S2, S3, S8 ativos; S9 latente (gate); S4b latente; S4a, S5, S6, S7 não executados |
| 3 | Quais são legítimos? | N0 (A), S1 (B, com resíduos); `LEGACY_COMPATIBILITY_DEFAULTS` e `NOMIC_PREFIX_MODELS` (C/A) |
| 4 | Quais são dívida técnica? | S2, S3, S8, S9, S4–S7, R1–R3 |
| 5 | Que dados fabricam? | 768, 1536, `"default"`, `"local-device"`, inputVersion:1, prefix "none", `activeSource:"jsonl"`, contagem 0/1, Active Producer implícito, `upstream:"ready"`, `no-work-assessed` |
| 6 | Fonte factual correta de cada um? | §7 |
| 7 | Consumidores? | §3.1/§8 |
| 8 | O que pode mudar ao remover? | §8 |
| 9 | Testes de proteção? | §12 |
| 10 | Ordem segura? | §15 |

**Confirmação de âmbito:** nenhum ficheiro de produção, teste, schema ou `data.json` foi alterado; nenhum embedding foi gerado; nenhuma chamada externa; nenhum commit nem push. As *probes* foram compiladas e executadas a partir do scratchpad da sessão (fora do repositório).

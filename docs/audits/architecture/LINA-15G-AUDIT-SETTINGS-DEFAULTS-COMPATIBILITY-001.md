# LINA-15G — AUDITORIA DE DEFAULTS DE SETTINGS E COMPATIBILIDADE (OPÇÃO B)

> **Fase:** LINA-15G — Settings Defaults & Compatibility — Opção B
> **Data:** 2026-10-02
> **Código auditado:** `master` @ `d011caf` (após LINA-15F), árvore limpa
> **Finding de origem:** CR-03 da LINA-15F (`LINA-15F-AUDIT-CONFIG-RUNTIME-CONSISTENCY-001.md` §12)
> **Decisão (responsável):** instalações existentes **preservam** o comportamento efetivo; a UI mostra o valor **efetivamente usado**; instalações novas recebem o default documentado.

---

## 0. Autoridade e conflitos

| # | Item | Resolução |
|---|---|---|
| A1 | `PROMPT-MESTRA-LINA-004` **não está no repositório** (só em `D:\anselmo\downloads`); lida de lá. | Registado. Não é substituída por esta prompt. |
| A2 | A prompt-mestra indica o branch `main`; `AGENTS.md` define `master`. | Prevalece `AGENTS.md` (`master`). |
| A3 | Nenhum push (prompt-mestra e prompt 15G coincidem). | — |

---

## 1. Confirmação dos valores da LINA-15F (código atual)

| Domínio | UI mostra (instalação sem valor local) | Runtime usa | Origem do valor runtime |
|---|---|---|---|
| Embeddings (Ollama) — modelo | `nomic-embed-text-v2-moe` (`chooseProviderDefaultModel("", …)` → `EMBEDDING_MODEL_DEFAULTS`, `declarativeSettingRenderers.ts:538-545`) | **`nomic-embed-text`** | `getLocalEmbeddingsModel() \|\| settings.embeddingModel` (`main.ts`, `getEffectiveEmbeddingConfig`); `DEFAULT_SETTINGS.embeddingModel = "nomic-embed-text"` (`settings.ts:744`) |
| Análise (Ollama) — modelo | `gemma4:e2b` | **`gemma4:12b`** | `getLocalAnalysisModel() \|\| settings.aiAnalysisModel \|\| defaults.model` (`linaSearchView.ts:1753`); `DEFAULT_SETTINGS.aiAnalysisModel = "gemma4:12b"` (`settings.ts:712`) |

Confirmados, e **tratados separadamente** (embeddings: afeta a identidade publicada; análise: não).

Divergência da mesma classe em **provider** e **Base URL**: a UI lê só `deviceSettingsById[…]` (+ default do provider); o runtime cai para os campos globais legados (`embeddingProvider`, `embeddingBaseUrl`, `embeddingLocalBaseUrl`, `aiProvider`, `aiBaseUrl`). Com a LINA-15F isto passou a ter relevância de privacidade: um `embeddingBaseUrl` global remoto, sem valor local, seria usado pelo runtime e **escondido** pela UI.

---

## 2. Inventário (campo · default UI · default runtime · persistido · existente · nova)

Não preenchido por inferência: cada célula vem do código indicado.

| Campo | Default UI | Default runtime | Persistido? | Instalação existente | Instalação nova (hoje) |
|---|---|---|---|---|---|
| embedding provider | `ollama` (`detachedProviderValue`) | `normalizeSupportedProvider(local \|\| settings.embeddingProvider)`; `DEFAULT_SETTINGS.embeddingProvider = "ollama"` | global: **sim, sempre** (o objeto `settings` completo é gravado); device: só se escolhido na UI | valor global persistido prevalece sobre a UI | `ollama` |
| embedding model | `nomic-embed-text-v2-moe` | `local \|\| settings.embeddingModel \|\| settings.embeddingLocalModel \|\| defaults.model`, fallback literal `"nomic-embed-text"` | global: sim, sempre (`nomic-embed-text`) | `nomic-embed-text` (persistido) | `nomic-embed-text` (diverge da UI) |
| embedding base URL | default do provider | `local \|\| settings.embeddingBaseUrl \|\| settings.embeddingLocalBaseUrl \|\| (ollama ? settings.aiBaseUrl) \|\| defaults.baseUrl` | global: sim (`http://localhost:11434`) | persistido | localhost |
| embedding dimensions | — (sem controlo) | **não é setting**: derivada da resposta do provider/manifesto (`resolvePreValidationTargetIdentity`) | só no manifesto publicado | do manifesto | n/a |
| AI analysis provider | `ollama` | `normalizeSupportedProvider(local \|\| settings.aiProvider)`; default global `ollama` | global sim | persistido | `ollama` |
| AI analysis model | `gemma4:e2b` | `local \|\| settings.aiAnalysisModel \|\| defaults.model`; default global `gemma4:12b` | global sim | `gemma4:12b` (persistido) | `gemma4:12b` (diverge da UI) |
| AI analysis base URL | default do provider | `local \|\| settings.aiBaseUrl \|\| defaults.baseUrl` | global sim | persistido | localhost |
| `settingsSchemaVersion` | — | `1` (`CURRENT_SETTINGS_SCHEMA_VERSION`) | sim | `0` (ausente) → migra para `1`; ou `1` | `1` |
| `aiProfiles` / `isLocal` | não apresentados | **sem consumidor runtime** (15F §8) | sim | idem | idem |

Observação estrutural: **os campos globais são sempre persistidos** (cada `saveData` grava `this.settings` completo, que já incorporou `DEFAULT_SETTINGS`). Logo uma instalação que existe há pelo menos um save tem `embeddingModel: "nomic-embed-text"` e `aiAnalysisModel: "gemma4:12b"` **no `data.json`**, indistinguíveis de uma "escolha". Isto exclui qualquer heurística "campo vazio ⇒ default".

---

## 3. Instalação existente vs. nova — mecanismo factual

`loadDataFromDisk()` (`main.ts`):

```ts
const raw = await this.loadData();                       // null quando não existe data.json
const data = isLinaStoredData(raw) ? raw : null;
const rawSettings = data?.settings ? { ...data.settings } : undefined;
this.settings = Object.assign({}, DEFAULT_SETTINGS, rawSettings ?? {});
```

| Situação | `rawSettings` | Distinção |
|---|---|---|
| Instalação nova (sem `data.json`, ou sem objeto `settings`) | `undefined` | **nova** |
| Instalação existente (qualquer versão do plugin que já gravou settings) | objeto | **existente** |
| Dispositivo novo sobre `data.json` sincronizado | objeto | existente (correto: herda a configuração) |
| Versão futura (`settingsSchemaVersion > 1`) | objeto | existente |

É um mecanismo **seguro e já existente**: depende da existência dos dados persistidos, não de campos vazios nem do schema. **Não é necessário** novo marcador nem bump de schema para distinguir existente/nova.

Caso a tratar: instalação **existente cujo `data.json` não contém** `embeddingModel`/`aiAnalysisModel` (versões antigas). Hoje `Object.assign(DEFAULT_SETTINGS, raw)` preenche com `nomic-embed-text`/`gemma4:12b` (= comportamento efetivo atual). Se o default global passar a ser o novo, estas instalações mudariam **silenciosamente**. Têm de receber o valor de compatibilidade explícito.

---

## 4. Precedência real (implementada, não inventada)

```text
Embeddings / Análise (produtor)
  1. valor device-local persistido   deviceSettingsById[deviceId].{embeddings|analysis}{Provider,Model,BaseUrl}
  2. campo global legado persistido   embeddingProvider/Model/BaseUrl/LocalModel/LocalBaseUrl | aiProvider/aiAnalysisModel/aiBaseUrl
  3. (embeddings/ollama) aiBaseUrl como fallback do endpoint de embeddings (inalcançável na prática: o passo 2 é sempre não-vazio)
  4. default do provider (providerDefaults.ts)
  5. literal fabricado: "nomic-embed-text" (modelo) / OLLAMA_DEFAULT_BASE_URL (URL)
Companion (embeddings): provider/modelo = VectorContractV1 publicado; só URL/credenciais locais.
```
`aiProfiles`/`activeAiProfileId` **não entram** na cadeia. A UI implementa só os passos 1 e 4.

---

## 5. Identidade dos embeddings — a opção B preserva-a?

Identidade publicada = `provider`, `model`, `dimensions`, `inputVersion`, `prefixMode` (+ `contractId` derivado). Os defaults tocam `provider` e `model`; `dimensions` é derivada; `inputVersion`/`prefixMode` dependem do modelo (`getPrefixModeForModel`).

| Cenário | Antes | Depois (B) | Identidade |
|---|---|---|---|
| Existente, `embeddingModel` persistido | runtime = persistido | runtime = persistido; **UI passa a mostrar o persistido** | **preservada** |
| Existente, chave ausente no `data.json` | runtime = `nomic-embed-text` (default mesclado) | runtime = `nomic-embed-text` (valor de compatibilidade explícito) | **preservada** |
| Existente, escolha explícita local | runtime = local | idem | preservada |
| Nova | runtime `nomic-embed-text`, UI v2-moe (divergente) | runtime = UI = **`nomic-embed-text-v2-moe`** | n/a (sem embeddings publicados) |

**Resposta:** sim — para instalações existentes o valor efetivo não muda; só a **apresentação** passa a refletir o runtime. Nunca ocorre `default novo → modelo alterado → embeddings antigos incompatíveis` numa instalação existente.

Risco residual aceite e documentado: uma instalação nova que, antes desta fase, já tinha gerado embeddings com `nomic-embed-text` **sem** ter qualquer `data.json` é impossível (gerar embeddings grava settings). Não existe estado `rawSettings === undefined` com embeddings do runtime legado nesse dispositivo; em dispositivo novo sobre vault com embeddings sincronizados (Companion ou Producer standby) o modelo vem do contrato publicado/identidade ou do primeiro save — um Producer novo com `rawSettings` ausente que passe a gerar com o novo default produzirá `INCOMPATIBLE` explícito pelo lifecycle (confirmação), nunca silencioso.

---

## 6. Necessidade de migração

**Não é necessária migração nem alteração de schema.**

- Existente: valores persistidos não são tocados (`data.json` não é reescrito para alinhar a UI).
- Chave ausente em instalação existente: preenchida **em memória** com o valor de compatibilidade (equivalente ao `Object.assign` atual). Nenhuma escrita.
- Nova: usa os novos defaults.
- Idempotência: trivial (função pura sobre `rawSettings`); sem passo de migração a repetir; `settingsSchemaVersion` inalterado (1).

---

## 7. Profiles

`aiProfiles`, `activeAiProfileId` e `LinaAiProfile.isLocal` não têm consumidor runtime nem UI (15F §8). Para a cadeia efetiva, profile e configuração apresentada **coincidem trivialmente** (ambos ignoram profiles). `buildDefaultAiProfiles` usa `settings.aiAnalysisModel || "gemma4:e2b"` — coerente com o novo default. Sem alteração; remoção fica encaminhada (CR-07).

---

## 8. Fonte única e duplicações de defaults

Defaults literais duplicados hoje: `settings.ts:712,744` (`gemma4:12b`, `nomic-embed-text`), `settings.ts:222-247,827,812` (`gemma4:e2b`), `main.ts` (`"nomic-embed-text"`), `providerDefaults.ts` (a fonte documentada). A resolução efetiva está **duplicada** em `main.getEffectiveEmbeddingConfig`, `linaSearchView.getActiveTextAiProfile`, `settingsRuntimeAdapters.getEffectiveEmbeddingIdentity/hasSameEffectiveProviderTuple`, `declarativeSettingRenderers.detached*Value`, `declarativeSettingsCandidateComposition.baseUrlFor`, `settings.ts` (resumos e `connectionConfiguration`).

Consequência adicional encontrada: `getEffectiveEmbeddingIdentity` (efeito `refresh-embedding-configuration-state`) assume `defaults.model` quando o valor local está vazio. Numa instalação existente (runtime = `nomic-embed-text`), escolher `nomic-embed-text-v2-moe` na UI não é detetado como mudança de identidade ⇒ o efeito de refresh **não dispara**. A correção da fonte única resolve isto.

---

## 9. Plano (decisões)

1. **`src/settings/effectiveAiConfig.ts` (puro, sem I/O):** `resolveEffectiveEmbeddingsConfig(local, settings)` e `resolveEffectiveAnalysisConfig(local, settings)` — a cadeia implementada (§4) numa única função, sem literais fabricados (o último recurso é o default do provider). Entradas estruturais mínimas (sem importar `settings.ts`).
2. **Novos defaults documentados numa só fonte:** `DEFAULT_SETTINGS.embeddingModel`/`aiAnalysisModel` derivam de `providerDefaults.ts` (`nomic-embed-text-v2-moe`, `gemma4:e2b`).
3. **Compatibilidade explícita:** `LEGACY_COMPATIBILITY_DEFAULTS` (`nomic-embed-text`, `gemma4:12b`) aplicados **apenas** quando existe `rawSettings` e a chave está ausente; função `resolveLoadedSettings(rawSettings)` testável; usada nos dois ramos de `loadDataFromDisk`.
4. **Consumidores a usar a fonte única:** `main.getEffectiveEmbeddingConfig` (produtor), `linaSearchView.getActiveTextAiProfile`, UI (porta `getEffectiveAiConfig` ⇒ provider/modelo/URL/placeholder), efeitos em `settingsRuntimeAdapters`, resumos e `connectionConfiguration` em `settings.ts`.
5. **Não alterar:** Lifecycle, Scheduler, Manager, Worker, OwnershipGate, fencing, Vector Contract, `data.json` de instalações existentes, schema.
6. **Testes:** os 9 pedidos (instalação existente sem modelo persistido; nova; explícita; profile; embeddings existentes/identidade; migração (n/a, documentada); UI == runtime) + guarda estática de duplicação.

## 10. Critérios (respostas antecipadas)

1. Valor efetivo de cada default: §2. 2. Default de nova instalação: `nomic-embed-text-v2-moe` / `gemma4:e2b`. 3. Mecanismo: `rawSettings` definido (§3). 4. UI == runtime: via fonte única (§9). 5–7. Preservação e identidade: §5. 8. Precedência: §4. 9–10. Sem migração (§6). 11. Defaults fabricados/duplicados: removidos nos consumidores (§8). 12. Lifecycle e barreiras: não alterados.

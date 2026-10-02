# LINA-15G — IMPLEMENTAÇÃO: DEFAULTS DE SETTINGS E COMPATIBILIDADE (OPÇÃO B)

> **Fase:** LINA-15G · **Data:** 2026-10-02
> **Auditoria:** `docs/audits/architecture/LINA-15G-AUDIT-SETTINGS-DEFAULTS-COMPATIBILITY-001.md`
> **Finding tratado:** CR-03 (LINA-15F) — a UI mostrava `nomic-embed-text-v2-moe` / `gemma4:e2b` enquanto o runtime usava `nomic-embed-text` / `gemma4:12b` (e a mesma classe de divergência em provider e Base URL).
> **Sem alteração de:** `EmbeddingLifecycleSnapshot`, `deriveEmbeddingWritePathDecision`, Scheduler, Operation Manager, Worker, OwnershipGate, fencing, Vector Contract, schema, `data.json` existente.

## 1. Decisão (opção B)

| Instalação | Comportamento |
|---|---|
| Existente (existem settings persistidas) | preserva o valor efetivo atual; a UI passa a mostrá-lo |
| Nova (sem settings persistidas) | defaults documentados: `nomic-embed-text-v2-moe`, `gemma4:e2b` |

**Distinção existente/nova:** `rawSettings` (de `loadData()`) definido ⇔ existente. Mecanismo já existente em `loadDataFromDisk`; não usa campos vazios nem `settingsSchemaVersion`; sem novo marcador. (Os campos globais são sempre persistidos desde o primeiro save, logo "vazio" nunca identificaria uma instalação.)

## 2. Alterações

1. **`src/settings/effectiveAiConfig.ts` (novo, puro):** `resolveEffectiveEmbeddingsConfig` / `resolveEffectiveAnalysisConfig` — precedência *device-local → campo global legado → default do provider*; sem literais fabricados. Para análise passam a aplicar-se `chooseProviderDefault*` (como já acontecia em embeddings): só afeta combinações incoerentes (modelo/URL de outro provider), nunca valores personalizados.
2. **Defaults numa só fonte:** `DEFAULT_SETTINGS.embeddingModel`/`aiAnalysisModel` derivam de `providerDefaults.ts`.
3. **Compatibilidade explícita:** `LEGACY_COMPATIBILITY_DEFAULTS` (`nomic-embed-text`, `gemma4:12b`) e `resolveLoadedSettings(raw)` — em memória, só para chaves em falta de instalações existentes; valores persistidos prevalecem; não escreve em disco. Usada nos dois ramos de `loadDataFromDisk`.
4. **Consumidores na fonte única:** `main.getEffectiveEmbeddingConfig` (produtor; removido o `|| "nomic-embed-text"`), `linaSearchView.getActiveTextAiProfile`, UI (nova porta `getEffectiveAiConfig` ⇒ provider/modelo/URL mostrados e placeholders das Base URL), `settingsRuntimeAdapters` (deteção de mudança de identidade e idempotência do tuplo, comparando o valor persistido e usando o efetivo só quando ausente), resumos de grupo e `connectionConfiguration` (o teste de ligação testa o que o runtime usa).

## 3. Identidade dos embeddings

| Cenário | Antes | Depois | Identidade |
|---|---|---|---|
| Existente, valor persistido | persistido | persistido (UI mostra-o) | preservada |
| Existente, chave ausente | `nomic-embed-text` | `nomic-embed-text` (compatibilidade explícita) | preservada |
| Escolha local explícita | local | local | preservada |
| Nova | runtime `nomic-embed-text` / UI v2-moe | **ambos v2-moe** | n/a (sem embeddings) |

Resposta: **a opção B preserva a identidade dos embeddings existentes.** Não existe caminho `default novo → modelo alterado → embeddings incompatíveis` numa instalação existente. Correção colateral: a deteção de mudança de identidade (efeito `refresh-embedding-configuration-state`) assumia o default do provider quando o valor local estava vazio; passa a usar o efetivo (numa instalação existente, escolher v2-moe na UI passa a disparar o refresh).

## 4. Migração

**Não necessária.** Sem passo de migração, sem `settingsSchemaVersion` novo, sem reescrita de `data.json`. Idempotência: função pura; uma instalação nova, após o primeiro save, é "existente" com os novos valores persistidos (testado).

## 5. Profiles

`aiProfiles`/`activeAiProfileId`/`isLocal` não participam na cadeia efetiva nem na UI (15F §8); a seleção de um perfil não altera nem a UI nem o runtime (testado). Remoção continua encaminhada.

## 6. Testes (`tests/settings/effectiveAiConfigUiRuntime.test.ts`, 13)

Carregamento (nova / existente sem chave / persistido prevalece / puro e idempotente); precedência do resolver e ausência de fuga de defaults entre providers; **UI == runtime** com o `LinaSettingTab` e o `LinaPlugin` reais: existente sem modelo local (legado `nomic-embed-text`/`gemma4:12b`), existente com chave persistida, nova (v2-moe/e2b), escolha explícita, Base URL legada visível, perfil selecionado; guarda estática contra resolução duplicada. Verificação por mutação: desligar a porta `getEffectiveAiConfig` faz falhar 3 testes. `tests/settings/nativeSettingsPagesUX.test.ts` atualizado para o novo `DEFAULT_SETTINGS.embeddingModel`.

## 7. Critérios de conclusão

1. Valor efetivo de cada default: auditoria §2. 2. Default de nova instalação: `nomic-embed-text-v2-moe` / `gemma4:e2b`. 3. Mecanismo: `rawSettings` definido. 4. UI == runtime: sim (testado). 5–6. Existente preservada / nova com default documentado: sim. 7. Identidade preservada: sim. 8. Precedência: device-local → legado global → default do provider (profiles fora). 9–10. Sem migração. 11. Defaults fabricados/duplicados removidos nos consumidores (restam os resíduos da 15D fora de âmbito: `768` etc., CR-05). 12. Lifecycle e barreiras inalterados.

## 8. Dívida técnica restante

CR-05 (`768`/`"nomic-embed-text"` em controller, `deviceRuntimeState`, `semanticCapability`, `sidebarStatusViewModel`, `vectorContract`, `semanticSearchModal`), CR-06 (provider ausente ⇒ `ollama`), CR-07 (`aiProfiles`; `aiBaseUrl` como fallback do endpoint de embeddings, mantido para fidelidade), CR-09 (duas tabelas de capacidades). Renumeração do roadmap: persistência passa a LINA-15H (ver `docs/INDEX.md`).

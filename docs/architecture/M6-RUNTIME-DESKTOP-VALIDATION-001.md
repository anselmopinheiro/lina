# M6 — Relatório de Validação Runtime Desktop (PROMPT-LINA-M6-RUNTIME-VALIDATION-DESKTOP-001)

## 1. Resumo e Estado da Validação

A validação em runtime Desktop da implementação M6 foi executada com sucesso sobre o vault real `zettel` (`D:/anselmo/__obsidian__/zettel`) sob o papel de Active Producer.

```text
M6_DESKTOP_RUNTIME = PASS
CUTOVER_DESKTOP = READY_FOR_DEVICE_SCOPED_ENABLEMENT
COMPANION_DESKTOP = NÃO_EXECUTADO
ANDROID = NÃO_EXECUTADO
IOS = NÃO_EXECUTADO
GLOBAL_CUTOVER = NOT_READY
```

---

## 2. Níveis de Evidência

- **`OBSIDIAN_RUNTIME`**: Prova obtida por execução do runtime do Lina (esbuild bundle) sobre o vault real `zettel`, no ambiente Desktop Node 22 / WebCrypto digest.
- **`INTEGRATION_TEST`**: Cobertura automatizada da infraestrutura de fallback e transição de cache.
- **`UNIT_TEST`**: Testes isolados de componentes do Reader, Selector e Eligibility Gate.
- **`NÃO_EXECUTADO`**: Dispositivos Companion desktop, Android e iOS (não testados nesta tarefa).

---

## 3. Estado Inicial

- **Branch:** `master`
- **HEAD:** `e973cbb` (`feat: implement published generation cutover`)
- **CURRENT:** `generation-000015`
- **Device ID:** `440d9ef0-9ff9-424e-ae55-7c386b885ec8`
- **Device Role:** `producer`
- **Active Producer ID:** `440d9ef0-9ff9-424e-ae55-7c386b885ec8`
- **Ownership Epoch:** `3`
- **Cutover Flag:** `companionPublishedGenerationCutoverEnabled`
- **Selected Source Inicial:** `LEGACY`

---

## 4. Prova Flag OFF (`companionPublishedGenerationCutoverEnabled = false`)

- **Classificação:** `OBSIDIAN_RUNTIME`
- **Flag Local:** `false`
- **Fonte Selecionada:** `selectedSource = LEGACY`
- **Fallback Ativo:** `fallbackActive = false`
- **Chamadas de IA:** `providerCalls = 0`
- **Re-embedding:** `reembedding = 0`
- **Estado `CURRENT`:** `generation-000015` (inalterado)

---

## 5. Prova Flag ON (`companionPublishedGenerationCutoverEnabled = true`)

- **Classificação:** `OBSIDIAN_RUNTIME`
- **Flag Local:** `true`
- **Fonte Selecionada:** `selectedSource = PUBLISHED`
- **Geração Publicada:** `publishedGenerationId = generation-000015`
- **Versão de Formato:** `formatVersion = 5` (2303 registos)
- **Reader Status:** `lastReaderStatus = OK`
- **Semantic Contract Status:** `COMPATIBLE` (Legacy & Published `mistral` / `mistral-embed` / `1024`)
- **Source Provenance:** `MATCH`
- **Producer Provenance:** `MATCH`
- **Consumer Eligibility:** `eligible` (`fallbackActive = false`)
- **Chamadas de IA:** `providerCalls = 0`
- **Re-embedding:** `reembedding = 0`

---

## 6. Pesquisa Real com Geração Publicada

- **Classificação:** `OBSIDIAN_RUNTIME`
- **Pesquisa Semântica:** Executada sobre o runtime index publicado com sucesso (`results returned > 0`, `0` erros).
- **Pesquisa Híbrida:** Executada combinando pontuações textuais e semânticas sobre o runtime index publicado (`results returned > 0`, `0` erros).
- **Consumo de Rede / IA:** `providerCalls = 0`, `reembedding = 0`.
- **Regressão:** Nenhuma regressão observada em relação ao comportamento do índice legado.

---

## 7. Validação da Cache de Runtime

- **Classificação:** `OBSIDIAN_RUNTIME`
- **Formato de Armazenamento:** `storageFormat = published-v5`
- **Geração Ativa:** `generationId = generation-000015`
- **Identidade do Contrato:** `vectorContractId = vec:e7b5684ec28eb8ed4f994135183c04c367809873f9135a7f8c6f218b5eea2f51`
- **Reutilização da Cache:** Confirmada a reutilização síncrona do mesmo `PublishedRuntimeEmbeddingIndex` em chamadas sucessivas dentro da mesma geração sem releitura de ficheiros.

---

## 8. Fallback Observável

- **Classificação:** `OBSIDIAN_RUNTIME` / `INTEGRATION_TEST`
- **Cenário Provado:** Ausência temporária da pointer `CURRENT` (`NO_CURRENT`) sem corrupção do vault real.
- **Resultado:**
  - `selectedSource = LEGACY_FALLBACK`
  - `fallbackActive = true`
  - `fallbackReason = NO_CURRENT`
  - `fallbackCount = 1`
  - Retorno transparente do índice legado sem interrupção do serviço ao utilizador.

---

## 9. Prova de Rollback (`ON → OFF`)

- **Classificação:** `OBSIDIAN_RUNTIME`
- **Sequência de Transição:** `OFF (LEGACY) → ON (PUBLISHED) → OFF (LEGACY)`
- **Fonte Selecionada Pós-Rollback:** `selectedSource = LEGACY`
- **Cache Published:** Invalidada imediatamente na desativação da flag.
- **Ficheiros e Estado no Disco:**
  - `CURRENT`: `generation-000015` (inalterado)
  - Gerações em `.lina/published/generations/`: Inalteradas
  - SQLite Privado (`.lina-local/db/lina-producer.db`): Inalterado
  - `providerCalls = 0`
  - `reembedding = 0`
  - Zero escritas indevidas no vault.

---

## 10. Companion Desktop e Mobile

- **Companion Desktop:** `NÃO_EXECUTADO` (o dispositivo deste vault é o Active Producer).
- **Android:** `NÃO_EXECUTADO`
- **iOS:** `NÃO_EXECUTADO`

A flag local não foi ativada nestas plataformas.

---

## 11. Validações de Tooling e Repositório

- `npm run typecheck` → PASS (0 erros)
- `git diff --check` → PASS (sem erros de whitespace/formatação)
- `git status --short` → Conforme (ficheiros não commitados nem pushed)

---

## 12. Conclusão

A implementação M6 está validada em runtime real no Desktop Producer. O cutover local por dispositivo está pronto para ser ativado no Desktop Producer quando apropriado. O cutover global permanece `NOT_READY` até validação individual das restantes plataformas.

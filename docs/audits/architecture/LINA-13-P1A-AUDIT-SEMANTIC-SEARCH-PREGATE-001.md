# LINA-13-P1A-AUDIT-SEMANTIC-SEARCH-PREGATE-001

**Tipo:** Auditoria técnica e análise de impacto pré-implementação  
**Âmbito:** P1-A — Remoção do pré-gate redundante baseado em cache/DeviceRuntimeState na pesquisa semântica pura  
**Referência:** `LINA-13-P1-AB-AUDIT-IMPLEMENTATION-PLAN-001`, `PROMPT-CODEX-LINA-P1A-SEMANTIC-SEARCH-PREGATE-001`  
**Estado Git:** `master`, HEAD `fc9b18a`  

---

## 1. Fluxo Atual e Cadeia de Decisão

A execução de uma pesquisa semântica em [`src/search/linaSearchView.ts`](file:///d:/_dev/obsidian/lina/src/search/linaSearchView.ts) segue a seguinte cadeia:

```
runSearch()                                            linaSearchView.ts:3130
 └─ selectedMode === "semantica" → runSemanticSearchGrouped(query, safeChunks)   :3198

runSemanticSearchGrouped                               :3754
 ① PRÉ-GATE (cache)  runtimeState = plugin.getDeviceRuntimeState()           :3755
                     if (!runtimeState.embeddings.semanticAvailable) → status + return   :3756-3759
 ② Companion sem contrato/config indisponível → status + return            :3762-3767
 ③ settingsProvider / settingsModel (Companion: contrato; produtor: settings locais) :3768-3773
 ④ runtimeIndex = plugin.getRuntimeEmbeddingIndex(chunks)  → null ⇒ status + return :3775-3779
 ⑤ provider do índice ≠ settingsProvider ⇒ status + return                  :3786-3789
 ⑥ modelo do índice ≠ settingsModel ⇒ status + return                       :3791-3794
 ⑦ inputVersion/prefixMode ≠ nextIdentity ⇒ status + return                 :3797-3803
 ⑧ dimensions ≤ 0 ⇒ status + return                                         :3809-3813
 ⑨ generateSingleEmbedding(query)  ← ÚNICO PASSO COM REDE                     :3820-3827
 ⑩ searchRuntimeSemanticIndex (vetores validados e filtrados)               :3833-3836
 ⑪ groupResultsByNote → renderGroupedCards                                  :3837-3838
```

---

## 2. Fonte do Bloqueio

O passo **①** consulta `this.plugin.getDeviceRuntimeState().embeddings.semanticAvailable`.
Este estado é uma projeção derivada avaliada no arranque (`loadDataFromDisk`) ou em momentos específicos (ex.: abertura da modal de diagnóstico).

Se a cache estiver stale (por exemplo, após uma primeira geração de embeddings, reconfiguração manual ou transição de ficheiros), `semanticAvailable` pode ser `false` mesmo quando:
1. O manifesto canónico `.lina/index/manifest.json` está 100% íntegro;
2. O contrato vetorial `VectorContract` está válido;
3. O ficheiro `embeddings.jsonl` (ou cópia binária) contém vetores válidos e correspondentes aos chunks atuais.

Nesse cenário, a pesquisa semântica é **bloqueada prematuramente** no passo ①, impedindo a execução de uma consulta plenamente legítima.

---

## 3. Análise de Segurança e Redundância

O pré-gate **①** é estritamente redundante quanto à segurança operacional e de custos/rede:
- O passo com chamada ao provider (passo **⑨**) **só é atingido após as validações canónicas completas nos passos ④ a ⑧**:
  - **Passo ④ (`getRuntimeEmbeddingIndex`)**: valida frescura do manifesto, existência de ficheiro, estabilidade de fonte, integridade JSONL e presença de vetores `validForSearch`;
  - **Passos ⑤, ⑥, ⑦**: validam compatibilidade exata de `provider`, `model`, `inputVersion` e `prefixMode`;
  - **Passo ⑧**: valida integridade dimensional dos vetores.
- A remoção do pré-gate ① não permite qualquer chamada de rede indevida nem fallback silencioso para modelos incompatíveis.

---

## 4. Confirmação da Alteração Mínima Segura

### 4.1 Remoção do Pré-gate
Em `src/search/linaSearchView.ts` (`runSemanticSearchGrouped`), remover as linhas 3755–3759:
```typescript
// REMOVER:
const runtimeState = this.plugin.getDeviceRuntimeState();
if (!runtimeState.embeddings.semanticAvailable) {
  this.setSearchStatus(runtimeState.embeddings.reason || this.L.stateSemanticUnavailable);
  return;
}
```
O fluxo passará a iniciar diretamente na validação de Companion/contrato (passo ②) e no carregamento do índice runtime (passo ④).

### 4.2 Mapeamento de Códigos de Erro no Estado Vazio (`getSemanticRuntimeLoadMessage`)
Quando não existem embeddings publicados, `getRuntimeEmbeddingIndex` devolve `null` com códigos de diagnóstico específicos (`lastErrorCode: "canonical-manifest-invalid"`, `"canonical-manifest-read-failed"`, `"canonical-embeddings-empty"`, etc.).
Para garantir que o utilizador vê uma mensagem clara (`semanticNoEmbeddings`) em vez de um erro genérico de falha de carregamento, alarga-se `getSemanticRuntimeLoadMessage()` para mapear os seguintes códigos:
- `lastErrorCode` ∈ `{"jsonl-missing", "canonical-manifest-invalid", "canonical-manifest-read-failed", "canonical-embeddings-empty"}`
- `fallbackReason` ∈ `{"empty", "canonical-manifest-invalid"}`

---

## 5. Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
| :--- | :--- | :--- | :--- |
| Mensagem degradada no estado sem embeddings | Baixa | Baixo | Tratado com o alargamento de `getSemanticRuntimeLoadMessage()` (§4.2). |
| Chamada ao provider sem embeddings válidos | Nula | Alto | O passo ⑨ é protegido pelas validações estritas ④–⑧ em `getRuntimeEmbeddingIndex`. |
| Regressão na pesquisa híbrida | Nula | Médio | A pesquisa híbrida já não utilizava o pré-gate de `DeviceRuntimeState`. |

---

## 6. Conclusão da Análise

A alteração proposta é mínima, atómica, segura e preserva integralmente a garantia de *Zero Silent Fallback* e a autoridade do `VectorContract`.
Aprovada para implementação imediata.

# LINA-14D.2-A — Auditoria da Migração do EmbeddingWorkStatusController

**Data:** 2026-09-29  
**Fase:** LINA-14D.2-A  
**Autor:** Arquiteto de Software Sénior & Engenheiro TypeScript/Obsidian Plugin  
**Estado:** Concluído / Pronto para Implementação  

---

## 1. Contexto e Objetivo

A fase **LINA-14D.2-A** inicia a migração ativa do Write Path do Lina, focando-se exclusivamente no [`EmbeddingWorkStatusController`](file:///d:/_dev/obsidian/lina/src/index/embeddingWorkStatusController.ts).

O objetivo desta sub-fase é eliminar as heurísticas dispersas e a lógica ad-hoc de "há trabalho a realizar" (`hasEmbeddingWorkAvailable`, `deriveEmbeddingWorkAvailability`), substituindo-as pela decisão canónica unificada:

$$\text{EmbeddingLifecycleSnapshot} \longrightarrow \text{deriveEmbeddingWritePathDecision()} \longrightarrow \text{EmbeddingWorkStatusController}$$

---

## 2. Auditoria do Estado Atual do Controller

### 2.1 Decisões e Heurísticas Atuais
No estado atual, o controller toma decisões de disponibilidade de trabalho através de duas funções locais:

1. **`hasEmbeddingWorkAvailable(summary)`**:
   - Avalia somatórios pontuais: `toGenerateCount > 0 || requiresPublication || missingCount > 0 || staleCount > 0 || obsoleteCount > 0 || duplicateRecordCount > 0 || invalidRecordCount > 0`.
2. **`deriveEmbeddingWorkAvailability(summary)`**:
   - Aplica regras de tri-estado:
     - Retorna `undefined` se `summary` for nulo, `detailsAvailable === false` ou `updatePlan.mode === "indeterminate"`.
     - Retorna `true` se `updatePlan.mode === "full-rebuild"`.
     - De outro modo, delega em `hasEmbeddingWorkAvailable(summary)`.

### 2.2 Divergências e Inconsistências Identificadas na Auditoria LINA-14D
- **Divergência B7 (Obsoletos sem Chunks):** Quando `chunks.length === 0` com registos obsoletos a remover no índice, `hasEmbeddingWorkAvailable` retornava `true`, enquanto a política legada retornava `false`. O modelo canónico classifica isto determinística e formalmente como `publish-only` (`action = "update"`, `cost = "none"`).
- **Tratamento de Estado Indeterminado:** Quando o índice canónico está ilegível ou corrompido, o controller reportava `undefined` de forma frágil, dependendo de flags soltas (`detailsAvailable`). O modelo canónico classifica estruturadamente como `INDETERMINATE`.
- **Ausência de Metadados de Decisão:** O controller apenas produzia um booleano (`workAvailable?: boolean`), sem expor a ação recomendada (`generate`, `update`, `rebuild`, `retry`), o modo de execução, severidade ou custo para os consumidores.

---

## 3. Plano de Implementação

### 3.1 Unificação da Avaliação de Trabalho no Controller
1. **Consumo de `EmbeddingLifecycleSnapshot` & `deriveEmbeddingWritePathDecision`**:
   - Ao processar o `EmbeddingWorkSummary` no método `runRefresh()`, o controller construirá o `EmbeddingLifecycleSnapshot` através de `adaptCurrentStateToLifecycleSnapshot` e derivará a decisão via `deriveEmbeddingWritePathDecision(snapshot)`.
2. **Resolução Determinística de `workAvailable`**:
   - `workAvailable` passará a refletir estritamente a decisão canónica:
     - Se `decision.workKind === "indeterminate"` ou `snapshot.primary === "INDETERMINATE"`: `workAvailable = undefined` (preservando o tri-estado sem conversão para idle).
     - Se `decision.updateRequired` for `true`: `workAvailable = true`.
     - Caso contrário: `workAvailable = false`.
3. **Enriquecimento do `EmbeddingWorkRuntimeState`**:
   - Adicionar opcionalmente os campos `decision?: EmbeddingWritePathDecision` e `lifecycleSnapshot?: EmbeddingLifecycleSnapshot` ao `EmbeddingWorkRuntimeState`, permitindo que futuros consumidores do Write Path acedam à decisão canónica sem recálculos.
4. **Refatoração de `hasEmbeddingWorkAvailable`**:
   - Migrar a função exportada `hasEmbeddingWorkAvailable` para utilizar `classifyEmbeddingWork` / `deriveEmbeddingWritePathDecision`, mantendo total paridade e retrocompatibilidade com os testes existentes.

---

## 4. Cenários Obrigatórios a Validar

| Cenário | Estado Canónico | `workAvailable` | Ação Recomendada (`action`) | Invariante Assegurada |
|---|---|---|---|---|
| **READY** | `READY` | `false` | `"none"` | Sem trabalho pendente. |
| **UPDATE_AVAILABLE** | `UPDATE_AVAILABLE` | `true` | `"update"` (ou `"rebuild"`) | Trabalho pendente; pesquisa permanece operacional. |
| **INDEX_ONLY** | `INDEX_ONLY` | `true` | `"generate"` | Necessidade de geração inicial identificada. |
| **INCOMPATIBLE** | `INCOMPATIBLE` | `true` | `"rebuild"` | Reconstrução obrigatória com confirmação. |
| **ERROR** | `ERROR` | Conforme falha | `"retry"` | Diagnóstico de erro preservado. |
| **Companion** | `READY` / `UPDATE_AVAILABLE` | `false` | `"none"` | Companion nunca assume trabalho de escrita. |
| **Standby** | `STANDBY` | `false` | `"none"` | Standby Producer não executa sem lock ativo. |
| **INDETERMINATE** | `INDETERMINATE` | `undefined` | `"none"` | Nunca convertido silenciosamente em idle/false. |

---

## 5. Limites e Segurança

- **Isolamento de Escopo:** Nenhuma alteração será introduzida no `EmbeddingScheduler`, `EmbeddingWorker`, UI, Sidebar, Settings ou publicação física.
- **Zero Efeitos Secundários:** A execução permanece 100% de leitura/derivação em memória dentro do controller.
- **Validação Rigorosa:** Toda a suíte de testes existente (incluindo testes de temporizadores e reentrância de refresh) deve manter 100% de aprovação.

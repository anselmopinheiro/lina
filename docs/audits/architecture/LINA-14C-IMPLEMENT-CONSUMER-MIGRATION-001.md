# LINA-14C-IMPLEMENT-CONSUMER-MIGRATION-001: Relatório de Implementação da Migração de Consumidores (Fase 14C-1)

**Fase:** LINA-14C-1  
**Data:** 2026-09-29  
**Status:** IMPLEMENTAÇÃO CONCLUÍDA / APROVADA  
**Alvo da Fase 14C-1:** `SidebarStatusViewModel` (`src/search/sidebarStatusViewModel.ts`) e integração de renderização na Sidebar (`src/search/linaSearchView.ts`).

---

## 1. Resumo da Implementação

Na fase **LINA-14C-1**, foi concluída a migração do primeiro consumidor alvo — o subsistema de apresentação de estado da Sidebar.

O `SidebarStatusViewModel` passou a suportar e consumir diretamente a projeção canónica [`EmbeddingLifecycleSnapshot`](file:///d:/_dev/obsidian/lina/src/index/embeddingLifecycleModel.ts), eliminando a necessidade de reconstrução ad-hoc de estados a partir de flags dispersas, mantendo 100% de paridade visual e retrocompatibilidade para chamadas legadas.

---

## 2. Ficheiros Alterados e Módulos Integrados

1. **`src/search/sidebarStatusViewModel.ts`:**
   - Adicionado o campo `lifecycleSnapshot?: EmbeddingLifecycleSnapshot` ao contrato `BuildSidebarStatusViewModelInput`.
   - Derivação declarativa da frescura de embeddings (`freshness.embeddings`), disponibilidade semântica (`searchAvailability.semanticAvailable`), modo de pesquisa (`searchAvailability.hybridMode`), razão secundária e alertas degradados (`degradedAlert`) a partir do snapshot canónico.
   - Gating de manutenção (`maintenance.canExecuteMaintenance`) condicionado diretamente a `lifecycleSnapshot.write.applicable`.
   - Preservação estrita dos caminhos de fallback legados quando o snapshot não for fornecido.

2. **`src/search/linaSearchView.ts`:**
   - Importado `adaptCurrentStateToLifecycleSnapshot` do adapter LINA-14B.
   - Em `refreshState()`, o snapshot canónico é gerado a partir do estado de runtime atual e injetado diretamente na chamada de `buildSidebarStatusViewModel()`.

3. **`tests/search/sidebarStatusLifecycleSnapshot.test.ts`:**
   - Nova suite de testes unitários dedicada, validando o comportamento do view model perante todos os estados fundamentais:
     - `READY` $\to$ embeddings frescos, pesquisa híbrida completa e tom de sucesso;
     - `UPDATE_AVAILABLE` $\to$ embeddings a necessitar de atualização, pesquisa ativa e manutenção permitida ao produtor;
     - `INCOMPATIBLE` $\to$ modo text-only com banner prioritário de `vector-mismatch`;
     - `INDEX_ONLY` $\to$ embeddings em falta com modo híbrido degradado para text-only;
     - `Companion` $\to$ manutenção de escrita desativada, nota explicativa de gestão por produtor ativo e pesquisa semântica preservada;
     - `Producer Standby` $\to$ manutenção de escrita desativada e nota de standby;
     - `ERROR` $\to$ registo de falha e manutenção disponível para retry.

---

## 3. Verificação de Invariantes e Comportamento

- **Vector Contract Preservado:** Incompatibilidades continuam a desativar a pesquisa semântica sem efetuar chamadas a providers externos.
- **Zero Silent Fallback:** Se os vetores publicados divergirem do contrato local, o modo de pesquisa degrada abertamente para text-only com alerta claro.
- **Isolamento Companion:** Nós Companion recebem `write.applicable = false` e `canRequestUpdate = false`.
- **Paridade Visual:** 100% dos testes históricos de layout e textos (PT-PT e EN) em `tests/search/sidebarStatusUX.test.ts` continuam a passar sem qualquer regressão.

---

## 4. Próximos Passos (Fases 14C-2 e Seguintes)

1. **Fase 14C-2:** Migração do `EmbeddingStatusViewModel` (`src/search/embeddingStatusViewModel.ts` / modal de diagnóstico de embeddings).
2. **Fase 14C-3:** Migração do modelo interno de diagnóstico de dispositivo (`src/device/deviceDiagnostics.ts`).
3. **Fase 14C-4:** Migração da avaliação canónica de capacidade semântica (`src/search/semanticCapability.ts`).

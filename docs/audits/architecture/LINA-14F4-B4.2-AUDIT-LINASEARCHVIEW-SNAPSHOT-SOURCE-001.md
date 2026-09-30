# Auditoria de Arquitetura: Consolidação da Fonte de Snapshot em LinaSearchView (LINA-14F.4-B4.2)

**Data:** 2026-09-30  
**Fase:** LINA-14F.4-B4.2 — LinaSearchView Snapshot Source Consolidation  
**Alvo:** `src/search/linaSearchView.ts`, `src/search/sidebarStatusViewModel.ts`, `main.ts`

---

## 1. Contexto e Objetivos

No seguimento das fases de consolidação LINA-14:
- `EmbeddingLifecycleSnapshot` é o modelo factual único de estado do ciclo de vida dos embeddings.
- O `EmbeddingWorkStatusController` gera periodicamente o snapshot canónico através de `buildEmbeddingWorkLifecycleSnapshot()`.
- O `LinaPlugin.getEmbeddingLifecycleSnapshot()` em `main.ts` disponibiliza o snapshot canónico enriquecido com autoridade em tempo real (`getLiveAuthorityRuntimeState()`) e estado operacional ativo.
- O `EmbeddingWorker`, o `EmbeddingScheduler` e o `EmbeddingOperationManager` já foram unificados para consumir esta fonte canónica.

Esta auditoria analisa a remoção da construção ad-hoc de `EmbeddingLifecycleSnapshot` em `src/search/linaSearchView.ts` e a sua substituição pela fonte canónica centralizada.

---

## 2. Análise da Construção Atual em `LinaSearchView`

### 2.1 Localização e Dados Utilizados
No método `updateSidebarStatusUX()` de `src/search/linaSearchView.ts` (linhas 2705–2715):

```ts
const lifecycleSnapshot = adaptCurrentStateToLifecycleSnapshot({
  deviceRuntimeState: runtimeState,
  operationState: embeddingOperationState,
  companionState,
  upstreamTextIndex: indexReady
    ? "ready"
    : (indexStatus.usability === "missing" ? "missing" : "invalid"),
  canonicalExists: runtimeState.embeddings.exists,
  validForSearchCount: runtimeState.embeddings.semanticAvailable ? 1 : 0,
  factsChecking: embeddingsChecking,
});
```

### 2.2 Incompletudes e Riscos do Snapshot Local
1. **Ausência do `updatePlan` e `EmbeddingWorkSummary`:**  
   O snapshot local criado em `linaSearchView.ts` não passa `updatePlan` nem `workAssessment` detalhado ao `adaptCurrentStateToLifecycleSnapshot()`.
2. **Classificação Divergente de Trabalho:**  
   Enquanto o `EmbeddingWorkStatusController` e `this.plugin.getEmbeddingLifecycleSnapshot()` dispõem das contagens exatas de chunks a gerar, missing, stale e obsoletos a partir do `readEmbeddingUpdatePreview`, a reconstrução local em `linaSearchView.ts` possui apenas contagens padrão ou inferidas.
3. **Duplicação de Pipeline:**  
   Cria um segundo ponto de montagem de snapshot que pode divergir do estado factual real consumido pelo Worker e Scheduler.

---

## 3. Comparação com a Fonte Canónica

```text
Pipeline Pretendido (Canónico):
LinaPlugin.getEmbeddingLifecycleSnapshot()
          │
          ▼
   LinaSearchView
          │
          ▼
buildSidebarStatusViewModel({ ..., lifecycleSnapshot })
          │
          ▼
Renderização UI (Sidebar Status)
```

Comparado com o pipeline legado:
```text
Pipeline Legado (Ad-hoc):
LinaSearchView (variáveis locais dispersas)
          │
          ▼
adaptCurrentStateToLifecycleSnapshot() [Snapshot Ad-hoc Incompleto]
          │
          ▼
buildSidebarStatusViewModel({ ..., lifecycleSnapshot })
```

### Vantagens da Unificação:
- **Consistência Total:** A UI reflete exatamente o snapshot que o Scheduler e o Worker avaliam para decisões de execução.
- **Zero Duplicação:** Elimina o import de `adaptCurrentStateToLifecycleSnapshot` em `linaSearchView.ts`.
- **Preservação de Responsabilidades:** A camada de UI passa a ser puramente consumidora do estado do sistema sem reconstruir dados do ciclo de vida.

---

## 4. Impacto Funcional e Visual

- **Apresentação na Sidebar:** Nenhuma alteração visual. O view model `buildSidebarStatusViewModel` continuará a receber um `lifecycleSnapshot` válido e compatível com as regras de renderização existentes.
- **Ações de Diagnóstico e Atualização:** A disponibilidade do botão contextual de atualização continua a respeitar as condições canónicas (`workAvailable`, autorização de escrita, estado da operação).
- **Tratamento de Erros e Alerts:** O degraded alert e os indicadores de status dot mantêm o seu comportamento determinístico.

---

## 5. Plano de Implementação

1. **Refatoração de `src/search/linaSearchView.ts`:**
   - Remover o import de `adaptCurrentStateToLifecycleSnapshot`.
   - Substituir a chamada local a `adaptCurrentStateToLifecycleSnapshot({ ... })` em `updateSidebarStatusUX()` por `const lifecycleSnapshot = this.plugin.getEmbeddingLifecycleSnapshot();`.
2. **Atualização de Testes:**
   - Atualizar `tests/search/linaSearchViewHardening.test.ts` para verificar o uso de `this.plugin.getEmbeddingLifecycleSnapshot()`.
   - Adicionar testes de caracterização específicos para a integração do snapshot em `linaSearchView`.
3. **Quality Gates:**
   - Executar `npm test`, `npm run typecheck`, `npm run lint:obsidian:strict`, `npm run build`, `npm run release-check`, `git diff --check`.

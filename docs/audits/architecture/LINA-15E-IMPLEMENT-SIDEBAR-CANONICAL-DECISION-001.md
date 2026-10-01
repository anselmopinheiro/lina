# Implementação LINA-15E: Alinhamento da Sidebar com a Decisão Canónica do Lifecycle

## 1. Enquadramento e Autoridade

- **Fase**: LINA-15E — Alinhamento da Sidebar com a Decisão Canónica do Lifecycle
- **Objetivo**: Resolver o finding **F-05** (e findings associados de código morto **F-20** e **F-25**) da auditoria global pós-LINA-14 (`docs/audits/architecture/LINA-EMBEDDINGS-AUDITORIA-GLOBAL-POS-LINA14-001.md`).
- **Autoridade Documental**:
  - `AGENTS.md`
  - `PROMPT-MESTRA-LINA-004`
  - `docs/audits/architecture/LINA-15E-AUDIT-SIDEBAR-CANONICAL-DECISION-001.md`

---

## 2. Divergência Identificada e Causa

A auditoria prévia classificou o runtime como **Modelo B (Parcialmente Canónico)**:
- `buildSidebarStatusViewModel` calculava o badge e o texto de freshness a partir do `EmbeddingLifecycleSnapshot`, mas a Sidebar UI (`renderSidebarStatusCard` em `src/search/linaSearchView.ts`) decidia a visibilidade do botão com um predicado booleano ad-hoc local (`isAuthorizedProducer && workAvailable && !operationActive && indexReady`) e utilizava uma etiqueta estática `"Atualizar embeddings"`.
- O clique no botão chamava `this.plugin.confirmAndRequestEmbeddingGeneration("sidebar")` sempre com `isFullRebuild = false`, ignorando se a decisão canónica era `generate`, `rebuild` ou `update`.
- Existiam quatro métodos privados mortos em `linaSearchView.ts` (`renderEmbeddingDiagnosticSummary`, `renderEmbeddingDiagnosticDetails`, `applyEmbeddingDiagnosticTone`, `handleEmbeddingDiagnosticAction`) que importavam `buildEmbeddingStatusViewModel` sem qualquer chamada ativa.

---

## 3. Implementação e Caminho Novo

O fluxo foi completamente alinhado com o modelo canónico (**Modelo A — Totalmente Canónico**):

```text
EmbeddingLifecycleSnapshot
        ↓
deriveEmbeddingWritePathDecision(lifecycleSnapshot)
        ↓
SidebarActionInfo (kind, label, disabled, requiresConfirmation, isFullRebuild, isVisible)
        ↓
SidebarStatusViewModel.action
        ↓
LinaSearchView.renderSidebarStatusCard (button label, class, disabled, onClick)
        ↓
LinaSearchView.handleEmbeddingGeneration(action.isFullRebuild)
        ↓
Plugin.confirmAndRequestEmbeddingGeneration("sidebar", progress, isFullRebuild)
        ↓
OperationManager / Worker (Gate Canónico + Ownership Fencing)
```

### Alterações Realizadas:

1. **`src/search/sidebarStatusViewModel.ts`**:
   - Introduzidos tipos `SidebarActionKind` (`"generate" | "update" | "rebuild" | "cancel" | "none"`) e interface `SidebarActionInfo`.
   - Adicionada propriedade `action?: SidebarActionInfo` a `SidebarStatusViewModel`.
   - Implementado bloco de derivação operacional invocando `deriveEmbeddingWritePathDecision(lifecycleSnapshot)`.
   - Se uma operação estiver em curso (`UPDATING` / `CANCELLING`), expõe ação `cancel` com rótulo "Cancelar".
   - Se for Producer Ativo com índice textual disponível, deriva `generate`, `update` ou `rebuild` (com `isFullRebuild: true` e `requiresConfirmation: true`).
   - Para Companion, Standby ou `INDETERMINATE`, nenhuma ação de escrita direta é exposta (`action = undefined`).

2. **`src/search/linaSearchView.ts`**:
   - `renderSidebarStatusCard` passou a ler `sidebarStatus.action` diretamente.
   - Aplica classes e rótulos contextuais (`mod-cta` para geração/atualização, `mod-warning` para rebuild ou cancelamento).
   - Passa `action.isFullRebuild` a `this.handleEmbeddingGeneration(action.isFullRebuild)`.
   - Removidos imports e métodos mortos (`buildEmbeddingStatusViewModel`, `EmbeddingDiagnosticAction`, `renderEmbeddingDiagnosticSummary`, `renderEmbeddingDiagnosticDetails`, `applyEmbeddingDiagnosticTone`, `handleEmbeddingDiagnosticAction`).

3. **Testes**:
   - `tests/search/sidebarStatusLifecycleSnapshot.test.ts`: Adicionada suíte de testes de invariantes cobrindo os cenários canónicos (UPDATE_AVAILABLE, INDEX_ONLY, INCOMPATIBLE, INDETERMINATE, operação ativa/cancel, Companion, Standby, resource-limit-exceeded).
   - `tests/search/sidebarEmbeddingWorkflowState.test.ts`: Atualizado teste estrutural para garantir a eliminação do predicado local e o wiring canónico de `sidebarStatus.action`.
   - `tests/search/linaSearchViewHardening.test.ts`: Atualizado para refletir a delegação limpa de diagnósticos ao `DeviceDiagnosticsModal`.

---

## 4. Invariantes Preservados

- **Zero Breaking Changes**: Nenhuma alteração a schemas persistidos, Vector Contract V1, formato JSONL/binário, ownership fencing ou políticas de write gate.
- **Segurança Operacional**: A UI não é a única barreira; o backend (`confirmAndRequestEmbeddingGeneration`, `evaluateOperationStartGate`, `EmbeddingWorker`, `OwnershipGate`) continua a validar e proteger a autoridade de escrita e o fencing.
- **Companion / Standby**: Continuam estritamente impedidos de expor ações de escrita de embeddings.
- **Resource Limit Exceeded**: Traduzido canonicamente em `rebuild` com confirmação obrigatória e flag `isFullRebuild: true`.
- **Indeterminate**: Permanece bloqueante sem emissão de ações de escrita.

---

## 5. Quality Gates

- `npm test`: 149 ficheiros de teste, 1976 testes aprovados.
- `npm run typecheck`: 0 erros.
- `npm run lint:obsidian:strict`: 0 erros, 0 avisos.
- `npm run build`: bundle e assets gerados e instalados no test vault.
- `npm run release-check`: verificado com sucesso para versão 0.3.1.
- `git diff --check`: 0 problemas de formatação.

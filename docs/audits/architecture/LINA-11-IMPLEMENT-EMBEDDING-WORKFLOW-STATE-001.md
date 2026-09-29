# LINA-11-IMPLEMENT-EMBEDDING-WORKFLOW-STATE-001 — Estabilização e Máquina de Estados do Workflow de Embeddings

## 1. Contexto e Objetivo

A auditoria arquitetural `LINA-11-AUDIT-EMBEDDING-WORKFLOW-STATE-001` identificou acoplamento indevido entre a **capacidade de pesquisa semântica** (Read Path) e o **workflow operacional de manutenção/geração de embeddings** (Write Path).

Este acoplamento gerava dois comportamentos anómalos visíveis na UI da Sidebar:
1. **Falso `"A preparar pesquisa semântica..."`**: Quando a cópia binária derivada tentava manutenção e encontrava o lock de escrita ocupado, a fase `queued` ficava retida no `BinaryEmbeddingCopyController`. A Sidebar inspecionava diretamente a cópia binária e apresentava a mensagem transitória sem que qualquer geração real de embeddings tivesse sido confirmada ou iniciada.
2. **Dois Canais Concorrentes**: A Sidebar apresentava o estado no `stateContainer` (declarativo, via `sidebarStatusViewModel`) e simultaneamente no `statusEl` (imperativo, via `setStatus`). Em caso de drift documental (`workAvailable = true`), o `stateContainer` mostrava `Embeddings: Atualização necessária`, enquanto o `statusEl` afirmava `Prontos` ou `A preparar pesquisa semântica...`.

O objetivo desta implementação foi formalizar a máquina de estados canónica do workflow, separar estritamente o Read Path do Write Path, eliminar a retenção do estado `queued` na cópia binária, subordinar o canal imperativo `statusEl` e fornecer a ação contextual autorizada `"Atualizar embeddings"`.

---

## 2. Máquina de Estados Canónica Implementada

Foi criado o módulo puro [`src/index/embeddingWorkflowState.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingWorkflowState.ts) que implementa `resolveEmbeddingWorkflowState(input)`.

### 2.1 Estados Canónicos (`EmbeddingWorkflowStatus`)

| Estado | Significado Operacional | UI Label / Expressão | Botão Contextual |
| :--- | :--- | :--- | :--- |
| `IDLE` | Sem trabalho nem operações ativas; embeddings sincronizados com o vault. | `Embeddings: Atualizados` | Oculto |
| `CHECKING` | Avaliação de drift/update plan ainda a decorrer. | `A verificar embeddings...` | Oculto |
| `UPDATE_REQUIRED` | Drift detetado (`workAvailable = true`), geração inativa. | `Embeddings: Atualização necessária` | Visível (se produtor autorizado + manual + texto pronto) |
| `PREPARING` | Geração autorizada e iniciada, em validação preliminar ou espera de índice textual. | `A preparar atualização de embeddings...` | Oculto / Disabled |
| `GENERATING` | Execução ativa de lotes de embeddings com o provider. | `A gerar embeddings... (x/y)` | Oculto |
| `PERSISTING` | Vetores a ser escritos no índice JSONL canónico. | `A guardar embeddings...` | Oculto |
| `FINALIZING` | Publicação canónica atómica ou manutenção terminal. | `A finalizar embeddings...` | Oculto |
| `ERROR` | Falha da operação de embeddings com detalhe do erro. | `Erro na atualização dos embeddings` | Oculto / Retry seguro |
| `CANCELLED` | Cancelamento cooperativo solicitado pelo utilizador. | `Atualização de embeddings cancelada` | Volta a `UPDATE_REQUIRED` se drift persistir |

### 2.2 Invariante Central
Em modo manual:
```typescript
workAvailable === true && generationRunning === false
```
produz **estritamente** `UPDATE_REQUIRED` e **nunca** `PREPARING`. A transição `UPDATE_REQUIRED → PREPARING` só é admitida após despacho confirmado da geração canónica (`operationState.status === "running"`).

---

## 3. Origem Canónica do Workflow

A origem do estado operacional é consolidada via `LinaPlugin.getEmbeddingWorkflowState()` em [`main.ts`](file:///d:/_dev/obsidian/lina/main.ts):
```typescript
getEmbeddingWorkflowState(options?: { textIndexReady?: boolean }): EmbeddingWorkflowState {
    const freshness = this.getEmbeddingFreshness();
    const operation = this.getEmbeddingOperationState();
    return resolveEmbeddingWorkflowState({
        freshness,
        operation,
        textIndexReady: options?.textIndexReady,
    });
}
```
Não existe inferência paralela nem duplicação de resolvers nos componentes de UI.

---

## 4. Separação Estrita: Read Path vs. Write Path

* **Read Path (Semantic Capability):** Determina se a pesquisa pode usar os vetores atualmente em disco.
  - Avaliado por `DeviceRuntimeState.embeddings` e `isEmbeddingReadyForSearch()`.
  - Estados: `AVAILABLE`, `DEGRADED`, `UNAVAILABLE`.
  - A pesquisa híbrida permanece **disponível** mesmo quando há drift de ficheiros (`UPDATE_REQUIRED`). O drift não degrada a pesquisa semântica dos documentos que já possuem vetores válidos.
* **Write Path (Embedding Workflow):** Determina a situação operacional da criação e atualização de vetores (`EmbeddingWorkflowState`).
  - Governa exclusivamente os banners, o indicador de progresso e a ação contextual.

---

## 5. Correção do Falso `semanticPreparing`

No ficheiro [`src/search/linaSearchView.ts`](file:///d:/_dev/obsidian/lina/src/search/linaSearchView.ts), o método `isSemanticPreparationActive()` inspecionava as fases da cópia binária:
```typescript
// ANTES (INCORRETO):
const binaryMaintenance = this.plugin.getBinaryEmbeddingCopyMaintenanceState();
return binaryMaintenance.phase === "queued" || binaryMaintenance.phase === "building" ...;
```
Esta lógica foi eliminada. A preparação semântica foi redefinida exclusivamente em função do runtime de geração canónica:
```typescript
// DEPOIS (CORRETO):
private isSemanticPreparationActive(): boolean {
    const op = this.plugin.getEmbeddingOperationState();
    return op.status === "running" && (
        op.phase === "preparing" ||
        op.phase === "waiting-for-text-index" ||
        op.phase === "validating"
    );
}
```
As fases derivadas da cópia binária (`queued`, `reading-jsonl`, `building`, `digesting`, `publishing`, `validating`) deixaram de poder produzir falsos `A preparar pesquisa semântica...`.

---

## 6. Correção do Bloqueio `queued` no `BinaryEmbeddingCopyController`

Em [`src/index/embeddingBinaryCopyController.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingBinaryCopyController.ts), o método `runWrite()` definia `phase = "queued"` antes de tentar adquirir o lock de escrita através do `IndexWriteCoordinator`. Caso a manutenção fosse rejeitada (`acquired.status !== "accepted"`), a função fazia `return` antecipado sem restaurar o estado, deixando a fase `queued` indefinidamente ativa.

**Correção aplicada:**
```typescript
if (acquired.status !== "accepted") {
    this.setState({
        phase: "idle",
        progress: null,
        summary: {
            status: "error",
            reason: acquired.reason ?? "Outra escrita do índice está em curso.",
        },
    });
    return;
}
```
O estado transitório `queued` é garantidamente libertado e revertido para `idle` com erro registado caso o lock não seja concedido.

---

## 7. Eliminação dos Canais Concorrentes da Sidebar

Na [`LinaSearchView`](file:///d:/_dev/obsidian/lina/src/search/linaSearchView.ts), o `stateContainer` e o `statusEl` divergiam:
* O `stateContainer` renderizava `sidebarStatusViewModel`.
* O `statusEl` executava `this.setStatus(semanticCompatibility.available ? this.L.stateEmbeddingsReady : ...)` ou mensagens transitórias.

**Resolução:**
O elemento `statusEl` foi integralmente subordinado ao modelo canónico:
- Em estados passivos/estáveis (`IDLE`, `UPDATE_REQUIRED`, `CHECKING`), `statusEl` é limpo (`""`), deixando a comunicação clara e unificada no cartão de estado declarativo (`stateContainer`).
- `statusEl` é reservado apenas para mensagens operacionais ativas ou feedback de erro (`operationState.error`).
- A contradição `Atualização necessária` + `Prontos` foi definitivamente eliminada.

---

## 8. Ação Contextual `Atualizar embeddings`

Foi implementado o botão contextual no cartão de estado da Sidebar ([`src/search/linaSearchView.ts`](file:///d:/_dev/obsidian/lina/src/search/linaSearchView.ts)):

* **Condições estritas de visibilidade:**
  ```typescript
  isAuthorizedProducer === true &&
  workAvailable === true &&
  operationState.status !== "running" &&
  operationState.status !== "cancelling" &&
  textIndexReady === true
  ```
* **Localização:** Imediatamente após `embeddingsLine` no cartão de estado da Sidebar.
* **Label:** `Atualizar embeddings` (ou `Update embeddings` em locale EN).
* **Ação:** Reutilização estrita do fluxo canónico existente:
  ```typescript
  void this.plugin.confirmAndRequestEmbeddingGeneration("sidebar");
  ```
  Preserva confirmação de custo/online, guards de concorrência, cancelamento, checkpoints e publicação transacional.

---

## 9. Testes e Validação Técnica

### 9.1 Novos Testes Automatizados
* [`tests/index/embeddingWorkflowState.test.ts`](file:///d:/_dev/obsidian/lina/tests/index/embeddingWorkflowState.test.ts):
  - Caso 1: Sem drift (`workAvailable = false`) → `IDLE`.
  - Caso 2: Drift pendente em modo manual (`workAvailable = true`) → `UPDATE_REQUIRED` (nunca `PREPARING`).
  - Casos 2b/2c: Drift com índice textual por aprontar ou a verificar.
  - Caso 3: Despacho e confirmação ativa → `PREPARING`, `GENERATING`, `PERSISTING`, `FINALIZING`.
  - Caso 4: Geração concluída → `IDLE`.
  - Caso 5: Erro operacional com mensagem técnica sanitizada → `ERROR`.
  - Caso 6: Cancelamento cooperativo com drift persistente → `CANCELLED` com fallback seguro para `UPDATE_REQUIRED`.
  - Caso 7: Preservação da capacidade de pesquisa durante `UPDATE_REQUIRED`.
* [`tests/search/sidebarEmbeddingWorkflowState.test.ts`](file:///d:/_dev/obsidian/lina/tests/search/sidebarEmbeddingWorkflowState.test.ts):
  - Verifica ausência de mensagens contraditórias (`Prontos` + `Atualização necessária`).
  - Valida renderização do botão `Atualizar embeddings` no cartão de estado apenas sob as condições autorizadas.
  - Valida ausência do botão quando a geração está ativa ou em nós não-produtores.
  - Garante ausência de dependência de `BinaryEmbeddingCopyController` para `semanticPreparing`.
* [`tests/index/embeddingBinaryCopyController.test.ts`](file:///d:/_dev/obsidian/lina/tests/index/embeddingBinaryCopyController.test.ts):
  - Valida que a rejeição do lock de escrita restaura `phase = "idle"` sem reter `queued`.

### 9.2 Resultados das Validações
* `npm test`: 125 ficheiros de teste executados, **1687 testes passados**, 0 falhas.
* `npm run typecheck`: TypeScript sem erros.
* `npm run lint:obsidian:strict`: 0 erros, 0 avisos.
* `npm run build`: Compilação de produção com esbuild concluída sem erros.
* `npm run release-check`: Validações de empacotamento aprovadas.
* `git diff --check`: Sem artefactos nem espaços em branco no final de ficheiros.

---

## 10. Riscos Residuais e Mitigações

| Risco Residual | Gravidade | Mitigação Implementada |
| :--- | :--- | :--- |
| Disparos concorrentes do botão contextual da Sidebar | Baixa | O botão invoca `confirmAndRequestEmbeddingGeneration()`, que possui guardas single-flight no coordenador e no plugin. Além disso, o botão é oculto assim que a operação transita para `running`. |
| Falha tardia de escrita durante a atualização manual | Baixa | A persistência atómica no `EmbeddingStore` preserva checkpoints e efetua rollback seguro, transitando o workflow para `ERROR` sem corromper o índice existente. |
| Invalidação concorrente de ficheiros durante geração | Baixa | O `EmbeddingFreshnessController` mantém o tracking incremental e o planeador avalia o drift restante no final da geração. |

---

## 11. Declaração de Conformidade Arquitetural

Confirma-se expressamente que:
1. **Nenhum** schema de dados persistentes foi alterado;
2. O contrato `VectorContract` permaneceu intacto;
3. `DeviceRuntimeState` permaneceu intacto no seu envelope e tipagem;
4. Não foram criados novos ficheiros de persistência nem fluxos paralelos de geração;
5. A capacidade de pesquisa semântica existente continua estritamente disponível durante drift documental.

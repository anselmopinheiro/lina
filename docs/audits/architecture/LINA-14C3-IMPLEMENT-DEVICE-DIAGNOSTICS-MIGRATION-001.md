# LINA-14C3-IMPLEMENT-DEVICE-DIAGNOSTICS-MIGRATION-001: Relatório de Migração dos Diagnósticos de Dispositivo para o Snapshot Canónico

**Fase:** LINA-14C.3  
**Data:** 2026-09-29  
**Status:** IMPLEMENTAÇÃO CONCLUÍDA / APROVADA  
**Alvo da Fase 14C.3:** `DeviceDiagnostics` (`src/device/deviceDiagnostics.ts`), `DeviceDiagnosticsModal` (`src/device/deviceDiagnosticsModal.ts`), integração no bootstrap em `main.ts` e suíte de testes.

---

## 1. Auditoria e Identificação de Classificações Paralelas

Na auditoria inicial da fase LINA-14C.3, foram identificadas as seguintes áreas onde os diagnósticos de dispositivo ainda recorriam a derivações paralelas baseadas em flags antigas:

| Ponto de Diagnóstico | Origem Legada | Risco / Problema | Substituição Canónica em LINA-14C.3 |
| :--- | :--- | :--- | :--- |
| **Disponibilidade de Pesquisa (`companionSearch.available`)** | `companionState.canConsume` / `runtimeEmbeddings.effectiveMode` | Avaliação inconsistente se o estado de runtime diferir da compatibilidade pura | `lifecycleSnapshot.read.effectiveMode !== "unavailable"` |
| **Modo Operacional (`companionSearch.mode` / `operationalMode`)** | `runtimeEmbeddings.effectiveMode` com fallback triplo | Duplicação de lógica entre runtime, companion state e fallback | `lifecycleSnapshot.read.effectiveMode` |
| **Presença de Trechos de Texto (`textIndexAvailable`)** | `companionState.artifactAvailability.textIndex === "available"` | Desalinhamento com a região upstream do ciclo de vida | `lifecycleSnapshot.upstream.textIndex === "ready" \|\| "stale"` |
| **Presença de Embeddings Declarados / Válidos** | `embeddingsDeclared` via manifest raw | Não refletia o estado formal de compatibilidade vetorial | `lifecycleSnapshot.read.semanticAvailable` e `compatibility.status !== "none"` |
| **Motivo de Incompatibilidade (`operationalReason`)** | `runtimeEmbeddings.reason` ou `semanticCap.reason` | Falta de propagação direta das razões tipadas de identidade | `lifecycleSnapshot.read.compatibility.reasons[0]` |

---

## 2. Implementação e Consumidores Alterados

### 2.1. Modelo Interno de Diagnóstico (`src/device/deviceDiagnostics.ts`)
- Adicionado `lifecycleSnapshot?: EmbeddingLifecycleSnapshot` à interface de snapshot `DeviceDiagnostics`.
- Em `buildDeviceDiagnostics(input)`:
  - `companionSearch.available` passa a refletir diretamente `lifecycleSnapshot.read.effectiveMode !== "unavailable"`.
  - `companionSearch.mode` e `operationalMode` assumem `lifecycleSnapshot.read.effectiveMode`.
  - `operationalSemanticAvailable` assume `lifecycleSnapshot.read.semanticAvailable`.
  - `operationalReason` assume a primeira razão canónica `lifecycleSnapshot.read.compatibility.reasons[0]`.
  - O snapshot puro é anexado diretamente ao resultado (`diagnostics.lifecycleSnapshot`).
- Em `readDeviceDiagnostics`: aceita e propaga `lifecycleSnapshot` em `ReadDeviceDiagnosticsOptions`.

### 2.2. Modal de Diagnóstico de Dispositivo (`src/device/deviceDiagnosticsModal.ts`)
- A secção *Search Capability / Companion Search* prioriza deterministicamente `this.diagnostics.lifecycleSnapshot` para determinar:
  - Prontidão e badge de estado (`isSearchAvailable`);
  - Modo de pesquisa (`effectiveDisplayMode`);
  - Presença de índice textual e vetores publicados (`hasTextIndex`, `hasEmbeddings`);
  - Explicação do motivo de incompatibilidade (`displayReason`).

### 2.3. Ponto de Entrada Principal (`main.ts`)
- Em `getDeviceDiagnostics()`: constrói deterministicamente `lifecycleSnapshot` via `adaptCurrentStateToLifecycleSnapshot` (agregando `deviceRuntimeState`, `workflowState`, `operationState`, `companionState`, `canonicalVectorContract` e `updatePlan`) e injeta-o na leitura de diagnósticos.

---

## 3. Validação dos 9 Cenários Canónicos

A suite de testes [`tests/device/deviceDiagnosticsLifecycleSnapshot.test.ts`](file:///d:/_dev/obsidian/lina/tests/device/deviceDiagnosticsLifecycleSnapshot.test.ts) validou a conformidade dos 9 cenários do ciclo de vida:

1. **Producer com embeddings válidos (READY):** Pesquisa operacional completa (`mode: "full"`, `available: true`), diagnóstico verde e ausência de falsos alarmes de obsolescência por idade.
2. **Producer com atualização pendente (UPDATE_AVAILABLE):** Pesquisa existente permanece totalmente funcional (`operationalSemanticAvailable: true`, `mode: "full"`), assinalando trabalho pendente sem bloquear consultas.
3. **Companion com artefactos válidos:** Pesquisa semântica operacional ativa (`available: true`, `mode: "full"`), com autoridade de escrita estritamente desativada (`write.applicable: false`).
4. **Companion sem artefactos:** Operação segura degradada para modo puramente textual (`mode: "text-only"`, `operationalSemanticAvailable: false`) com zero tentativas de mutação ou geração local.
5. **Vector Contract incompatível (INCOMPATIBLE):** Pesquisa semântica preventivamente bloqueada (`mode: "text-only"`, `operationalSemanticAvailable: false`), apresentando o motivo concreto (`model-mismatch`) sem qualquer fallback silencioso.
6. **Prior epoch válido:** Artefactos de épocas anteriores mantêm-se válidos e pesquisáveis, preservando o histórico de publicação de forma não-destrutiva.
7. **Embeddings inexistentes (INDEX_ONLY):** Índice textual funcional e pesquisa semântica indisponível.
8. **Estado indeterminado (INDETERMINATE):** Situação de ficheiros corrompidos ou ilegíveis reportada com integridade sem quebras de runtime.
9. **Erro operacional (ERROR):** Falhas em operações de geração ou rede registadas e propagadas no histórico para inspeção e retry.

---

## 4. Validação Técnica Completa

Todos os comandos de validação do projeto foram executados com sucesso:

- `npm test` $\to$ **133 ficheiros de teste / 1779 testes aprovados** (100% PASS).
- `npm run typecheck` $\to$ **0 erros** TypeScript (`tsc --noEmit`).
- `npm run lint:obsidian:strict` $\to$ **0 erros e 0 avisos** ESLint.
- `npm run build` $\to$ Build de produção compilada com sucesso.
- `npm run release-check` $\to$ Verificação de ficheiros e manifesto aprovada.
- `git diff --check` $\to$ Sem erros de formatação ou whitespace.

---

## 5. Limitações e Próximos Passos

- **Estritamente Read-Only:** Nenhuma alteração foi realizada na camada de escrita, persistência ou execução de workers.
- **Transição Concluída:** Sidebar, Embedding Status e Device Diagnostics encontram-se agora 100% alinhados sob o mesmo modelo puro canónico (`EmbeddingLifecycleSnapshot`).

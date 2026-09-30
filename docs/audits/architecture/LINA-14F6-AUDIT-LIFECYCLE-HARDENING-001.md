# Auditoria e Validação Arquitetural: Lifecycle Architecture Hardening

**Fase:** LINA-14F.6  
**Data:** 2026-09-30  
**Status:** Concluída com Sucesso / Aprovada  
**Documento:** `LINA-14F6-AUDIT-LIFECYCLE-HARDENING-001.md`  

---

## 1. Sumário Executivo e Objetivos

A fase **LINA-14F.6** estabelece a auditoria e validação arquitetural final da consolidação do ciclo de vida dos embeddings no plugin Lina (série LINA-14). 

O objetivo é auditar e certificar:
1. **Unicidade da Cadeia de Autoridade Canónica:**
   $$\text{Estado Factual} \longrightarrow \text{EmbeddingLifecycleSnapshot} \longrightarrow \text{Decisão Canónica (Write Path)} \longrightarrow \text{Consumidores}$$
2. **Eliminação Integral de Modelos e Heurísticas Paralelas:** Ausência de caminhos alternativos de decisão, estados paralelos ou reconstruções ad-hoc.
3. **Isolamento e Segurança Operacional:** Garantia de que papéis (Producer ativo vs Standby vs Companion), limites de autoridade, fencing de ownership e estados de falha/indeterminados são respeitados uniformemente.
4. **Proteção de Contratos e Estabilidade:** Validação de que contratos de dados, schemas persistidos e a UX do utilizador permanecem íntegros e auditáveis.

---

## 2. Auditoria Estrutural das 5 Dimensões Principais

### 2.1 Fonte Única de Verdade (Single Source of Truth)

- **Unicidade Factual:** O estado do subsistema de embeddings é projectado a partir de factos brutos em memória (`TextIndexStatus`, `DeviceRuntimeState`, `VectorContract`, `EmbeddingUpdatePlan`, `EmbeddingOperationState`, `CompanionArtifactConsumptionState`) exclusivamente através de `adaptCurrentStateToLifecycleSnapshot` / `resolveEmbeddingLifecycle`.
- **Motor de Decisão Único:** Todas as decisões operacionais (se deve gerar, atualizar, reconstruir, repetir, cancelar ou bloquear) são computadas pela função pura e determinística:
  `deriveEmbeddingWritePathDecision(snapshot: EmbeddingLifecycleSnapshot): EmbeddingWritePathDecision`
- **Ausência de Reconstruções:** 
  - `main.ts` centraliza a leitura através de `getEmbeddingLifecycleSnapshot()` e `buildEmbeddingWorkLifecycleSnapshot(...)`.
  - `linaSearchView.ts` recebe o snapshot canónico do plugin e repassa-o aos ViewModels.
  - Não existem instâncias de recálculo ad-hoc de deltas ou contagens fora do `EmbeddingLifecycleSnapshot`.

### 2.2 Mapeamento de Consumidores

| Consumidor | Ponto de Entrada | Uso do Snapshot | Interpretação Direta de Ficheiros |
| :--- | :--- | :--- | :--- |
| **Sidebar View Model** | `buildSidebarStatusViewModel` | Consome `lifecycleSnapshot` para role, frescura, `effectiveMode` de pesquisa e maintenance gating | **Não** (puramente desacoplado) |
| **Search Engine View** | `LinaSearchView` | Consome `plugin.getEmbeddingLifecycleSnapshot()` | **Não** |
| **Capacidade Semântica** | `evaluateSemanticSearchCapability` | Lê `lifecycleSnapshot.read.semanticAvailable` e `.effectiveMode` | **Não** |
| **Diagnostic View Model** | `buildEmbeddingStatusViewModel` | Consome `lifecycleSnapshot` e `deriveEmbeddingWritePathDecision` para renderizar contagens, identidades e ações de UI | **Não** |
| **Policy Engine** | `evaluateEmbeddingUpdatePolicyFromSnapshot` | Avalia `snapshot` + política de automação (manual vs auto-local) | **Não** |
| **Scheduler** | `evaluateSchedulerDecisionFromSnapshot` | Avalia autoridade de agendamento e auto-dispatch via snapshot | **Não** |
| **Operation Manager** | `evaluateOperationStartGate` | Valida permissão de arranque de operação contra o Write Path do snapshot | **Não** |
| **Embedding Worker** | `evaluateOperationDecisionFromSnapshot` | Última barreira pré-execução física consultando o snapshot injetado | **Não** |

*Resultado:* 100% dos consumidores operam sobre a representação canónica. Nenhum consumidor interpreta diretamente artefactos brutos em disco para tomada de decisão operacional.

### 2.3 Contratos e Compatibilidade

- **`EmbeddingLifecycleSnapshot`:**
  - Tipagem estrita e imutável com 6 sub-árvores claras: `primary`, `capability`, `read`, `write`, `process`, `info`, `history`.
  - Invariantes validados formalmente pela suíte `embeddingLifecycleModel.test.ts`.
- **Vector Contract (`VectorContractV1`):**
  - Identidade declarativa persistida com schema versionado (`schemaVersion: 1`).
  - Suporta detecção atómica de divergências de dimensões, provider, modelo, inputVersion e prefixMode.
- **Formato de Embeddings e Armazenamento:**
  - Preservado o formato JSONL canónico em `.lina/embeddings/` e formato binário seguro.
  - Zero alterações a schemas persistidos em disco.

### 2.4 Isolamento Producer vs Companion

- **Active Producer:**
  - `deviceRole === "producer"` e `isActiveProducer === true`.
  - `write.applicable === true`, `capability.canRequestUpdate === true`.
  - Autorizado a executar workers, publicar índices e emitir diagnósticos de escrita.
- **Standby Producer:**
  - `deviceRole === "producer"` mas `isActiveProducer === false`.
  - `write.applicable === false`, `capability.blockedReason === "standby"`.
  - Bloqueado de executar workers ou auto-dispatch; interface exibe aviso de standby.
- **Companion Device:**
  - `deviceRole === "companion"`.
  - `write.applicable === false`, `capability.blockedReason === "companion"`.
  - Estritamente somente-leitura: consome artefactos sincronizados, realiza pesquisas semânticas locais se compatíveis, sem qualquer capacidade de mutação de índices.

### 2.5 Segurança Operacional e Casos Limite

- **Perda de Autoridade durante a Execução (Fencing):**
  - Se um dispositivo perde o papel de produtor durante a geração de embeddings, `decision.ownershipLostDuringOperation === true`. O Worker aborta a persistência imediatamente, evitando corrupção de índices remotos.
- **Estados Indeterminados (`INDETERMINATE`):**
  - Quando os metadados do vault ou do índice textual estão corrompidos ou ilegíveis, o snapshot assume `primary === "INDETERMINATE"`.
  - Write Path bloqueia automaticamente (`action = "none"`, `canExecute = false`), impedindo regenerações destrutivas acidentais sobre índices corrompidos.
- **Operações Destrutivas (Rebuild Completo):**
  - Quando há incompatibilidade de modelos (`primary === "INCOMPATIBLE"`), a ação `rebuild` exige confirmação modal explícita do utilizador (`requiresFullRebuildConfirmation: true`), impedindo auto-dispatch silencioso.

---

## 3. Respostas aos 5 Critérios de Conclusão

1. **Existe uma única fonte de verdade?**
   **SIM.** Todo o estado factual converge exclusivamente para o `EmbeddingLifecycleSnapshot`, e toda a decisão operacional é derivada de `deriveEmbeddingWritePathDecision()`.

2. **Todos os consumidores respeitam o modelo canónico?**
   **SIM.** Sidebar, Search, Diagnostics, Policy Engine, Scheduler, Operation Manager e Worker consomem estritamente o snapshot canónico.

3. **Existem contratos protegidos?**
   **SIM.** `EmbeddingLifecycleSnapshot`, `VectorContractV1`, `EmbeddingWritePathDecision` e os formatos de persistência encontram-se formalmente tipados e cobertos por mais de 147 ficheiros de testes (1938+ testes unitários/integrados).

4. **A arquitetura está preparada para evolução?**
   **SIM.** A separação estrita entre factos, snapshot de estado, decisão de escrita e executores permite adicionar novos providers ou estratégias de chunking sem alterar a orquestração do ciclo de vida.

5. **O legado removível foi identificado?**
   **SIM.** `EmbeddingWorkflowState`, `resolveEmbeddingWorkflowState`, comparadores shadow e helpers temporários foram totalmente removidos do código de produção e de testes.

---

## 4. Dívida Técnica Restante e Recomendações

1. **Pontos Fortes Consolidados:**
   - Previsibilidade determinística de 100% dos estados de embeddings.
   - Isolamento seguro e comprovado entre Producer e Companion.
   - Robustez contra concorrência e perda de autoridade.

2. **Recomendações para Fases Futuras:**
   - Preservar os testes de matriz de cenários (`embeddingLifecycleShadowValidation.test.ts`) como testes de regressão permanentes.
   - Manter a regra de governança de nunca permitir que componentes de UI ou controllers recalculem heurísticas de prontidão ad-hoc.

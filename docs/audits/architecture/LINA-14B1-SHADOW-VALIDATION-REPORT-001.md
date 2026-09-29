# LINA-14B1-SHADOW-VALIDATION-REPORT-001: Relatório de Validação em Shadow Mode do Modelo Canónico de Ciclo de Vida dos Embeddings

**Fase:** LINA-14B.1  
**Data:** 2026-09-29  
**Status:** APROVADO / SEM BLOQUEIOS ARQUITETURAIS  
**Contexto:** Validação observacional pura do modelo canónico `EmbeddingLifecycleSnapshot` vs. estados legados heterogéneos antes da migração de consumidores.

---

## 1. Resumo Executivo

A fase **LINA-14B.1** executou a validação sistemática em **Shadow Mode** do modelo puro e canónico [`EmbeddingLifecycleSnapshot`](file:///d:/_dev/obsidian/lina/src/index/embeddingLifecycleModel.ts) em relação a todas as fontes de verdade de estado existentes no Lina (`DeviceRuntimeState`, `EmbeddingWorkflowState`, `EmbeddingUpdatePlan`, `VectorContractV1`, `ProducerStateV1` e `CompanionArtifactConsumptionState`).

A validação incidiu sobre os **10 cenários canónicos** do ciclo de vida dos embeddings e submeteu o snapshot às verificações cruzadas de invariantes arquiteturais (I1 a I15).

### Principais Conclusões:
1. **Zero Problemas Arquiteturais:** Nenhuma contradição lógica, fuga de mutação, degradação de segurança ou perda de informação foi detetada.
2. **Separação Canónica Efetiva (C1 / C2 / C3):** O modelo puro resolve formalmente a separação entre:
   - **Read Path (Pesquisa Semântica):** Disponibilidade imediata baseada na existência física e compatibilidade estrita do contrato (`read.semanticAvailable`).
   - **Write Path (Manutenção de Embeddings):** Deteção de desfasamento e necessidade de rebuild (`write.updateRequired`), estritamente condicionada à aplicabilidade de escrita do dispositivo (`write.applicable`).
   - **Process Path (Progresso Operacional):** Rastreio determinístico da operação ativa com cancelabilidade explícita.
3. **Isolamento Estrito do Companion:** Dispositivos com `effectiveRole: "companion"` mantêm `write.applicable = false` e `capability.canRequestUpdate = false` em todos os cenários, permitindo leitura semântica segura sem qualquer possibilidade de escrita ou geração local.
4. **Proteção Contra Falso READY:** Nenhuma condição com trabalho pendente no produtor ativo gera `primary: "READY"`; o estado é estritamente promovido a `UPDATE_AVAILABLE`.
5. **Decisão:** O modelo encontra-se validado, robusto e **aprovado para avanço para a fase LINA-14C** (Migração Gradual de Consumidores).

---

## 2. Matriz de Cenários e Comparação Shadow

| # | Cenário | Estado Legado | Snapshot Canónico (`EmbeddingLifecycleSnapshot`) | Diferenças Observadas | Classificação |
|---|---|---|---|---|---|
| **1** | **Vault novo sem índice nem embeddings** | `workflowStatus: "idle"`<br>`semanticAvailable: false`<br>`workAvailable: false` | `primary: "NO_TEXT_INDEX"`<br>`read.effectiveMode: "unavailable"`<br>`read.semanticAvailable: false`<br>`write.applicable: true`<br>`capability.canRequestUpdate: false`<br>`capability.blockedReason: "text-index-not-ready"` | O modelo legado indicava genericamente `idle`; o modelo canónico diagnostica explicitamente a falta do índice upstream antes de avaliar embeddings. | **Esperada** (Refinamento de precisão) |
| **2** | **Índice textual criado sem embeddings** | `workflowStatus: "idle"`<br>`semanticAvailable: false`<br>`workAvailable: true` | `primary: "INDEX_ONLY"`<br>`read.effectiveMode: "text-only"`<br>`read.semanticAvailable: false`<br>`write.applicable: true`<br>`write.updateRequired: true` (`initial-build`)<br>`capability.canRequestUpdate: true` | O modelo canónico clarifica a prontidão imediata de pesquisa textual semântica (`INDEX_ONLY`) e sinaliza a necessidade de construção inicial. | **Esperada** (Classificação clara de prontidão) |
| **3** | **Embeddings válidos e sincronizados** | `workflowStatus: "idle"`<br>`semanticAvailable: true`<br>`workAvailable: false` | `primary: "READY"`<br>`read.effectiveMode: "full"`<br>`read.semanticAvailable: true`<br>`write.applicable: true`<br>`write.updateRequired: false`<br>`write.work.kind: "none"` | Paridade exata em todas as dimensões de leitura, escrita e estado primário. | **Inexistente** (Paridade total) |
| **4** | **Notas alteradas sem regeneração** | `workflowStatus: "update-required"`<br>`semanticAvailable: true`<br>`workAvailable: true` | `primary: "UPDATE_AVAILABLE"`<br>`read.effectiveMode: "full"`<br>`read.semanticAvailable: true`<br>`write.applicable: true`<br>`write.updateRequired: true` (`incremental`)<br>`capability.canRequestUpdate: true` | Paridade exata. A pesquisa semântica permanece ativa sobre os vectores existentes enquanto a atualização incremental é requerida. | **Inexistente** (Paridade total) |
| **5** | **Alteração de provider de IA** | `workflowStatus: "idle"`<br>`semanticAvailable: false`<br>`workAvailable: true` | `primary: "INCOMPATIBLE"`<br>`read.effectiveMode: "text-only"`<br>`read.semanticAvailable: false`<br>`read.compatibility.status: "incompatible"`<br>`read.compatibility.reasons: ["provider-mismatch"]`<br>`write.applicable: true`<br>`write.updateRequired: true` (`full-rebuild`) | O modelo legado misturava erro de contrato em flags genéricas; o snapshot isola a incompatibilidade com motivos formais e bloqueia a pesquisa semântica. | **Esperada** (Diagnóstico tipado e explícito) |
| **6** | **Alteração de modelo de embedding** | `workflowStatus: "idle"`<br>`semanticAvailable: false`<br>`workAvailable: true` | `primary: "INCOMPATIBLE"`<br>`read.effectiveMode: "text-only"`<br>`read.semanticAvailable: false`<br>`read.compatibility.status: "incompatible"`<br>`read.compatibility.reasons: ["model-mismatch"]`<br>`write.applicable: true`<br>`write.updateRequired: true` (`full-rebuild`) | Idem ao cenário 5: o modelo protege contra o uso de vectores com dimensões/espaço vetorial desfasado. | **Esperada** (Segurança contra contaminação vetorial) |
| **7** | **Dispositivo Companion** | `workflowStatus: "update-required"` (ou `idle`)<br>`semanticAvailable: true`<br>`workAvailable: true` (se notas sincronizadas) | `primary: "READY"`<br>`read.effectiveMode: "full"`<br>`read.semanticAvailable: true`<br>`write.applicable: false`<br>`write.updateRequired: false`<br>`capability.canRequestUpdate: false`<br>`capability.blockedReason: "companion"` | O modelo legado podia assinalar `workAvailable: true` devido ao cálculo local de diff de notas no Companion. O modelo canónico impõe a regra arquitetural C1 (`write.applicable = false`). | **Informativa** (Resolução formal da decisão C1) |
| **8** | **Producer sem ownership (Standby)** | `workflowStatus: "idle"`<br>`semanticAvailable: true`<br>`isActiveProducer: false` | `primary: "STANDBY"`<br>`read.effectiveMode: "full"`<br>`read.semanticAvailable: true`<br>`write.applicable: false`<br>`write.updateRequired: false`<br>`capability.canRequestUpdate: false`<br>`capability.blockedReason: "standby"` | O modelo legado dependia de gates imperativos na tentativa de execução; o snapshot declara proativamente a impossibilidade de escrita no estado de standby. | **Esperada** (Proatividade do contrato de ownership) |
| **9** | **Operação de geração em curso** | `workflowStatus: "generating"`<br>`isGenerating: true`<br>`processedChunks: 45 / 100` | `primary: "UPDATING"`<br>`process.phase: "generating"`<br>`process.progress: { processed: 45, total: 100 }`<br>`process.cancellable: true`<br>`capability.canRequestUpdate: false`<br>`capability.blockedReason: "operation-active"` | Paridade estrita de estado de progresso com granularidade de fase e cancelabilidade cooperativa. | **Inexistente** (Paridade total) |
| **10** | **Erro operacional de provider** | `workflowStatus: "error"`<br>`error: "Ollama timeout"` | `primary: "ERROR"`<br>`history.lastOperation: { kind: "failed", message: "..." }`<br>`capability.canRequestUpdate: true`<br>`write.applicable: true` | Paridade estrita, permitindo nova tentativa de recuperação sem bloquear a interface. | **Inexistente** (Paridade total) |

---

## 3. Análise Detalhada das Divergências

### 3.1. Divergências Informativas (C1: Isolamento Companion)
* **Observação:** Em dispositivos móveis ou companions onde o vault sincronizou novas notas de texto, o diff local identificava ficheiros pendentes de vetorização (`workAvailable = true`). No entanto, o runtime Companion está proibido de gerar embeddings.
* **Comportamento no Snapshot:** O snapshot canónico força `write.applicable = false`, o que anula `write.updateRequired` para o dispositivo, mantendo a pesquisa semântica ativa (`READY` / `effectiveMode: "full"`) sobre os embeddings publicados pelo Producer.
* **Impacto:** Positivo. Elimina falsos alertas de atualização em dispositivos Companion.

### 3.2. Divergências Esperadas (Precisão Diagnóstica: NO_TEXT_INDEX, INDEX_ONLY, INCOMPATIBLE, STANDBY)
* **Observação:** O modelo legado de `EmbeddingWorkflowState` colapsava quase todos os estados passivos em `status: "idle"`.
* **Comportamento no Snapshot:** O snapshot canónico atribui estados primários inequívocos de alta fidelidade (`NO_TEXT_INDEX`, `INDEX_ONLY`, `INCOMPATIBLE`, `STANDBY`), mantendo as regiões ortogonais (`read`, `write`, `process`) transparentes.
* **Impacto:** Positivo. Facilita a migração da UI e de diagnósticos sem inferências ad-hoc.

### 3.3. Problemas Arquiteturais
* **Total Encontrado:** 0 (zero).

---

## 4. Auditoria de Invariantes e Verificações de Segurança

| Verificação Arquitetural | Critério de Aceitação | Resultado em Shadow Mode |
|---|---|---|
| **READY com trabalho pendente** | `primary === "READY"` **nunca** pode ocorrer se `write.applicable && write.work.kind !== "none"`. | **APROVADO** (100% de conformidade; promove a `UPDATE_AVAILABLE`). |
| **Companion com capacidade de escrita** | Dispositivo `companion` **nunca** pode ter `write.applicable = true` ou `canRequestUpdate = true`. | **APROVADO** (100% isolado). |
| **INCOMPATIBLE com pesquisa ativa** | Estado `INCOMPATIBLE` **nunca** pode permitir `read.semanticAvailable = true` ou `read.effectiveMode = "full"`. | **APROVADO** (Pesquisa semântica estritamente bloqueada). |
| **UPDATE_AVAILABLE sem motivo** | `primary === "UPDATE_AVAILABLE"` **nunca** ocorre sem razões explícitas no `workAssessment`. | **APROVADO** (Exige `pending` e razões estruturadas). |
| **Perda de informação histórica** | Sucessos e falhas anteriores devem ser preservados nas regiões `history` e `info`. | **APROVADO** (Preservação integral). |
| **Ambiguidade de estados** | Apenas um `primary` status determinístico por combinação de entradas. | **APROVADO** (Resolução pura e determinística). |

---

## 5. Riscos Identificados e Mitigações para LINA-14C

| Risco Identificado | Severidade | Mitigação Arquitetural Implementada |
|---|---|---|
| Consumidores legados lerem campos antigos desfasados durante a transição | Média | O adapter `embeddingLifecycleAdapter.ts` fornece uma ponte unificada. A migração na fase LINA-14C será feita consumidor a consumidor, mantendo o adapter como orquestrador. |
| Invalidação de cache de pesquisa semântica durante transição de estado | Baixa | `read.semanticAvailable` depende exclusivamente de existência física e compatibilidade do contrato vetorial, não sofrendo com oscilações de UI. |
| Divergência na ordenação de apresentação da Sidebar | Baixa | A Sidebar deverá subscrever o `EmbeddingLifecycleSnapshot` diretamente, utilizando `primary` e `write.work` de forma declarativa. |

---

## 6. Recomendações Técnicas

1. **Reutilização Integral do Snapshot:** Na fase LINA-14C, substituir as chamadas manuais espalhadas nos controladores pelo consumo do `EmbeddingLifecycleSnapshot`.
2. **Manutenção da Pureza:** O módulo `src/index/embeddingLifecycleModel.ts` deve permanecer estritamente puro (sem dependências Obsidian ou I/O).
3. **Padrão de Invalidação Reativo:** O cálculo do snapshot deve continuar lazy ou desencadeado por eventos específicos de alteração do vault, publicação de embeddings ou troca de dispositivo.

---

## 7. Decisão Formal para LINA-14C

O modelo canónico [`EmbeddingLifecycleSnapshot`](file:///d:/_dev/obsidian/lina/src/index/embeddingLifecycleModel.ts) e o seu adapter [`embeddingLifecycleAdapter.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingLifecycleAdapter.ts) demonstraram estabilidade, determinismo, conformidade rigorosa com os contratos arquiteturais e ausência de efeitos colaterais.

**Decisão:** **AUTORIZADO O AVANÇO PARA A FASE LINA-14C (Migração de Consumidores).**

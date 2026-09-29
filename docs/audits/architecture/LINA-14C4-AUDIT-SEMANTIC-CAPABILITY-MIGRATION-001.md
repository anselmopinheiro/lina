# LINA-14C.4 — Auditoria da Migração da Capacidade Semântica para o EmbeddingLifecycleSnapshot

**Data:** 2026-09-29  
**Fase:** LINA-14C.4  
**Autor:** Arquiteto de Software Sénior & Engenheiro TypeScript/Obsidian Plugin  
**Estado:** Concluído / Pronto para Implementação  

---

## 1. Contexto e Enquadramento

Na sequência das fases LINA-14A (Modelo Puro), LINA-14B (Adapter Shadow), LINA-14B.1 (Validação de Cenários), LINA-14C.1 (Sidebar), LINA-14C.2 (Diagnósticos de Embeddings) e LINA-14C.3 (Diagnósticos de Dispositivo), esta fase aborda a migração do módulo `src/search/semanticCapability.ts`.

O objetivo fundamental é **eliminar avaliações paralelas de prontidão da pesquisa semântica**, garantindo que a pergunta *"Está disponível a pesquisa semântica e em que modo operacional?"* é respondida exclusivamente com base na semântica canónica de leitura do `EmbeddingLifecycleSnapshot`.

---

## 2. Auditoria do Estado Atual

### 2.1. O Módulo `src/search/semanticCapability.ts`
O módulo expõe:
- `SemanticOperationalReasonCode`: códigos de motivo de indisponibilidade (`vector-file-missing`, `model-incompatible`, `provider-unreachable`, `no-contract`, etc.).
- `SemanticCapabilityState`:
  - `artifactState`: `{ textIndex, embeddingsDeclared, vectorFile }`
  - `contractState`: `"compatible" | "mismatch" | "none"`
  - `runtimeState`: `"ready" | "checking" | "unavailable"`
  - `semanticAvailable`: `boolean`
  - `effectiveMode`: `"full" | "text-only" | "unavailable"`
  - `reasonCode?`: `SemanticOperationalReasonCode`
  - `reason?`: `string`
- `evaluateSemanticCapability(input: EvaluateSemanticCapabilityInput)`: função pura que sintetiza a disponibilidade semântica com base em flags ad-hoc (`textIndexAvailable`, `embeddingsDeclaredInManifest`, `vectorContractState`, `semanticCompatibility`, `isChecking`, `providerReachable`).

### 2.2. Consumidores Identificados

1. **`src/device/deviceRuntimeState.ts` (`resolveDeviceRuntimeState`)**:
   - Invoca `evaluateSemanticCapability` para preencher `DeviceRuntimeState.embeddings` (`semanticAvailable`, `effectiveMode`, `contractState`, `readiness`, `reasonCode`, `reason`).
2. **`src/device/deviceDiagnostics.ts` (`buildDeviceDiagnostics`)**:
   - Invoca `evaluateSemanticCapability` para compor `companionSearchSection.semanticCapability` e preencher os atributos de diagnóstico de pesquisa.
3. **Suíte de Testes**:
   - `tests/search/semanticAvailabilityDiagnosticsAlignment.test.ts` (testa alinhamento e consistência).

---

## 3. Duplicações e Riscos Identificados

### 3.1. Duplicação Semântica
- `EmbeddingLifecycleSnapshot.read` já calcula formalmente e de forma pura:
  - `read.semanticAvailable`: `true` para `READY` e `UPDATE_AVAILABLE`; `false` para `INDEX_ONLY`, `INCOMPATIBLE`, `DISABLED`, `NO_TEXT_INDEX`, etc.
  - `read.effectiveMode`: `"full" | "text-only" | "unavailable"`.
  - `read.compatibility`: `{ status, reasons, published, device }`.
  - `read.source`: `"jsonl" | "binary" | "none"`.
- O algoritmo interno legado de `evaluateSemanticCapability` calcula estas mesmas decisões através de cascatas `if-else` sobre flags booleanas soltas, correndo o risco de divergir (e.g. em cenários de `UPDATE_AVAILABLE`, onde embeddings antigos continuam válidos para leitura, ou na classificação detalhada de incompatibilidades contratuais).

### 3.2. Riscos de Migração
1. **Quebra de Contratos Existentes**: Se a assinatura ou os tipos retornados por `evaluateSemanticCapability` mudarem bruscamente, testes ou chamadores legados podem falhar.
2. **Perda de Zero Silent Fallback**: Qualquer regressão que silencie erros de contrato vetorial ou permita fallback silencioso violaria as regras de arquitetura.
3. **Isolamento Companion vs Producer**: Dispositivos Companion não podem ser impactados com tarefas ou diagnósticos de escrita.

---

## 4. Plano de Implementação

1. **Estender `EvaluateSemanticCapabilityInput`**:
   - Adicionar o campo opcional `lifecycleSnapshot?: EmbeddingLifecycleSnapshot | null`.
2. **Evoluir `evaluateSemanticCapability`**:
   - Quando `input.lifecycleSnapshot` for fornecido, derivar deterministicamente `SemanticCapabilityState` diretamente do snapshot:
     - `semanticAvailable` = `snapshot.read.semanticAvailable`
     - `effectiveMode` = `snapshot.read.effectiveMode`
     - `contractState` = `"compatible"` | `"mismatch"` | `"none"` mapeado de `snapshot.read.compatibility.status`
     - `runtimeState` = `"checking"` (se `VERIFYING` ou checking ativo), `"ready"` (se `semanticAvailable`), ou `"unavailable"`
     - `artifactState` = inferido do snapshot (`textIndex`, `embeddingsDeclared`, `vectorFile`)
     - `reasonCode` e `reason` = mapeados dos motivos canónicos do snapshot (`reasons`, `reasonCode`, `reason`, `operationalError`)
   - Quando `input.lifecycleSnapshot` não estiver presente, manter o caminho legado como fallback seguro e controlado para total retrocompatibilidade.
3. **Propagar Snapshot**:
   - Permitir passagem de `lifecycleSnapshot` em `ResolveDeviceRuntimeStateInput` (`deviceRuntimeState.ts`) e garantir o seu encaminhamento para `evaluateSemanticCapability`.
4. **Criar Suíte de Testes Dedicada**:
   - `tests/search/semanticCapabilityLifecycleSnapshot.test.ts` cobrindo integralmente os 9 cenários canónicos.

---

## 5. Matriz de Cenários e Comportamento Canónico

| Cenário | `status` | `semanticAvailable` | `effectiveMode` | `contractState` | `reasonCode` |
|---|---|---|---|---|---|
| **1. READY** | `READY` | `true` | `"full"` | `"compatible"` | `undefined` |
| **2. UPDATE_AVAILABLE** | `UPDATE_AVAILABLE` | `true` | `"full"` | `"compatible"` | `undefined` |
| **3. INDEX_ONLY** | `INDEX_ONLY` | `false` | `"text-only"` | `"none"` | `"vector-file-missing"` |
| **4. INCOMPATIBLE (Provider)** | `INCOMPATIBLE` | `false` | `"text-only"` | `"mismatch"` | `"model-incompatible"` |
| **5. INCOMPATIBLE (Model)** | `INCOMPATIBLE` | `false` | `"text-only"` | `"mismatch"` | `"model-incompatible"` |
| **6. Companion** | `READY` / `UPDATE_AVAILABLE` | `true` (se artefactos válidos) | `"full"` / `"text-only"` | `"compatible"` / `"none"` | Depende dos artefactos |
| **7. Standby Producer** | `READY` | `true` (leitura operacional) | `"full"` | `"compatible"` | `undefined` |
| **8. ERROR / Operational** | `ERROR` | `false` | `"text-only"` / `"unavailable"` | `"compatible"` / `"none"` | Código de erro mapeado |
| **9. Fallback sem Snapshot** | N/A | Avaliação determinística legacy | Conforme flags de entrada | Conforme flags de entrada | Mapeado |

---

## 6. Conclusão da Auditoria
A migração é viável, pura, sem efeitos secundários, preserva a compatibilidade existente e garante que toda a cadeia de leitura (Sidebar, Diagnósticos e Capacidade Semântica) partilha exatamente o mesmo modelo canónico `EmbeddingLifecycleSnapshot`.

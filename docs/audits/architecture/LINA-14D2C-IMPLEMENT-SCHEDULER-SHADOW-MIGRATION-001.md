# LINA-14D.2-C — Relatório de Implementação da Shadow Migration do Scheduler

**Data:** 2026-09-30  
**Fase:** LINA-14D.2-C  
**Autor:** Arquiteto de Software Sénior & Engenheiro TypeScript/Obsidian Plugin  
**Estado:** Concluído com Sucesso  

---

## 1. Sumário Executivo

A fase **LINA-14D.2-C** executou a migração shadow do [`EmbeddingScheduler`](file:///d:/_dev/obsidian/lina/src/maintenance/embeddingScheduler.ts) para o modelo canónico [`EmbeddingLifecycleSnapshot`](file:///d:/_dev/obsidian/lina/src/index/embeddingLifecycleModel.ts) e a decisão derivada [`deriveEmbeddingWritePathDecision()`](file:///d:/_dev/obsidian/lina/src/index/embeddingLifecycleWritePath.ts), respeitando rigorosamente os limites de não-interferência comportamental em produção:

- **Zero alteração de comportamento operacional:** O loop de agendamento em produção, temporizadores, debounce de quiet period (30s), maximum delay (300s), backoff exponencial e despacho assíncrono permaneceram 100% intactos.
- **Camada Shadow Pura:** Foram introduzidas tipagens e funções puras de avaliação e comparação determinística (`evaluateLegacySchedulerDecision`, `evaluateSchedulerDecisionFromSnapshot` e `compareSchedulerDecision`).
- **Classificação Estrita de Divergências:** Todas as diferenças são categorizadas de forma transparente em `expected`, `informative` e `divergence`.
- **Cobertura de Testes Dedicada:** Criada a suite [`tests/maintenance/embeddingSchedulerLifecycle.test.ts`](file:///d:/_dev/obsidian/lina/tests/maintenance/embeddingSchedulerLifecycle.test.ts) cobrindo todos os 10 cenários obrigatórios estipulados na especificação.

---

## 2. Implementação Técnica

### 2.1 Tipos e Interfaces Shadow Adicionados
No módulo [`src/maintenance/embeddingScheduler.ts`](file:///d:/_dev/obsidian/lina/src/maintenance/embeddingScheduler.ts):

- `SchedulerEligibilityDecision`:
  - `shouldSchedule: boolean` (autorização de arranque/agendamento do scheduler)
  - `canDispatch: boolean` (autorização de despacho automático imediato)
  - `hasWork: boolean` (presença de trabalho pendente de embeddings)
  - `action: EmbeddingWriteAction` (`"none" | "generate" | "update" | "rebuild" | "cancel" | "retry"`)
  - `requiresConfirmation: boolean` (exigência de confirmação modal explícita)
  - `reason: string` (motivo descritivo tipado)
  - `decision?: EmbeddingWritePathDecision` (decisão canónica completa do Write Path)
- `LegacySchedulerDecisionInputs`: inputs de referência para avaliação das regras legadas do host.
- `SchedulerDifference` e `SchedulerComparisonResult`: modelo determinístico de diagnóstico comparativo com áreas (`authority`, `dispatch`, `work`, `action`, `confirmation`, `primary`) e severidades (`expected`, `informative`, `divergence`).

### 2.2 Avaliação Canónica (`evaluateSchedulerDecisionFromSnapshot`)
A decisão canónica do scheduler é derivada puramente do snapshot e da política de atualização:
1. `shouldSchedule = decision.applicable && decision.blockedReason === undefined && !isIndeterminate`;
2. `hasWork = decision.updateRequired || (decision.workKind === "pending" && decision.action !== "none")`;
3. `canDispatch = shouldSchedule && policyDecision.allowed && !policyDecision.requiresConfirmation && decision.canExecute && decision.cost === "local" && !decision.requiresConfirmation && (decision.action === "update" || decision.action === "generate")`;
4. `requiresConfirmation = decision.requiresConfirmation || policyDecision.requiresConfirmation`.

### 2.3 Comparador de Paridade (`compareSchedulerDecision`)
Compara a decisão legada contra a decisão canónica e categoriza eventuais desvios:
- Bloqueios em Companion, Standby, Unassigned, perda de ownership e Incompatibilidade de modelo são classificados como `expected`.
- Diferenças puramente textuais de ação ou razão são classificadas como `informative`.
- Qualquer discrepância não justificada em modo produtor operacional seria reportada como `divergence` (`hasRealDivergence: true`).

---

## 3. Validação dos 10 Cenários Obrigatórios

Na suite [`tests/maintenance/embeddingSchedulerLifecycle.test.ts`](file:///d:/_dev/obsidian/lina/tests/maintenance/embeddingSchedulerLifecycle.test.ts):

| Cenário | Estado Canónico | Resultado da Avaliação Shadow | Estado do Teste |
|---|---|---|---|
| **1. Sem Trabalho (READY)** | `READY` | `shouldSchedule: true`, `canDispatch: false`, `hasWork: false`, `action: "none"`, `reason: "no-work"` | Aprovado |
| **2. UPDATE_AVAILABLE** | `UPDATE_AVAILABLE` | Local Ollama auto: `canDispatch: true`, `hasWork: true`, `action: "update"`. Manual/External: `canDispatch: false`, `requiresConfirmation: true`. | Aprovado |
| **3. INDEX_ONLY** | `INDEX_ONLY` | Build inicial reconhecido: `shouldSchedule: true`, `canDispatch: true` (se auto-local), `action: "generate"`. | Aprovado |
| **4. INCOMPATIBLE** | `INCOMPATIBLE` | `canDispatch: false`, `requiresConfirmation: true`, `action: "rebuild"`, `reason: "incompatible-rebuild-required"`. | Aprovado |
| **5. ERROR** | `ERROR` | `canDispatch: false`, `action: "retry"`, `requiresConfirmation: true`, `reason: "error-retry-required"`. | Aprovado |
| **6. Companion** | `COMPANION` | `shouldSchedule: false`, `canDispatch: false`, `hasWork: false`, `action: "none"`, `reason: "blocked-companion"`. | Aprovado |
| **7. Standby** | `STANDBY` | `shouldSchedule: false`, `canDispatch: false`, `hasWork: false`, `action: "none"`, `reason: "blocked-standby"`. | Aprovado |
| **8. INDETERMINATE** | `INDETERMINATE` | `shouldSchedule: false`, `canDispatch: false`, `hasWork: false`, `action: "none"`, `reason: "indeterminate-state-blocked"`. | Aprovado |
| **9. Perda de Ownership** | `UNASSIGNED` | `shouldSchedule: false`, `canDispatch: false`, `hasWork: false`, `action: "none"`, `reason: "blocked-unassigned"`. | Aprovado |
| **10. Divergência Legado vs Canónico** | `INCOMPATIBLE` | Diferença detetada, categorizada como `expected` devido ao bloqueio estrito de rebuild, sem divergência real descontrolada. | Aprovado |

---

## 4. Resultados da Validação Global

- **Suíte Vitest:** 138 ficheiros / 1854 testes aprovados (100% verde);
- **Typecheck (`tsc --noEmit`):** 0 erros;
- **Linter Obsidian Strict:** 0 erros bloqueantes de runtime;
- **Build (`esbuild`):** compilação com sucesso;
- **Release Check:** verificação concluída.

---

## 5. Próximos Passos (Roadmap LINA-14D)

Com as subfases 14D.2-A, 14D.2-B e 14D.2-C concluídas:
- Todos os consumidores da família 14D.2 (`EmbeddingWorkStatusController`, `EmbeddingPolicyEngine`, `EmbeddingScheduler`) dispõem de ferramentas consolidadas de lifecycle e shadow migration.
- A próxima subfase é **LINA-14D.3 — Sidebar Button & Manual Triggers Migration**.

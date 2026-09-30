# Relatório de Implementação: Injeção de Snapshot Canónico no EmbeddingWorker (LINA-14F.4-B4.0-B)

**Data:** 2026-09-30  
**Fase:** LINA-14F.4-B4.0-B  
**Alvo:** `src/maintenance/embeddingWorker.ts`, `main.ts` (`getMaintenanceEngine`)

---

## 1. Resumo Executivo

A fase **LINA-14F.4-B4.0-B** consolidou o `EmbeddingWorker` como a última barreira de validação e segurança antes da execução física de manutenção e geração de embeddings.

Anteriormente, o `EmbeddingWorker` possuía infraestrutura interna de validação de snapshot via `evaluateOperationDecisionFromSnapshot(snapshot)` e a opção `getLifecycleSnapshot?: () => EmbeddingLifecycleSnapshot`, mas na instanciação em produção (`main.ts:getMaintenanceEngine`) a porta `getLifecycleSnapshot` não estava a ser fornecida, deixando a validação dependente apenas dos ports de fallback legados (`capabilities`, `canPublish`).

Nesta fase:
1. Adicionou-se o método auxiliar `getEmbeddingLifecycleSnapshot(): EmbeddingLifecycleSnapshot` ao `LinaPlugin` em `main.ts`.
2. Injetou-se a porta `getLifecycleSnapshot: () => this.getEmbeddingLifecycleSnapshot()` na instanciação do `EmbeddingWorker` em `getMaintenanceEngine()`.
3. Protegeu-se o acesso a `secretStorage` com optional chaining em `getEffectiveEmbeddingApiKey`.
4. Criou-se a suite de testes de caracterização `tests/maintenance/embeddingWorkerSnapshotInjection.test.ts` cobrindo todos os cenários canónicos.

---

## 2. Cenários Validados

A nova suite `tests/maintenance/embeddingWorkerSnapshotInjection.test.ts` e a suite de regressão cobrem:

| Cenário | Estado Canónico | Comportamento no Worker | Resultado |
|---|---|---|---|
| **1. Producer Ativo (READY)** | `READY`, `action: "none"` | `evaluateCanonicalDecision()` reporta `canStart=false` e `reason="no-work-pending"`. | Aprovado |
| **1. Producer Ativo (UPDATE_AVAILABLE)** | `UPDATE_AVAILABLE`, `action: "update"` | `evaluateCanonicalDecision()` reporta `canStart=true`, execução manual autorizada. | Aprovado |
| **1. Producer Ativo (INDEX_ONLY)** | `INDEX_ONLY`, `action: "generate"` | `evaluateCanonicalDecision()` reporta `canStart=true`, geração inicial autorizada. | Aprovado |
| **2. Companion Isolation** | `deviceRole: "companion"`, `blockedReason: "companion"` | Bloqueia categoricamente com `not-capable` tanto pedidos manuais como automáticos. | Aprovado |
| **3. Standby Producer** | `deviceRole: "producer"`, `isActiveProducer: false` | Bloqueia com `not-active-producer` sem afetar as réplicas locais. | Aprovado |
| **4. Perda de Ownership** | Autoridade revogada durante operação ativa | Deteta `ownershipLostDuringOperation=true` e rejeita execução com `not-active-producer`. | Aprovado |
| **5. Incompatibilidade / Rebuild** | `INCOMPATIBLE`, `action: "rebuild"` | `requiresConfirmation=true`; bloqueia auto-dispatch (`not-capable`); autoriza pedido manual. | Aprovado |

---

## 3. Ficheiros Modificados

1. [`main.ts`](file:///d:/_dev/obsidian/lina/main.ts):
   - Importado `EmbeddingLifecycleSnapshot`.
   - Adicionado `getEmbeddingLifecycleSnapshot(): EmbeddingLifecycleSnapshot`.
   - Injetado `getLifecycleSnapshot` na inicialização do `EmbeddingWorker`.
   - Protegido `this.app?.secretStorage` em `getEffectiveEmbeddingApiKey`.
2. [`tests/maintenance/embeddingWorkerSnapshotInjection.test.ts`](file:///d:/_dev/obsidian/lina/tests/maintenance/embeddingWorkerSnapshotInjection.test.ts):
   - Nova suite de testes de caracterização para injeção de snapshot no `EmbeddingWorker`.
3. [`docs/audits/architecture/LINA-14F4-B4.0-B-AUDIT-WORKER-SNAPSHOT-INJECTION-001.md`](file:///d:/_dev/obsidian/lina/docs/audits/architecture/LINA-14F4-B4.0-B-AUDIT-WORKER-SNAPSHOT-INJECTION-001.md):
   - Documento de auditoria pré-implementação.

---

## 4. Quality Gates

- `npm test`: 141 ficheiros / 1875 testes aprovados (100%).
- `npm run typecheck`: Sucesso sem erros.
- `npm run lint:obsidian:strict`: 0 erros, 0 avisos.
- `npm run build`: Sucesso (bundle production gerado).
- `npm run release-check`: READY FOR OBSIDIAN RELEASE.
- `git diff --check`: Limpo sem erros de formatação.

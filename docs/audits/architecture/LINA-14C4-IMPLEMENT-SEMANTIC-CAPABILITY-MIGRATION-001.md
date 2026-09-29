# LINA-14C.4 — Implementação da Migração da Capacidade Semântica para o EmbeddingLifecycleSnapshot

**Data:** 2026-09-29  
**Fase:** LINA-14C.4  
**Autor:** Arquiteto de Software Sénior & Engenheiro TypeScript/Obsidian Plugin  
**Estado:** Concluído / Aprovado  

---

## 1. Resumo Executivo

A fase **LINA-14C.4** concluiu a migração do módulo `src/search/semanticCapability.ts` e de toda a avaliação de prontidão semântica para o modelo canónico [`EmbeddingLifecycleSnapshot`](file:///d:/_dev/obsidian/lina/src/index/embeddingLifecycleModel.ts).

Com esta alteração, todas as superfícies READ do plugin (Sidebar, Diagnósticos de Embeddings, Diagnósticos de Dispositivo e Avaliação de Capacidade Semântica) consomem a mesma fonte de verdade semântica, eliminando divergências e mantendo integralmente a arquitetura local-first e a regra de Zero Silent Fallback.

---

## 2. Ficheiros Alterados e Criados

| Ficheiro | Tipo | Descrição da Modificação |
|---|---|---|
| [`src/search/semanticCapability.ts`](file:///d:/_dev/obsidian/lina/src/search/semanticCapability.ts) | Modificado | Adicionado suporte para `lifecycleSnapshot` em `EvaluateSemanticCapabilityInput`, implementada a função canónica `evaluateSemanticCapabilityFromSnapshot`, e atualizado `evaluateSemanticCapability` para delegar no snapshot quando presente. |
| [`src/device/deviceRuntimeState.ts`](file:///d:/_dev/obsidian/lina/src/device/deviceRuntimeState.ts) | Modificado | Adicionado `lifecycleSnapshot?: EmbeddingLifecycleSnapshot \| null` a `ResolveDeviceRuntimeStateInput` e propagado para `evaluateSemanticCapability`. |
| [`src/device/deviceDiagnostics.ts`](file:///d:/_dev/obsidian/lina/src/device/deviceDiagnostics.ts) | Modificado | Propagado `lifecycleSnapshot: input.lifecycleSnapshot` na chamada a `evaluateSemanticCapability`. |
| [`tests/search/semanticCapabilityLifecycleSnapshot.test.ts`](file:///d:/_dev/obsidian/lina/tests/search/semanticCapabilityLifecycleSnapshot.test.ts) | Criado | Suíte com 10 testes cobrindo os 9 cenários obrigatórios (READY, UPDATE_AVAILABLE, INDEX_ONLY, INCOMPATIBLE provider, INCOMPATIBLE model, Companion, Standby Producer, ERROR, Fallback sem snapshot e paridade direta). |
| [`docs/audits/architecture/LINA-14C4-AUDIT-SEMANTIC-CAPABILITY-MIGRATION-001.md`](file:///d:/_dev/obsidian/lina/docs/audits/architecture/LINA-14C4-AUDIT-SEMANTIC-CAPABILITY-MIGRATION-001.md) | Criado | Relatório de auditoria pré-implementação. |
| [`docs/audits/architecture/LINA-14C4-IMPLEMENT-SEMANTIC-CAPABILITY-MIGRATION-001.md`](file:///d:/_dev/obsidian/lina/docs/audits/architecture/LINA-14C4-IMPLEMENT-SEMANTIC-CAPABILITY-MIGRATION-001.md) | Criado | Este documento de implementação e encerramento. |
| [`AGENTS.md`](file:///d:/_dev/obsidian/lina/AGENTS.md) / [`CHANGELOG.md`](file:///d:/_dev/obsidian/lina/CHANGELOG.md) | Modificado | Registada a conclusão da fase LINA-14C.4. |

---

## 3. Decisões Arquiteturais

1. **`UPDATE_AVAILABLE` preserva `semanticAvailable = true`**:
   - A existência de novos ficheiros para indexar ou chunks a atualizar é uma preocupação do Write Path (manutenção / background generation).
   - Para efeitos de pesquisa (Read Path), os embeddings publicados continuam completamente válidos e operacionais (`mode = "full"`).
2. **`INCOMPATIBLE` bloqueia pesquisa semântica com razão explícita**:
   - Falhas de contrato vetorial (provider, model, dimensions, inputVersion, prefixMode) resultam em `semanticAvailable = false`, `mode = "text-only"` e `reasonCode = "model-incompatible"`.
   - Preservado o princípio de **Zero Silent Fallback** (nunca tentar fazer match parcial ou degradar silenciosamente).
3. **Isolamento de Companion e Standby Producer**:
   - Dispositivos Companion ou Standby avaliam prontidão semântica dos artefactos publicados sem assumir responsabilidades de Producer ou obrigações de escrita.
4. **Fallback Retrocompatível Controlado**:
   - Quando `lifecycleSnapshot` não é fornecido (e.g. testes legados com inputs parciais), a função preserva a lógica determinística pré-existente sem quebrar contratos.

---

## 4. Testes e Validação

- Suíte de Testes: **134 ficheiros, 1789 testes (100% aprovados)**.
- `typecheck`: **0 erros**.
- `lint:obsidian:strict`: **0 erros, 0 avisos**.
- `build`: Sucesso.
- `release-check`: OK.
- `git diff --check`: OK.

---

## 5. Limitações e Próximos Passos

Esta fase conclui a migração dos consumidores de leitura (`Sidebar`, `Embedding Diagnostics`, `Device Diagnostics` e `Semantic Capability`).
As fases subsequentes do roadmap LINA-14 poderão focar-se na descontinuação segura de adaptadores shadow e na convergência de runtime.

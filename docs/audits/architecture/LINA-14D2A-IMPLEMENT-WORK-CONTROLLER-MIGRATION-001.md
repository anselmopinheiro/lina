# LINA-14D.2-A — Implementação da Migração do EmbeddingWorkStatusController para o Write Path Canónico

**Data:** 2026-09-29  
**Fase:** LINA-14D.2-A  
**Autor:** Arquiteto de Software Sénior & Engenheiro TypeScript/Obsidian Plugin  
**Estado:** Concluído / Aprovado  

---

## 1. Resumo Executivo

A fase **LINA-14D.2-A** concluiu a migração do [`EmbeddingWorkStatusController`](file:///d:/_dev/obsidian/lina/src/index/embeddingWorkStatusController.ts) para consumir a decisão canónica do Write Path:

```
EmbeddingLifecycleSnapshot
        ↓
deriveEmbeddingWritePathDecision(snapshot)
        ↓
EmbeddingWorkStatusController (decision, lifecycleSnapshot, workAvailable)
```

Com esta migração, o controller deixa de tomar decisões ad-hoc através de heurísticas ou flags booleanas duplicadas. O estado de runtime passa a expor diretamente o `decision: EmbeddingWritePathDecision` e o `lifecycleSnapshot: EmbeddingLifecycleSnapshot`, preservando com rigor os invariantes do Write Path:
- Companion e Standby nunca executam nem agendam trabalho local (`write.applicable = false`, `workAvailable = false`, `action = "none"`);
- Estados indeterminados (`INDETERMINATE` / canonical unreadable) nunca são convertidos silenciosamente em "sem trabalho" (`workAvailable = undefined`);
- Incompatibilidades exigem full rebuild com confirmação explícita;
- Ações recomendadas (`generate`, `update`, `rebuild`, `retry`, `none`) são estritamente derivadas do snapshot canónico.

---

## 2. Ficheiros Alterados e Criados

| Ficheiro | Tipo | Descrição da Modificação |
|---|---|---|
| [`src/index/embeddingWorkStatusController.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingWorkStatusController.ts) | Modificado | Migrado para utilizar `adaptCurrentStateToLifecycleSnapshot` e `deriveEmbeddingWritePathDecision`, estendido `EmbeddingWorkRuntimeState` com `decision` e `lifecycleSnapshot`, suportado `getDeviceRuntimeState` e `deviceRuntimeState`, e alinhado `hasEmbeddingWorkAvailable` com a classificação canónica. |
| [`tests/index/embeddingWorkStatusControllerLifecycle.test.ts`](file:///d:/_dev/obsidian/lina/tests/index/embeddingWorkStatusControllerLifecycle.test.ts) | Criado | Suíte com 10 testes dedicados cobrindo os cenários canónicos (READY, UPDATE_AVAILABLE, INDEX_ONLY, INCOMPATIBLE, ERROR com retry, Companion, Standby, INDETERMINATE, Publish-only cleanup e paridade semântica). |
| [`tests/index/embeddingLifecycleWritePath.test.ts`](file:///d:/_dev/obsidian/lina/tests/index/embeddingLifecycleWritePath.test.ts) | Modificado | Atualizada asserção de isolamento para remover o controller da lista de módulos não-migrados. |
| [`tests/settings/embeddingConfigurationRuntimeWiring.test.ts`](file:///d:/_dev/obsidian/lina/tests/settings/embeddingConfigurationRuntimeWiring.test.ts) | Modificado | Atualizada asserção para validar que JSONL ilegível produz `workAvailable: undefined` (tri-state indeterminate) de acordo com o modelo LINA-14. |
| [`docs/audits/architecture/LINA-14D2A-AUDIT-WORK-CONTROLLER-MIGRATION-001.md`](file:///d:/_dev/obsidian/lina/docs/audits/architecture/LINA-14D2A-AUDIT-WORK-CONTROLLER-MIGRATION-001.md) | Criado | Auditoria técnica pré-implementação. |
| [`docs/audits/architecture/LINA-14D2A-IMPLEMENT-WORK-CONTROLLER-MIGRATION-001.md`](file:///d:/_dev/obsidian/lina/docs/audits/architecture/LINA-14D2A-IMPLEMENT-WORK-CONTROLLER-MIGRATION-001.md) | Criado | Este documento de implementação e encerramento. |
| [`AGENTS.md`](file:///d:/_dev/obsidian/lina/AGENTS.md) / [`CHANGELOG.md`](file:///d:/_dev/obsidian/lina/CHANGELOG.md) | Modificado | Registada a conclusão da fase LINA-14D.2-A. |

---

## 3. Decisões Arquiteturais e Invariantes

1. **Fonte Única para o Write Path**:
   - `EmbeddingWorkStatusController` obtém a decisão exclusivamente através de `deriveEmbeddingWritePathDecision(snapshot)`.
   - `state.workAvailable` é `true` quando `updateRequired === true` (ou duplicates/invalid records requerem cleanup), `false` quando não há trabalho ou a escrita não é aplicável, e `undefined` em estados indeterminados.
2. **Isolamento de Companion e Standby**:
   - Dispositivos Companion (`isCompanion === true`) e Standby Producer (`isStandbyProducer === true` / `isActiveProducer === false`) têm `write.applicable = false`.
   - O controller reporta `workAvailable: false` e `decision.action: "none"`, garantindo que dispositivos sem autoridade de escrita nunca executam tarefas locais.
3. **Preservação de Estados Indeterminados**:
   - Quando `canonicalReadability === "unreadable"` ou `updatePlan.mode === "indeterminate"`, o controller mantém `workAvailable = undefined` e não toma decisão apressada.
4. **Sem Alterações no Scheduler, Worker ou Publicação**:
   - Esta fase limitou-se estritamente ao controller de estado de trabalho, mantendo os componentes de execução intactos para as subfases posteriores do roadmap LINA-14D.2.

---

## 4. Testes e Validação

- **Suíte de Testes:** 136 ficheiros, 1833 testes (100% aprovados).
- **Testes dedicados de Lifecycle:** 10 testes em `tests/index/embeddingWorkStatusControllerLifecycle.test.ts`.
- **Testes existentes do Controller:** 17 testes em `tests/index/embeddingWorkStatusController.test.ts`.
- **`typecheck` (`tsc --noEmit`):** 0 erros.
- **`lint:obsidian:strict`:** 0 erros, 0 avisos.
- **`build`:** Compilação de produção e cópia para test-vault concluídas com sucesso.
- **`release-check`:** OK.
- **`git diff --check`:** OK.

---

## 5. Próximos Passos

Prosseguir para as seguintes subfases do roadmap LINA-14D.2:
- **LINA-14D.2-B**: Migração do Scheduler e do Worker de Manutenção;
- **LINA-14D.2-C**: Migração da Geração/Operação e publicação de artefactos.

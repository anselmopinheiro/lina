# LINA-14D.2-B — Implementação da Migração do Policy Engine para o Write Path Canónico

**Data:** 2026-09-29  
**Fase:** LINA-14D.2-B  
**Autor:** Arquiteto de Software Sénior & Engenheiro TypeScript/Obsidian Plugin  
**Estado:** Concluído / Aprovado  

---

## 1. Resumo Executivo

A fase **LINA-14D.2-B** concluiu a migração do [`EmbeddingPolicyEngine`](file:///d:/_dev/obsidian/lina/src/maintenance/embeddingPolicyEngine.ts) para consumir a decisão canónica do Write Path:

```
EmbeddingLifecycleSnapshot
        ↓
deriveEmbeddingWritePathDecision(snapshot)
        ↓
evaluateEmbeddingUpdatePolicyFromSnapshot() / evaluateEmbeddingUpdatePolicy()
        ↓
EmbeddingPolicyDecision (allowed, requiresConfirmation, reason, action, decision)
```

Com esta migração:
1. As decisões de autorização de escrita, exigência de confirmação modal e classificação de custo foram unificadas na fonte canónica (`deriveEmbeddingWritePathDecision`), eliminando regras paralelas ad-hoc;
2. As proteções fundamentais de Companion e Standby Producer foram reforçadas (`allowed = false`, `requiresConfirmation = false`, `action = "none"`);
3. Incompatibilidades de contrato vetorial (`INCOMPATIBLE`) impõem deterministicamente a ação de `rebuild` com confirmação explícita obrigatória (`requiresConfirmation = true`);
4. Estados indeterminados (`INDETERMINATE`) bloqueiam qualquer despacho automático sem silenciar o diagnóstico (`allowed = false`, `reason = "indeterminate-state-blocked"`);
5. Foi disponibilizada uma função de comparação de paridade (`comparePolicyEngineDecision`) para validação estrita entre a decisão antiga e a decisão nova.

---

## 2. Ficheiros Criados e Alterados

| Ficheiro | Tipo | Descrição da Modificação |
|---|---|---|
| [`src/maintenance/embeddingPolicyEngine.ts`](file:///d:/_dev/obsidian/lina/src/maintenance/embeddingPolicyEngine.ts) | Modificado | Migrado para derivar decisões diretamente do `EmbeddingLifecycleSnapshot` e `deriveEmbeddingWritePathDecision`, implementadas as funções `evaluateEmbeddingUpdatePolicyFromSnapshot`, `evaluateLegacyEmbeddingUpdatePolicy` e `comparePolicyEngineDecision`. |
| [`tests/maintenance/embeddingPolicyEngineLifecycle.test.ts`](file:///d:/_dev/obsidian/lina/tests/maintenance/embeddingPolicyEngineLifecycle.test.ts) | Criado | Suíte dedicada com 11 testes cobrindo os cenários canónicos (READY, UPDATE_AVAILABLE, INDEX_ONLY, INCOMPATIBLE, ERROR, Companion, Standby, INDETERMINATE, Rebuild com confirmação, Retry após falha e comparação shadow). |
| [`tests/index/embeddingLifecycleWritePath.test.ts`](file:///d:/_dev/obsidian/lina/tests/index/embeddingLifecycleWritePath.test.ts) | Modificado | Atualizada asserção de isolamento para remover o Policy Engine da lista de módulos não-migrados. |
| [`docs/audits/architecture/LINA-14D2B-AUDIT-POLICY-ENGINE-MIGRATION-001.md`](file:///d:/_dev/obsidian/lina/docs/audits/architecture/LINA-14D2B-AUDIT-POLICY-ENGINE-MIGRATION-001.md) | Criado | Auditoria técnica pré-implementação. |
| [`docs/audits/architecture/LINA-14D2B-IMPLEMENT-POLICY-ENGINE-MIGRATION-001.md`](file:///d:/_dev/obsidian/lina/docs/audits/architecture/LINA-14D2B-IMPLEMENT-POLICY-ENGINE-MIGRATION-001.md) | Criado | Este documento de implementação e encerramento. |
| [`AGENTS.md`](file:///d:/_dev/obsidian/lina/AGENTS.md) / [`CHANGELOG.md`](file:///d:/_dev/obsidian/lina/CHANGELOG.md) | Modificado | Registada a conclusão da fase LINA-14D.2-B. |

---

## 3. Decisões Arquiteturais e Invariantes

1. **Fonte Única para Autorização e Confirmação**:
   - O Policy Engine delega a avaliação de trabalho, prontidão e custo diretamente na decisão canónica `deriveEmbeddingWritePathDecision(snapshot)`.
   - Providers com custo externo (`cost === "external"`) ou operações de `rebuild` bloqueiam a execução automática e exigem confirmação modal.
2. **Proteção Rigorosa de Companion e Standby**:
   - `Companion` e `Standby` recebem deterministicamente `allowed: false`, `requiresConfirmation: false`, `action: "none"` e motivos descritivos (`companion-device-not-allowed`, `standby-device-not-allowed`).
3. **Bloqueio de Estados Indeterminados**:
   - Índices ilegíveis ou estados não verificados bloqueiam execução automática (`allowed: false`, `reason: "indeterminate-state-blocked"`).
4. **Retrocompatibilidade com Consumidores Existentes**:
   - `evaluateEmbeddingUpdatePolicy` preserva a interface pré-existente para compatibilidade total com chamadores legados enquanto permite a injeção opcional de `lifecycleSnapshot` ou `decision`.

---

## 4. Testes e Validação

- **Suíte de Testes:** 137 ficheiros, 1844 testes (100% aprovados).
- **Testes dedicados de Lifecycle:** 11 testes em `tests/maintenance/embeddingPolicyEngineLifecycle.test.ts`.
- **Testes existentes do Policy Engine:** 15 testes em `tests/maintenance/embeddingPolicyEngine.test.ts`.
- **`typecheck` (`tsc --noEmit`):** 0 erros.
- **`lint:obsidian:strict`:** 0 erros, 0 avisos.
- **`build`:** Compilação de produção e cópia para test-vault concluídas com sucesso.
- **`release-check`:** OK.
- **`git diff --check`:** OK.

---

## 5. Próximos Passos

Prosseguir para as fases subsequentes do roadmap LINA-14D:
- **LINA-14D.2-C**: Migração do Scheduler e Worker de Manutenção;
- **LINA-14D.2-D**: Migração da Geração/Operação e publicação de artefactos.

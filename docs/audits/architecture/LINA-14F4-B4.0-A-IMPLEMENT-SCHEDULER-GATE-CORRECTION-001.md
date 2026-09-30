# LINA-14F.4-B4.0-A — Relatório de Implementação: Correção do Gate de Despacho Automático do Scheduler (F01)

**Data**: 2026-09-30  
**Fase**: LINA-14F.4-B4.0-A (Embedding Lifecycle Consolidation)  
**Autor**: Arquiteto de Software Sénior & Engenheiro TypeScript  
**Auditoria de Referência**: Problema F01 identificado na Auditoria LINA-14F.4-B4  
**Estado**: Concluído  

---

## 1. Descrição do Problema (F01)

No wiring do `EmbeddingScheduler` em `main.ts`, a função `canDispatchAutomatically` utilizava dados incompletos e fabricados para avaliar a autorização de execução automática:
1. Lia `this.settings?.embeddingProvider` (definição global estática) em vez de resolver a configuração efetiva para o dispositivo (`getEffectiveEmbeddingConfig()`).
2. Fabricava um snapshot sintético com identidade fixa (`dimensions: 768`, `publishedIdentity: identity`, `targetIdentity: identity`, `validForSearchCount: 1`, `workAssessment: { kind: "pending", mode: "incremental", ... }`).
3. Não consultava o estado factual real do dispositivo nem o snapshot canónico derivado pelo controlador de ciclo de vida.

### Risco / Impacto
Em configurações com múltiplos dispositivos, providers externos (Mistral, OpenRouter) ou quando um `full-rebuild` era exigido devido a alteração de modelo/dimensões, a decisão automática podia ignorar a exigência de confirmação explícita ou permitir despachos incorretos.

---

## 2. Correção Efetuada

A autorização de despacho automático do scheduler foi unificada para seguir a cadeia canónica estrita:

$$\text{Estado Factual} \longrightarrow \text{EmbeddingLifecycleSnapshot} \longrightarrow \text{deriveEmbeddingWritePathDecision()} \longrightarrow \text{Scheduler}$$

### 2.1. Alterações em `main.ts`
1. **`canDispatchAutomatically()`**:
   - Valida que a política configurada é explicitamente `"automatic-local-only"`.
   - Valida que o papel do dispositivo é `"producer"` com autoridade ativa confirmada (`getOwnershipGate().isAuthorizedSync()`).
   - Resolve o provider efetivo através de `getEffectiveEmbeddingConfig()` e bloqueia imediatamente se `!providerCapability.isLocal`.
   - Verifica se os embeddings estão configurados no `DeviceRuntimeState`.
   - Quando o `EmbeddingWorkStatusController` já possui um snapshot em memória, avalia a decisão canónica através de `evaluateSchedulerDecisionFromSnapshot(controllerSnapshot, policy).canDispatch`.

2. **`hasAutomaticEmbeddingWork()`**:
   - Constrói o snapshot factual a partir do plano de atualização real (`updatePlan`), estado de runtime do dispositivo e configuração efetiva.
   - Avalia a decisão de agendamento através de `evaluateSchedulerDecisionFromSnapshot(snapshot, policy)`.
   - Retorna `true` estritamente quando `schedulerDecision.canDispatch && schedulerDecision.hasWork`.

3. **Remoção de Código Morto**:
   - Removido o snapshot fabricado e o import não utilizado de `deriveEmbeddingWritePathDecision` em `main.ts`.

---

## 3. Testes de Caracterização Adicionados

Criado o ficheiro `tests/maintenance/embeddingSchedulerGate.test.ts` com 5 testes focados:
- **F01.1**: Bloqueio estrito de despacho automático quando o provider efetivo é externo (Mistral), mesmo sob política automática (`reason: "external-provider-blocked"`).
- **F01.2**: Bloqueio de despacho automático quando é exigido `full-rebuild`, mesmo para o provider local Ollama (`reason: "incompatible-rebuild-required"`).
- **F01.3**: Autorização de despacho automático exclusivamente para provider local (Ollama) em modo incremental/initial-build sob política `"automatic-local-only"`.
- **F01.4**: Bloqueio de despacho automático sob política `"manual"`.
- **F01.5**: Bloqueio de agendamento e despacho em dispositivos Companion ou Standby.

---

## 4. Quality Gates

| Validação | Comando | Resultado |
|---|---|---|
| Suíte de Testes | `npm test` | **140 ficheiros / 1868 testes aprovados (100%)** |
| Verificação de Tipos | `npm run typecheck` | **0 erros** |
| Linter Estrito | `npm run lint:obsidian:strict` | **0 erros / 0 avisos** |
| Build de Produção | `npm run build` | **Sucesso (`main.js` gerado e copiado)** |
| Release Check | `npm run release-check` | **READY FOR OBSIDIAN RELEASE** |
| Git Diff Check | `git diff --check` | **Limpo (0 conflitos / 0 whitespace issues)** |

---

## 5. Conclusão

O finding F01 foi completamente eliminado sem introduzir novas camadas ou abstrações. Todas as decisões de despacho automático do scheduler passam agora exclusivamente pelo snapshot canónico e pelas decisões operacionais do ciclo de vida dos embeddings.

# LINA-14D.2-B — Auditoria de Migração do Policy Engine para o Write Path Canónico

**Data:** 2026-09-29  
**Fase:** LINA-14D.2-B  
**Autor:** Arquiteto de Software Sénior & Engenheiro TypeScript/Obsidian Plugin  
**Estado:** Aprovado para Implementação  

---

## 1. Contexto e Motivação

O projeto Lina encontra-se na fase LINA-14D.2 de migração dos consumidores do Write Path para a decisão canónica prescritiva derivada exclusivamente de [`EmbeddingLifecycleSnapshot`](file:///d:/_dev/obsidian/lina/src/index/embeddingLifecycleModel.ts):

```
EmbeddingLifecycleSnapshot
        ↓
deriveEmbeddingWritePathDecision()
        ↓
EmbeddingPolicyEngine & Consumidores do Write Path
```

Na fase anterior (LINA-14D.2-A), o `EmbeddingWorkStatusController` foi migrado com sucesso. O próximo consumidor na cadeia de decisão é o [`EmbeddingPolicyEngine`](file:///d:/_dev/obsidian/lina/src/maintenance/embeddingPolicyEngine.ts).

O Policy Engine é responsável por:
1. Autorizar ou bloquear a execução automática de geração/atualização de embeddings;
2. Determinar se uma ação exige confirmação modal explícita do utilizador;
3. Proteger recursos externos (LLMs em nuvem com custo / consumo de quota);
4. Garantir que dispositivos Companion e Standby nunca executam tarefas locais.

---

## 2. Auditoria dos Consumidores Atuais

A pesquisa no repositório identificou os seguintes pontos de consumo de `evaluateEmbeddingUpdatePolicy`:

| Ficheiro | Localização | Finalidade |
|---|---|---|
| [`main.ts`](file:///d:/_dev/obsidian/lina/main.ts) | Linhas 904-911 | Construção da comparação shadow em `getEmbeddingWritePathShadowComparison()` |
| [`main.ts`](file:///d:/_dev/obsidian/lina/main.ts) | Linhas 1540-1546 | Predicado `canDispatchAutomatically` no `EmbeddingScheduler` |
| [`main.ts`](file:///d:/_dev/obsidian/lina/main.ts) | Linhas 1751-1761 | Fluxo de confirmação manual `confirmAndRequestEmbeddingGeneration()` |
| [`tests/maintenance/embeddingPolicyEngine.test.ts`](file:///d:/_dev/obsidian/lina/tests/maintenance/embeddingPolicyEngine.test.ts) | Bateria completa | Testes de unidade do motor de política |
| [`tests/maintenance/embeddingUpdateConfirmation.test.ts`](file:///d:/_dev/obsidian/lina/tests/maintenance/embeddingUpdateConfirmation.test.ts) | Bateria completa | Preparação de confirmação de atualização |
| [`tests/maintenance/embeddingStatusExplanation.test.ts`](file:///d:/_dev/obsidian/lina/tests/maintenance/embeddingStatusExplanation.test.ts) | Bateria completa | Explicações textuais do estado de manutenção |
| [`tests/settings/embeddingUpdateSettings.test.ts`](file:///d:/_dev/obsidian/lina/tests/settings/embeddingUpdateSettings.test.ts) | Bateria completa | Definições de modo de atualização |
| [`tests/security/secretBoundaryProtection.test.ts`](file:///d:/_dev/obsidian/lina/tests/security/secretBoundaryProtection.test.ts) | Linha 256 | Teste de proteção de fronteiras de segredos |

---

## 3. Análise Comparativa: Regras Legadas vs Decisão Canónica

### 3.1 Avaliação de Companion e Papéis de Dispositivo
- **Legado:** Verificava `deviceRole === "companion"`.
- **Canónico:** `deriveEmbeddingWritePathDecision(snapshot)` avalia `!decision.applicable` com `blockedReason === "companion"`, `"standby"`, `"unassigned"`, `"ownership-lost"` ou `"embeddings-disabled"`.
- **Invariante:** Dispositivos sem autoridade de escrita obtêm sempre `allowed: false`, `requiresConfirmation: false` e `action: "none"`.

### 3.2 Avaliação de Trabalho Pendente
- **Legado:** Calculava flags booleanas ad-hoc `hasPendingWork` a partir de `toGenerateCount > 0 || staleCount > 0 || missingCount > 0`.
- **Canónico:** `deriveEmbeddingWritePathDecision(snapshot)` avalia formalmente `decision.updateRequired`, `decision.workKind` e `decision.action`.
- **Invariante:** Se `action === "none"` ou `!updateRequired`, a política reporta `no-update-required` com `allowed: false` e `requiresConfirmation: false`.

### 3.3 Custo e Confirmação de Providers Externos vs Locais
- **Legado:** Inspecionava `providerCapability.isLocal` e `providerCapability.hasExternalCost` diretamente no Policy Engine.
- **Canónico:** `snapshot.write.cost` (`"none" | "local" | "external"`) e `decision.requiresConfirmation` já integram o custo do provider e a necessidade de confirmação prescrita pelo ciclo de vida.
- **Invariante:** Providers com custo externo (`cost === "external"`) ou operações de `rebuild` têm `requiresConfirmation = true` e `allowed = false` em modo automático.

### 3.4 Estados Indeterminados
- **Legado:** `hasPendingWork` podia avaliar `false` inadvertidamente em estados onde a leitura falhou.
- **Canónico:** `primary === "INDETERMINATE"` produz `workKind: "indeterminate"` e bloqueia qualquer despacho automático sem silenciar o diagnóstico (`allowed = false`, `reason = "indeterminate-state-blocked"`).

---

## 4. Plano de Implementação

1. **Unificação da Função Central**:
   - `evaluateEmbeddingUpdatePolicy` passa a aceitar opcionalmente `lifecycleSnapshot` ou `decision`.
   - Quando não fornecido diretamente, os inputs são adaptados via `adaptCurrentStateToLifecycleSnapshot` para derivar `deriveEmbeddingWritePathDecision(snapshot)`.
   - Adicionar `evaluateEmbeddingUpdatePolicyFromSnapshot(snapshot, policy)` como helper canónico direto.
2. **Extensão de Tipos e Resultados**:
   - Enriquecer `EmbeddingPolicyDecision` com `action?: EmbeddingWriteAction` e `decision?: EmbeddingWritePathDecision`.
   - Suportar razões adicionais tipadas (`"standby-device-not-allowed"`, `"indeterminate-state-blocked"`, `"rebuild-confirmation-required"`).
3. **Mecanismo de Comparação / Paridade**:
   - Implementar `comparePolicyEngineDecision` para comparar decisões legadas com a decisão canónica e identificar eventuais desvios.
4. **Suíte de Testes Dedicada**:
   - Criar `tests/maintenance/embeddingPolicyEngineLifecycle.test.ts` cobrindo os 10 cenários obrigatórios da prompt.

---

## 5. Critérios de Sucesso

- O Policy Engine consome a decisão canónica como fonte de verdade única;
- 0 regressões em testes existentes (136 ficheiros / 1833 testes);
- Bateria dedicada de testes de ciclo de vida aprovada;
- Validação estrita de tipos, linter, build e release-check.

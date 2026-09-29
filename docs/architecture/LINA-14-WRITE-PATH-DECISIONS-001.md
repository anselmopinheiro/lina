# LINA-14: Decisões Arquiteturais do Write Path de Embeddings

**Documento:** `LINA-14-WRITE-PATH-DECISIONS-001.md`  
**Fase:** LINA-14D.1 (Consolidação Documental Pré-Migração do Write Path)  
**Estado:** Congelado / Arquitetura de Referência  
**Autor:** Arquiteto de Software Sénior & Engenheiro TypeScript/Obsidian Plugin  

---

## 1. Contexto e Motivação

O projeto Lina consolidou a representação unificada de leitura (Read Path) nas fases LINA-14A a LINA-14C.4 através do modelo canónico [`EmbeddingLifecycleSnapshot`](file:///d:/_dev/obsidian/lina/src/index/embeddingLifecycleModel.ts).

No Write Path (geração física de embeddings, publicação de limpeza, checkpoints, agendamento e acionamento manual), auditorias anteriores (LINA-13-P0, LINA-14 e LINA-14D) identificaram a coexistência de múltiplas decisões duplicadas e predicados dispersos em `main.ts`, `embeddingWorkStatusController.ts`, `embeddingWorkflowState.ts`, `embeddingPolicyEngine.ts`, `embeddingScheduler.ts` e `linaSearchView.ts`.

Este documento **congela formalmente as decisões arquiteturais do Write Path** com base na camada shadow introduzida na fase LINA-14D.1, estabelecendo o contrato rígido que orientará as migrações ativas das sub-fases subsequentes (LINA-14D.2 a LINA-14D.5).

---

## 2. Cadeia Canónica de Decisão (Fonte de Verdade)

A arquitetura estabelece uma hierarquia unidirecional e estrita:

```
+-------------------------------------------------------------+
|               EmbeddingLifecycleSnapshot                     |
|  - Representa o estado canónico puro do ciclo de vida       |
|  - Regiões: read, write (work), process, history, primary   |
|  - Sem I/O, sem efeitos secundários, sem execução           |
+-------------------------------------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|              EmbeddingLifecycleWritePath                    |
|             (deriveEmbeddingWritePathDecision)              |
|  - Deriva a decisão prescritiva de escrita                  |
|  - Classifica a ação: none | generate | update | rebuild |   |
|                      cancel | retry                         |
|  - Define custo, severidade, canExecute e confirmação       |
+-------------------------------------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|               Consumidores do Write Path                    |
|  1. EmbeddingWorkStatusController (classificação de trabalho)|
|  2. EmbeddingPolicyEngine & EmbeddingScheduler (agendamento)|
|  3. Sidebar Button & Modais (gatilhos manuais e confirmação)|
|  4. EmbeddingWorker & MaintenanceEngine (execução segura)   |
+-------------------------------------------------------------+
```

---

## 3. Divisão de Responsabilidades

### 3.1 `EmbeddingLifecycleSnapshot` (Modelo de Estado)
- **Função:** Capturar o estado operacional e factual dos embeddings, índice e ambiente.
- **Responsabilidades:**
  - Determinar a prontidão de leitura (`read.semanticAvailable`, `read.effectiveMode`, `read.compatibility`).
  - Efetuar a classificação factual do trabalho de manutenção (`write.work`: `kind`, `mode`, `updateRequired`, `severity`, `cost`, `counts`).
  - Acompanhar a fase e progresso de qualquer processo em curso (`process.phase`, `progress`, `cancellable`).
  - Registar o desfecho histórico recente (`history.lastSuccess`, `history.lastFailure`).
  - Registar barreiras estruturais de autoridade (`capability.canRequestUpdate`, `capability.blockedReason`).
- **Não-responsabilidade:** **Nunca toma decisões imperativas de execução nem invoca ações.**

### 3.2 `EmbeddingLifecycleWritePath` (Decisão Derivada de Escrita)
- **Função:** Traduzir o snapshot numa recomendação prescritiva de ação para o Write Path.
- **Campos Canónicos Derivados:**
  - `applicable`: `boolean` (se o dispositivo atual tem autoridade de escrita).
  - `workKind` & `workMode`: `EmbeddingWorkKind` e `EmbeddingWorkExecutionMode`.
  - `action`: `"none" | "generate" | "update" | "rebuild" | "cancel" | "retry"`.
  - `canExecute`: `boolean` (se o acionamento pode ser iniciado de imediato).
  - `requiresConfirmation`: `boolean` (se exige confirmação modal explícita).
  - `cost`: `"none" | "local" | "external"`.
  - `severity`: `"none" | "info" | "action" | "blocking"`.
  - `ownershipLostDuringOperation`: `boolean` (deteção de perda de autoridade a meio do processo).
  - `canRetry`: `boolean` (se uma operação falhada pode ser reexecutada).
  - `diagnostic`: Mensagem técnica e descritiva contextual.

### 3.3 Consumidores de Produção (Executores)
- **Função:** Executar estritamente as ações permitidas por `deriveEmbeddingWritePathDecision`.
- **Regra Geral:** Nenhum consumidor calcula critérios próprios ou predicados ad-hoc de "há trabalho" ou "pode executar".

---

## 4. Regras e Invariantes Arquiteturais Congeladas

### Regra 1: Autoridade Exclusiva do Produtor Ativo (Producer-Only Write)
- Apenas o dispositivo com papel `producer` e autoridade de publicação confirmada no manifesto `.lina/ownership.json` (`isActiveProducer === true`) pode executar tarefas de escrita, geração, publicação ou checkpoints.
- Dispositivos `companion`, `standby` ou `unassigned` têm deterministicamente:
  $$\text{applicable} = \text{false}, \quad \text{canExecute} = \text{false}, \quad \text{action} \in \{\text{"none"}, \text{"cancel"}\}$$

### Regra 2: Proteção Total do Companion (Zero Sync / Zero Generation)
- O Companion nunca inicia geração física de embeddings, nunca instancia schedulers de background e nunca escreve no índice partilhado.
- A presença de novos ficheiros ou alterações textuais num dispositivo Companion **nunca gera necessidade de escrita** local.

### Regra 3: Preservação de Estado Indeterminado (No Silent Fallback to Idle)
- Se o estado do índice canónico estiver corrompido, ilegível ou em verificação ativa (`VERIFYING`), o estado **nunca pode ser convertido silenciosamente em "sem trabalho" (`IDLE`)**.
- Estados `INDETERMINATE` mantêm `workKind = "indeterminate"` e bloqueiam agendamento automático cego.

### Regra 4: Incompatibilidade Requer Reconstrução Controlada (Explicit Rebuild)
- Em caso de incompatibilidade de contrato vetorial (`INCOMPATIBLE`), seja por fornecedor, modelo, dimensões ou prefix mode:
  - A pesquisa semântica é **imediatamente suspensa** (`read.semanticAvailable = false`, `mode = "text-only"`).
  - A ação recomendada é obrigatoriamente `rebuild`.
  - A execução exige **confirmação explícita obrigatória do utilizador** (`requiresConfirmation = true`), mesmo para providers locais.
  - É expressamente proibido efetuar fallback silencioso de modelo ou regeneração automática não confirmada.

### Regra 5: Atualização Pendente Não Invalida Pesquisa Existente (Stale-While-Rebuild)
- Quando existem notas modificadas ou novos ficheiros a processar (`UPDATE_AVAILABLE`):
  - Para o Read Path: os embeddings existentes continuam completamente válidos e operacionais para pesquisa (`read.semanticAvailable = true`, `effectiveMode = "full"`).
  - Para o Write Path: o trabalho é classificado como `incremental` (`action = "update"`).
  - A escrita e a leitura permanecem ortogonais até à publicação atómica do novo lote.

### Regra 6: Precedência Estrita de Processos em Curso
- Quando uma operação está em execução (`UPDATING` ou `CANCELLING`):
  - Ações de pedido de nova geração estão bloqueadas (`canExecute = false`).
  - Apenas a ação `cancel` pode ser oferecida (e unicamente se `process.cancellable === true`, o que exclui fases não interrompíveis como `persisting`).

### Regra 7: Limpeza sem Chunks (Publish-Only Cleanup)
- Quando existem registos obsoletos a remover sem novos trechos a gerar:
  - O modo é classificado formalmente como `publish-only`.
  - O custo é `none` (sem invocação de LLMs/modelos).
  - Ação é `update` sem exigência de confirmação modal externa.

---

## 5. Mapeamento da Matriz de Decisão do Write Path

| Estado Primário (`primary`) | Condições Internas | Ação (`action`) | `canExecute` | `requiresConfirmation` | `cost` | Severidade |
|---|---|---|---|---|---|---|
| `UPDATING` | `cancellable === true` | `"cancel"` | `false` | `false` | Conforme op. | `none` |
| `UPDATING` | `cancellable === false` (ex: `persisting`) | `"none"` | `false` | `false` | Conforme op. | `none` |
| `CANCELLING` | Em cancelamento ativo | `"none"` | `false` | `false` | `none` | `info` |
| `DISABLED` | Embeddings desativados nas definições | `"none"` | `false` | `false` | `none` | `none` |
| `VERIFYING` | Deteção / cálculo de hashes em curso | `"none"` | `false` | `false` | `none` | `info` |
| `STANDBY` | Produtor em modo Standby (sem lock) | `"none"` | `false` | `false` | `none` | `info` |
| `INDEX_ONLY` | Produtor ativo, sem embeddings | `"generate"` | `true` | Depende provider | `local`/`external` | `action` |
| `INCOMPATIBLE` | Produtor ativo, contrato divergente | `"rebuild"` | `true` | **`true`** (sempre) | `local`/`external` | `blocking` |
| `UPDATE_AVAILABLE` | `mode === "full-rebuild"` | `"rebuild"` | `true` | **`true`** | `local`/`external` | `action` |
| `UPDATE_AVAILABLE` | `mode === "incremental"` | `"update"` | `true` | Depende provider | `local`/`external` | `action` |
| `UPDATE_AVAILABLE` | `mode === "publish-only"` | `"update"` | `true` | `false` | `none` | `info` |
| `ERROR` | Falha prévia registada | `"retry"` | `canRequestUpdate` | Depende falha | `local`/`external` | `blocking` |
| `READY` | Sem trabalho pendente | `"none"` | `false` | `false` | `none` | `none` |
| Qualquer | Companion ou Unassigned | `"none"` | `false` | `false` | `none` | `none` |

---

## 6. Roteiro de Migração dos Consumidores (Sub-Fases 14D)

| Sub-Fase | Âmbito e Consumidores Afetados | Objetivo da Migração |
|---|---|---|
| **LINA-14D.1** *(Concluída)* | `src/index/embeddingLifecycleWritePath.ts`, testes shadow | Implementação da camada shadow pura e congelamento arquitetural de decisões. |
| **LINA-14D.2** *(Próxima)* | `EmbeddingWorkStatusController`, `EmbeddingPolicyEngine`, `EmbeddingScheduler` | Unificação da avaliação de "há trabalho" através de `classifyEmbeddingWork` e remoção de predicados redundantes. |
| **LINA-14D.3** | Botão da Sidebar (`linaSearchView.ts`), `confirmAndRequestEmbeddingGeneration` | Migração do botão e do gatilho manual para consumir `deriveEmbeddingWritePathDecision`. |
| **LINA-14D.4** | Telemetria histórica (`producer-state.json`, `lastOutcome`, `history`) | Unificação do reporte histórico de sucesso/falha através do snapshot e limpeza de canais legacy. |
| **LINA-14D.5** | Fencing e perda de autoridade de escrita | Tratamento de `OWNERSHIP_LOST` durante processos ativos de geração com interrupção segura. |

---

## 7. Conclusão e Autorização para LINA-14D.2

Com a formalização deste documento:
- Todas as decisões prescritivas do Write Path ficam **estritamente documentadas e congeladas**.
- A paridade entre o modelo canónico e as decisões legadas está comprovada pelos 34 testes shadow da suite [`tests/index/embeddingLifecycleWritePath.test.ts`](file:///d:/_dev/obsidian/lina/tests/index/embeddingLifecycleWritePath.test.ts).
- O projeto reúne todas as pré-condições de segurança para avançar para a fase **LINA-14D.2**.

# Arquitetura de Referência: Embedding Lifecycle Baseline

**Iniciativa:** LINA-14 — Embedding Lifecycle Consolidation  
**Estado:** `LINA-14 — CONCLUÍDA`  
**Data de Fecho:** 2026-09-30  
**Documento:** `docs/architecture/LINA-14-EMBEDDING-LIFECYCLE-BASELINE-001.md`  
**Referência Canónica:** Obrigatória para todo o desenvolvimento futuro que interaja com Embeddings, Pesquisa Semântica, Agendamento e Sincronização.

---

## 1. Estado da Iniciativa

A iniciativa **LINA-14 (Embedding Lifecycle Consolidation)** encontra-se **integralmente concluída, testada e validada**. Todas as subfases foram concluídas com aprovação de 100% dos testes e portões de qualidade:

| Fase | Título / Âmbito | Objetivo | Resultado | Estado Final |
| :--- | :--- | :--- | :--- | :--- |
| **LINA-14A** | Modelo Canónico | Definição do tipo unificado `EmbeddingLifecycleSnapshot` com separação de domínios (`primary`, `read`, `write`, `process`, `capability`, `info`, `history`). | Modelo formal imutável e puro implementado em `src/index/embeddingLifecycleModel.ts`. | **Concluída** |
| **LINA-14B** | Adapter e Validação Shadow | Criação do transformador factual `adaptCurrentStateToLifecycleSnapshot` e validação shadow de 14 cenários do ciclo de vida. | Validação em matriz com 100% de paridade factual comprovada. | **Concluída** |
| **LINA-14C** | Migração do Read Path | Alinhamento da Sidebar, Pesquisa Semântica e Diagnósticos com o snapshot canónico. | `sidebarStatusViewModel`, `semanticCapability` e diagnósticos migrados para ler `lifecycleSnapshot`. | **Concluída** |
| **LINA-14D** | Consolidação do Write Path | Definição da função de decisão pura `deriveEmbeddingWritePathDecision` e classificação determinística de trabalho (`classifyEmbeddingWork`). | Motor de decisão único para todas as ações operacionais (`generate`, `update`, `rebuild`, `retry`, `cancel`, `none`). | **Concluída** |
| **LINA-14E** | Auditoria Global de Consolidação | Auditoria global de consistência entre Read Path e Write Path, ownership, estados indeterminados e concorrência. | Aprovação do plano de cutover e remoção de legado. | **Concluída** |
| **LINA-14F** | Cutover e Hardening Final | Cutover ativo de Policy Engine, Scheduler, Worker, Operation Manager, UI; remoção de legado (`EmbeddingWorkflowState`, comparadores shadow) e hardening de runtime wiring. | 100% dos componentes em produção utilizam a cadeia canónica; 1938 testes aprovados. | **Concluída** |

---

## 2. Problema Original

Antes da intervenção LINA-14, o subsistema de embeddings do Lina sofria de fragmentação estrutural identificada nas auditorias técnicas (LINA-12, LINA-13-P0, LINA-14-AUDIT):

1. **Dualidade de Modelos (Read Path vs. Write Path):**
   - A leitura e a apresentação na Sidebar dependiam de `EmbeddingWorkflowState` com fases e heurísticas próprias.
   - O agendamento e o cálculo de trabalho dependiam de `hasEmbeddingWorkAvailable()` e reduções booleanas locais.
   - Havia divergência sobre se ficheiros obsoletos sem novos chunks constituíam trabalho ou bloqueio.
2. **Heurísticas Dispersas e Decisões Paralelas:**
   - Múltiplos ficheiros (`main.ts`, `embeddingScheduler.ts`, `embeddingWorker.ts`, `linaSearchView.ts`, `embeddingStatusViewModel.ts`) recalculavam localmente se o sistema estava "pronto", "sujo" ou "com trabalho".
3. **Fallbacks Silenciosos Indesejados:**
   - Estados de erro ou indefinição eram por vezes colapsados em `false` ou "sem trabalho", podendo mascarar corrupções ou bloqueios legítimos.
4. **Dificuldade na Representação Fiel de Estados Críticos:**
   - Complexidade em distinguir `READY` (totalmente atualizado) de `UPDATE_AVAILABLE` (pesquisa válida, mas drift existente que permite atualização em background).
   - Representação ambígua de incompatibilidade de modelo (`INCOMPATIBLE`) exigindo `rebuild` completo versus atualização incremental (`incremental`).
   - Falta de fencing de autoridade durante operações ativas caso o papel do dispositivo mudasse em tempo real.

---

## 3. Arquitetura Canónica Final

A arquitetura consolidada opera estritamente através de um fluxo unidirecional:

``` text
┌─────────────────────────────────────────────────────────┐
│                     ESTADO FACTUAL                      │
│ (TextIndex, Embeddings State, Device Role, Companion)   │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│               EmbeddingLifecycleSnapshot                │
│    (Primary Status, Read Mode, Write Work, Capability)  │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│           deriveEmbeddingWritePathDecision()            │
│   (Action, WorkMode, CanExecute, Gating, Reasons)       │
└────────────────────────────┬────────────────────────────┘
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
┌───────────────────────┐         ┌───────────────────────┐
│      EXECUTORES       │         │       VIEWMODELS      │
│  - EmbeddingScheduler │         │  - SidebarStatusVM    │
│  - EmbeddingWorker    │         │  - EmbeddingStatusVM  │
│  - OperationManager   │         │  - LinaSearchView     │
│  - PolicyEngine       │         │  - IndexDiagnosticVM  │
└───────────────────────┘         └───────────────────────┘
```

### Mapeamento dos Consumidores Canónicos

| Consumidor | Módulo | Responsabilidade |
| :--- | :--- | :--- |
| **Sidebar** | `src/search/sidebarStatusViewModel.ts` | Apresenta o papel do dispositivo, frescura dos artefactos, `effectiveMode` de pesquisa e gating de manutenção. |
| **Pesquisa** | `src/search/semanticCapability.ts` / `linaSearchView.ts` | Avalia disponibilidade semântica e modo híbrido (`full` vs `text-only`) exclusivamente a partir de `lifecycleSnapshot.read`. |
| **Diagnósticos** | `src/search/embeddingStatusViewModel.ts` / `deviceDiagnostics.ts` | Renderiza contagens de chunks, modelos publicados vs configurados e ações de UI mapeadas da decisão canónica. |
| **Policy Engine** | `src/maintenance/embeddingPolicyEngine.ts` | Avalia regras de negócio de automação (`manual` vs `automatic-local-only`) baseando-se estritamente no snapshot. |
| **Scheduler** | `src/maintenance/embeddingScheduler.ts` | Gere timers, debounce (30s) e auto-dispatch verificando `evaluateSchedulerDecisionFromSnapshot`. |
| **Operation Manager** | `src/index/embeddingOperationManager.ts` | Garante single-flight incondicional e autorização de início via `evaluateOperationStartGate`. |
| **Worker** | `src/maintenance/embeddingWorker.ts` | Executa fisicamente o batching e a geração; avalia `evaluateOperationDecisionFromSnapshot` antes de cada execução. |
| **Plugin Orchestrator** | `main.ts` | Fornece `getEmbeddingLifecycleSnapshot()` e orquestra a injeção de dependências sem reconstruir lógica. |

---

## 4. Separação Estrita: Estado vs. Decisão

### 4.1 Estado Factual: `EmbeddingLifecycleSnapshot`
- **Natureza:** Estrutura de dados pura, determinística, imutável e serializável.
- **Responsabilidade:** Representar a verdade factual do sistema num dado instante.
- **Regra:** Não executa ações, não efetua mutações, não faz I/O e não decide intenções.

### 4.2 Decisão Operacional: `deriveEmbeddingWritePathDecision()`
- **Natureza:** Função pura `(snapshot: EmbeddingLifecycleSnapshot) => EmbeddingWritePathDecision`.
- **Responsabilidade:** Traduzir o estado factual numa recomendação operacional inequívoca:
  - `action`: `"none" | "generate" | "update" | "rebuild" | "retry" | "cancel"`
  - `workMode`: `"initial-build" | "incremental" | "full-rebuild" | "publish-only" | "indeterminate"`
  - `canExecute`: booleano indicando se o dispositivo atual tem autoridade e capacidade física para executar a ação.
  - `requiresConfirmation`: booleano indicando se a ação exige confirmação explícita do utilizador (ex: rebuild destrutivo ou provider externo tarifado).
  - `cost`: `"none" | "local" | "external"`
- **Regra:** Nenhum componente de UI ou background pode reinventar ou desviar-se das regras codificadas nesta função.

---

## 5. Estados Primários Canónicos (12 Estados)

O `EmbeddingLifecycleSnapshot.primary` classifica o estado do subsistema em 12 valores formais:

| Estado Primário | Significado Factual | Impacto no Read Path (Pesquisa) | Impacto no Write Path (Escrita) | Comportamento Esperado |
| :--- | :--- | :--- | :--- | :--- |
| `NO_TEXT_INDEX` | O índice textual upstream não existe ou está inválido. | Pesquisa indisponível (`unavailable`). | Escrita bloqueada (`action: none`). | Aguarda indexação textual prévia. |
| `DISABLED` | Embeddings desativados nas definições do dispositivo. | Pesquisa textual apenas (`text-only`). | Escrita bloqueada (`action: none`). | Nenhuma operação é agendada ou executada. |
| `INDEX_ONLY` | Existe índice textual, mas nunca foram gerados embeddings para o vault. | Pesquisa textual apenas (`text-only`). | Ação `generate` disponível (`initial-build`). | Sugere criação inicial de embeddings. |
| `VERIFYING` | O sistema está a calcular planos de atualização ou a verificar integridade. | Mantém modo anterior se disponível. | Escrita temporariamente em pausa (`action: none`). | Aguarda conclusão da análise factual. |
| `READY` | Embeddings publicados, compatíveis e 100% atualizados em relação ao texto. | Pesquisa semântica/híbrida total (`full`). | Nenhuma ação necessária (`action: none`, `updateRequired: false`). | Estado ideal de repouso operacional. |
| `UPDATE_AVAILABLE` | Existem vetores válidos publicados, mas há drift factual (notas modificadas/novas). | **Pesquisa total mantida (`full`)** com base nos vetores existentes. | Ação `update` disponível (`incremental` ou `publish-only`). | Permite auto-dispatch em background ou update manual sem degradar a pesquisa. |
| `INCOMPATIBLE` | Contrato ou modelo configurado diverge do publicado (ex: troca de modelo ou dimensões). | Pesquisa semântica suspensa (`text-only`), banner de incompatibilidade. | Ação `rebuild` disponível (`full-rebuild`). | **Exige confirmação explícita do utilizador** para reconstrução total destrutiva. |
| `INDETERMINATE` | Ficheiros de metadados ilegíveis, erro de parsing ou estado impossível de determinar com segurança. | Pesquisa semântica suspensa (`text-only`). | Escrita estritamente bloqueada (`action: none`, `canExecute: false`). | Previne corrupção acidental; aguarda recuperação. |
| `UPDATING` | Operação física de geração/persistência em curso no Worker. | Pesquisa mantida se existirem vetores; status "A gerar...". | Ação `cancel` disponível (se fase for cancelável). | Protegido por single-flight incondicional. |
| `CANCELLING` | Pedido de cancelamento submetido, aguarda interrupção segura do lote. | Pesquisa preservada. | Ação bloqueada (`disabled: true`). | Aguarda ponto seguro de paragem. |
| `ERROR` | A última operação falhou (ex: timeout de provider, rede, limite). | Pesquisa mantida se vetores prévios intactos. | Ação `retry` disponível (`canRetry: true`). | Expõe diagnóstico de erro no ViewModel. |
| `STANDBY` | Produtor válido configurado, mas sem autoridade ativa de publicação (`activeProducerId` pertence a outro nó). | Pesquisa semântica ativa a partir dos artefactos sincronizados. | Escrita bloqueada (`blockedReason: standby`). | Dispositivo opera em leitura passiva; não despacha workers. |

---

## 6. Invariantes Arquiteturais Congeladas

1. **Fonte Única de Verdade:** É estritamente proibido aos consumidores reconstruir estados, contagens ou decisões fora do `EmbeddingLifecycleSnapshot`.
2. **Zero Silent Fallback:** Estados de erro, incompatibilidade ou indeterminação nunca são transformados silenciosamente em "sem trabalho" ou "sucesso".
3. **Producer Only Write:** Apenas o Active Producer autorizado no manifesto `.lina/ownership.json` pode executar geração, atualização ou publicação física de embeddings.
4. **Companion Isolation:** Dispositivos Companion consomem exclusivamente artefactos sincronizados, executam pesquisas semânticas locais quando compatíveis, e nunca executam workers pesados nem agendam escrita.
5. **Standby Protection:** Produtores em Standby coexistem com segurança sem emitir escritas concorrentes.
6. **Stale While Rebuild:** Durante atualizações incrementais (`UPDATE_AVAILABLE`), a pesquisa semântica permanece disponível com base nos vetores publicados existentes.
7. **Confirmação Obrigatória para Rebuild Destrutivo:** Qualquer reconstrução total que descarte vetores existentes exige confirmação modal explícita do utilizador.
8. **Ownership Fencing em Tempo Real:** Se a autoridade de escrita for revogada durante uma operação ativa, a persistência é imediatamente abortada com código `not-active-producer`.
9. **UI como Apresentadora Pura:** Os componentes de interface (`Sidebar`, `Search View`, Modais de Definições) apenas mapeiam dados do snapshot e da decisão; não contêm regras de negócio.

---

## 7. Contratos e Persistência

### 7.1 Contratos de Dados Persistidos (Imutáveis sem Migração)
- **Vector Contract (`VectorContractV1`):** Localizado em `.lina/embeddings/manifest.json`. Contém `schemaVersion: 1`, `contractId`, `provider`, `model`, `dimensions`, `metric`, `inputVersion`, `prefixMode`.
- **Ficheiro de Embeddings (`.lina/embeddings/chunks.jsonl`):** Registos sequenciais com `chunkId`, `notePath`, `chunkIndex`, `textHash`, `embeddingInputHash`, `vector`.
- **Manifesto de Ownership (`.lina/ownership.json`):** Epoch monotónico crescente, `activeProducerId`, timestamps.

### 7.2 Contratos de Runtime (Memória)
- `EmbeddingLifecycleSnapshot`: Interface pura representando o estado integral.
- `EmbeddingWritePathDecision`: Interface de decisão operacional.
- `EmbeddingWorkAssessment`: Estrutura de análise de trabalho (`reusableCanonical`, `toGenerate`, `missing`, `staleToReplace`, `obsoleteToDrop`).

---

## 8. Papel do Adaptador Canónico (`embeddingLifecycleAdapter.ts`)

O módulo `src/index/embeddingLifecycleAdapter.ts` e a sua função `adaptCurrentStateToLifecycleSnapshot`:
- **NÃO é código shadow:** Não realiza comparações paralelas nem mantém lógica duplicada.
- **É o transformador factual canónico:** Centraliza a projeção de estruturas heterogéneas de baixo nível (índices, estado de processos, nós de rede) para o tipo estrito `EmbeddingLifecycleSnapshot`.
- **Permanece ativo e essencial:** Deve ser mantido como o ponto oficial de instanciação de snapshots a partir de factos brutos.

---

## 9. Padrão Shadow Mode para Migrações Futuras

A LINA-14 estabeleceu e validou com sucesso o padrão institucional de migração segura de subsistemas críticos no Lina:

``` text
1. SHADOW (Implementação pura sem interferência no fluxo ativo)
      ↓
2. COMPARAÇÃO (Testes de paridade e divergência determinística)
      ↓
3. VALIDAÇÃO (Matriz de cenários cobrindo casos normais e limites)
      ↓
4. CUTOVER (Ativação controlada por camadas: Leitura → Escrita → Executores)
      ↓
5. HARDENING & REMOÇÃO (Eliminação do modelo legado e de comparadores)
```

Este padrão deve ser rigorosamente replicado em futuras refatorações estruturais.

---

## 10. Inventário de Legado Removido

Na conclusão da LINA-14, os seguintes componentes legados foram **comprovada e definitivamente eliminados** do repositório:

1. `src/index/embeddingWorkflowState.ts` (modelo de workflow legado e enumerações de fase).
2. `resolveEmbeddingWorkflowState()` e `getEmbeddingWorkflowState()`.
3. `hasEmbeddingWorkAvailable()` em `embeddingWorkStatusController.ts`.
4. `evaluateEmbeddingUpdatePolicy()` legado e comparadores shadow (`compareSchedulerDecision`, `evaluateLegacySchedulerDecision`, `getEmbeddingWritePathShadowComparison`).
5. Propriedades órfãs `workflowState` em `linaSearchView.ts`, `sidebarStatusViewModel.ts` e `main.ts`.
6. Heurísticas ad-hoc de UI e reconstruções locais de snapshots em `main.ts` e `linaSearchView.ts`.

---

## 11. Dívida Técnica Remanescente

### 11.1 Confirmada
- *Nenhuma dívida crítica de lifecycle ativa.* A arquitetura está 100% unificada sob a cadeia canónica.

### 11.2 Backlog para Fases Futuras
- Expansão de novos providers de embeddings (Claude, Gemini, etc.) tirando partido da infraestrutura de `VectorContractV1`.
- Suporte a compressão/quantização de vetores no formato binário experimental.

### 11.3 Não é Dívida Técnica (Função Arquitetural Válida)
- `adaptCurrentStateToLifecycleSnapshot`: É o adaptador funcional legítimo de runtime.
- Matrizes de teste com sufixo `*Shadow*` (ex: `embeddingLifecycleShadowValidation.test.ts`): São testes de regressão de invariantes permanentes e devem ser preservados.

---

## 12. Regras Estritas para Desenvolvimento Futuro

Qualquer novo comando, view, setting ou funcionalidade que interaja com Embeddings **DEVE**:
1. Obter o estado exclusivamente via `plugin.getEmbeddingLifecycleSnapshot()` ou portas de injeção de dependência tipadas.
2. Obter decisões de ação exclusivamente via `deriveEmbeddingWritePathDecision(snapshot)` ou avaliadores dedicados (`evaluateSchedulerDecisionFromSnapshot`, `evaluateEmbeddingUpdatePolicyFromSnapshot`, `evaluateOperationDecisionFromSnapshot`).
3. **NUNCA** ler diretamente ficheiros `.json` ou `.jsonl` em disco para decidir se pode pesquisar ou gerar.
4. **NUNCA** criar novas flags booleanas ou enums de estado de workflow paralelos.
5. **NUNCA** permitir execução de escrita ou workers em dispositivos `companion` ou `standby`.
6. Respeitar a exigência de confirmação do utilizador em operações destrutivas ou com custos externos.

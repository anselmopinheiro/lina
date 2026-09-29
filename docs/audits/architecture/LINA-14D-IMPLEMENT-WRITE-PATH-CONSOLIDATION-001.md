# LINA-14D-IMPLEMENT-WRITE-PATH-CONSOLIDATION-001

**Fase:** LINA-14D-1 — camada shadow do Write Path (primeira sub-fase de LINA-14D)
**Auditoria prévia:** `LINA-14D-AUDIT-WRITE-PATH-CONSOLIDATION-001.md`
**Estado:** Concluída. **Sem alteração de comportamento.**

## 1. Objetivo

Dar ao Write Path uma **representação canónica** derivada do `EmbeddingLifecycleSnapshot` e um mecanismo de **comparação shadow** com as decisões paralelas ainda existentes, sem alterar geração, publicação, agendamento, UI ou persistência.

## 2. O que foi implementado

### 2.1 `src/index/embeddingLifecycleWritePath.ts` (novo, 100 % puro)

| Elemento | Função |
|---|---|
| `deriveEmbeddingWritePathDecision(snapshot)` | Decisão canónica: `applicable`, `workKind/workMode`, `updateRequired`, `severity`, `cost`, **`action`** (`none/generate/update/rebuild/cancel/retry`), `canExecute`, `blockedReason`, **`requiresConfirmation`**, `process` (fase, progresso, cancelabilidade, origem), `ownershipLostDuringOperation`, `canRetry`, `diagnostic` |
| `summarizeLegacyWritePath(inputs)` | Réplicas mínimas das decisões legadas: `controllerWorkAvailable` (tri-estado), `policyPending` e `schedulerPending` (predicados de `main.ts`), `sidebarButtonVisible`, modo do plano, operação, telemetria do `producer-state.json`, confirmação da política |
| `compareLegacyWritePathWithLifecycle(inputs, snapshot)` | Diferenças por área (`work`, `mode`, `action`, `confirmation`, `process`, `authority`, `history`, `primary`) com severidade `info` / `warning` / `divergence`; `consistent` = sem `divergence` |
| `createEmbeddingWritePathShadowComparison(inputs)` | Constrói o snapshot (usando `workState.summary.updatePlan` e `factsChecking` derivado do estado do controller) e compara |

Regras da decisão (por prioridade):
1. **Operação ativa** (`UPDATING`/`CANCELLING`): só `cancel` (se cancelável) ou `none`; fase, progresso e cancelabilidade preservados; nada pode ser pedido (`canExecute=false`).
2. **Escrita não aplicável** (Companion, Standby, Unassigned, embeddings desativados) ou **`VERIFYING`**: `none`.
3. **`ERROR`**: `retry`, controlado por `capability.canRequestUpdate`; diagnóstico preservado.
4. **`INCOMPATIBLE`**: `rebuild`, sempre com confirmação.
5. **`INDEX_ONLY`**: `generate`.
6. **Trabalho pendente**: ação por modo (`initial-build`→`generate`, `incremental`/`publish-only`→`update`, `full-rebuild`→`rebuild`).
7. Caso contrário: `none`.

Confirmação: `rebuild`, `work.mode=full-rebuild`, custo `external` ou `capability.requiresConfirmation`. Limpeza `publish-only` tem custo `none` e não exige confirmação.

### 2.2 Alterações a ficheiros existentes

| Ficheiro | Alteração |
|---|---|
| `src/index/embeddingLifecycleAdapter.ts` | `updatePlan` passa a aceitar `EmbeddingUpdatePlanPreview` (super-conjunto estrutural; `EmbeddingUpdatePlan` continua atribuível). Sem alteração de lógica |
| `main.ts` | Novo método `getEmbeddingWritePathShadowComparison()`: lê estado em memória e, a pedido, `.lina/producer-state.json`; **sem chamadores de produção**, sem escritas |

`embeddingLifecycleModel.ts` **não** foi alterado (14A fechado).

## 3. Estados obrigatórios validados

| Estado | Verificação | Teste |
|---|---|---|
| `READY` | `updateRequired=false`, ação `none`, sem diferenças | §10 |
| `UPDATE_AVAILABLE` | `updateRequired=true`, `action=update`, `read.semanticAvailable=true` | §1 |
| `INCOMPATIBLE` | `action=rebuild`, `requiresConfirmation=true`, pesquisa semântica suspensa, `Companion` sem ação | §6 |
| `UPDATING` | fase, progresso, origem e cancelabilidade preservados; `persisting` não cancelável | §3 |
| `ERROR` | diagnóstico presente, `retry` controlado; sem `retry` sem autoridade; `retry` de rebuild pede confirmação | §5 |

## 4. Cenários pedidos (9) e adicionais

1. Producer com atualização pendente — §1 (3 testes)
2. Companion com artefactos válidos — §2
3. Geração em curso — §3 (2 testes)
4. Cancelamento (`cancelling` e `cancelled`) — §4 (2 testes)
5. Erro de provider — §5 (3 testes)
6. Incompatibilidade de modelo — §6 (3 testes)
7. Perda de ownership — §7
8. Standby — §8
9. Estado indeterminado — §9
+ `READY`, `INDEX_ONLY`, `DISABLED`, `VERIFYING`, `publish-only`, divergências legadas (B7, modo, erro de refresh, telemetria), invariantes, Companion/Standby/Unassigned em todos os estados, imutabilidade, determinismo, réplicas legadas, adapter com preview, pureza do módulo, isolamento de consumidores e leitura apenas do método do plugin.

Total: **34 testes** em `tests/index/embeddingLifecycleWritePath.test.ts`.

## 5. Divergências legadas expostas (evidência para 14D-2…14D-5)

| Evidência | Origem legada | Severidade no shadow | Sub-fase que resolve |
|---|---|---|---|
| Obsoletos sem chunks: controller `true`, política/scheduler `false`, snapshot `publish-only` | `hasEmbeddingWorkAvailable` vs `main.ts:1674/2584` | `divergence` | 14D-2 |
| Canónico ilegível: controller `undefined`, workflow `idle` | `embeddingWorkflowState.ts:61` | `divergence` | 14D-2 |
| Botão visível com embeddings desativados | `linaSearchView.ts` (condição do botão) | `divergence` | 14D-3 |
| Falha de refresh do estado de trabalho não representada no snapshot | `workState.status="error"` | `warning` | 14D-4 |
| Operação ativa sem autoridade de escrita | `OwnershipGate.isAuthorizedSync()` em cache | `divergence` | 14D-5 |
| `plan.mode=full-rebuild` sem representação no snapshot quando o contrato do dispositivo = publicado | `deviceIdentity = vectorContract` no adapter | `divergence` | 14D-2 / Read Path |
| Cancelamento apresentado como `preparing` no workflow legado | `embeddingWorkflowState.ts:89` | `info` | 14D-4 |
| Companion/Standby com trabalho local | controller | `info` (isolamento esperado) | — |

## 6. Achados para as próximas sub-fases

- **WP-1:** `getDeviceDiagnostics` constrói o snapshot **sem** `updatePlan`; o adapter cai no ramo `workflowState` (`mode` sempre `incremental`, `cost` sempre `local`). A camada shadow usa o plano do runtime; o corte do diagnóstico para o plano fica para 14D-2.
- **WP-4:** `deviceIdentity = vectorContract ?? published` no adapter faz com que uma mudança de provider no Produtor não gere `INCOMPATIBLE` no snapshot de produção (só `UPDATE_AVAILABLE` com `mode=full-rebuild`). É Read Path (14C); a decisão derivada trata `full-rebuild` como `rebuild` com confirmação, mas o `primary` continua a depender do adapter.
- **WP-8 (novo):** `capability.canRequestUpdate` exige `upstream.textIndex === "ready"`; um índice textual `stale` (que o botão legado aceita) bloqueia o pedido no snapshot. Decisão de produto pendente.

## 7. Garantias

- **Producer** continua a ser o único responsável por gerar, publicar e atualizar artefactos; nenhum escritor foi alterado.
- **Companion** nunca gera, publica nem executa manutenção; testado em todos os estados de operação (`canExecute=false`, `canRetry=false`, ações ⊆ {`none`,`cancel`}).
- **Sem geração automática**: o módulo não referencia nenhum ponto de entrada de geração; teste estrutural impede que fluxos de produção o consumam.
- **Sem alterações** a schemas, notas Markdown, ownership persistente, formato de embeddings ou contratos externos.

## 8. Validação

| Comando | Resultado |
|---|---|
| `npm ci` | OK (412 pacotes) |
| `npm run typecheck` | OK |
| `npx vitest run tests/index/embeddingLifecycleWritePath.test.ts` | 34/34 |
| `npm test` | **135 ficheiros / 1823 testes** (baseline 134 / 1789 + 34) |
| `npm run lint:obsidian` | 0 erros, 0 avisos |
| `npm run lint:obsidian:strict` | OK (`--max-warnings=0`) |
| `npm run build` | OK (o passo `copy:test-vault` copiou `main.js`, `manifest.json` e `styles.css` para a pasta de plugin do vault de teste configurado; nenhuma nota foi tocada) |
| `npm run release-check` | `READY FOR OBSIDIAN RELEASE` |
| `git diff --check` | limpo |

## 9. Riscos e pontos a validar

- As réplicas legadas em `summarizeLegacyWritePath` espelham predicados inline de `main.ts`; se estes mudarem sem atualizar a réplica, o shadow deixa de ser fiel (mitigação: testes que fixam cada réplica; 14D-2 remove a duplicação).
- O método do plugin lê `producer-state.json` a pedido; não deve ser chamado em ciclos de renderização.
- A validação manual em Obsidian não se aplica (sem alterações de UI).

## 10. Próximas sub-fases

14D-2 (função única de "há trabalho" no controller, política e scheduler) → 14D-3 (botão e pedido manual via decisão derivada) → 14D-4 (`lastOutcome`/histórico) → 14D-5 (fencing de ownership).

## 11. Confirmações

Nenhuma nota do vault foi alterada, criada ou apagada. Nenhum embedding foi gerado. Nenhuma chamada externa. `npm install` não foi executado (usado `npm ci`). Houve alterações em código funcional (módulo puro, tipo do adapter e um método on-demand). Nenhum comando de paleta novo. Nenhum dado guardado no índice (`saveData`).

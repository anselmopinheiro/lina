# LINA-14F1-IMPLEMENT-READ-PATH-UI-CUTOVER-001

## Identificação da Implementação
- **Fase:** LINA-14F.1 — Cutover Ativo do Read Path e UI
- **Data:** 2026-09-30
- **Autor:** Responsável pela Migração Arquitetural do Ciclo de Vida dos Embeddings
- **Status:** Concluído com Sucesso
- **Referência:** `PROMPT-CODEX-LINA-14F1-READ-PATH-UI-CUTOVER-001`
- **Auditoria Prévia:** `docs/audits/architecture/LINA-14F1-AUDIT-READ-PATH-UI-CUTOVER-001.md`

---

## 1. Sumário Executivo

A fase LINA-14F.1 executou com êxito o cutover de leitura e UI para a fonte canónica única `EmbeddingLifecycleSnapshot`. Foram eliminados os fluxos e ramificações que reconstruíam localmente o estado semântico, capacidade de pesquisa, gating de manutenção e frescura através de flags dispersas ou cascatas legadas imperativas.

Os consumidores migrados (`sidebarStatusViewModel`, `embeddingStatusViewModel`, `deviceDiagnostics`, `semanticCapability`, `deviceRuntimeState`) derivam agora o seu estado visual e operacional a partir da estrutura unificada `EmbeddingLifecycleSnapshot` ou de projeções puras deste snapshot.

---

## 2. Consumidores Migrados e Fallbacks Removidos

### 2.1. `src/search/semanticCapability.ts`
- **Modificação:** `evaluateSemanticCapability` passou a delegar integralmente em `evaluateSemanticCapabilityFromSnapshot`, eliminando mais de 100 linhas de verificações e inferências legadas em cascata.
- **Fallbacks Removidos:** Verificações manuais em cascata de ficheiros vetoriais e compatibilidade de modelos; as 4 camadas são resolvidas diretamente através das regiões `snapshot.read`, `snapshot.process` e `snapshot.upstream`.

### 2.2. `src/device/deviceDiagnostics.ts` e `src/device/deviceDiagnosticsModal.ts`
- **Modificação:** `buildDeviceDiagnostics` constrói o `companionSearch` e seções de diagnóstico consumindo `lifecycleSnapshot`.
- **Fallbacks Removidos:** Inferência de modo operacional (`operationalMode`) por combinações soltas de flags de manifesto; o modal e as seções diagnósticas leem o `lifecycleSnapshot` formal.

### 2.3. `src/search/sidebarStatusViewModel.ts`
- **Modificação:** `buildSidebarStatusViewModel` foi refatorado para utilizar `lifecycleSnapshot` em:
  - `role` e permissões de manutenção (`canExecuteMaintenance`, `isAuthorizedProducer`);
  - `embeddingsStatus` e `freshness` orientados pela matriz primária do lifecycle (`READY`, `UPDATE_AVAILABLE`, `INDEX_ONLY`, `INCOMPATIBLE`, `ERROR`, `STANDBY`, `DISABLED`);
  - `searchAvailability` e `hybridMode` derivados de `lifecycleSnapshot.read.effectiveMode`;
  - `degradedAlert` priorizado a partir da compatibilidade e integridade do snapshot.
- **Fallbacks Removidos:** Deduções locais de `isEmbeddingsStale` baseadas exclusivamente em contagem de tempo sem reconciliação de drifts reais.

### 2.4. `src/search/embeddingStatusViewModel.ts`
- **Modificação:** `buildEmbeddingStatusViewModel` deriva headline, contadores diagnósticos (`counts`), ações executáveis (`actions`: update / generate / rebuild / cancel / refresh-status) e guidance a partir de `lifecycleSnapshot.write` e `lifecycleSnapshot.primary`.
- **Fallbacks Removidos:** Resolução ad-hoc de botões baseada em inspeções desfasadas de `workState.summary`.

---

## 3. Matriz de Estados Coberta nos Testes

| Estado Canónico | Comportamento no Read Path / UI | Cobertura de Testes |
|---|---|---|
| `READY` | Pesquisa híbrida completa (`full`), frescura `fresh`, sem alertas degradados. | Testado em `sidebarStatusLifecycleSnapshot.test.ts` e `embeddingStatusLifecycleSnapshot.test.ts` |
| `UPDATE_AVAILABLE` | Pesquisa híbrida completa (`full`), estado `stale` com ação de atualização incremental. | Testado em cenários de drift e snapshot tests |
| `INDEX_ONLY` | Pesquisa degradada para `text-only`, frescura `missing`, oferta de geração inicial. | Validado com e sem embeddings físicos |
| `INCOMPATIBLE` | Pesquisa em `text-only`, alerta `vector-mismatch`, ação obrigatória de reconstrução completa confirmada. | Testado em cenários de mismatch de dimensões e modelo |
| `INDETERMINATE` | Frescura `unknown`, diagnóstico neutro seguro sem falsos alarmes críticos. | Testado em unreadable / parsing failure |
| `ERROR` | Estado `stale`, headline de erro explícito com affordance de retry preservada. | Testado com falhas de operação simuladas |
| `STANDBY` | Modo consumer / sem manutenção local ativa. | Testado em `deviceRole` e lifecycle suites |
| `COMPANION` | Somente leitura / busca habilitada se compatível, sem botões de geração. | Testado em `companionCapability` e `companionSearch` |

---

## 4. Quality Gates e Validação

Todos os quality gates passaram com 100% de conformidade:

1. `npm test` — 139 ficheiros de teste, 1867 testes aprovados (0 falhas);
2. `npm run typecheck` — 0 erros de tipagem TypeScript;
3. `npm run lint:obsidian:strict` — 0 erros, 0 avisos;
4. `npm run build` — Build de produção gerado com sucesso;
5. `npm run release-check` — Aprovado para release Obsidian;
6. `git diff --check` — Sem conflitos ou espaços em branco residuais.

---

## 5. Próximos Passos (LINA-14F.2)

- **LINA-14F.2:** Cutover ativo do Write Path (Scheduler, Policy, Worker, Operation Manager) da fase de shadow para a fonte única canónica.
- **LINA-14G:** Limpeza e remoção definitiva de estruturas legadas redundantes tornadas obsoletas.

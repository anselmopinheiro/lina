# LINA-09: Implementação da Separação entre Frescura de Conteúdo e Idade Cronológica dos Embeddings

**Documento:** `LINA-09-IMPLEMENT-EMBEDDING-FRESHNESS-001`
**Data:** 29 de Setembro de 2026
**Papel:** Arquiteto de Software Sénior e Engenheiro TypeScript/Obsidian
**Estado:** Concluído
**Tipo:** Implementação Arquitetural e UX (Desacoplamento de TTL e Alinhamento com Plano de Atualização)

---

## 1. Causa Corrigida

### O Problema Resolvido
No vault de testes, o utilizador deparava-se com uma incoerência gritante:
- **Search View / Banner:** `🟢 Pesquisa semântica disponível`
- **Sidebar Panel:** `Embeddings: Desatualizado (há 21 dias)`
- **Ação "Atualizar embeddings":** Notificação `Os embeddings já se encontram atualizados.`

### Diagnóstico e Resolução
A causa-raiz foi identificada em [`LINA-09-AUDIT-EMBEDDING-FRESHNESS-VS-UPDATE-PLAN-001.md`](file:///d:/_dev/obsidian/lina/docs/audits/architecture/LINA-09-AUDIT-EMBEDDING-FRESHNESS-VS-UPDATE-PLAN-001.md):
- A Sidebar invocava `computeFreshnessFromTimestamp(manifest.embeddings.updatedAt)` com um limiar fixo de 48 horas (`DEFAULT_STALE_THRESHOLD_MS`).
- Após 48 horas de uma publicação válida, mesmo que nenhuma nota do cofre tivesse sido editada, adicionada ou removida, o sistema classificava os embeddings como `"stale"` (`"Desatualizado"`).
- O motor de atualização, no entanto, comparava hash a hash os chunks textuais e os vetores canónicos através de `calculateEmbeddingUpdatePlan`, concluindo com acerto que o drift era nulo (`hasPendingWork === false`).

A presente implementação eliminou a aplicação de TTL cronológico aos embeddings na Sidebar e ligou a frescura funcional ao indicador real de trabalho do `EmbeddingWorkStatusController`.

---

## 2. Separação Estrita entre Idade e Drift

Ficou formalizada na arquitetura a seguinte separação ontológica:

```text
Idade Cronológica (Informativa)
         ≠
Frescura de Conteúdo (Drift Real de Hashes)
         ≠
Necessidade de Atualização (Work Availability)
         ≠
Prontidão Operacional (Runtime Readiness)
```

1. **Idade Cronológica:** Quanto tempo passou desde a gravação do ficheiro canónico no disco. É uma métrica estritamente histórica e informativa. Não implica que os dados estejam desatualizados.
2. **Frescura de Conteúdo (Drift):** Se os vetores refletem o estado atual dos ficheiros Markdown no cofre. Se as notas não mudaram, os vetores mantêm frescura e fidelidade máxima de 100%, independentemente de terem 1 hora, 21 dias ou 1 ano.
3. **Necessidade de Atualização:** Presença de chunks novos, modificados, apagados ou alteração do modelo configurado.

---

## 3. Fonte Canónica da Idade Informativa

> **Fonte Única:** `manifest.embeddings.updatedAt` (com fallback em `companionState.producerState.embeddings.lastSuccessfulPublicationAt` em nós Companion).

- **Utilização Exclusiva:** Alimenta a função de tempo relativo `formatRelativeTime(effectiveEmbeddingsUpdated, nowMs, strings)`, produzindo strings como `"(há 21 dias)"` ou `"(21 days ago)"`.
- **Invariante:** O valor temporal **nunca** altera, de forma isolada, a cor do indicador, não produz warnings nem marca os embeddings como `stale` / `Desatualizado`.

---

## 4. Fonte Canónica da Necessidade de Atualização

> **Fonte Única:** `EmbeddingWorkStatusController.getState().workAvailable` (ou `calculateEmbeddingUpdatePlan()`).

- **Regra Funcional:**
  ```typescript
  const isOperational = runtimeEmbeddings
    ? Boolean(runtimeEmbeddings.semanticAvailable)
    : Boolean(semanticAvailable && embeddingsReady);

  if (!embeddingsEnabled) {
    embeddingsStatus = "disabled";
  } else if (isOperational) {
    if (embeddingsWorkAvailable === true) {
      embeddingsStatus = "stale";
    } else {
      embeddingsStatus = "fresh";
    }
  }
  ```
- **Resultado:**
  - Se `isOperational === true` e `embeddingsWorkAvailable === false`: Status é `"fresh"` (`"Atualizado (há 21 dias)"`).
  - Se `isOperational === true` e `embeddingsWorkAvailable === true`: Status é `"stale"` (`"Atualização necessária (há 21 dias)"`).
  - Se `contractState === "mismatch"`: Status é `"stale"` (`"Atualização necessária"`).

---

## 5. Alterações de UI e Mapeamento de Estado

### Ficheiros Modificados

1. [`src/i18n/strings.ts`](file:///d:/_dev/obsidian/lina/src/i18n/strings.ts):
   - Adicionada a chave `sidebarFreshnessUpdateRequired` a `UiStrings`:
     - PT: `"Atualização necessária"`
     - EN: `"Update required"`
   - Mantida a chave `sidebarFreshnessStale` (`"Desatualizado"` / `"Outdated"`) para compatibilidade com o índice textual.

2. [`src/search/sidebarStatusViewModel.ts`](file:///d:/_dev/obsidian/lina/src/search/sidebarStatusViewModel.ts):
   - Adicionado `embeddingsWorkAvailable?: boolean` à interface `BuildSidebarStatusViewModelInput`.
   - Atualizada a função `formatFreshnessHumanText` para suportar `staleLabel?: string` com fallback para `strings.sidebarFreshnessStale`.
   - Eliminada a chamada a `computeFreshnessFromTimestamp` para embeddings operacionais.
   - Embeddings operacionais usam agora exclusivamente `embeddingsWorkAvailable` para determinar se necessitam de atualização (`stale` / `sidebarFreshnessUpdateRequired`) ou se estão em dia (`fresh` / `sidebarFreshnessFresh`).

3. [`src/search/linaSearchView.ts`](file:///d:/_dev/obsidian/lina/src/search/linaSearchView.ts):
   - Injetado `embeddingsWorkAvailable: embeddingWorkState?.workAvailable` na chamada a `buildSidebarStatusViewModel`.

---

## 6. Cobertura de Testes

### Testes Adicionados e Ajustados

1. [`tests/search/sidebarStatusUX.test.ts`](file:///d:/_dev/obsidian/lina/tests/search/sidebarStatusUX.test.ts):
   - **Cenário 1 (21 dias sem alterações):**
     `updatedAt = 21 dias atrás`, `embeddingsWorkAvailable = false`, `semanticAvailable = true`.
     Valida que o estado é `"fresh"`, com texto `"Atualizado (há 21 dias)"` (PT) / `"Up to date (21 days ago)"` (EN), e nunca `"Desatualizado"`.
   - **Cenário 2 (21 dias com drift real):**
     `updatedAt = 21 dias atrás`, `embeddingsWorkAvailable = true`, `semanticAvailable = true`.
     Valida que o estado é `"stale"`, com texto `"Atualização necessária (há 21 dias)"` (PT) / `"Update required (21 days ago)"` (EN).
   - **Cenário 3 (Publicação recente sem drift):**
     `updatedAt = 2 h atrás`, `embeddingsWorkAvailable = false`.
     Valida status `"fresh"` e texto `"Atualizado (há 2 h)"`.
   - **Cenário 4 (Idade cronológica isolada de 60 dias):**
     Valida que a idade cronológica isolada de 60 dias sem drift nunca gera `"stale"`.
   - **Cenário 5 (Incompatibilidade de contrato vetorial):**
     Valida que `contractState === "mismatch"` resulta em `"stale"` e aviso de atualização necessária.

2. [`tests/search/sidebarSimplificationUX.test.ts`](file:///d:/_dev/obsidian/lina/tests/search/sidebarSimplificationUX.test.ts):
   - Ajustados testes 10 e 11 para refletir a nova semântica: o índice textual continua sujeito à janela de 24h-48h de gravação, enquanto os embeddings operacionais permanecem `"fresh"` na ausência de drift de notas.

---

## 7. Validações Técnicas

Todas as validações obrigatórias foram executadas com sucesso:
- **`npm test`:** 123 ficheiros de teste executados, 1667 testes aprovados (100% verde).
- **`npm run typecheck`:** `tsc --noEmit` concluído com código 0.
- **`npm run lint:obsidian:strict`:** `eslint` concluído com 0 erros e 0 avisos.
- **`npm run build`:** Build de produção gerado e copiado para o cofre de teste.
- **`npm run release-check`:** `READY FOR OBSIDIAN RELEASE` aprovado.
- **`git diff --check`:** Zero erros de formatação, trailing whitespace ou marcadores residuais.

---

## 8. Riscos Residuais

- **Impacto em cofres sem notas alteradas:** Risco nulo. O utilizador deixa de ser bombardeado com o aviso falso "Desatualizado (há 21 dias)", vendo o estado coerente "Atualizado (há 21 dias)".
- **Impacto em cofres com drift:** Risco nulo. Assim que o utilizador altera ou adiciona notas, o `EmbeddingWorkStatusController` deteta a alteração de hash, `workAvailable` transita para `true`, e a Sidebar exibe imediatamente `"Atualização necessária (há X dias)"`.
- **Ação manual "Atualizar embeddings":** Quando não há trabalho pendente, preserva integralmente a resposta `"Os embeddings já se encontram atualizados."`, sem mutações artificiais.

---

## 9. Confirmação de Ausência de Alterações a Schemas, Contratos e Persistência

- **Zero alterações a schemas:** Nenhum ficheiro JSON persistente (`ownership.json`, `manifest.json`, `producer-state.json`, `devices/*.json` ou `data.json`) sofreu alterações de esquema.
- **Zero alterações ao VectorContract:** O contrato vetorial canónico e a sua identidade permanecem estritamente intactos.
- **Zero mutações forçadas:** Nenhum ficheiro foi reescrito ou bumpado artificialmente para "refrescar" timestamps.

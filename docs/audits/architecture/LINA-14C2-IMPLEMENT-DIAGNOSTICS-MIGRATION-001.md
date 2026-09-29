# LINA-14C2-IMPLEMENT-DIAGNOSTICS-MIGRATION-001: Relatório de Migração dos Consumidores de Diagnóstico para o Snapshot Canónico

**Fase:** LINA-14C.2  
**Data:** 2026-09-29  
**Status:** IMPLEMENTAÇÃO CONCLUÍDA / APROVADA  
**Alvo da Fase 14C.2:** `EmbeddingStatusViewModel` (`src/search/embeddingStatusViewModel.ts`), Diagnósticos de Dispositivo (`src/device/deviceDiagnostics.ts`) e modais de diagnóstico associados.

---

## 1. Contexto e Auditoria Inicial

Na sequência da consolidação do modelo puro de ciclo de vida (`EmbeddingLifecycleSnapshot` — LINA-14A), do adapter em Shadow Mode (LINA-14B), da validação dos cenários canónicos (LINA-14B.1) e da migração da Sidebar (LINA-14C.1), a fase **LINA-14C.2** abordou a migração dos consumidores de diagnóstico de embeddings.

Antes desta fase, os diagnósticos de embeddings dependiam de classificações manuais dispersas a partir de múltiplos booleanos (`embeddingsReady`, `indexReady`, `workAvailable`, `semanticAvailable`, flags de proveniência e planos parciais), com risco de divergência nas decisões de apresentação.

---

## 2. Consumidores Migrados e Alterações Realizadas

### 2.1. Embedding Status View Model (`src/search/embeddingStatusViewModel.ts`)
- **Extensão de Contrato:** Adicionado `lifecycleSnapshot?: EmbeddingLifecycleSnapshot` ao `BuildEmbeddingStatusViewModelInput`.
- **Classificação Canónica:**
  - `headline` e `tone`: Determinados a partir de `lifecycleSnapshot.primary`, respeitando estados activos (`UPDATING`, `CANCELLING`), falhas (`ERROR`), cálculo (`VERIFYING`, `INDETERMINATE`), incompatibilidades (`INCOMPATIBLE`), ausência de embeddings (`INDEX_ONLY`), trabalho pendente (`UPDATE_AVAILABLE`) e estado pronto (`READY`).
  - `runtimeLabel`: Derivado diretamente de `lifecycleSnapshot.primary` e `lifecycleSnapshot.write.updateRequired`.
  - `actions`:
    - Bloqueio estrito de ações de mutação de escrita (`generate`, `update`, `rebuild`) quando `lifecycleSnapshot.write.applicable === false` (garantia fundamental para nós Companion e Standby).
    - Preservação da exigência de confirmação para reconstruções completas (`requiresFullRebuildConfirmation: true`) em `INCOMPATIBLE` ou `full-rebuild`.
  - `counts`, `published` e `nextGeneration`: Consomem diretamente as métricas de trabalho (`write.work.counts`), identidades comparadas (`read.compatibility.published`, `read.compatibility.device`) e timestamps canónicos.
  - `guidance`: Apresenta orientações contextuais canónicas (reconstrução completa, checkpoint recuperável, atualização incremental, aviso de Companion gerido pelo produtor ativo, aviso de Standby).

### 2.2. Modelo de Diagnóstico de Dispositivo (`src/device/deviceDiagnostics.ts`)
- **Contrato e Options:** Adicionado `lifecycleSnapshot?: EmbeddingLifecycleSnapshot` a `BuildDeviceDiagnosticsInput` e `ReadDeviceDiagnosticsOptions`.
- **Secção de Pesquisa/Companion (`companionSearch`):**
  - Avaliação de `textIndexAvailable` e `embeddingsAvailable` derivada das regiões `upstream` e `read.compatibility` do snapshot.
  - Disponibilidade semântica operacional e modo de pesquisa (`operationalSemanticAvailable`, `operationalMode`, `operationalReason`) alimentados diretamente por `lifecycleSnapshot.read`.
  - Retrocompatibilidade total preservada quando `lifecycleSnapshot` não for fornecido.

---

## 3. Conformidade com as Regras UX Obrigatórias

O modelo de diagnóstico implementado satisfaz integralmente os 7 cenários canónicos exigidos:

1. **READY:** Diagnóstico verde (`tone: "success"`), pesquisa semântica ativa (`read.semanticAvailable: true`), sem ações de mutação desnecessárias; a idade dos artefactos é exibida apenas como detalhe temporal descritivo, nunca como critério de obsolescência funcional.
2. **UPDATE_AVAILABLE:** Vetores existentes permanecem operacionais para pesquisa se válidos; sinaliza atualização pendente e oferece botão de atualização incremental sem exigir confirmação destrutiva.
3. **INCOMPATIBLE:** Pesquisa semântica bloqueada preventivamente com motivo explícito de incompatibilidade vetorial; botão de reconstrução exige confirmação atómica explícita; zero fallback silencioso.
4. **INDEX_ONLY:** Índice textual disponível e ausência de vetores; apresenta headline clara de detalhes indisponíveis e oferece ação de geração inicial (quando no produtor ativo).
5. **Companion:** O dispositivo consome e pesquisa, mas **nunca** assume necessidade local de escrita, não apresenta botões de geração/atualização e exibe aviso de manutenção gerida pelo nó produtor ativo.
6. **ERROR:** Apresenta tom de erro, runtime label de erro e mantém possibilidade de retry/refresh.
7. **Prior Epoch:** Embeddings criados em época anterior permanecem válidos e utilizáveis, com histórico de publicação e identidade publicados preservados.

---

## 4. Testes e Validação

### 4.1. Testes Automatizados Dedicados
- Criado o ficheiro [`tests/search/embeddingStatusLifecycleSnapshot.test.ts`](file:///d:/_dev/obsidian/lina/tests/search/embeddingStatusLifecycleSnapshot.test.ts) cobrindo explicitamente os 7 cenários obrigatórios (READY, UPDATE_AVAILABLE, INCOMPATIBLE, INDEX_ONLY, Companion, ERROR, Prior Epoch).
- Suíte completa executada: **132 ficheiros de teste / 1770 testes passaram com 100% de sucesso**.

### 4.2. Comandos de Verificação
- `npm test` $\to$ 132/132 suites verdes (1770 testes aprovados).
- `npm run typecheck` $\to$ 0 erros TypeScript (`tsc --noEmit`).
- `npm run lint:obsidian:strict` $\to$ 0 erros e 0 avisos ESLint.
- `npm run build` $\to$ Build de produção concluída com sucesso.
- `npm run release-check` $\to$ Verificação de integridade do plugin Obsidian aprovada.
- `git diff --check` $\to$ Sem problemas de formatação ou whitespace.

---

## 5. Limitações e Impacto Arquitetural

- **Natureza Estritamente Read-Only:** Nenhuma alteração foi efetuada no fluxo de escrita, gravação em disco, geração de embeddings ou publicação de manifests.
- **Isolamento de Consumidores:** A migração foi realizada mantendo retrocompatibilidade estrita nos view models e adaptadores de diagnóstico.
- **Próximas Fases:** A fase seguinte (LINA-14C.3 / LINA-14D) consolidará a transição dos fluxos de avaliação de capacidade operacional e orquestração do pipeline.

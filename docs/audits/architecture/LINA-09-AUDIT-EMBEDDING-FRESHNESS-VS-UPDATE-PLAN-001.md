# LINA-09: Auditoria de Coerência entre Frescura de Embeddings e Plano de Atualização

**Documento:** `LINA-09-AUDIT-EMBEDDING-FRESHNESS-VS-UPDATE-PLAN-001`
**Data:** 29 de Setembro de 2026
**Papel:** Arquiteto de Software Sénior
**Estado:** Concluído
**Tipo:** Exclusivamente Auditoria (Sem alterações de código, UI, schemas, migrations ou commits)

---

## 1. Resumo Executivo

### O Paradoxo Observado
No vault de testes, o utilizador depara-se com três indicações simultâneas e contraditórias:
1. **Search View / Banner:** `🟢 Pesquisa semântica disponível` (ou `Pesquisa híbrida disponível`).
2. **Sidebar Panel:** `Embeddings: Desatualizado (há 21 dias)`.
3. **Ação "Atualizar embeddings":** Notificação explícita `Os embeddings já se encontram atualizados.`.

### Conclusão Principal da Auditoria
A contradição **não resulta de um erro no cálculo de vetores nem de corrupção de ficheiros**, mas sim de uma **confusão arquitetural fundamental entre Idade Cronológica e Frescura de Conteúdo**:
1. **O valor "há 21 dias" é real e legítimo:** Corresponde com precisão ao timestamp ISO gravado em `.lina/index/manifest.json` (`manifest.embeddings.updatedAt`), gerado aquando da última publicação canónica dos ficheiros vetoriais há 21 dias.
2. **A classificação "Desatualizado" na Sidebar é um falso positivo arquitetural:** A Sidebar (`sidebarStatusViewModel.ts`) avalia a data de publicação através de um limiar temporal ingénuo do tipo TTL (`computeFreshnessFromTimestamp` com `staleThresholdMs = 48 horas`). Se decorreram mais de 48 horas desde a gravação do ficheiro, a Sidebar rotula sumariamente os embeddings como `"stale"` (`"Desatualizado"`), **mesmo que nenhuma nota tenha sido criada, editada ou apagada no cofre**.
3. **A conclusão "embeddings já atualizados" da ação é a única matematicamente correta:** A ação "Atualizar embeddings" executa `calculateEmbeddingUpdatePlan` e compara os hashes SHA-256 de cada chunk atual no cofre (`chunks.jsonl`) com os registos persistidos em disco (`embeddings.jsonl`). Como nenhuma nota mudou, o drift é zero (`toGenerateCount = 0`, `missingCount = 0`, `staleCount = 0`, `obsoleteCount = 0`), e a ação recusa-se com razão a gastar computação/energia para regenerar vetores idênticos.

A separação axiomática imperativa é:
```text
Idade Cronológica (Informativa)
         ≠
Frescura de Conteúdo (Content Drift / Hashes)
         ≠
Necessidade de Atualização (Work Availability)
         ≠
Prontidão Operacional (Runtime Readiness)
```

---

## 2. Origem Exata do "há 21 dias"

### 2.1. O Caminho do Dado (Data Flow)

O caminho completo que culmina na string `Desatualizado (há 21 dias)` na Sidebar é o seguinte:

```text
.lina/index/manifest.json (campo embeddings.updatedAt)
                    ↓
src/index/embeddingGenerator.ts :: readEmbeddingManifest(app)
                    ↓
src/index/embeddingGenerator.ts :: parsePublishedEmbeddingIdentity(manifest)
  → extrai: updatedAt: embeddings.updatedAt
                    ↓
src/index/embeddingGenerator.ts :: readEmbeddingStatus(app)
  → devolve: EmbeddingIndexStatus.updatedAt
                    ↓
main.ts :: getEmbeddingWorkStatusController().refreshSummary()
  → consolida em: EmbeddingWorkSummary.updatedAt
                    ↓
src/search/linaSearchView.ts :: refreshState() (L2636 / L2718)
  → embeddingStatus = embeddingWorkState.summary
  → passa a buildSidebarStatusViewModel: embeddingsUpdatedAt: embeddingStatus?.updatedAt
                    ↓
src/search/sidebarStatusViewModel.ts :: buildSidebarStatusViewModel() (L327)
  → effectiveEmbeddingsUpdated = embeddingsUpdatedAt
                    ↓
src/search/sidebarStatusViewModel.ts :: formatRelativeTime() (L136 / L373)
  → diffMs = nowMs - Date.parse(effectiveEmbeddingsUpdated) (21 dias)
  → formata: "há 21 dias"
                    ↓
src/search/sidebarStatusViewModel.ts :: computeFreshnessFromTimestamp() (L170 / L345)
  → diffMs > DEFAULT_STALE_THRESHOLD_MS (48h)
  → devolve status: "stale"
                    ↓
src/search/sidebarStatusViewModel.ts :: formatFreshnessHumanText() (L209 / L377)
  → strings.sidebarFreshnessStale + " (" + relativeTime + ")"
  → "Desatualizado (há 21 dias)"
```

### 2.2. Detalhes de Código e Responsabilidades

1. **Origem do Timestamp Persistido:**
   - **Ficheiro:** [`src/index/embeddingPersistence.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingPersistence.ts#L769-L788)
   - **Função:** `buildManifestCandidate(currentManifest, records, info)`
   - **Linha 769 / 788:**
     ```typescript
     const now = new Date().toISOString();
     // ...
     embeddings: {
       enabled: true,
       provider: info.provider,
       model: info.model,
       totalEmbeddings: records.length,
       dimensions: info.dimensions,
       updatedAt: now,
       publicationId,
       // ...
     }
     ```
   - Este timestamp é gravado atomicamente quando uma operação de publicação (`publishCanonicalEmbeddings`) é concluída com sucesso.

2. **Leitura da Identidade Publicada:**
   - **Ficheiro:** [`src/index/embeddingGenerator.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingGenerator.ts#L1622-L1644)
   - **Função:** `parsePublishedEmbeddingIdentity(manifest)`
   - **Linha 1639:**
     ```typescript
     updatedAt: typeof embeddings.updatedAt === "string" ? embeddings.updatedAt : "",
     ```

3. **Consumo na Vista de Pesquisa:**
   - **Ficheiro:** [`src/search/linaSearchView.ts`](file:///d:/_dev/obsidian/lina/src/search/linaSearchView.ts#L2636-L2718)
   - **Função:** `LinaSearchView.refreshState()`
   - **Linha 2636 / 2718:**
     ```typescript
     const embeddingStatus = embeddingWorkState.summary;
     // ...
     const sidebarStatus = buildSidebarStatusViewModel({
       // ...
       embeddingsUpdatedAt: embeddingStatus?.updatedAt ?? null,
       // ...
     });
     ```

4. **Classificação Temporal Errónea na Sidebar:**
   - **Ficheiro:** [`src/search/sidebarStatusViewModel.ts`](file:///d:/_dev/obsidian/lina/src/search/sidebarStatusViewModel.ts#L170-L189)
   - **Função:** `computeFreshnessFromTimestamp(isoDate, nowMs, agingThresholdMs, staleThresholdMs)`
   - **Constantes:** [`src/device/producerState.ts`](file:///d:/_dev/obsidian/lina/src/device/producerState.ts#L32-L35)
     - `DEFAULT_AGING_THRESHOLD_MS = 24 * 60 * 60 * 1000` (24 horas)
     - `DEFAULT_STALE_THRESHOLD_MS = 48 * 60 * 60 * 1000` (48 horas)
   - **Linha 188:** Como a diferença entre o momento atual e o timestamp de 21 dias atrás é ~1.814.400.000 ms (muito superior a 172.800.000 ms / 48 horas), o classificador retorna taxativamente `"stale"`.
   - **Linha 344-346:** Mesmo com `isOperational === true`, a Sidebar executa:
     ```typescript
     if (effectiveEmbeddingsUpdated) {
       const tsStatus = computeFreshnessFromTimestamp(effectiveEmbeddingsUpdated, nowMs);
       embeddingsStatus = tsStatus !== "unknown" ? tsStatus : "fresh";
     }
     ```
   - **Linha 210:** `formatFreshnessHumanText` combina o rótulo de `"stale"` (`"Desatualizado"`) com o tempo relativo (`"(há 21 dias)"`), gerando:
     `"Desatualizado (há 21 dias)"`.

---

## 3. Origem Exata do "Embeddings já atualizados"

### 3.1. O Caminho da Decisão Funcional

Quando o utilizador clica no botão "Atualizar embeddings" ou executa o comando na paleta de comandos:

```text
Comando / Botão "Atualizar embeddings"
                    ↓
main.ts :: confirmAndRequestEmbeddingGeneration("sidebar" | "command") (L1629)
                    ↓
src/index/embeddingGenerator.ts :: readEmbeddingUpdatePreview(app, ...) (L1569)
                    ↓
src/index/embeddingUpdatePlan.ts :: calculateEmbeddingUpdatePlan(input) (L214)
                    ↓
src/index/embeddingGenerator.ts :: calculateEmbeddingState(input)
  - Carrega chunks atuais de .lina/index/chunks.jsonl
  - Carrega vetores canónicos de .lina/index/embeddings.jsonl
  - Hash match (chunk.contentHash === record.chunkHash)
  - Resultado: missingCount = 0, staleCount = 0, obsoleteCount = 0
                    ↓
src/index/embeddingUpdatePlan.ts :: (L307 / L314)
  - chunksToGenerate.length === 0
  - requiresPublication === false
  - toGenerateCount === 0
                    ↓
src/maintenance/embeddingPolicyEngine.ts :: evaluateEmbeddingUpdatePolicy() (L71-L95)
  - hasPendingWork === false
  - Devolve: { allowed: false, requiresConfirmation: false, reason: "no-update-required" }
                    ↓
main.ts :: prepareEmbeddingUpdateConfirmation() → devolve null
                    ↓
main.ts :: (L1690-L1692)
  if (!isFullRebuild && (updatePlan.toGenerateCount === 0 || policyDecision.reason === "no-update-required")) {
    new Notice(this.L.confirmEmbeddingUpdateNoWorkNotice); // "Os embeddings já se encontram atualizados."
    return { success: true, message: this.L.confirmEmbeddingUpdateNoWorkNotice };
  }
```

### 3.2. Critérios Concretos da Decisão

Para o Lina concluir que não há embeddings a atualizar, todos os seguintes critérios foram rigorosamente validados pelo `calculateEmbeddingUpdatePlan`:
1. **Existência Física:** `.lina/index/embeddings.jsonl` existe e é legível (`canonicalReadability === "readable"`).
2. **Contrato Vetorial Compatível:** O `provider`, `model`, `dimensions` e `prefixMode` configurados correspondem exatamente à identidade publicada em `.lina/index/manifest.json`.
3. **Zero Chunks em Falta (`missingCount === 0`):** Não existe nenhum chunk no ficheiro `chunks.jsonl` que não possua o respetivo vetor em `embeddings.jsonl`.
4. **Zero Chunks Alterados (`staleCount === 0`):** Para todos os chunks do cofre, o `chunk.contentHash` é estritamente igual ao `record.chunkHash` persistido.
5. **Zero Registos Órfãos (`obsoleteCount === 0`):** Não existem vetores em `embeddings.jsonl` pertencentes a notas que tenham sido apagadas do cofre.
6. **Zero Registos Inválidos ou Duplicados:** `invalidRecordCount === 0` e `duplicateRecordCount === 0`.
7. **Ausência de Necessidade de Publicação (`requiresPublication === false`):** Não há checkpoints residuais nem operações pendentes de reconciliação.

Como o cofre permaneceu inalterado nos 21 dias decorridos, **o índice está perfeito e 100% sincronizado com o texto das notas**. A conclusão `"Os embeddings já se encontram atualizados."` é irrepreensível.

---

## 4. Matriz Comparativa entre os Dois Fluxos

| Conceito | Fonte Atual | Significado Real | É Verdadeiro? | Deve Controlar a UI de Frescura? |
|---|---|---|---|---|
| **“há 21 dias”** | `manifest.embeddings.updatedAt` | Data em que a última escrita no ficheiro canónico foi efetuada. | **Sim.** Os ficheiros foram efetivamente gerados há 21 dias. | **Apenas como idade informativa.** Não como indicador de validade. |
| **“Desatualizado” (Sidebar)** | `computeFreshnessFromTimestamp(manifest.embeddings.updatedAt)` | O ficheiro de embeddings tem mais de 48 horas cronológicas de existência. | **Falso.** Assume erradamente que tempo = caducidade de dados. | **NÃO.** Nunca deve controlar o estado de frescura de embeddings. |
| **Conteúdo Atual (Plan)** | `calculateEmbeddingUpdatePlan` (comparação de hashes dos chunks) | O conteúdo semântico dos vetores reflete com precisão exata o texto de todas as notas do cofre. | **Sim.** Zero drift verificado hash a hash. | **SIM.** É a única fonte de verdade da frescura de conteúdo. |
| **Contrato Compatível** | `VectorContract` (Settings vs Manifest) | O modelo configurado (ex: `nomic-embed-text`) é idêntico ao modelo que gerou os vetores. | **Sim.** Compatibilidade total. | **SIM.** Controla se a pesquisa semântica pode operar. |
| **Rebuild Necessário** | `updatePlan.mode === "full-rebuild"` | Incompatibilidade de modelo, dimensões ou corrupção de ficheiro. | **Não.** Não é necessário rebuild. | **SIM.** Controla se a UI deve sugerir regeneração total. |
| **semanticAvailable** | `DeviceRuntimeState.embeddings.semanticAvailable` | O motor de pesquisa consegue carregar os vetores em memória e executar cálculo de similaridade de cossenos. | **Sim.** Pesquisa híbrida 100% operacional. | **SIM.** Controla os badges de pesquisa e o headline da Sidebar. |

---

## 5. Inspeção dos Artefactos Reais

Com base nas definições dos schemas canónicos e no fluxo de persistência observado:

### 5.1. `.lina/index/manifest.json`
O manifesto canónico do cofre contém:
- **`updatedAt` (raiz):** Timestamp da última atualização do índice textual.
- **`generationId` (raiz):** UUID identificador da geração textual.
- **`embeddings.updatedAt`:** Timestamp ISO da última publicação de embeddings (o valor de onde provém os "21 dias").
- **`embeddings.publicationId`:** UUID único e imutável atribuído no momento da publicação.
- **`embeddings.totalEmbeddings`:** Contagem exata de vetores em `embeddings.jsonl`.
- **`embeddings.vectorContract`:** Objeto imutável contendo `{ provider, model, dimensions, metric: "cosine", prefixMode, inputVersion }`.
- **`embeddings.provenance`:** `{ activeProducerId, epoch, generatedAt }`.

### 5.2. `.lina/producer-state.json`
O ficheiro de sincronização de produtor contém:
- **`updatedAt`:** Heartbeat periódico do dispositivo produtor ativo.
- **`producerEpoch`:** Época de ownership em que o produtor está a correr.
- **`embeddings.lastSuccessfulPublicationAt`:** Cópia sincronizada do timestamp da última publicação para consumo de nós companion.

### 5.3. Análise Crítica
- O timestamp que alimenta a indicação "há 21 dias" **é o timestamp canónico interno** de `manifest.embeddings.updatedAt`. Não é uma inferência do `mtime` do sistema de ficheiros (que poderia ser alterado pelo Git, Obsidian Sync ou antivírus).
- Portanto, o valor cronológico é íntegro e autêntico. O erro reside exclusivamente na interpretação desse valor como uma métrica de obsolescência de dados.

---

## 6. Análise dos Cenários Obrigatórios

### Cenário A — Conteúdo sem alterações durante 21 dias (O Caso do Utilizador)
- **Estado Real:**
  - `semanticAvailable = true`
  - `toGenerateCount = 0`, `missingCount = 0`, `staleCount = 0`, `obsoleteCount = 0`
  - `updatePlan = no-work`
- **Comportamento Atual:** A Sidebar diz `Desatualizado (há 21 dias)` e o botão diz `Os embeddings já se encontram atualizados.`.
- **Comportamento Esperado:**
  - A UI deve apresentar: `Embeddings: Atualizados (há 21 dias)` ou `Embeddings: Prontos (gerados há 21 dias)`.
  - A ação "Atualizar embeddings" mantém `Os embeddings já se encontram atualizados.`.
  - **Coerência total:** Não há qualquer contradição visual ou funcional.

---

### Cenário B — Conteúdo alterado ontem, embeddings não atualizados
- **Estado Real:**
  - O utilizador modificou 5 notas e adicionou 2 notas ontem.
  - `toGenerateCount = 7`, `staleCount = 5`, `missingCount = 2`
  - `updatePlan = work-required`
- **Comportamento Esperado:**
  - A Sidebar apresenta legitimamente: `Embeddings: Atualização necessária (7 notas/chunks pendentes)`.
  - A ação "Atualizar embeddings" abre o modal de confirmação ou gera os 7 embeddings incrementais.
  - A classificação de desatualização baseia-se no **drift de chunks**, não nas horas que passaram.

---

### Cenário C — Timestamp legado / Errado
- **Análise:** Não foi detetado uso de timestamp corrompido ou legado. O timestamp usado (`manifest.embeddings.updatedAt`) é o correto para saber quando os embeddings foram calculados pela última vez.
- **Classificação do Bug:**
  - **Bug Arquitetural / Lógico:** A função `computeFreshnessFromTimestamp` em `sidebarStatusViewModel.ts` aplica regras de heartbeat/TTL a dados estáticos indexados.
  - O bug não é o valor da data, mas sim o classificador que transforma uma data > 48h num estado de erro funcional (`"stale"`).

---

### Cenário D — Embeddings regenerados agora
Se o utilizador forçar a regeneração (ou se o plano tiver trabalho e o utilizador atualizar):
1. **O que muda em disco:**
   - `.lina/index/embeddings.jsonl` é reescrito com os novos vetores.
   - `.lina/index/manifest.json` é atualizado com novo `embeddings.updatedAt = now` e novo `embeddings.publicationId`.
   - Se o produtor estiver ativo, `.lina/producer-state.json` atualiza `embeddings.lastSuccessfulPublicationAt = now`.
2. **O que reflete na UI:**
   - `EmbeddingWorkStatusController` recebe o evento `embeddings-published` e relê o manifesto.
   - `LinaSearchView` faz refresh.
   - A Sidebar passa a apresentar: `Atualizado (há instantes)` / `Just now`.

---

## 7. Classificação e Inventário de Bugs Encontrados

### Bug 1: Confusão entre TTL Cronológico e Validade de Conteúdo
- **Local:** [`src/search/sidebarStatusViewModel.ts`](file:///d:/_dev/obsidian/lina/src/search/sidebarStatusViewModel.ts#L343-L353)
- **Problema:** A Sidebar determina `embeddingsStatus` invocando `computeFreshnessFromTimestamp(effectiveEmbeddingsUpdated, nowMs)` mesmo quando `isOperational === true`.
- **Efeito:** Qualquer cofre estável cujas notas não sejam editadas há mais de 48 horas terá os seus embeddings marcados como `"Desatualizado"`, gerando alarmismo falso no utilizador.

### Bug 2: Ignorância da Fonte de Verdade de Trabalho (`EmbeddingWorkRuntimeState`)
- **Local:** [`src/search/linaSearchView.ts`](file:///d:/_dev/obsidian/lina/src/search/linaSearchView.ts#L2708-L2728) e [`src/search/sidebarStatusViewModel.ts`](file:///d:/_dev/obsidian/lina/src/search/sidebarStatusViewModel.ts#L85-L121)
- **Problema:** `LinaSearchView` já dispõe de `embeddingWorkState` (que contém `workAvailable: boolean` calculado a partir de hashes reais). No entanto, não passa este indicador para `buildSidebarStatusViewModel`.
- **Efeito:** O componente visual mais visível do plugin (Sidebar) ignora completamente o motor analítico de drift que já existe no controlador.

### Bug 3: Sobrecarga Semântica do Termo "Desatualizado"
- **Problema:** O termo "Desatualizado" (`sidebarFreshnessStale`) é usado simultaneamente para:
  1. Embeddings gerados há mais de 2 dias num cofre intacto.
  2. Embeddings onde o utilizador alterou o texto das notas.
  3. Embeddings gerados com um modelo diferente do atual.
  4. Embeddings de uma época anterior de ownership.
- **Efeito:** Ambiguidade total na interface; o utilizador não sabe se precisa de atualizar, se a pesquisa vai falhar ou se está tudo bem.

---

## 8. Fontes Canónicas Recomendadas

Para eliminar definitivamente o conflito, a arquitetura do Lina deve adotar **duas fontes canónicas com papéis estritamente separados**:

### 8.1. Fonte Canónica para "Idade Informativa / Última Publicação"
> **Fonte Única:** `manifest.embeddings.updatedAt` (com fallback em `companionState.producerState.embeddings.lastSuccessfulPublicationAt` em nós Companion).

- **Propósito:** Meramente informativo e histórico.
- **Apresentação:** "Gerado há 21 dias" / "Última geração: há 21 dias".
- **Regra de Ouro:** A idade cronológica **NUNCA** altera a cor do indicador para amarelo/vermelho nem muda o status operacional para "Desatualizado".

### 8.2. Fonte Canónica para "Necessidade de Atualização" (Work Required)
> **Fonte Única:** `EmbeddingWorkStatusController.getState().workAvailable` (ou `calculateEmbeddingUpdatePlan`).

- **Critério:**
  ```typescript
  const workRequired = (summary?.updatePlan?.toGenerateCount ?? 0) > 0
    || summary?.updatePlan?.requiresPublication === true
    || (summary?.staleCount ?? 0) > 0
    || (summary?.missingCount ?? 0) > 0
    || (summary?.obsoleteCount ?? 0) > 0;
  ```
- **Propósito:** Decidir se os dados estão funcionais ou se requerem ação do utilizador.
- **Regra de Ouro:** Só existe estado "Desatualizado / Atualização necessária" se `workRequired === true` ou se houver incompatibilidade de modelo (`contractState === "mismatch"`). Se `workRequired === false`, os embeddings estão **Atualizados / Em dia**, independentemente da idade do ficheiro.

---

## 9. Terminologia Recomendada para a UI

A Sidebar e os Diálogos devem separar com clareza o **Estado Funcional** da **Idade do Ficheiro**:

### Proposta de Apresentação na Sidebar:

1. **Quando o cofre está consistente e não há trabalho pendente (`workAvailable === false`):**
   - **Status:** `🟢 Embeddings: Atualizados` (ou `Prontos`)
   - **Subtexto / Detalhe:** `Gerados há 21 dias`
   - *Nunca apresentar a palavra "Desatualizado".*

2. **Quando existem notas alteradas ou novas (`workAvailable === true`):**
   - **Status:** `🟡 Embeddings: Atualização necessária`
   - **Subtexto / Detalhe:** `5 notas modificadas • Gerados há 21 dias`

3. **Quando o modelo configurado foi alterado (`contractState === "mismatch"`):**
   - **Status:** `🟠 Embeddings: Incompatíveis com o modelo`
   - **Subtexto / Detalhe:** `Reconstrução necessária`

4. **Quando os vetores ainda não foram gerados (`vectorFileState === "missing"`):**
   - **Status:** `⚪ Embeddings: Não gerados`
   - **Subtexto / Detalhe:** `Geração inicial necessária`

---

## 10. Recomendações para Implementação Futura (Sem Implementação Nesta Fase)

Quando for autorizada a implementação (ex: `LINA-09-IMPLEMENT-EMBEDDING-FRESHNESS-COHERENCE-001`):

1. **Alargar `BuildSidebarStatusViewModelInput`:**
   Adicionar os campos derivados do `EmbeddingWorkRuntimeState`:
   - `workAvailable?: boolean;`
   - `pendingChunksCount?: number;`
2. **Atualizar `buildSidebarStatusViewModel`:**
   - Eliminar a chamada a `computeFreshnessFromTimestamp` para determinar o `embeddingsStatus` quando `isOperational === true`.
   - Quando `isOperational === true`:
     - Se `workAvailable === true` (ou `staleCount > 0`): `embeddingsStatus = "stale"` (ou `"work-required"`).
     - Se `workAvailable === false`: `embeddingsStatus = "fresh"`.
   - O timestamp `effectiveEmbeddingsUpdated` deve ser usado exclusivamente por `formatRelativeTime` para alimentar o texto descritivo secundário (`relativeTime`).
3. **Harmonizar Testes Unitários de UX:**
   - Ajustar os testes em `tests/search/sidebarStatusUX.test.ts` para validar que embeddings operacionais sem trabalho pendente mantêm `status: "fresh"` mesmo após 48 horas ou 21 dias.

---

## 11. Conclusão Final e Respostas Inequívocas

1. **O valor "há 21 dias" representa realmente a última geração/publicação dos embeddings atuais?**
   > **SIM.** O valor é 100% autêntico e provém diretamente do campo canónico `manifest.embeddings.updatedAt`, gravado em disco no momento da última publicação canónica de vetores.

2. **Porque o Lina afirma simultaneamente que os embeddings estão atualizados e apresenta uma frescura temporal que sugere o contrário?**
   > **Porque a Sidebar avalia a validade através de um temporizador cego de 48 horas (`computeFreshnessFromTimestamp`), enquanto o plano de atualização avalia a integridade através do conteúdo real dos hashes das notas (`calculateEmbeddingUpdatePlan`).**
   > Como o conteúdo do cofre não foi alterado em 21 dias, os embeddings continuam matematicamente e funcionalmente perfeitos. A classificação "Desatualizado" é um falso positivo do modelo de temporizador da Sidebar.

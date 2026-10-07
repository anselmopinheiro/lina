# M5 — Auditoria: Companion em Shadow Consumption das Gerações M4

Data: 2026-10-05. Relatório e Evidências da Fase M5 (Shadow Consumption).

## Resultado Global M5

- **Fase M5 (Shadow Mode M5A–M5D): `PASS`** (Validação concluída em Desktop Producer Runtime).
- **Cutover para Produção:** **`BLOCKED`** por quatro lacunas de contrato estruturais (G1, G2, G3 e G6 abaixo), em particular a perda de `embeddingInputHash` no caminho canónico.

---

## Estado das Subfases M5

| Subfase | Âmbito | Estado | Ficheiro de Referência / Evidência |
| :--- | :--- | :--- | :--- |
| **M5A** | Reader Read-Only de Gerações M4 | **`PASS`** | `src/index/publishedGenerationReader.ts` (12 testes unitários) |
| **M5B** | Comparador Puro de Equivalência (L1/L2, 9 classes) | **`PASS`** | `src/index/publishedGenerationEquivalence.ts` (29 testes unitários) |
| **M5C** | Integração Shadow Auditing & Diagnóstico em Memória | **`PASS`** | `src/index/publishedGenerationShadowAudit.ts` (47 testes de integração) |
| **M5D** | Prova Runtime Shadow (Desktop Producer) | **`PASS`** | `docs/architecture/evidence/M5D-RUNTIME-SHADOW-001.json` |

---

## Matriz de Execução por Plataforma e Dispositivo

| Plataforma / Dispositivo | Estado de Execução | Nível de Evidência | Observações |
| :--- | :--- | :--- | :--- |
| **Producer Desktop** (Windows) | **`PASS`** | `OBSIDIAN_RUNTIME` | Medido no vault `zettel` (`generation-000008` vs legado, 2303/2303, 0 divergências) |
| **Companion Desktop** | **`NÃO_EXECUTADO`** | `NÃO_EXECUTADO` | Pendente de ambiente secundário dedicado |
| **Android Mobile** | **`NÃO_EXECUTADO`** | `NÃO_EXECUTADO` | Leitura L1 mobile-safe documentada como pendente |
| **iOS Mobile** | **`NÃO_EXECUTADO`** | `NÃO_EXECUTADO` | Leitura `readBinary` + WebCrypto documentada como não validada |

---

## Resumo das Medições Runtime Desktop (M5D)

### Flag OFF (`companionPublishedGenerationShadowEnabled = false`)
- **Status:** `IDLE`
- **Geração:** `none`
- **Leitura Publicada / Shadow:** Desativados
- **Caminho Crítico:** Servido 100% pelo índice legado
- **Provider Calls:** `0`
- **Nível de Evidência:** `OBSIDIAN_RUNTIME`

### Flag ON (`companionPublishedGenerationShadowEnabled = true`)
- **Status:** `PASS`
- **Geração Publicada:** `generation-000008`
- **Nível de Comparação:** `L2` (desktop)
- **Cardinalidade / Equivalência:** 2303 registos legados ↔ 2303 registos publicados (`0` divergências)
- **Tempos Medidos:** `126 ms` (carregamento/análise legado) vs `124 ms` (leitura + digest + comparação shadow em background)
- **Provider Calls:** `0` (nenhuma chamada a modelos de IA)
- **Nível de Evidência:** `OBSIDIAN_RUNTIME`

---

## Bloqueadores Estruturais do Cutover (Gaps G1, G2, G3 e G6)

A aprovação da Fase M5 (**Shadow Mode `PASS`**) **NÃO autoriza** a transição para Cutover. O Cutover permanece **`BLOCKED`** até à resolução formal das seguintes precondições:

| Gap ID | Severidade | Descrição do Bloqueador |
| :--- | :--- | :--- |
| **G1** | `BLOCKS_CUTOVER` | O manifesto M4 não tem `inputVersion` nem `prefixMode`, exigidos por `RuntimeEmbeddingSourceIdentity`. |
| **G2** | `BLOCKS_CUTOVER` | O manifesto M4 não guarda `sourcePublicationId` nem `sourceTextGenerationId` estabelecendo a ligação ao legado. |
| **G3** | `BLOCKS_CUTOVER` | Ausência de proveniência (`producerDeviceId`/`producerEpoch`) nas gerações M4. |
| **G6** | `BLOCKS_CUTOVER` | **Perda de `embeddingInputHash`.** O caminho canónico grava `inputHash: contractId`, a reprojeção legada e `records.json` omitem o campo, e `embeddingState.ts` rejeita registos sem esse hash. |

---

## Atualização M5A — 2026-10-05

**`M5A = IMPLEMENTED / PASS`**. Foi criado `src/index/publishedGenerationReader.ts`: leitor estritamente read-only de `.lina/published/CURRENT` e de uma geração final M4, com `DataAdapter` de leitura e digest WebCrypto injetado. Não importa `node:*`, SQLite, Writer M4, recovery de pointers ou clientes de provider; não possui portas de escrita e não está integrado na pesquisa, cache runtime, settings, UI ou shadow mode.

Os 12 testes focados cobrem os estados válidos, pointer ausente/tmp/malformado, targets parciais, manifesto/formato, hashes, records/vectors, limites antes de leituras grandes, downgrade, mudança concorrente de `CURRENT` e guardas arquiteturais.

---

## Atualização M5B — 2026-10-05

**`M5B = IMPLEMENTED / PASS`**. Criado `src/index/publishedGenerationEquivalence.ts`: comparador puro `compareLegacyAndPublished({ level, legacy, published })` entre um snapshot legado já carregado e o resultado do `PublishedGenerationReader` (M5A). Sem I/O, sem SQLite, sem provider, sem `node:*`, sem recalcular SHA-256, sem tocar no Writer/recovery; único import é um `import type` do Reader.

---

## Atualização M5C — 2026-10-05

**`M5C = IMPLEMENTED / PASS`**. A flag local por dispositivo `companionPublishedGenerationShadowEnabled` permanece `false` por defeito. Só quando está ativa, `LinaPlugin.getRuntimeEmbeddingIndex()` devolve primeiro o índice legado e agenda, sem aguardar, a leitura e comparação M5 em memória.

`PublishedGenerationShadowAuditor` fornece single-flight, deduplicação pela identidade legado + `CURRENT`, retry com backoff apenas em memória e diagnóstico tipado (`IDLE`, `RUNNING`, `PASS`, `DIVERGED`, `READER_ERROR`). Comando `Lina: Diagnose m5 shadow` disponível para verificação instantânea.

---

## Atualização M5D — 2026-10-05

**`M5D = IMPLEMENTED / PASS`**. Prova runtime obtida no Obsidian Desktop real (vault `zettel`) e registada no artefacto `docs/architecture/evidence/M5D-RUNTIME-SHADOW-001.json`. Validados com evidência `OBSIDIAN_RUNTIME` os comportamentos de Flag OFF (`IDLE`, 0 leituras) e Flag ON (`PASS`, 2303/2303 equivalentes, 0 divergências, 0 chamadas de IA).

---

## Conclusão

- **Fase M5 (Shadow Mode): `PASS`**
- **Cutover para Produção:** **`BLOCKED`** por G1, G2, G3 e G6.

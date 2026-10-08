# PARTIAL-SEMANTIC-INDEX-AUDIT-001

Fase de auditoria. **Sem alterações funcionais.** Evidência: STATIC + UNIT_TEST (`tests/index/partialSemanticIndexFeasibility.test.ts`, 11 testes, com o publisher/reader binário reais e adapter em memória). OBSIDIAN_RUNTIME: NÃO_EXECUTADO.

## Resultado

```text
CAN PARTIAL SEMANTIC SEARCH BE SAFE? YES
PARTIAL SEMANTIC SEARCH = SAFE (condicionado aos bloqueios globais abaixo)

VECTOR→CHUNK IDENTITY CONTRACT
  vetor N --(vectorOrdinal, explícito no metadata)--> registo de metadata
  registo --(chunkId = "<path>::<chunkIndex>")--> chunk atual
  VALID ⇔ existe exatamente 1 chunk atual com o mesmo chunkId
          ∧ path e index iguais ∧ textHash igual
          ∧ embeddingInputHash == hash(buildEmbeddingInput(chunk atual, prefixMode))
          ∧ provider/model/dimensions/publicationId da publicação compatíveis
POSITIONAL DEPENDENCY: só dentro do artefacto (offset do vetor = vectorOrdinal × dim), protegido por digests
                       do metadata e dos vetores no manifesto binário. A associação ao chunk NÃO depende de posição.
PER-RECORD HASH AVAILABLE?  SIM (textHash + embeddingInputHash por registo)
ORPHAN DETECTION POSSIBLE?  SIM (chunkId sem chunk atual)
STALE DETECTION POSSIBLE?   SIM (hash divergente) ; MISSING também (chunk atual sem registo)
INSERT/REMOVE SAFE?         SIM (testado: não há shift posicional; os ordinais só endereçam vetores)
```

## Tabela de artefactos

| Artefacto | Identidade por registo | Ordem relevante? | Hash? | Match individual? |
|---|---|---|---|---|
| `chunks.jsonl` | `chunkId` (`path::index`), `path`, `chunkIndex` | não para identidade | `textHash` | n/a (fonte atual) |
| `embeddings.jsonl` (canónico) | `chunkId` | não (ordenado por `chunkId`/`localeCompare` só por determinismo de ficheiro) | `textHash`, `embeddingInputHash` | sim (`calculateEmbeddingState`) |
| `embeddings.meta.jsonl` | `chunkId`, `path`, `index`, `vectorOrdinal` | só `vectorOrdinal` (validado: únicos, 0..N-1 sem lacunas) | `textHash`, `embeddingInputHash`; ficheiro com `metadataDigest` | sim |
| `embeddings.vectors.f32` | nenhuma (puramente posicional) | sim, ordinal×dim | `vectorsDigest` (ficheiro inteiro) | só via metadata paralela (`vectorOrdinal`) |
| `embeddings.binary.manifest.json` | `sourcePublicationId`, `generationId`, `recordCount`, `dimensions`, provider/model, contrato | n/a | digests sha256 | global |
| `manifest.json` | `embeddings.publicationId`, `totalEmbeddings`, identidade | n/a | n/a | global |

O ficheiro de vetores é posicional, mas a metadata paralela resolve `vector index → vectorOrdinal → chunkId → chunk atual → textHash/embeddingInputHash` de forma inequívoca; por isso **não** se aplica `PARTIAL SEARCH = UNSAFE`.

## Runtime atual

- Ponto de bloqueio: `binaryMetadataMatchesCurrentChunks()` (`src/search/runtimeEmbeddingIndex.ts:345`), que emite `chunkMatch:false` (linha 358). É uma igualdade **global** (`records.length === chunks.length` e todos os registos têm de coincidir) → um chunk alterado rejeita o índice inteiro como `binary-invalid`.
- Pode ser decomposta por registo sem perder segurança: a mesma comparação (`path`, `index`, `textHash`, `embeddingInputHash`) passa a classificar cada registo em vez de abortar.
- O consumidor `searchRuntimeSemanticIndex` itera `runtimeIndex.records[i]` com o vetor em `i*dim` e ignora registos sem chunk atual; **não** assume `chunks.length === vectors.length`. Um índice compactado (`vectors` + `records` só com ordinais VALID) funciona (testado).
- **Inconsistência existente:** o caminho JSONL (`buildRuntimeIndex`) já é parcial por construção (`validForSearchChunkIds`); só o caminho binário é tudo-ou-nada. Em mobile (JSONL acima do teto) isto torna o Android mais frágil do que o Desktop.

## Casos obrigatórios (testados)

| Caso | Resultado |
|---|---|
| A. 1 chunk alterado | N-1 VALID, 1 STALE |
| hash-only mismatch (shift de `chunkIndex`) | só esse registo STALE |
| B. 1 chunk removido | 1 ORPHAN, restantes VALID, sem shift |
| C. 1 chunk inserido entre existentes | 1 MISSING, mapeamento e pesquisa corretos |
| D. rename / re-chunking | novo MISSING + antigo ORPHAN (nunca update in-place, porque `chunkId` contém o `path`) |
| dimensions/provider/model diferentes | UNAVAILABLE |
| metadata/vetores corrompidos | reader existente rejeita (`binary-digest-mismatch`) → UNAVAILABLE |
| publicationId diferente | UNAVAILABLE |
| `chunkId` atual duplicado (ambíguo) | UNAVAILABLE |
| 0 VALID | UNAVAILABLE (nunca PARTIAL) |

## Bloqueios

GLOBAIS (→ `UNAVAILABLE`): dimensions, provider/model, `publicationId`, digest/manifest/metadata inválidos ou ordinais ambíguos/duplicados, contrato vetorial incompatível, `chunkId` atual duplicado, 0 registos VALID, `no-safe-source`.
LOCAIS (→ `PARTIAL`): STALE, MISSING, ORPHAN, e registo duplicado no índice (excluído, nunca pesquisável).

## Riscos e limites encontrados

1. `hashContent` é um hash de 32 bits não criptográfico (7–8 hex). Uma colisão aceitaria um vetor stale. Já é verdade hoje no caminho global e no JSONL; em PARTIAL o impacto é limitado ao registo, mas recomenda-se registar como risco aceite (ou reforçar o hash numa fase própria, sem migração forçada).
2. Alinhar o estado: o `validForSearchCount` introduzido em ANDROID-SEMANTIC-CAPABILITY-DIVERGENCE (ramo acima do teto) usa `recordCount` do binário (nível manifesto), não a classificação por registo. Em PARTIAL isso sobre-reporta; deve ser substituído pela contagem real quando a classificação existir.
3. O diagnóstico/Sidebar precisam de `valid/stale/missing/orphan` para a mensagem "parcial"; a classificação por registo exige ler a metadata (≈0,6 MB para 2564 registos) e hashes dos chunks atuais: O(n) em CPU, sem carregar o JSONL grande nem os vetores. Os vetores só são necessários na compactação (cópia de N×dim floats) quando se pesquisa.
4. Producer: o canónico JSONL é a fonte; stale/missing ⇒ atualização incremental existente (`reusableForNextGeneration` preserva registos válidos) ⇒ nova publicação ⇒ reprojeção binária ⇒ COMPLETE, sem regenerar válidos. Companion: só leitura, sem provider.

## Desenho mínimo proposto (NÃO implementado)

```ts
interface SemanticEmbeddingAvailability {
  status: "complete" | "partial" | "unavailable";
  totalChunks: number; valid: number; stale: number; missing: number; orphan: number;
  reason?: string;            // apenas em unavailable
}
// derivado exclusivamente de correspondências seguras
validSemanticRecords: { ordinal: number; chunkId: string }[]
```

1. Extrair `classifyBinaryRecords(index, chunks, expectedIdentity)` puro e partilhado (um único validador, usado por runtime e diagnóstico).
2. `RuntimeEmbeddingIndexCache.load`: substituir `binaryMetadataMatchesCurrentChunks` por esta classificação; `UNAVAILABLE` mantém o comportamento atual (`binary-invalid`, sem fallback inseguro); `PARTIAL` constrói índice compactado e regista o diagnóstico.
3. Propagar `SemanticEmbeddingAvailability` ao snapshot/Sidebar ("Pesquisa semântica parcial — N de M chunks"), sem alterar a máquina de estados do lifecycle (equivale a `UPDATE_AVAILABLE` com vetores válidos).
4. Compatibilidade: sem alteração de formato, schema, ownership, CURRENT, SQLite, M6 (o leitor published tem o seu próprio contrato e fica fora desta fase) nem legacy.

## Recomendação / risco

Próximo passo: aprovar o desenho acima e implementar na ordem 1→2→3 com os testes desta auditoria promovidos a testes de produção. Risco: baixo-médio — a lógica de comparação já existe; o risco real é de apresentação (estado/mensagem) e do hash de 32 bits. Evidência de Android real: NÃO_EXECUTADO.

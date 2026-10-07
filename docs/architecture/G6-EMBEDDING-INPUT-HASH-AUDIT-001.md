# G6 — Auditoria de `embeddingInputHash`

Data: 2026-10-06. Auditoria e desenho read-only. Não foram alterados SQLite,
legado, gerações publicadas, `CURRENT`, embeddings ou providers.

## Conclusão

**`READY_FOR_FIX`**, mas cutover permanece bloqueado por G1, G2, G3 e G6.

A perda é uma regressão estrutural introduzida pelo caminho canónico M3. O
valor correto já existia no formato legado antes de M1/M2; não é um campo
opcional para a validade semântica da pesquisa. A correção mínima requer que o
SQLite canónico passe a preservar o valor real e que todas as projeções o
transportem. Não é aceitável usar `textHash`, `vectorContractId` ou uma
constante como substituto.

## Semântica formal

`embeddingInputHash = hashContent(buildEmbeddingInput(chunk, prefixMode))`.

Em `src/index/embeddingGenerator.ts`, `buildEmbeddingInput()` forma o texto:

```text
[prefixo documental, se aplicável]
Título: <basename do path>
Caminho: <chunk.path>
Bloco: <chunk.chunkIndex>
Conteúdo:
<chunk.text>
```

O prefixo é `search_document: ` apenas em
`nomic-search-query-document`; `getPrefixModeForModel()` escolhe-o para a lista
explícita de modelos Nomic. O hash é calculado imediatamente antes de persistir
o resultado do provider (`embeddingGenerator.ts:1348`). Portanto depende do
texto do chunk, path, basename, índice, versão/algoritmo de preparação e modo
de prefixo. Não inclui provider, modelo ou dimensões diretamente; estes são
validados em separado pela identidade publicada. O idioma não é um input
separado neste código, salvo estar contido no próprio texto/path.

## Identidades

| Campo | Semântica | Origem | Persistência atual | Uso |
| --- | --- | --- | --- | --- |
| `textHash` | `hashContent(chunk.text)` | chunker/note hash | legado, SQLite, binário e M4 | deteta alteração do texto puro |
| `embeddingInputHash` | hash do input enriquecido documental | `embeddingGenerator` | legado e 3E suportam; SQLite/M4 atuais omitem | requisito de validade/reuso em `embeddingState` |
| `inputHash` | nome provisório do contrato `ProducerEmbeddingRecord` | M1 types | não existe como coluna; é gravado/lido em `vector_contract_id` | ambíguo e incorreto no M3 canónico |
| `vectorContractId` | identidade provider/model/dimensões/métrica/prefixo/inputVersion | `createVectorContract` | `embedding_spaces`, binário e manifesto M4 | compatibilidade do espaço vetorial |

Nenhum destes campos pode ser derivado de outro isoladamente. Em particular,
`textHash` não inclui path, índice, título nem prefixo; `vectorContractId` não
inclui o conteúdo do chunk.

## Fluxo e ponto de perda

| Etapa | Ficheiro/função | Classificação |
| --- | --- | --- |
| Preparação/input e hash | `embeddingGenerator.buildEmbeddingInput`, geração em linha 1348 | PRESERVA/origem |
| Legado JSONL | `EmbeddingRecord.embeddingInputHash` em `embeddingPersistence.ts` | PRESERVA |
| M1 shadow/bootstrapping | `sqliteProducerShadowWriter.buildProducerRecordsFromPublication` | TRANSFORMA; usa o hash real se presente, mas o fallback histórico para `textHash` não prova equivalência |
| M2 bootstrap | `sqliteProducerBootstrap` → helper M1 | TRANSFORMA |
| M3 canonical write | `sqliteProducerCanonicalWriter.mapEmbeddingRecordToProducerRecord` | **SUBSTITUI** por `contractId` |
| SQLite schema/read | `sqliteProducerLocalStore.embedding_records.vector_contract_id` | **SUBSTITUI**; não existe coluna independente de input hash |
| Reprojeção legado | `reprojectLegacyFromSqlite` | **OMITE** `embeddingInputHash` |
| M4 builder/`records.json` | `publishedGenerationBuilder` | **OMITE** o campo |
| Binário 3E | `embeddingBinaryStorage` | PRESERVA se o legado o tiver; a cópia atual recebeu dados já omissos |
| Runtime JSONL | `calculateEmbeddingState`/`buildRuntimeIndex` | REJEITA como `missing-input-hash` |
| Runtime binário | `readBinaryEmbeddingStorage` | TRANSPORTA metadata sem revalidar `calculateEmbeddingState`; mascara G6 |

`producerStoreEquivalenceAuditor` não compara este valor: a equivalência M2
conseguiu declarar vetores/metadados equivalentes enquanto a semântica de
validade se perdia.

## Medição read-only: vault `zettel`

| Artefacto | Registos | Com hash | Sem hash |
| --- | ---: | ---: | ---: |
| `.lina/index/embeddings.jsonl` | 2303 | 0 | 2303 |
| `.lina/index/embeddings.meta.jsonl` (3E) | 2303 | 0 | 2303 |
| M4 `generation-000008/records.json` | 2303 | 0 | 2303 |

Os 2303 chunks atuais têm `textHash` coincidente, mas
`calculateEmbeddingState` classificaria **0** como válidos e **2303** com
`missing-input-hash`; por isso `buildRuntimeIndex()` JSONL devolve `null`.
O vault está configurado com `embeddingStorageReadPreference = prefer-binary`;
a via 3E carrega os vetores sem aplicar esse filtro e, por isso, mantém a
pesquisa funcional. Isto é uma máscara de runtime, não uma resolução: fallback
JSONL, alterações de preferência ou futuro cutover podem expor a falha.

## Recuperabilidade

Para o snapshot atual, é **`RECOVERABLE_WITHOUT_PROVIDER`**: os 2303 chunks
atuais, `textHash`, path, índice e manifesto legado (Mistral, `prefixMode=none`,
`inputVersion=1`) permitem reconstruir deterministicamente cada input e o seu
hash. Isso não prova que qualquer vetor histórico seja semanticamente atual;
prova apenas o mesmo contrato que `embeddingState` já usa. A operação futura
deve revalidar o `textHash` e a identidade antes de preencher.

Para registos cujo chunk já não exista, tenha path/índice alterado, ou não tenha
identidade de preparação verificável, é **`NOT_RECOVERABLE`** sem material
histórico adicional; `records.json`, 3E e SQLite não guardam texto suficiente.
Globalmente a classificação é **`PARTIALLY_RECOVERABLE`**. Não existem backups
de embeddings/checkpoints no vault analisado. O histórico Git anterior a M1 já
continha `embeddingInputHash`; a sua perda começou no caminho SQLite/canónico,
não no formato legado original.

## Correção implementada (G6-FIX-001)

1. Foi criado schema SQLite v2 com coluna `embedding_input_hash TEXT NULL`, sem
   reutilizar `vector_contract_id`.
2. Tornar `ProducerEmbeddingRecord` explícito: `vectorContractId` e
   `embeddingInputHash` separados. Migrar readers/writers e auditoria M2 para
   comparar ambos.
3. Em canonical write, gravar o valor original; em bootstrap, preservar apenas
   valor real (sem fallback para `textHash`); em reprojeção, 3E e M4
   `records.json`, projetá-lo fielmente.
4. Backfill conservador: somente registos que possam reconstruir o input atual
   com chunk + identidade comprovada; marcar/contar os não recuperáveis e não
   inventar valores. Nenhuma chamada ao provider é necessária para o conjunto
   recuperável.
5. Validar pós-migração: igualdade por `chunkId` entre legado/SQLite/3E/M4,
   `calculateEmbeddingState.validForSearchCount`, e preservação dos vetores.

Uma migration é necessária porque a coluna existente representa o contrato
vetorial e não contém o input hash. A compatibilidade deve aceitar `NULL` como
histórico não confirmado, mas nunca tratá-lo como válido para pesquisa ou
reutilização.

A implementação detalhada e o estado de runtime estão em
`G6-EMBEDDING-INPUT-HASH-FIX-001.md`. A prova manual no vault permanece
pendente; portanto este audit não declara G6 como PASS.

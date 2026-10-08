# ANDROID-SEMANTIC-CAPABILITY-DIVERGENCE-IMPL-001

## Alterações
1. `src/index/embeddingGenerator.ts` — novo `readBinaryCopyCountForCurrentPublication()` (apenas manifestos, sem carregar vetores). No ramo
   `resource-limit-exceeded` de `readEmbeddingStatus`, `validForSearchCount` passa a ser a contagem da cópia binária **se e só se**
   `sourcePublicationId === publicationId`, provider/model/dimensions iguais e `recordCount === totalEmbeddings`; caso contrário 0.
2. `src/search/hybridSearch.ts` — o probe binário de `getSemanticSearchAvailability` usa `currentChunks ?? readIndexedChunks(app)`
   em vez de `[]` (o mesmo conjunto de chunks que a pesquisa real usa).

Uma única fonte (status → snapshot → capability) deixa de contradizer o diagnóstico; nenhum validador paralelo foi criado.
A validação completa do binário (digests, chunks, publicação) continua exclusivamente em `RuntimeEmbeddingIndexCache` no momento da pesquisa
(sem fallback silencioso: se falhar, a pesquisa semântica bloqueia).

## Não alterado
Ownership, CURRENT, SQLite, formatos, limites de memória, geração de embeddings, chamadas a providers, ficheiros do vault (0 writes).
Producer/Desktop: o ramo só é atingido acima do teto; Producer com `resource-limit` continua `INCOMPATIBLE`/rebuild sob confirmação (workDemandsFullRebuild).

## Testes
`tests/search/androidCompanionSemanticCapability.test.ts` (INTEGRATION_TEST, adapter em memória, perfil mobile, JSONL > teto, discovery real):
cópia consistente ⇒ capability disponível/`full`, sem "Embeddings não encontrados", Companion sem ações de escrita; publicationId diferente,
ausência de cópia e contagem divergente ⇒ indisponível; 0 writes/removes/renames.
Suite completa: 188 ficheiros / 2424 testes. Limite: o probe com `readIndexedChunks` e a carga real do binário não têm teste de integração
com ficheiros binários reais (coberto indiretamente por `embeddingBinaryStorage`/`runtimeEmbeddingIndex` existentes).

## Gates
`npm test`, `typecheck`, `lint:obsidian:strict`, `build`, `build:dev`, `build:test`, `release-check`, `git diff --check`: verdes.

## Runtime
ANDROID_RUNTIME = NOT_EXECUTED
DESKTOP_REGRESSION = NOT_EXECUTED (apenas testes automáticos)

Para validar: copiar o build (DEV) para o Android, abrir diagnóstico (Modo = Completo, sem "Embeddings não encontrados"), pesquisa semântica e híbrida.

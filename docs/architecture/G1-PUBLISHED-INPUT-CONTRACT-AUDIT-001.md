# G1 — Auditoria do contrato de input publicado

Data: 2026-10-06
Estado: **FIX IMPLEMENTADA; PROVA RUNTIME PENDENTE**
Cutover: **BLOCKED por G1 runtime pendente/G2/G3**

## Conclusão

`inputVersion` e `prefixMode` fazem parte da identidade semântica do espaço vetorial. A geração publicada M4 v2 guarda apenas o `vectorContractId` opaco, embora esse identificador seja calculado a partir desses campos. Como SHA-256 não é reversível, a geração não contém a descrição necessária para reproduzir ou validar historicamente o input. O v2 atual é íntegro, mas não satisfaz o contrato mínimo para `cutoverEligible`.

G6 resolveu a identidade do input **por record** com `embeddingInputHash`; não resolve a identidade global de preparação. Os dois níveis são necessários: o manifesto declara as regras invariáveis da geração; o hash por record confirma que cada chunk foi materializado sob essas regras.

Nenhuma alteração foi feita a M4, `CURRENT`, SQLite, provider, embeddings, notas ou settings. Não foi executado diagnóstico mutável, commit ou push.

> Actualização de implementação: a correção foi aplicada em `G1-PUBLISHED-INPUT-CONTRACT-FIX-001.md`. O estado descrito nesta secção é o da auditoria original; a prova runtime não foi executada porque o Obsidian não estava acessível nesta sessão.

## Fluxo factual

| Etapa | Código | Fato provado |
| --- | --- | --- |
| Chunk | `src/index/chunker.ts` | Produz `path`, `chunkIndex`, `text` e `textHash`. |
| Preparação documental | `buildEmbeddingInput()` em `src/index/embeddingGenerator.ts` | Forma `Título`, `Caminho`, `Bloco` e `Conteúdo` a partir do chunk. |
| Prefixo do documento | `applyEmbeddingPrefix(..., false)` | Em `nomic-search-query-document`, acrescenta `search_document: `. |
| Prefixo da query | `applyEmbeddingPrefix(..., true)` em `src/search/hybridSearch.ts` | No mesmo modo, acrescenta `search_query: `. |
| Escolha de modo | `getPrefixModeForModel()` | Quatro modelos Nomic mapeiam para `nomic-search-query-document`; os restantes para `none`. |
| Versão | `EMBEDDING_INPUT_VERSION = 1` | Versão da estratégia de preparação; é passada para publicação. |
| Provider | `generateProviderEmbeddings()` | Recebe exactamente o resultado de `buildEmbeddingInput()` para documentos; a query recebe o texto prefixado. |
| Hash por record | `hashContent(buildEmbeddingInput(...))` em `embeddingState.ts` | É usado para validar/reutilizar records e para G6. |
| Contrato global | `createVectorContract()` em `vectorContract.ts` | Inclui provider, model, dimensions, metric, `prefixMode` e `inputVersion`; calcula `vectorContractId`. |
| JSONL canónico | `publishCanonicalEmbeddings()` em `embeddingPersistence.ts` | Persiste `embeddingInput.version`, `embeddingInput.prefixMode` e o contrato vectorial completo. |
| SQLite | `sqliteProducerCanonicalWriter.ts` | Recebe ambos os valores para o espaço; a tabela só tem coluna `input_version`. |
| M4 | `buildImmutableGeneration()` em `publishedGenerationBuilder.ts` | Publica `vectorContractId`, mas omite `inputVersion` e `prefixMode`. |
| Reader/validator/comparator | módulos `publishedGeneration*` | Validam o identificador opaco, mas não conseguem validar ou comparar os dois campos. |

## Semântica formal

`inputVersion` é a versão da estratégia que define o texto de embedding, não a versão do provider nem do modelo. Hoje é `1`; pode mudar mantendo provider/model/dimensão se mudar a montagem de título/caminho/bloco/conteúdo, normalização ou regras equivalentes. Entra no `vectorContractId`, por `computeVectorContractId()`. Não entra literalmente no `embeddingInputHash`; este hash cobre o texto final e pode mudar se a alteração de versão alterar esse texto. Por isso uma alteração de versão que preserve acidentalmente um input concreto não deixa de ser alteração do contrato global.

`prefixMode` admite `none` e `nomic-search-query-document`. O primeiro transmite o texto enriquecido sem prefixo. O segundo aplica `search_document: ` aos documentos e `search_query: ` às queries. Portanto afecta os dois lados da pesquisa, com prefixos distintos. Entra no `vectorContractId` e altera o texto que gera `embeddingInputHash` para os documentos. O seu valor é semanticamente relevante mesmo se uma query concreta não revelar degradação observável.

## Identidade semântica

| Campo | Define modelo | Define preparação | Define input real | Persistido hoje | Necessário para replay |
| --- | --- | --- | --- | --- | --- |
| provider | Sim | Não | Indirectamente | JSONL, SQLite, M4 | Sim |
| model | Sim | Escolhe prefixMode hoje | Indirectamente | JSONL, SQLite, M4 | Sim |
| dimensions | Espaço/forma do vetor | Não | Não | JSONL, SQLite, M4 | Sim |
| dtype | Representação do vetor | Não | Não | SQLite/M4 | Sim |
| vectorContractId | Identidade resumida | Resumo opaco | Não | JSONL, SQLite, M4/records | Sim, mas insuficiente sozinho |
| inputVersion | Não | Sim | Pode alterar | JSONL e SQLite; ausente em M4 | Sim |
| prefixMode | Não | Sim | Sim | JSONL e 3E; ausente em M4 e não persistido no schema SQLite | Sim |
| embeddingInputHash | Não | Por record | Confirma o texto concreto | JSONL, SQLite records, M4 v2 records, 3E metadata | Sim para verificação por record; não substitui contrato global |

Uma descrição reproduzível exige pelo menos `provider`, `model`, `dimensions`, `dtype`, `metric`, `inputVersion`, `prefixMode` e um `vectorContractId` verificável contra esses campos. Para verificar a materialização de cada record, exige também `embeddingInputHash` e os metadados do chunk.

## Estado de `generation-000012`

`CURRENT` aponta para `generation-000012`. O manifesto contém `formatVersion: 2`, provider `mistral`, model `mistral-embed`, dimensions `1024`, dtype `float32`, `vectorContractId: vec:e7b568…` e 2303 records. Não contém `inputVersion`, `prefixMode`, `metric` nem o objecto `vectorContract`. Todos os 2303 records contêm `embeddingInputHash` e o mesmo `vectorContractId`; nenhum contém `inputVersion` ou `prefixMode`.

O manifesto JSONL canónico correlato contém hoje `embeddingInput.version: 1`, `embeddingInput.prefixMode: none` e o objecto `vectorContract` completo. Isso permite inspeccionar o estado presente do vault, mas é uma correlação com outro artefacto mutável, não uma propriedade auto-suficiente da geração M4.

## Derivabilidade histórica

| Fonte | inputVersion | prefixMode | Classificação e limite |
| --- | --- | --- | --- |
| Manifesto M4 v2 | Ausente | Ausente | `NOT_DERIVABLE`. |
| `vectorContractId` | Não invertível | Não invertível | `NOT_DERIVABLE`; enumerar valores conhecidos seria apenas uma hipótese baseada no código actual. |
| `embeddingInputHash` | Não | Não | `NOT_DERIVABLE`; hash por record não codifica campos nem é invertível. |
| Settings | Pode sugerir o presente | Pode sugerir o presente | `DERIVABLE_ONLY_FROM_CURRENT_CODE`; settings não são prova histórica da geração. |
| SQLite | Coluna `input_version` | Não há coluna `prefix_mode` | `EXPLICITLY_PERSISTED` para versão; `NOT_DERIVABLE` para modo. `getSpace()` fabrica `prefixMode: "none"`, logo não é prova. |
| JSONL canónico/manifesto | Sim | Sim | `EXPLICITLY_PERSISTED`, se o par canónico correlato existir e for confiável. |
| 3E binary manifest | `inputFormatVersion` | `prefixMode` | `EXPLICITLY_PERSISTED`, mas é derivado e não é fonte para reconstituir uma geração M4 independente. |
| Código actual | Constante 1 | Mapa por modelo | `DERIVABLE_ONLY_FROM_CURRENT_CODE`; upgrades podem mudar ambos. |
| Manifestos antigos | Só se explicitamente presentes | Só se explicitamente presentes | Para M4 v2 actual: `NOT_DERIVABLE`. |

## Risco de cutover actual

| Cenário | Detetável hoje por M4 v2 isolado | Falso match | Resultado degradado | Re-embedding indevido | Mistura de espaços |
| --- | --- | --- | --- | --- | --- |
| Mesmo provider/model, inputVersion diferente | Não | Alto | Alto | Possível | Alto |
| Mesmo provider/model, prefixMode diferente | Não | Alto | Alto, sobretudo query/corpus Nomic | Possível | Alto |
| Query com contrato diferente do corpus | Não por M4 v2 | Alto | Alto | Não aplicável | Alto |
| Upgrade altera preparação e mantém modelo | Não | Alto | Alto | Possível | Alto |
| Companion recebe geração antiga e runtime novo | Não | Alto | Alto | Possível | Alto |

O Reader declara v2 elegível apenas por `formatVersion === 2`; o Validator faz o mesmo após integridade. O Comparator M5 só compara campos presentes em ambos os lados e os snapshots de shadow não incluem estes dois campos. Assim, um PASS M5 não prova equivalência do contrato de input.

## Manifesto versus records e compatibilidade

`inputVersion` e `prefixMode` pertencem ao manifesto, porque são invariáveis em toda a geração. Devem integrar um objecto `vectorContract` completo ou campos equivalentes explicitamente validados contra `vectorContractId`; o contrato deve também declarar `metric`. Duplicá-los em cada record não acrescenta capacidade de replay e aumenta a superfície de incoerência.

Cada record deve manter `vectorContractId` e `embeddingInputHash`. O primeiro vincula-o à geração; o segundo confirma a materialização específica e detecta divergência por chunk. G6 não substitui G1: hashes por record não declaram a transformação global usada para os produzir.

É necessário `formatVersion: 3` para o contrato mínimo de cutover. Tornar os novos campos opcionais em v2 preservaria v2 sem identidade explícita e obrigaria Reader/Validator a uma regra ambígua. V1 e v2 podem continuar legíveis para compatibilidade e recovery de integridade, mas devem ser `cutoverEligible: false`; v3 deve ser exigido para cutover. A alteração futura deverá actualizar builder, validator, reader, comparator, recovery, shadow, Companion e mobile, sem inferir valores para v1/v2.

## Contrato mínimo proposto para a próxima fase

Uma geração só pode ter `cutoverEligible: true` se `formatVersion === 3` e o manifesto contiver, com validação estrita:

- `provider`, `model`, `dimensions`, `dtype: "float32"` e `metric: "cosine"`;
- `inputVersion` inteiro positivo e `prefixMode` de enum suportado;
- `vectorContract` completo e válido, cujo `contractId` coincide com `vectorContractId` e é recomputado a partir dos campos explícitos;
- records com o mesmo `vectorContractId`, `embeddingInputHash` não vazio, layout e digests válidos.

Correção mínima recomendada: introduzir v3 apenas para novas publicações, persistir e validar o contrato global completo no manifesto, transportar a identidade para Reader/Comparator/Shadow/Companion e reclassificar v1/v2 como não elegíveis para cutover. Não é seguro migrar ou declarar v2 elegível por inferência retrospectiva.

## Respostas directas

1. `inputVersion` faz parte da identidade semântica? **Sim.**
2. `prefixMode` faz parte da identidade semântica? **Sim.**
3. Estão persistidos actualmente no M4 v2? **Não.**
4. Podem ser derivados com segurança histórica? **Não.**
5. Precisam de estar no manifesto? **Sim.**
6. Precisam de estar nos records? **Não; `embeddingInputHash` deve permanecer.**
7. G6 substitui esta necessidade? **Não.**
8. É necessário novo `formatVersion`? **Sim, v3 para cutover seguro.**
9. Correção mínima? **Contrato global explícito e validado em v3; v1/v2 não elegíveis.**
10. Porque o cutover continua bloqueado? **G1 não permite provar a identidade do input no artefacto M4; G2/G3 continuam pendentes.**

## Validação

`npm run typecheck` e `git diff --check` passaram. Não foram necessários testes novos: as conclusões vêm da leitura directa de código e dos artefactos existentes, sem executar caminhos mutáveis.

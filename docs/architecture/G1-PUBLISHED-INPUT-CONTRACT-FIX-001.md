# G1 — Correção do contrato de input publicado

Data: 2026-10-06
Estado: **G1 PASS — prova runtime concluída**
Cutover: **continua bloqueado por G2/G3**

## Implementação

As novas gerações M4 usam `formatVersion: 3`. O manifesto v3 contém `provider`, `model`, `dimensions`, `dtype: "float32"`, `metric: "cosine"`, `inputVersion`, `prefixMode`, `vectorContractId` e o objecto completo `vectorContract`.

`buildImmutableGeneration()` aceita somente `inputVersion: 1` e os modos `none` e `nomic-search-query-document`. Recalcula o identificador com `computeVectorContractId()` e recusa publicar se o contrato do espaço SQLite não corresponder. Isto evita inventar `prefixMode` ou publicar um identificador opaco incompatível.

O Validator obriga os campos v3, o enum, `metric`, os hashes por record e a igualdade exacta entre os campos explícitos, `vectorContract.contractId` e o identificador recomposto. Uma divergência devolve `VECTOR_CONTRACT_MISMATCH`.

O Reader continua a ler v1/v2 para integridade e recovery, sem preencher campos ausentes; ambos passaram a ser formatos legados e não elegíveis para cutover. Só v3 íntegro é elegível. O Reader expõe o contrato v3 no índice runtime e inclui a guarda pura `evaluatePublishedGenerationSemanticContract()`, que devolve `SEMANTIC_CONTRACT_MISMATCH` quando o contrato de query não coincide. Esta guarda não activa consumo, Companion, mobile ou cutover.

O comparador M5 passou a comparar `metric`, `inputVersion`, `prefixMode` e, para v3, o identificador recomposto do contrato legado. Assim, um PASS L2 v3 cobre o contrato global além de provider, modelo, dimensão, dtype, hashes por record e vetores.

## Recovery e compatibilidade

Recovery continua a aceitar todas as gerações íntegras v1, v2 e v3 e mantém a escolha monotónica de `CURRENT`. V1/v2 são apenas recuperáveis: não recebem campos inferidos, não se tornam elegíveis e não são reescritos. A publicação continua a descobrir a próxima geração real no directório, sem números codificados.

Não foi alterado o schema SQLite. O limite identificado na auditoria permanece deliberadamente visível: para uma fonte SQLite cujo `prefixMode` não permita reconstruir o mesmo `vectorContractId`, a publicação v3 falha fechada em vez de inventar um modo. No vault actual, Mistral usa `prefixMode: none` e o identificador existente é verificável.

## Cobertura

Foram adicionados testes de caracterização e regressão para manifesto v3, contrato recomposto, falha de contrato, recovery de v1/v2/v3, reclassificação de elegibilidade, hashes por record em v3, reader v3 e incompatibilidade semântica de query. A bateria focada passou com 104 testes em 7 ficheiros.

## Prova runtime

O script `scripts/run-obsidian-g1-published-input-contract-proof.mjs` captura hashes das gerações 000001–000012, notas, ownership e device; depois publica a próxima geração via `diagnoseM4ImmutablePublication()`, bloqueando chamadas HTTP e reembedding, valida o manifesto v3 e exige M5 L2 `2303/2303` sem divergências. O script também compara os hashes anteriores após a publicação.

A prova foi executada no runtime real do Obsidian 1.14.4 com o vault `zettel`. `CURRENT` avançou de `generation-000012` para `generation-000013`; a geração nova contém 2303 records e manifesto v3 com `mistral` / `mistral-embed`, dimensão 1024, `float32`, métrica `cosine`, `inputVersion: 1`, `prefixMode: none` e contrato `vec:e7b5684ec28eb8ed4f994135183c04c367809873f9135a7f8c6f218b5eea2f51`.

O Validator real devolveu `integrityValid: true` e `cutoverEligible: true`. O identificador recomposto coincidiu com o manifesto. A guarda semântica devolveu `COMPATIBLE` para o contrato publicado e `SEMANTIC_CONTRACT_MISMATCH` para um contrato de modelo deliberadamente diferente. Shadow M5 devolveu `PASS`, nível L2, 2303 records legados e publicados, zero divergências e zero chamadas a provider.

As gerações 000001–000012 mantiveram hashes byte-a-byte idênticos, as 1293 notas e os ficheiros de ownership/device permaneceram idênticos, e a prova bloqueou HTTP e os caminhos de reembedding (`providerCalls: 0`, `reembedding: 0`). As gerações históricas v1/v2 foram validadas no runtime: continuam íntegras e com `cutoverEligible: false`. A publicação M4 usada neste teste apenas lê o SQLite canónico; não houve operação M3 nem mudança SQLite inesperada atribuível a G1.

## Limites preservados

Não houve chamada a provider nem reembedding nos testes. Não foram iniciados G2, G3, consumo autoritativo, Companion/mobile, alteração de schema SQLite, migração de gerações antigas, commit ou push.

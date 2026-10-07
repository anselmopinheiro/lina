# G2 — Source Generation Link Fix

## Implementação

O formato publicado passou para v4. Cada geração nova exige e transporta
`sourceTextGenerationId`, `sourceChunksDigest`, `sourcePublicationId` e
`sourceRecordCount`. A origem é extraída do manifesto canónico que já descreve
os embeddings publicados; não é inferida do estado textual atual.

O SQLite do produtor migra para schema 3 e guarda a proveniência no espaço de
embeddings. A publicação v4 falha fechada quando algum campo de origem falta ou
quando a contagem da origem difere dos registos a publicar.

Formatos v1–v3 continuam válidos para leitura, recuperação e integridade, mas
não são elegíveis para cutover. O leitor expõe proveniência apenas em v4. O
comparador distingue `SOURCE_PROVENANCE_MISMATCH` de divergências semânticas e
de registos; o guard runtime devolve `SOURCE_PROVENANCE_MISMATCH` para um par
canónico incompatível.

## Prova runtime

No vault `zettel`, a publicação sem rede nem reembedding promoveu
`generation-000014` com 2303 registos. A proveniência é
`gen-muvb41fn-elt8zhju`, `sha256:1fc6195999522568fd3edcd3e2ccf6d195a9c17705d656d20d607be3bdd84cb2`,
e a publicação canónica existente. O shadow M5 L2 passou sem divergências e as
gerações 1–13 ficaram byte-idênticas. A evidência estruturada está em
`docs/architecture/evidence/G2-SOURCE-GENERATION-LINK-FIX-001.json`.

## Limites

Esta alteração não inicia G3, não faz cutover e não altera a geração de
embeddings. A validação manual de release em Obsidian continua pendente.

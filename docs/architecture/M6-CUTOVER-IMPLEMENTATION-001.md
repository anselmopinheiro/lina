# M6 — cutover controlado do runtime para geração publicada

O selector foi integrado exclusivamente em `LinaPlugin.getRuntimeEmbeddingIndex()`. A flag `companionPublishedGenerationCutoverEnabled` é local por dispositivo e tem default efetivo `false`.

Com a flag desligada, o runtime mantém o índice legado. Com a flag ligada, o selector lê a geração apontada por `CURRENT`, aplica Reader v5, contrato semântico, provenance da fonte canónica, ownership e `evaluatePublishedGenerationForConsumer`. Só uma decisão integralmente elegível seleciona `PUBLISHED`.

Indisponibilidade do artefacto publicado produz `LEGACY_FALLBACK` observável. Integridade, incompatibilidade semântica e provenance `MISMATCH` produzem `PUBLISHED_BLOCKED`, sem fallback automático. A cache publicada é read-only e tem identidade por geração, contrato e provenance; cada chamada relê a geração antes de reutilizar a cache.

O cutover é device-scoped e reversível ao desligar a flag. Não altera SQLite, ownership, `CURRENT`, gerações, embeddings ou chama providers.

Runtime desktop Producer e Companion, Android e iOS permanecem não executados nesta implementação; a flag não é ativada automaticamente.

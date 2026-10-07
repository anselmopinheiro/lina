# M4 — Diagnóstico de Dimension Mismatch

## Resultado

O erro `Dimension mismatch for 00_inbox/mafarrico.md::0` não é corrupção de
dados. A auditoria SQLite read-only encontrou **2.299/2.299** BLOBs válidos de
**1024** dimensões e zero mismatches entre record e respetivo space.

Há dois spaces: `ollama:nomic-embed-text:4` (0 registos) e
`ollama:nomic-embed-text:1024` (2.299 registos). A distribuição é apenas
`1024 → 2299`.

## Origem comprovada

Em `publishedGenerationPublicationService.ts`, a chamada `store.getSpace()` não
passa `spaceId`. Em `sqliteProducerLocalStore.ts`, esse modo executa uma query
com `LIMIT 1`; seleciona o space 4d vazio, embora `getAllRecords()` devolva
registos do space 1024d. O Builder aplica então a dimensão global 4 a todos os
BLOBs 1024d e falha no primeiro registo.

Assim, M4 assume incorretamente uma dimensão única derivada de um space
arbitrário. A correção arquitetural recomendada é publicar uma geração por
`spaceId`/`vectorContractId`, selecionando explicitamente o space que cobre a
snapshot; snapshots multi-space exigem geração separada ou manifesto
multi-space. Esta tarefa não altera código, dados, legado ou SQLite.

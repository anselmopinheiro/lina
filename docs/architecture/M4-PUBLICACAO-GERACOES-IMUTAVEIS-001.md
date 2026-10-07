# M4 — Publicação por Gerações Imutáveis

## Resultado

**`PASS`** (2026-10-05). M5 não foi iniciada.

## Arquitetura implementada

O SQLite canónico no Active Producer fornece a snapshot a `PublishedGenerationBuilder`; este produz `vectors.bin` Float32 determinístico, `records.json` e manifesto com hashes. `PublishedGenerationValidator` relê e valida os artefactos. `PublishedGenerationWriter` escreve em staging, promove por rename e atualiza `CURRENT` através de `CURRENT.tmp`.

`publishedGenerationPublicationService` é Producer-only, exige canonical mode e a flag `producerImmutableGenerationPublicationEnabled`, lê apenas SQLite e reporta `providerCalls: 0`. A integração no canonical writer ocorre depois da projeção legada; uma falha M4 é warning/retryable e não reverte SQLite nem legado.

## Critérios de fecho

| Critério | Estado |
| --- | --- |
| SQLite canónico como fonte | PASS |
| Geração imutável derivada | PASS |
| Builder determinístico | PASS (testes) |
| Validação antes de promoção | PASS |
| `generationId` monotónico | PASS (runtime: 000001→000008) |
| `CURRENT` atualizado corretamente | PASS (runtime) |
| Anti-downgrade ativo | PASS (testes; diagnóstico R2) |
| Recovery de publicação interrompida | PASS (runtime, `RECOVERED_TMP`) |
| `providerCalls = 0` no recovery | PASS |
| Nenhuma geração final modificada | PASS (SHA-256 idêntico) |
| Retry idempotente | PASS (runtime, `NO_OP`) |
| Companion não migrado nesta fase | PASS (sem referências a `published`/`CURRENT` em `src/companion` e `src/search`; sem alterações git nesses diretórios) |

## Correção descoberta durante a prova

`DataAdapter.rename` do Obsidian recusa destino existente ("Destination file already exists!"), pelo que `CURRENT.tmp → CURRENT` falhava e deixava gerações promovidas sem `CURRENT`. Corrigido com `replaceCurrent` (remove `CURRENT` e renomeia o tmp) e `recoverPublishedGenerationPointer`, que repara a janela entre remoção e rename. Detalhe em `M4-CURRENT-RECOVERY-001.md`.

## Validação

Suite completa: 174 ficheiros / 2292 testes verdes; `npm run typecheck` e `git diff --check` verdes. Prova runtime controlada no vault `zettel` (ver `M4-CURRENT-RECOVERY-001.md`).

## Limitações

- Não existe comando de recovery isolado; é observado através do diagnóstico, antes da publicação.
- Gerações 000002–000005 e as de diagnóstico (000007, 000008) permanecem no vault de testes; GC não implementado (fora de âmbito).
- Lint e build desta fase não foram reexecutados nesta prova.

## Estado Git

M2/M3/M3B/M4 permanecem alterações locais preservadas. Não houve commit nem push.

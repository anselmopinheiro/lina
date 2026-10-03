# LINA-15H-F — Correção dos bugs de persistência N-01/N-03

**Data:** 2026-10-03 · **Branch:** `master` · **Base:** `b4ed0dc` (LINA-15H-D).

## Âmbito e origem factual

Esta fase corrige exclusivamente os bugs reais classificados pela auditoria pré-existente `LINA-15H-E-AUDIT-PERSISTENCE-CLOSURE-001.md`:

- **N-01:** rollback mutável após `OwnershipFenceRejectedError`;
- **N-03:** `saveTextIndex` tratava um `manifest.json` existente mas ilegível como se não tivesse secção `embeddings`.

O relatório 15H-E foi preservado integralmente como artefacto de auditoria pré-existente. Não foi alterado por esta fase.

## N-01 — perda de autoridade durante publicação

### Causa

`publishCanonicalEmbeddings` e `publishEmbeddingsDisabledManifest` entravam no `catch` comum depois da rejeição da fence. Esse caminho fazia rollback e limpeza através de operações mutáveis no adapter, mesmo sem autoridade atual.

### Correção e máquina de estados

```text
staging/backup/publicação
        │
        ├─ erro normal → rollback mutável → estado anterior coerente
        │
        └─ OwnershipFenceRejectedError → sem rollback/cleanup → tmp/backups determinísticos
                                                              │
                                                              └─ recovery autorizado → estado coerente
```

As duas publicações agora interrompem imediatamente o caminho mutável ao receber `OwnershipFenceRejectedError`. A publicação canónica devolve falha factual; o ramo de embeddings desativados propaga a falha para o seu chamador. Em ambos os casos, os artefactos existentes permanecem reconhecíveis pelo recovery já existente e nunca são `READY` antes de recovery autorizado.

O rollback para erros normais permanece inalterado e continua a restaurar o par anterior.

## N-03 — manifesto partilhado ilegível

### Causa

`readEmbeddingSectionFrom` devolvia `undefined` tanto para manifesto inexistente como para uma falha de leitura/parse. O fallback `{}` permitia publicar `notes`, `chunks` e manifesto novo, apagando silenciosamente uma identidade `embeddings` não legível.

### Correção

A leitura interna passou a distinguir quatro proveniências:

| Estado | Resultado em `saveTextIndex` |
|---|---|
| manifesto ausente | primeira criação legítima |
| manifesto JSON válido sem embeddings | ausência legítima preservada |
| manifesto JSON válido com embeddings | identidade preservada |
| manifesto existente ilegível/corrompido | falha fechada, sem nova tripla |

O mesmo fail-closed aplica-se à releitura imediatamente antes de publicar e a backups determinísticos existentes que não possam ser lidos. Assim, uma identidade desconhecida nunca é convertida em ausência artificial.

## Testes permanentes

- **P2:** manifesto corrompido e falha de leitura mantêm todos os ficheiros inalterados, sem mutação/publicação; primeira criação e manifesto válido com/sem embeddings continuam cobertos.
- **P5:** `publishCanonicalEmbeddings` perde a fence depois de backups parciais; não há qualquer mutação posterior à rejeição e o recovery autorizado restaura um par canónico válido.
- **P6:** o ramo "tudo purgado" perde a fence depois de mover os backups; não há rollback mutável e o recovery autorizado restaura o par canónico válido.
- Os testes de rollback por erro normal existentes continuam a provar a restauração do estado anterior.

## Compatibilidade e riscos residuais

Não foram alterados schema, `data.json`, formato JSONL, `publicationId`, digests, providers, Scheduler, Worker, Operation Manager, `effectiveAiConfig` ou o protocolo de publicação fora destes guards.

- **N-02:** coordinator apenas em memória — não implementado.
- **N-04:** digest do conteúdo JSONL — não implementado.

Os limites de fsync, atomicidade multi-ficheiro, TOCTOU fence→adapter e sincronização externa permanecem os já documentados. O recovery continua a operar apenas sobre nomes determinísticos e sob fence autorizada.

## Gates

Todos os gates passaram:

- `npm test` — 164 ficheiros / 2199 testes;
- `npm run typecheck`;
- `npm run lint:obsidian:strict` (`--max-warnings=0`);
- `npm run build`;
- `npm run release-check`;
- `git diff --check`.

O build regenerou apenas `main.js`; o ficheiro foi restaurado ao estado de `HEAD` antes do commit, conforme a política do repositório.

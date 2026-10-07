# G6 — Correção de `embeddingInputHash`

## Fecho autorizado — correção de ownership/cache (2026-10-06)

**G6 = PASS. CUTOVER = BLOCKED por G1/G2/G3 pendentes.** A auditoria original e as recusas históricas abaixo ficam preservadas como registo anterior à correção; não representam o estado final.

Implementação mínima em `OwnershipGate`, wiring binário de `main.ts` e `BinaryWorker`: `evaluateAndCache()` centraliza a decisão derivada, incluindo allow e deny em `acquireFence(options)` e `assertFence()`. O preflight binário adquire fence sem auto-claim, valida owner/epoch e usa diretamente o resultado atual. Não consulta a autorização antiga em cache. A manutenção automática aguarda o preflight assíncrono; stop/dispose durante essa espera impede a escrita. O controlador mantém todas as validações de fence em fronteiras duráveis. Não foi criada persistência nem nova fonte de verdade.

Identidade ou role alteradas durante uma avaliação provocam deny. Mudanças de ownership/epoch são detetadas na aquisição e nas assertions seguintes; fence recusado sincroniza deny. Reload cria uma instância sem cache. `invalidate()` neutraliza completions anteriores por revisão, mas não autoriza o caminho binário: este resolve sempre autoridade fresca. Completions antigas não sobrescrevem cache de avaliações mais recentes. O comportamento síncrono histórico de cache null permanece fora do preflight binário, sem alargar este âmbito.

Os **22 casos da auditoria foram preservados**: executaram como caracterização antes das alterações e os quatro casos que exprimiam os bugs passaram a exigir o comportamento corrigido. Foram acrescentados **17 testes**, incluindo stale deny/allow, owner/epoch/role/identity mismatch, reload, idempotência, concorrência, stop/dispose e autorização assíncrona automática. A fixture de indexação passou a declarar identity/ownership válidos, sem depender de permissividade de cache.

Prova real no vault `zettel`: 2303/2303 vetores; `ALREADY_PRESENT=2303`, `BACKFILLED_VERIFIED=0`, restantes=0; binário **valid**, publicação **PASS**, zero divergências, zero provider e zero reembedding. Shadow M5 **PASS / L2 / 2303–2303 / 0 divergências**. `CURRENT` partiu de `generation-000010`; a primeira execução G6 publicou normalmente `generation-000011` e a repetição final idempotente publicou `generation-000012`. A reparação binária isolada não alterou CURRENT.

Segurança final comprovada após o arranque estabilizar: registos e espaços SQLite exatamente iguais, integridade SQLite `ok`, 2303 vetores/input hashes iguais entre SQLite, JSONL, binário e geração M4 atual; 1293 notas com hashes byte a byte iguais; ownership/device inalterados; 30 ficheiros das gerações 1–10 byte a byte iguais. JSONL, identidade de publicação, diagnóstico e cópia derivada são escritos normalmente pelo diagnóstico; não se afirma ausência de reescrita física desses artefactos.

**Finding residual de arranque:** o diagnóstico automático M3 preexistente em `main.ts` executa no reload e reescreveu metadados/timestamps SQLite e identidade da projeção legada. A comparação inicial de segurança falhou nesses dois digests; os vetores e input hashes permaneceram iguais. Essa tentativa foi preservada em `previousAttempt`, e a repetição G6 com baseline após o arranque demonstrou ausência de novas alterações SQLite. Este comportamento M3 não foi corrigido neste âmbito. A janela oculta também suspendeu `requestAnimationFrame`; a prova restaurou a janela e manteve o scheduler de produção. O guard do harness permite I/O local `app://` e bloqueia HTTP; geração foi explicitamente bloqueada nos métodos do plugin durante a prova.

Gates: `npm test` **180 ficheiros / 2374 testes**, typecheck, lint strict **0 erros/avisos**, build, release-check e diff-check **PASS**. O caso SQLite nativo da CLI Node 20 faz early return; a prova SQLite efetiva foi executada no Electron/Obsidian, não inferida desse teste. O build preservou o `main.js` preexistente do checkout e instalou o bundle corrigido no vault autorizado. Não foi executado novo `npm ci` nesta correção; dependências/lockfile não foram alterados.

Sem commit, push, início de G1/G2/G3 ou cutover. HEAD permanece `620a2c62b3a907927c12bd72e25b847caa6f3e61` em `master`.

Evidência completa: [G6-BINARY-OWNERSHIP-CACHE-FIX-RUNTIME-001.json](evidence/G6-BINARY-OWNERSHIP-CACHE-FIX-RUNTIME-001.json). Harness: [run-obsidian-g6-cache-fix-proof.mjs](../../scripts/run-obsidian-g6-cache-fix-proof.mjs), que exige bundle já recarregado e diagnósticos de arranque estabilizados.

---

## Registo anterior à correção (histórico)

Data: 2026-10-06
Estado: `FAIL` na prova final de diagnóstico binário — implementação, testes,
publicação v2 e shadow PASS; execução interrompida com cache de ownership
contaminada por erro de preflight do harness. G6 não é declarada PASS.

## Alterações G6

- SQLite Producer evolui para schema v2: `embedding_records.embedding_input_hash`
  é uma coluna própria, mantendo `vector_contract_id` intacto. A abertura migra
  v1→v2 numa transação, é idempotente e executa `PRAGMA integrity_check`.
- `ProducerEmbeddingRecord` deixa de ter o campo ambíguo `inputHash`: passa a
  transportar `vectorContractId` e `embeddingInputHash` separadamente.
- Escrita canónica, bootstrap M1/M2, auditoria de equivalência e reprojeção
  passam a preservar o hash real. A equivalência emite
  `INPUT_HASH_MISMATCH` quando necessário.
- 3E já serializava a metadata; o runtime agora só aceita binário se cada
  hash, path, índice e `textHash` corresponder ao chunk atual. Assim, o binário
  já não mascara `missing-input-hash`.
- M4 publica agora `formatVersion: 2`, com hash obrigatório por registo no Builder,
  Validator e Reader. v1 estruturalmente íntegra é legível/apontável e recuperável,
  com `cutoverEligible=false`, sem fabricar hashes históricos. O recovery distingue
  integridade de elegibilidade. Ver `G6-PUBLISHED-FORMAT-V2-001.md`.

## Backfill determinístico

`embeddingInputHashBackfill.ts` planeia e aplica apenas hashes calculáveis por
`hashContent(buildEmbeddingInput(chunk, prefixMode))`. Não chama provider.

Classificações: `BACKFILLED_VERIFIED`, `ALREADY_PRESENT`, `NOT_RECOVERABLE`,
`AMBIGUOUS`, `SOURCE_MISSING` e `SOURCE_CHANGED`. A aplicação usa a transação
de substituição canónica SQLite: se falhar, o rollback do store é propagado e
nenhuma atualização parcial é considerada sucesso.

## Evidência automatizada

- 99 testes M1/M3/M4/M5 focados: PASS.
- 56 testes de backfill, runtime JSONL e 3E: PASS.
- Typecheck e lint estrito: PASS (execução posterior registada no evidence).
- Suíte completa após compatibilidade v2: 178 ficheiros / 2353 testes: PASS.

## Prova runtime executada, mas não concluída

No vault `zettel`, 000008 v1 foi aceite pelo recovery; foi publicada 000009 v2
com 2303 hashes (0 ausentes), e shadow M5 L2 PASS (2303/2303, 0 divergências).
Os 24 SHA-256 das gerações 1–8 ficaram idênticos. O diagnóstico G6 confirmou
ALREADY_PRESENT=2303, BACKFILLED_VERIFIED=0, demais categorias=0 e equivalência
sem divergências; publicou 000010, mas a etapa binária devolveu error. A causa
é a decisão de ownership em cache que o primeiro preflight do harness deixou
inválida, não um erro demonstrado no backfill ou no formato v2. Execução parada
sem reparações, retries ou repontamento manual. Ver `G6-PUBLISHED-FORMAT-V2-001.md`.
O diagnóstico escreve projeções e gerações; não é read-only. ProviderCalls=0,
sem re-embedding. G6 não é PASS; cutover permanece BLOCKED.

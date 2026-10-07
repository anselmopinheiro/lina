# G6 — Contrato publicado v2 e compatibilidade de recovery

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

Data: 2026-10-06. Estado: implementação, publicação v2 e shadow validados; prova final G6 **FAIL**, interrompida no diagnóstico binário. Cutover: **BLOCKED**. Sem commit nem push.

## Contrato

Novas publicações têm `formatVersion: 2`. O Builder exige `embeddingInputHash` string não vazia em cada registo SQLite; não inventa hashes nem degrada para v1. O Validator verifica hashes dos artefactos, contagens, offsets, identidade dos registos, contrato vetorial e valores finitos. Versão desconhecida produz `FORMAT_UNSUPPORTED`.

| Geração | integrityValid | cutoverEligible | legacyFormat |
| --- | --- | --- | --- |
| v1 íntegra, com ou sem hash histórico | true | false | true |
| v2 íntegra com hash em todos os registos | true | true | false |
| Qualquer geração inválida | false | false | conforme versão |

`valid` permanece um alias de `integrityValid` para compatibilidade dos consumidores existentes. Recovery usa explicitamente `integrityValid`; v1 íntegra continua apontável por CURRENT/CURRENT.tmp, mas não elegível para cutover. A monotonia e as recusas de downgrade permanecem.

O Reader lê v1 e v2; v1 não recebe hashes fabricados, v2 sem hash é recusada. Resultados de leitura e diagnóstico shadow expõem versão e elegibilidade. O comparator ignora a comparação do hash de entrada em v1, exige correspondência em v2 e torna diferenças de versão observáveis. PASS de equivalência legacy não concede elegibilidade de cutover.

## Testes e gates

Baseline antes das alterações: 61 ficheiros / 1024 testes de indexação e typecheck passaram. Após correção: 61 ficheiros / 1032 testes de indexação; suíte completa 178 ficheiros / 2353 testes. Typecheck, lint strict, build, release-check e diff-check passaram. Os testes cobrem leitura v1/v2, v2 sem hash, versão desconhecida, CURRENT e tmp para ambas as versões, corrupção, publicação seguinte v2, bytes antigos preservados, retry idempotente e downgrade recusado.

`npm ci` executado com lockfile existente. Reportou 19 vulnerabilidades nas dependências (4 moderate, 13 high, 2 critical); não foram alteradas dependências nem executado audit fix. Vitest/esbuild exigiram execução fora do sandbox devido a EPERM. Nenhuma chamada a provider nos testes ou na construção/publicação.

## Prova runtime

Executada no renderer real do Obsidian 1.14.4, vault `zettel`, após guardar SHA-256 antes do arranque. Serviço real `publishSqliteCanonicalGeneration` sobre SQLite v2; nenhuma chamada a provider ou re-embedding.

| Medição | Resultado |
| --- | --- |
| CURRENT inicial | generation-000008 |
| 000008 | v1, integrityValid=true, cutoverEligible=false, 2303 registos |
| Recovery | NO_OP, sucesso; 8 gerações v1 aceites pela integridade |
| Publicação | generation-000009, v2, 2303 registos, 2303 hashes, 0 em falta |
| 000009 | integrityValid=true, cutoverEligible=true |
| CURRENT após publicação | generation-000009 |
| SHA-256 gerações 1–8 | 24/24 iguais antes/depois; zero artefactos alterados |
| Shadow M5 | PASS, 000009, L2, 2303/2303, 0 divergências, providerCalls=0 |
| Diagnóstico G6 | FAIL apenas na etapa binária; publishedGenerationStatus=PASS e equivalenceDivergences=0 |
| Backfill | ALREADY_PRESENT=2303; BACKFILLED_VERIFIED=0; restantes categorias=0; applied=false |
| Binary status | error: «Esta operação requer um dispositivo produtor do Lina.» |
| CURRENT final | generation-000010, publicado pelo diagnóstico existente |

### Causa da interrupção e limite da evidência

O primeiro preflight do harness chamou incorretamente `OwnershipGate.evaluate()` com um objeto de opções, quando o argumento esperado é um epoch numérico. Isso armazenou em `lastDecision` um `epoch-mismatch` artificial (`expected epoch [object Object]`), antes de qualquer publicação. Uma segunda falha de harness foi a tentativa de `require('obsidian')` no renderer global, onde esse módulo não está disponível; também anterior às mutações de publicação. Foram corrigidas as invocações do harness, sem reparar dados.

A prova subsequente confirmou authority através de `acquireFence({autoClaimIfUnclaimed:false})`, mas esse ramo não atualiza `lastDecision`. O diagnóstico chegou à etapa binária com a decisão anterior ainda em cache. `main.ts` injeta `isAuthorizedSync()` no BinaryWorker, que recusou a operação e devolveu undefined; o host converteu esse resultado na mensagem genérica de produtor. O MaintenanceEngine tinha capabilities Producer, `canMaintainBinaryCopy=true`, estava iniciado e o device runtime reconhecia o Active Producer. Portanto a falha observada está contaminada pelo harness e **não demonstra corrupção, ownership perdido ou um defeito no formato v2**.

Após a falha real no diagnóstico, a execução parou: nenhum retry, reparação binária, transferência de ownership, edição de gerações ou repontamento manual de CURRENT. A próxima prova exige runtime limpo e autorização para retomar a partir do estado factual 000010; não se deve reutilizar a premissa 000008 nem apagar 000009/000010.

Harness: `scripts/run-obsidian-g6-format-v2-proof.mjs`, Node >=22, porta local 9222. O guard bloqueou `window.fetch` e foi restaurado; `requestUrl` não foi instrumentado. Zero providers é sustentado pelos caminhos executados e pelos resultados dos serviços/diagnósticos. Evidência: `evidence/G6-PUBLISHED-FORMAT-V2-001.json`; erro inicial preservado em `evidence/G6-PUBLISHED-FORMAT-V2-PREFLIGHT-001.json`.

O diagnóstico G6 existente **não é read-only**: nesta execução o plano de backfill foi idempotente, mas reprojetou o legado, publicou 000010 e escreveu evidência no vault; a criação da cópia binária foi recusada. CURRENT avançou monotonamente, sem repontamento manual.

G1/G2/G3 e cutover não foram iniciados. As alterações pré-existentes M1–M5/G6 foram preservadas; nenhum commit ou push.

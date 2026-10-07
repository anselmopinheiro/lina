# G6 — Auditoria da cache de ownership no caminho binário

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

Data: 2026-10-06. Resultado: **READY_FOR_FIX**. Recuperabilidade: **RECOVERABLE_WITHOUT_PROVIDER**. G6 continua **FAIL** na prova final; cutover **BLOCKED**.

Auditoria exclusivamente read-only do `zettel`. Nenhuma reparação da cache, repetição do diagnóstico G6, alteração de SQLite, notas, ownership, gerações M4 ou CURRENT. Sem commit nem push. Alterações pré-existentes preservadas.

## 1. Causa provada e artefacto exato

A cache inválida é `LinaPlugin.ownershipGate.lastDecision`, declarada em `src/device/ownershipGate.ts`, classe `OwnershipGate`. **Não tem path de filesystem nem persistência**. É um objeto JavaScript `OwnershipGateDecision` com authorized/status/activeProducerId/epoch/reason, pertencente à instância local do plugin. Não é partilhada nem sincronizada; não tem timestamp, TTL ou fingerprint de inputs. Vive até ser substituída por `evaluate()`/`assertFence()`, limpa por `invalidate()`, ou perdida com a substituição da instância do plugin.

Estado real observado: `authorized=false`, `status=epoch-mismatch`, epoch 3, reason `Ownership epoch mismatch: expected epoch [object Object], but manifest is at epoch 3.` A cache permanece assim nesta auditoria; `isAuthorizedSync()` devolve false.

Quem a escreveu foi o **meu primeiro preflight do harness**, através de `gate.evaluate({autoClaimIfUnclaimed:false})`. O método espera um epoch numérico. O JavaScript não tipado passou o objeto à comparação estrita com epoch 3 e armazenou a recusa em `lastDecision`. A chamada errada está preservada na evidência do preflight anterior; foi reproduzida em adapter exclusivamente em memória.

## 2. Fluxo e fontes de verdade

| Etapa | Ficheiro/função | Contrato |
| --- | --- | --- |
| Identidade local | `deviceIdentity.ts:getOrCreatePersistentDeviceId`; `main.ts:getDeviceId` | `app.loadLocalStorage('lina_device_id')`, fora dos ficheiros sincronizados; a auditoria apenas leu o valor existente |
| Papel | `deviceState.ts:loadDeviceState`; `main.ts:getDeviceRoleResolution` | `.lina/devices/<deviceId>.json` + resolução canónica, não inferência de autoridade pela plataforma |
| Autoridade | `deviceOwnership.ts:readOwnership`; `ownershipGate.ts:evaluateOwnershipGate` | `.lina/ownership.json`, comparação de deviceId/activeProducerId e epoch, com papel Producer |
| Cache | `OwnershipGate.evaluate/assertFence/invalidate` | writers de `lastDecision`; `acquireFence(options)` não é writer |
| Preflight binário | `main.ts:getMaintenanceEngine` | injeta `canPublish: () => gate.isAuthorizedSync()` no BinaryWorker |
| Criação/remove 3E | `MaintenanceEngine.runBinaryTask`; `BinaryWorker.createOrUpdate/remove` | capability + started + cached canPublish antes de entrar no controller |
| Publicação 3E | `BinaryEmbeddingCopyController.runWrite` | aquisição de fence sem auto-claim, assert antes das mutações, lease, correspondência da publicação canónica e rollback/recovery existente |
| Validação 3E | `BinaryWorker.check`; `BinaryEmbeddingCopyController.check` | read-only, sem preflight cached canPublish; compara digests, contagens e sourcePublicationId |
| Leitura runtime | `RuntimeEmbeddingIndexCache.load`; `readBinaryEmbeddingStorage` | read-only; compara identidade/binário/chunks, fallback JSONL dentro dos limites; não usa `OwnershipGate.lastDecision` |

Ownership tem como fonte de verdade o manifesto de ownership **em conjunto com a identidade local e o papel canónico**. Settings/provider, SQLite, geração M4 e versão binária não concedem ownership. `producerState.ts` também documenta o manifesto de ownership como autoridade. `deviceRuntimeState` é outra projeção em memória: pode mostrar canPublish=true ao mesmo tempo que `lastDecision` recusa, como observado; não substitui a autoridade real.

## 3. Sequência causal

1. O preflight errado escreve a recusa artificial em RAM; não escreve ownership.json.
2. A chamada do harness é corrigida para `acquireFence({autoClaimIfUnclaimed:false})`.
3. Esse ramo chama diretamente `evaluateOwnershipGate` e devolve token correto (deviceId/epoch 3), mas não atualiza `lastDecision` em sucesso **nem em falha**. Portanto a cache negativa sobrevive.
4. Publicação 000009 v2 e shadow L2 passam, por caminhos que não dependem deste canPublish síncrono.
5. O diagnóstico G6 reprojeta JSONL e publica 000010; chama `createOrUpdateBinaryEmbeddingCopy()`.
6. O MaintenanceEngine tem capabilities Producer, está iniciado e admite binary-copy, mas o BinaryWorker recebe `isAuthorizedSync=false` e devolve undefined **antes de chamar o controller**.
7. O host converte undefined em `{status:'error', reason:'Esta operação requer um dispositivo produtor do Lina.'}`.

A sequência sugerida «cache persistida» é **rejeitada**: houve cache em RAM, não persistência em disco. Não se observou corrupção nem transferência de ownership. A falha é transitória quanto à persistência, pode durar indefinidamente na mesma instância sem nova avaliação e é reproduzível. Também se reproduziu com um epoch numérico antigo, sem depender do erro de tipagem do harness.

## 4. Estado real e provas read-only

- DeviceId local, deviceId persistido e activeProducerId: `440d9ef0-9ff9-424e-ae55-7c386b885ec8`; role configurada/effective Producer; epoch 3; device name TESTES.
- Ownership atualizado a 2026-09-28T19:54:18.892Z, reason manual-transfer. Device state schema 2 atualizado a 2026-09-28T19:57:12.874Z.
- CURRENT: **generation-000010**, sem alteração durante a auditoria. Gerações 000009/000010: v2, 2303 registos, zero hashes ausentes, hashes de artefactos, offsets e dimensões válidos.
- SQLite privado: `C:/Users/ansel/AppData/Local/lina/db/lina-producer.db`. Consultada apenas **cópia de DB+WAL** no workspace, aberta read-only: integrity_check=ok, schema 2, 2303/2303 input hashes, vetores de 4096 bytes (=1024 float32).
- Binário: `embeddings.binary.manifest.json`, `embeddings.meta.jsonl`, `embeddings.vectors.f32`, formato binary-v1; 2303 registos × 1024 dimensões; vetores 9433088 bytes; criado a 2026-10-06T11:19:21.701Z. Hashes e tamanhos de metadata/vetores conferem.
- Binary sourcePublicationId: `emb-muwl66hs-8hv4xi3e5p`; geração binária `derived-emb-muwl66hs-8hv4xi3e5p`. Manifesto JSONL atual: `emb-muwl8l2c-icffosat9c`, atualizado a 2026-10-06T11:21:10.308Z. **Binário íntegro mas outdated** perante a publicação JSONL atual; o status histórico do controller ainda diz valid para a publicação antiga.
- Comparação float32 por chunk: **2303/2303 iguais** entre SQLite, JSONL, binário existente e M4 v2 000009/000010. JSONL e M4 têm 2303/2303 hashes iguais ao SQLite. Binário deriva de JSONL, não do número M4/CURRENT.
- Comparados 40 artefactos protegidos (ownership/device state, índice, CURRENT, 30 ficheiros M4, DB/WAL), antes/depois: **zero hashes alterados**. Nenhum método de repair, evaluate/assertFence/invalidate ou publicação foi chamado no runtime real por esta auditoria.

## 5. Invalidação e lacunas

| Evento/input | Contrato factual e lacuna |
| --- | --- |
| DeviceId | Getter dinâmico na avaliação, mas isAuthorizedSync não compara o id com lastDecision; uma mudança exige leitura fresca |
| Role | Método síncrono recusa role não Producer; `changeDeviceRole` reavalia em vários ramos. Retorno a Producer sem avaliação pode herdar cache antiga |
| Ownership/epoch | evaluate/assertFence reavaliam; acquireFence(options) não sincroniza cache. Nenhum caller de `OwnershipGate.invalidate()` encontrado em produção; não há subscrição dedicada de alterações do ficheiro ownership para essa cache |
| SQLite generation | Não é input de ownership; não deve invalidar autoridade por si só |
| Binary format/version | Não é input de ownership; pertence à validação de artefactos |
| Canonical generation | Deve invalidar o índice runtime/derivados, não conceder authority; diagnóstico M4 não atualiza esta cache |
| Erro de preflight | evaluate guarda a recusa, sem validar em runtime o tipo do expectedEpoch; correção de argumentos não apaga a decisão anterior |
| Startup/reload | Nova instância inicia lastDecision=null; loadDataFromDisk chama evaluate e reconstrói. Não executado como repair nesta auditoria |

`invalidate()` isolado **não é uma correção segura**: lastDecision=null faz `isAuthorizedSync()` devolver true num Producer. Há ainda a variante simétrica: cache positiva antiga permanece após `acquireFence(options)` recusar nova ownership. O controller mantém fence no limite durável, pelo que essa variante não prova escrita sem autoridade; prova divergência no preflight.

## 6. Impacto real vs risco

| Caminho | Evidência/impacto |
| --- | --- |
| Diagnóstico G6 | Falha real na etapa binária; mensagem genérica mascara a recusa stale |
| Criação/update/remove 3E | Preflight cache pode recusar trabalho legítimo; manutenção automática usa o mesmo gate cached |
| Validação read-only 3E | Não bloqueada pela cache; binário atual classificável outdated pela diferença de publicationId |
| Runtime binary read | Não depende dessa cache; diagnóstico em memória ainda refere a leitura antiga. Não foi forçada nova leitura/pesquisa nesta auditoria |
| Fallback JSONL | Código existente conserva fallback sob Resource Guard; bytes/vetores atuais conferem. Não foi medida uma nova pesquisa |
| Producer | Afetado no preflight mutável, como provado |
| Companion/mobile | Leitura não requer autoridade de publicação; risco indireto de receber derivados outdated/ter de usar fallback ou exceder cap JSONL. Sem prova em dispositivo secundário; esse impacto operacional é INCONCLUSIVO |
| M5 shadow | PASS real para 000009, L2, 2303/2303, zero divergências; não reexecutado |
| M4/SQLite | Publicação v2 e integridade comprovadas; cache não as corrompeu |

## 7. Segurança e recuperabilidade

**RECOVERABLE_WITHOUT_PROVIDER**: autoridade correta é derivável deterministicamente de deviceId/role/ownership atuais. Teste isolado mostra que aquisição e assert de fence atualizam a decisão correta, sem alterar ownership.json; nova instância não herda a cache. Nada foi recuperado no runtime real.

Zero corrupção observada em SQLite (integrity_check da cópia estável), M4 e binário (hashes/layout); zero perda de vetores (2303/2303); zero alterações aos embeddings nesta auditoria (hashes antes/depois); provider/re-embedding não necessários. O **diagnóstico G6 anterior escreveu fisicamente** a reprojeção JSONL e publicou M4; não se afirma ausência desses efeitos históricos, apenas conservação dos vetores e ausência de mutação nesta auditoria.

## 8. Estratégias comparadas e correção mínima recomendada

| Estratégia | Causa raiz | Risco/complexidade | Mobile/startup/idempotência |
| --- | --- | --- | --- |
| A — invalidar em eventos | Parcial; não garante leitura fresca e null é otimista | Médio: listeners de device/role/ownership e corridas; insuficiente isoladamente | Sem I/O de provider; precisa reevaluate antes de mutar; eventos repetidos toleráveis |
| B — recalcular em cada preflight | Resolve stale negativo e positivo no caminho mutável | Baixo/médio: pequena leitura de ownership, sem auto-claim; manter fences duráveis | Portable DataAdapter; custo local por operação; leitura repetida idempotente |
| C — cache com fingerprint | Resolve se deviceId/role/owner/epoch forem atuais | Maior: para conhecer fingerprint de ownership é preciso reler; não incluir SQLite/M4/binary como autoridade | Mobile possível; mais contrato e invalidação; sem benefício demonstrado aqui |
| D — remover cache | Elimina a origem de stale | Maior refactor: consumidores síncronos de UI/embeddings/proveniência exigem revisão | Mais leitura assíncrona/startup; não recomendado nesta correção mínima |

Recomendar **B**, com aquisição de fence **sem auto-claim** no preflight binário e assertion atual, mantendo fencing já existente antes de cada mutação no controller. Reconciliar `acquireFence(options)` para publicar a decisão fresca em `lastDecision` em ambos os outcomes, sem criar outro modelo de ownership. Corrigir o harness para não passar opções a evaluate(expectedEpoch); uma guarda de tipo em runtime pode ser considerada, mas não substitui o contrato fresco. Não recomendar troca direta para canPublish() sem analisar auto-claim, nem invalidate() sozinho.

G6 está funcionalmente provada no backfill, contrato v2, publication e shadow; **não está formalmente concluída**, nem se garante que nova prova binária passe sem a execução controlada dessa etapa. A correção proposta não requer provider, re-embedding, alteração SQLite/M4 ou repontar CURRENT.

## 9. Validação, ficheiros e limites

Criados este relatório, `evidence/G6-BINARY-OWNERSHIP-CACHE-AUDIT-001.json` e `tests/device/ownershipCacheAudit.test.ts` (4 caracterizações). `npx vitest run tests/device/ownershipCacheAudit.test.ts tests/device/ownershipGate.test.ts`: **2 ficheiros / 22 testes PASS**. `npm run typecheck`: PASS. `git diff --check`: PASS. Build/npm ci não executados nesta auditoria: prompt limita os gates a typecheck/diff-check e testes necessários; não houve alteração funcional de produção ou dependências.

Lidos AGENTS.md, docs/INDEX.md, prompt, relatórios/evidências G6 e módulos de ownership, identidade/role, MaintenanceEngine/BinaryWorker, controller/storage/runtime binários, SQLite/path resolver e testes pertinentes. A causalidade foi provada por código, estado real e testes; a reprodução e recuperação usam apenas FakeAdapter. Modelo com raciocínio técnico adequado pela necessidade de distinguir autoridade, projeções e mutação durável.

Evidência preserva os snapshots read-only e SHA-256. Captura não equivale a teste mobile, nova pesquisa, garantia futura ou validação de release. Parar após esta auditoria; não reparar, repetir diagnóstico G6, iniciar G1/G2/G3 ou cutover.

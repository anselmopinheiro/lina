# LINA-GIT-DIVERGENCE-AUDIT-001

Data: 2026-10-01 (Europe/Lisbon). Domínio: auditoria Git e documentação arquitetural de embeddings/ownership.

## Conclusão

Confirmada divergência de **9 commits exclusivos locais e 1 exclusivo remoto**. O commit remoto `e5b3da0` acrescenta apenas um documento legítimo de auditoria LINA-14. O mesmo documento foi incorporado integralmente pelo commit local `86676a4`: path, modo `100644`, blob e patch desse ficheiro são idênticos. Não existe conteúdo exclusivo remoto em falta na árvore local atual.

A origem está documentada no reflog deste clone: criação de `e5b3da0`, atualização de `origin/master` por push, recuo histórico de `master` para `5a29833` e criação subsequente dos nove commits locais. Esse recuo é evidência histórica; nenhum reset foi executado nesta tarefa.

Recomenda-se, após decisão explícita de integração, um merge normal que preserve os dois históricos. O resultado de conteúdo esperado é a árvore local atual. Não foi executada integração nem simulação de merge; ausência de conflitos é uma previsão fundamentada pela comparação das alterações e blobs, não um resultado de merge testado.

## 1. Estado Git

| Campo | Antes da auditoria | Após fetch |
|---|---|---|
| Diretório/root | `D:/_dev/obsidian/lina` | igual |
| Branch | `master` | igual |
| HEAD local | `0d9580d2adfb68586f96a05014c954b66a0c2b00` | igual |
| `origin/master` | `e5b3da038165e68dc9fa049267fcc08c36c9383c` | igual |
| Working tree | limpa, saída vazia de `git status --porcelain=v1` | limpa antes da criação deste relatório |
| Origin | `https://github.com/anselmopinheiro/lina.git` | igual |

`git fetch origin` foi realizado com sucesso (exit 0), sem alteração dos hashes acima. A primeira tentativa no sandbox falhou com `cannot open '.git/FETCH_HEAD': Permission denied`; a repetição com permissão elevada terminou com sucesso. Fetch pode atualizar metadados/referências remotas em `.git`; não altera o histórico local nem o working tree.

Aplicada a clarificação do utilizador: árvore limpa no início, relatório criado durante a auditoria, apenas este relatório como alteração final. Sem commit ou push.

## 2. Histórico local

Datas de autoria e de commit coincidem nos nove commits; horas abaixo em UTC+01:00. Autor/committer: Anselmo Pinheiro. Ordem do mais antigo para o mais recente. Hashes abreviados identificam univocamente os commits observados.

| Commit | Data | Mensagem | Área | Observação |
|---|---|---|---|---|
| `c2c64b4` | 2026-09-30 19:52:50 | refactor(embeddings): derive status UI actions from canonical write-path decision (LINA-14F.4-B4.1) | LINA-14, código, testes, documentação | 5 ficheiros; ações de estado derivadas de `deriveEmbeddingWritePathDecision`; teste de derivação; bundle. |
| `86676a4` | 2026-09-30 20:04:44 | refactor(embeddings): consolidate search view snapshot source (LINA-14F.4-B4.2) | LINA-14, pesquisa, testes, documentação | 7 ficheiros; `LinaSearchView` consome snapshot do plugin; incorpora também o documento B4.0-D idêntico ao remoto. |
| `c320754` | 2026-09-30 20:38:12 | refactor(embeddings): consolidate main runtime lifecycle snapshot derivation (LINA-14F.4-B4.3) | LINA-14, runtime, testes, documentação | 6 ficheiros; `main.ts` reutiliza `buildEmbeddingWorkLifecycleSnapshot`; controller recebe contexto de provider/identidade; bundle. |
| `603e734` | 2026-09-30 21:24:18 | refactor(embeddings): final lifecycle wiring cleanup and hardening (LINA-14F.4-B4.4) | LINA-14, testes, documentação | 4 ficheiros; auditoria/implementação e 455 linhas iniciais de testes; altera bundle, sem alteração TS neste commit. |
| `2f1bfd8` | 2026-09-30 21:38:32 | refactor(embeddings): shadow infrastructure removal audit and consolidation (LINA-14F.5) | LINA-14, consolidação, testes, documentação | 6 ficheiros; comentários canónicos no adapter/scheduler, testes de ausência de infraestrutura shadow e bundle. |
| `4362da6` | 2026-09-30 21:50:55 | docs(architecture): complete lifecycle architecture hardening audit and validation (LINA-14F.6) | LINA-14, documentação, artefacto | 2 ficheiros; auditoria de hardening e alteração de `main.js`; não é estritamente documental. |
| `23862c5` | 2026-09-30 22:10:33 | docs(architecture): close LINA-14 embedding lifecycle consolidation | LINA-14, documentação, artefacto | 3 ficheiros; baseline arquitetural, estado em `AGENTS.md` e alteração de bundle. |
| `66156b7` | 2026-09-30 22:33:01 | docs(audit): complete post-LINA14 embeddings subsystem audit | Documentação, auditoria pós-LINA-14 | 1 ficheiro, 750 linhas; auditoria global do subsistema. |
| `0d9580d` | 2026-10-01 16:27:05 | fix(embeddings): fence durable writes by ownership epoch | LINA-15A, correção, ownership, embeddings, testes, documentação | 12 ficheiros; token produtor/epoch, classificação de leitura de ownership, injeção de fence em geração/persistência/purge, testes e bundle. |

Presença confirmada de lifecycle, `EmbeddingLifecycleSnapshot`, `deriveEmbeddingWritePathDecision`, ownership fencing e LINA-15A. Os commits anteriores de scheduler, worker e operation manager pertencem ao histórico comum; não são commits locais exclusivos adicionais.

## 3. Histórico remoto

| Commit | Data | Mensagem | Área | Observação |
|---|---|---|---|---|
| `e5b3da038165e68dc9fa049267fcc08c36c9383c` | 2026-09-30 19:09:05 +01:00 | docs: update master branch and deployment workflow | Documentação arquitetural LINA-14F.4-B4.0-D | Um ficheiro novo, 155 linhas, modo `100644`; conteúdo já incorporado em `86676a4`. |

Autor e committer: Anselmo Pinheiro (`pinheiro.anselmo@gmail.com`), com a mesma data de autoria/commit. Parent único: `5a2983381eb32c9ee71b00d71abbb85c4018355a`.

Único ficheiro alterado:

`docs/audits/architecture/LINA-14F4-B4.0-D-AUDIT-RUNTIME-WIRING-SIMPLIFICATION-001.md`

Foi lido o diff completo. Apesar da mensagem mencionar branch e deployment, o commit **não altera configuração Git, CI, workflow, release, código ou schema**. O documento mapeia snapshots ad-hoc, adapter, controllers, orquestração e UI, propondo as subfases B4.1–B4.4. É trabalho legítimo do Lina e um registo histórico anterior à consolidação local posterior.

## 4. Ancestral comum

`git merge-base master origin/master`:

`5a2983381eb32c9ee71b00d71abbb85c4018355a`

Mensagem: `fix(embeddings): consolidate operation manager with lifecycle snapshot (LINA-14F.4-B4.0-C)`.

Autor/committer: Anselmo Pinheiro; data: 2026-09-30 18:47:17 +01:00. Consolida gate canónica de início partilhada pelo worker/manager e snapshot vivo com autoridade atual.

Os dois comandos `git merge-base --is-ancestor` devolveram exit 1: `origin/master` não é ancestral de `master`, nem `master` de `origin/master`. Trata-se de divergência real, não fast-forward.

## 5. Natureza e origem da divergência

```text
5a29833 (ancestral comum)
├── e5b3da0                                  origin/master
└── c2c64b4 → 86676a4 → c320754 → 603e734
    → 2f1bfd8 → 4362da6 → 23862c5 → 66156b7
    → 0d9580d                                master / HEAD
```

Evidência do reflog local, por ordem temporal:

| Data (+01:00) | Referência | Entrada |
|---|---|---|
| 2026-09-30 19:09:05 | `master` | `e5b3da0`: commit: docs: update master branch and deployment workflow |
| 2026-09-30 19:09:12 | `origin/master` | `e5b3da0`: update by push |
| 2026-09-30 19:12:25 | `master` | `5a29833`: reset: moving to HEAD~1 |
| 2026-09-30 19:52:50 em diante | `master` | criação dos nove commits locais listados |

Logo, neste clone, o commit publicado foi retirado da ancestralidade local por esse reset histórico. O documento reapareceu em `86676a4`, sem reincorporar o commit remoto como ancestral. Reflog e metadados não permitem atribuir a intenção, ferramenta ou operador do reset; não se infere isso.

## 6. Diferença de conteúdo

### 6.1 Prova de equivalência do conteúdo remoto

| Verificação | Resultado |
|---|---|
| Blob no documento em `master` | `5fc6dc6d9b56b2d748e52f4f0df95a02752f9397` |
| Blob no documento em `origin/master` | `5fc6dc6d9b56b2d748e52f4f0df95a02752f9397` |
| Diff desse path entre os tips | vazio, exit 0 |
| Patch-id estável do commit remoto | `9524b29993f8a0ce82252b6b2ee6bdae7c9a0eee` |
| Patch-id estável da alteração desse path em `86676a4` | `9524b29993f8a0ce82252b6b2ee6bdae7c9a0eee` |

`git cherry -v master origin/master` marca `e5b3da0` com `+`: não existe um commit local com patch **integral** equivalente, porque `86676a4` inclui também seis outros ficheiros. Isso não contradiz a igualdade comprovada do único conteúdo remoto. Nenhum dos nove commits locais é integralmente patch-equivalente ao commit remoto.

### 6.2 Diferenças entre tips

`git diff --stat master origin/master`: **35 ficheiros, 232 inserções e 4099 remoções**, na direção local → remoto. Estas remoções representam trabalho local ausente no tip remoto; não foram efetuadas nesta tarefa nem são alterações feitas por `e5b3da0`.

Na direção inversa, `origin/master` → `master`: 4099 inserções e 232 remoções. Desde o ancestral comum até `master`: 36 ficheiros, 4254 inserções e 232 remoções; o 36.º ficheiro é precisamente a auditoria B4.0-D comum aos dois tips.

Inventário completo de `git diff --name-status master origin/master` (M = diferente; D = existe localmente e está ausente no tip remoto):

```text
M AGENTS.md
D docs/architecture/LINA-14-EMBEDDING-LIFECYCLE-BASELINE-001.md
M docs/architecture/producer-ownership.md
D docs/audits/architecture/LINA-14F4-B4.1-AUDIT-UI-ACTION-DERIVATION-001.md
D docs/audits/architecture/LINA-14F4-B4.1-IMPLEMENT-UI-ACTION-DERIVATION-001.md
D docs/audits/architecture/LINA-14F4-B4.2-AUDIT-LINASEARCHVIEW-SNAPSHOT-SOURCE-001.md
D docs/audits/architecture/LINA-14F4-B4.2-IMPLEMENT-LINASEARCHVIEW-SNAPSHOT-SOURCE-001.md
D docs/audits/architecture/LINA-14F4-B4.3-AUDIT-MAIN-RUNTIME-SNAPSHOT-CONSOLIDATION-001.md
D docs/audits/architecture/LINA-14F4-B4.3-IMPLEMENT-MAIN-RUNTIME-SNAPSHOT-CONSOLIDATION-001.md
D docs/audits/architecture/LINA-14F4-B4.4-AUDIT-FINAL-LIFECYCLE-WIRING-CLEANUP-001.md
D docs/audits/architecture/LINA-14F4-B4.4-IMPLEMENT-FINAL-LIFECYCLE-WIRING-CLEANUP-001.md
D docs/audits/architecture/LINA-14F5-AUDIT-SHADOW-INFRASTRUCTURE-REMOVAL-001.md
D docs/audits/architecture/LINA-14F5-IMPLEMENT-SHADOW-INFRASTRUCTURE-REMOVAL-001.md
D docs/audits/architecture/LINA-14F6-AUDIT-LIFECYCLE-HARDENING-001.md
D docs/audits/architecture/LINA-15A-AUDIT-OWNERSHIP-FENCING-001.md
D docs/audits/architecture/LINA-15A-IMPLEMENT-OWNERSHIP-FENCING-001.md
D docs/audits/architecture/LINA-EMBEDDINGS-AUDITORIA-GLOBAL-POS-LINA14-001.md
M main.js
M main.ts
M src/device/deviceOwnership.ts
M src/device/ownershipGate.ts
M src/index/embeddingGenerator.ts
M src/index/embeddingLifecycleAdapter.ts
M src/index/embeddingPersistence.ts
M src/index/embeddingWorkStatusController.ts
M src/maintenance/embeddingScheduler.ts
M src/search/embeddingStatusViewModel.ts
M src/search/linaSearchView.ts
M tests/device/ownershipGate.test.ts
M tests/index/embeddingPersistence.test.ts
D tests/maintenance/finalLifecycleWiringHardening.test.ts
D tests/maintenance/mainRuntimeSnapshotConsolidation.test.ts
D tests/search/embeddingStatusActionDerivation.test.ts
M tests/search/linaSearchViewHardening.test.ts
D tests/search/linaSearchViewSnapshotSource.test.ts
```

As diferenças funcionais locais lidas incluem: fonte canónica de snapshot na pesquisa; decisão canónica de ações; factory de lifecycle no main/controller; token `producerDeviceId + epoch` no ownership gate; leitura distinguindo missing/invalid/unsupported/unreadable; porta de fence propagada pelo generator à persistence; verificações em recovery, checkpoints, promoção canónica e purge. Há testes e documentação associados. Não há ficheiro de schema, configuração ou workflow/release alterado nas diferenças observadas; a implementação LINA-15A declara e mantém os formatos persistidos, acrescentando tipos/portas runtime.

## 7. Conflitos potenciais e comparação semântica

Sobreposição de paths desde o ancestral: exatamente **um**, a auditoria B4.0-D, acrescentada independentemente nos dois lados com conteúdo e modo idênticos. Não há sobreposição remota em `main.ts`, `src/index`, `src/maintenance`, `src/search`, ownership, schemas ou `AGENTS.md`.

Classificação principal: **B — conteúdo já incorporado localmente**, dentro de um commit maior. Também é documentação legítima a preservar (A quanto à legitimidade) e um diagnóstico histórico superado por implementações posteriores (C quanto à atualidade). Não há evidência de D, conflito com a arquitetura atual: o documento propõe consolidação canónica compatível com a direção dos commits LINA-14 posteriores, e não prescreve remoção do fencing LINA-15A.

Não foi identificado conflito semântico de integração. As descrições de “situação atual” e referências de linhas no documento remoto devem ser entendidas no contexto da fase B4.0-D, não como descrição do HEAD posterior à LINA-15A. Preservar esse documento não implica reintroduzir código antigo.

Um merge normal deverá resolver a adição idêntica sem conflito e manter toda a árvore local. Um rebase/cherry-pick pode encontrar adição duplicada ou alteração vazia, dependendo da sequência/estratégia. Não se realizou qualquer operação de integração para descobrir conflitos.

## 8. Avaliação de risco

| Cenário | Risco | Fundamentação |
|---|---|---|
| Auditoria e criação deste relatório | LOW | Histórico local intacto; única alteração no working tree é documental. |
| Merge normal após autorização e nova confirmação dos tips | LOW | Remoto só acrescenta documento idêntico; preserva ambos os históricos. Resultado ainda precisa de verificação. |
| Rebase dos nove commits | MEDIUM | Reescreve hashes e pode exigir tratamento da adição já presente; desnecessário para resolver esta divergência. |
| Cherry-pick isolado do remoto | MEDIUM | Conteúdo já presente; não estabelece ancestralidade e não resolve por si o non-fast-forward. |
| Reset local para o remoto | HIGH | Retira nove commits da referência ativa e perde da árvore a consolidação/fencing local. |
| Push forçado do local | HIGH | Substitui a ancestralidade remota e elimina `e5b3da0` do branch publicado, apesar de o ficheiro sobreviver localmente. |

Risco global da divergência: **LOW para integração preservadora**, **HIGH para soluções que substituam um dos históricos**. Não existe evidência de perda de conteúdo remoto atual; existe trabalho local funcional relevante a proteger.

## 9. Estratégias possíveis — não executadas

| Estratégia | Preservação | Conflitos esperados | Impacto no histórico | Adequação |
|---|---|---|---|---|
| Merge normal de `origin/master` em `master` | Todos os commits locais e remoto | Nenhum esperado; único add/add é idêntico | Um novo merge commit, hashes existentes intactos | Recomendada; confirmar previamente working tree e tips, depois verificar árvore resultante. |
| Rebase local sobre `origin/master` | Conteúdo pode ser preservado, mas exige cuidado | Possível duplicação da auditoria em B4.2 | Reescreve os nove commits locais | Possível se história linear for requisito explícito; maior complexidade sem benefício necessário. |
| Cherry-pick do remoto sobre local | Conteúdo já preservado | Patch já aplicado/commit vazio possível | Novo commit ou nenhum; original remoto continua fora da ancestralidade | Inadequada isoladamente para reconciliar branches. |
| Reset local para remoto | Não preserva o trabalho local na referência ativa | Não resolve semanticamente; substitui a árvore | Recuo do branch; versões LINA-14/LINA-15A deixam de estar ativas | Rejeitada como solução desta divergência. |
| Push forçado / force-with-lease | Preserva árvore local, mas não a ancestralidade remota | Contorna proteção em vez de integrar | Substitui histórico publicado | Desnecessária e não recomendada, mesmo com lease. |
| Aguardar sem integração | Tudo permanece como está | Nenhum | Sem alteração | Segura até haver autorização, mas push normal continuará non-fast-forward. |

Não se recomenda estratégia `ours` nem resolução global `-X ours`: a comparação permite um merge normal, que preserva e considera explicitamente o trabalho remoto.

## 10. Recomendação e respostas objetivas

É razoavelmente seguro integrar mediante **merge normal posterior**, preservando `e5b3da0` como ancestral e os nove commits locais. O conteúdo remoto já está preservado; a integração proposta preserva também a proveniência original. Nenhuma inspeção funcional adicional é exigida pela diferença remota atual, mas os tips devem ser confirmados novamente antes de integrar, e o resultado deve ser validado contra a árvore local auditada. Se o remoto avançar, esta conclusão precisa de nova avaliação.

Antes dessa operação futura, resolver explicitamente o destino deste relatório não commitado. Após integração autorizada, verificar conteúdo, estado e ancestralidade antes de decidir push; se surgirem alterações funcionais inesperadas, parar e analisá-las. A auditoria não constitui autorização para integração, commit, push ou release.

1. **Commit remoto em falta na ancestralidade local:** `e5b3da038165e68dc9fa049267fcc08c36c9383c`.
2. **Alteração:** apenas a auditoria B4.0-D, 155 linhas; mensagem de deployment não corresponde a alteração de workflow.
3. **Nove commits locais:** os listados na secção 2, de `c2c64b4` a `0d9580d`.
4. **Ancestral comum:** `5a2983381eb32c9ee71b00d71abbb85c4018355a`.
5. **Sobreposição:** apenas a auditoria B4.0-D, idêntica nos dois lados.
6. **Conflito semântico:** nenhum identificado; o remoto não altera ownership, embeddings ou lifecycle executável.
7. **Preservar remoto:** sim; conteúdo já preservado, recomenda-se preservar também o commit original via merge.
8. **Estratégia segura:** merge normal, sem reescrita e com validação posterior; não executado nesta fase.
9. **Razão para não fazer push agora:** divergência de ancestralidade impede fast-forward; o remoto não é ancestral local. Forçar descartaria proveniência sem necessidade. Além disso, push não foi autorizado.

## 11. Métodos, limites e verificação final

Ficheiros de orientação lidos: prompt externa autorizada pelo utilizador, `AGENTS.md` e `docs/agents/relatorio-final.md`. Análise limitada aos commits divergentes, ancestral, documento remoto, diffs funcionais relevantes e documento de implementação LINA-15A.

Comandos de leitura usados: `Get-Location`, `Get-Content`, `rg`, `git rev-parse`, `git status`, `git branch --show-current`, `git remote -v`, `git log` (incluindo graph/ranges/path), `git show --stat --summary` e `--format=fuller --no-ext-diff`, `git rev-list --left-right --count`, `git merge-base`/`--is-ancestor`, `git diff --stat`/`--name-status`/`--numstat`/`--exit-code`, `git cherry -v`, `git patch-id --stable` e `git reflog show`. `git cherry` é uma consulta; não foi usado `git cherry-pick`. Única operação de rede: fetch de origin expressamente autorizado.

Não foram executados pull, merge, rebase, reset, cherry-pick, push, criação de commits ou alteração de branches. As entradas de reset/push aqui transcritas são exclusivamente históricas. Não se usou merge-tree nem outro mecanismo de integração/simulação que escreva objetos.

Verificação final do working tree e referências:

```text
git status --porcelain=v1 --untracked-files=all
?? docs/audits/architecture/LINA-GIT-DIVERGENCE-AUDIT-001.md

git branch --show-current
master

git rev-parse HEAD
0d9580d2adfb68586f96a05014c954b66a0c2b00

git rev-parse origin/master
e5b3da038165e68dc9fa049267fcc08c36c9383c
```

Único ficheiro criado: este relatório. Sem alterações tracked ou staged. `git diff --check` e verificação de whitespace do novo ficheiro concluídos sem erros; o novo ficheiro também foi revisto em diff contra `/dev/null`, porque o diff normal não inclui untracked files.

`npm ci`, `npm install`, build, testes, typecheck e release-check dispensados: tarefa exclusivamente documental, sem execução ou alteração do plugin. Resultados de testes mencionados nos documentos históricos não foram revalidados nesta auditoria. Não é necessária validação interativa em Obsidian para esta comparação Git.

Nenhuma nota do vault alterada/criada/apagada; nenhum embedding gerado; nenhuma escrita no índice ou `saveData`; nenhum novo comando do plugin; nenhuma chamada a providers IA; nenhum commit realizado e nenhum push. Não houve alteração fora do âmbito, salvo metadados de fetch autorizados em `.git`.

Adequação do modelo: a recolha Git é adequada a um modelo económico; a avaliação de equivalência parcial de commits, reflog e preservação de históricos exige revisão cuidadosa especializada.

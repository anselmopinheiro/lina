# LINA-GIT-DIVERGENCE-INTEGRATION-AUDIT-001

Data: 2026-10-01 (Europe/Lisbon). Domínio: Git e documentação arquitetural. Estado: auditoria concluída; nenhuma integração realizada.

## Conclusão

**Merge normal seguro para os tips auditados**, com risco baixo. A simulação `git merge-tree --write-tree --messages master origin/master` terminou com exit **0**, sem conflitos, e produziu a árvore **idêntica à árvore atual de `master`**: `b4f079f69b3d94be968aa84a980124f008b06064`. Não é necessária resolução manual para estes tips.

O conteúdo do único commit remoto exclusivo, `e5b3da0`, está integralmente presente em `master`, incorporado no commit maior `86676a4`. Os commits completos não são patch-equivalentes. `e5b3da0` ainda não é ancestral de `master`; um merge posterior preservará os dois históricos através de um novo commit com dois parents, sem reescrever commits existentes.

O relatório anterior não commitado foi preservado sem qualquer alteração. Esta fase cria apenas este novo relatório e não autoriza nem executa merge real, commit, push ou limpeza de branches/stashes.

## 1. Estado inicial

Consultados `AGENTS.md` (incluindo regras Git e diretório canónico), o documento externo autorizado pelo utilizador, o relatório anterior e a auditoria arquitetural B4.0-D contida nos commits. As regras de release do `AGENTS.md` referem `master`; não foi assumido `main`.

| Campo | Valor |
|---|---|
| Diretório e Git root | `D:/_dev/obsidian/lina` |
| Branch atual | `master` |
| HEAD | `0d9580d2adfb68586f96a05014c954b66a0c2b00` |
| `refs/heads/master` | `0d9580d2adfb68586f96a05014c954b66a0c2b00` |
| `origin/master` | `e5b3da038165e68dc9fa049267fcc08c36c9383c` |
| Git | `2.50.1.windows.1` |
| Working tree | Apenas o relatório anterior untracked; sem alterações tracked/staged |
| Stashes | `git stash list` sem entradas |

Estado inicial observado:

```text
?? docs/audits/architecture/LINA-GIT-DIVERGENCE-AUDIT-001.md
```

A working tree não está limpa, por causa do relatório expressamente preservado pelo utilizador. Não se executou integração. A simulação opera sobre commits e não consome nem altera esse ficheiro untracked.

SHA-256 inicial do relatório anterior:

`D4924CDC0FE7CF08988CF3A621EB0AEA10D844E25B1BB37DEC2607C99665B4BC`

Não foi realizado novo fetch nesta fase: a comparação incide nas referências locais de `master` e `origin/master`, cujos hashes permanecem iguais aos confirmados pelo fetch da auditoria anterior. Não se afirma que o servidor remoto não possa ter avançado entretanto. Antes de integração futura, atualizar/verificar o remoto e repetir a simulação se os tips mudarem.

## 2. Grafo Git e origem da divergência

Ancestral comum, confirmado por `git merge-base master origin/master`:

`5a2983381eb32c9ee71b00d71abbb85c4018355a`

Mensagem: `fix(embeddings): consolidate operation manager with lifecycle snapshot (LINA-14F.4-B4.0-C)`.

`git rev-list --left-right --count master...origin/master` devolveu `9 1`. Os dois testes `git merge-base --is-ancestor` devolveram exit 1: nenhum dos tips é ancestral do outro. Existe divergência real, não fast-forward.

```text
5a29833
├── e5b3da0                                  origin/master
└── c2c64b4 → 86676a4 → c320754 → 603e734
    → 2f1bfd8 → 4362da6 → 23862c5 → 66156b7
    → 0d9580d                                master / HEAD
```

Commits exclusivos locais, por ordem de criação:

| Commit | Mensagem |
|---|---|
| `c2c64b4` | refactor(embeddings): derive status UI actions from canonical write-path decision (LINA-14F.4-B4.1) |
| `86676a4` | refactor(embeddings): consolidate search view snapshot source (LINA-14F.4-B4.2) |
| `c320754` | refactor(embeddings): consolidate main runtime lifecycle snapshot derivation (LINA-14F.4-B4.3) |
| `603e734` | refactor(embeddings): final lifecycle wiring cleanup and hardening (LINA-14F.4-B4.4) |
| `2f1bfd8` | refactor(embeddings): shadow infrastructure removal audit and consolidation (LINA-14F.5) |
| `4362da6` | docs(architecture): complete lifecycle architecture hardening audit and validation (LINA-14F.6) |
| `23862c5` | docs(architecture): close LINA-14 embedding lifecycle consolidation |
| `66156b7` | docs(audit): complete post-LINA14 embeddings subsystem audit |
| `0d9580d` | fix(embeddings): fence durable writes by ownership epoch |

Exclusivo remoto: `e5b3da0`, `docs: update master branch and deployment workflow`.

O reflog de `master` foi novamente consultado e confirma:

| Data (+01:00) | Evento histórico |
|---|---|
| 2026-09-30 19:09:05 | criação local de `e5b3da0` |
| 2026-09-30 19:12:25 | `5a29833`: `reset: moving to HEAD~1` |
| 2026-09-30 19:52:50 em diante | criação dos nove commits locais |

A auditoria anterior registou ainda `origin/master` atualizado por push para `e5b3da0` às 19:09:12. O reset histórico retirou o commit publicado da ancestralidade local; as alterações documentais foram posteriormente reincorporadas sem o parent remoto. Não se atribui intenção, operador ou ferramenta ao reset. Nenhum reset foi executado nesta fase.

## 3. Análise do commit remoto e equivalência

| Campo | Valor |
|---|---|
| Commit | `e5b3da038165e68dc9fa049267fcc08c36c9383c` |
| Parent único | `5a2983381eb32c9ee71b00d71abbb85c4018355a` |
| Autor/committer | Anselmo Pinheiro (`pinheiro.anselmo@gmail.com`) |
| Data de autoria/commit | 2026-09-30 19:09:05 +01:00 |
| Mensagem | `docs: update master branch and deployment workflow` |
| Diff | 1 ficheiro novo, 155 inserções, modo `100644` |

Único path introduzido:

`docs/audits/architecture/LINA-14F4-B4.0-D-AUDIT-RUNTIME-WIRING-SIMPLIFICATION-001.md`

O diff remoto foi inspecionado integralmente. É uma auditoria do wiring do lifecycle: snapshots ad-hoc, adapter, controllers, main e UI; inclui matriz de simplificação e plano B4.1–B4.4. Não altera código, ownership, schema, configuração, release ou deployment workflow, apesar da mensagem do commit. É documentação legítima e histórica, anterior às consolidações locais e ao fencing LINA-15A.

### Prova empírica

`git log --all --oneline --decorate -- <path>` identifica duas introduções: `e5b3da0` e `86676a4`. `git ls-tree` comprova o mesmo path, modo e conteúdo em ambos e no tip local:

| Revisão | Modo | Blob |
|---|---|---|
| `e5b3da0` | `100644` | `5fc6dc6d9b56b2d748e52f4f0df95a02752f9397` |
| `86676a4` | `100644` | `5fc6dc6d9b56b2d748e52f4f0df95a02752f9397` |
| `master` | `100644` | `5fc6dc6d9b56b2d748e52f4f0df95a02752f9397` |

O diff desse path entre `e5b3da0` e `master` é vazio, exit 0.

Patch-ids estáveis calculados a partir de `git show --format= --no-ext-diff`:

| Patch | Patch-id |
|---|---|
| Remoto completo `e5b3da0` | `9524b29993f8a0ce82252b6b2ee6bdae7c9a0eee` |
| Apenas esse path em `86676a4` | `9524b29993f8a0ce82252b6b2ee6bdae7c9a0eee` |
| Local completo `86676a4` | `2bc13e41422630927f37979946c0a66553e132e8` |

`86676a4` inclui também seis outros ficheiros: auditoria e implementação B4.2, `main.js`, `src/search/linaSearchView.ts`, `tests/search/linaSearchViewHardening.test.ts` e `tests/search/linaSearchViewSnapshotSource.test.ts`. Logo:

- **Equivalência confirmada de todo o conteúdo remoto:** mesmo path, bytes e modo, sem qualquer conteúdo funcional/documental remoto ausente.
- **Equivalência parcial dos patches completos:** o patch remoto é integralmente um subconjunto do patch local; os commits completos não são equivalentes.
- **Ancestralidade não incorporada:** o commit original remoto não é ancestral de `master`.

Não houve transferência para outro path nem equivalência baseada apenas na mensagem dos commits. O relatório anterior fica empiricamente confirmado sem necessitar de alteração.

## 4. Simulação de integração

Executado o mecanismo moderno disponível no Git instalado:

```powershell
git merge-tree --write-tree --messages master origin/master
```

Resultado da execução bem-sucedida (exit 0):

```text
b4f079f69b3d94be968aa84a980124f008b06064
```

Sem entradas de conflitos ou mensagens de conflito. A primeira tentativa no sandbox terminou com exit 128 por `insufficient permission for adding an object to repository database .git/objects`; não foi um conflito. A repetição elevada, limitada ao comando de simulação autorizado, terminou com sucesso.

`--write-tree` calcula o merge e pode escrever objetos de árvore/blob no object database; **não executa `git merge`**, não cria commit, não move referências, não altera índice/working tree e não inicia estado `MERGE_HEAD`. Não foram usados branches/worktrees temporários, stashes, checkout ou limpeza. Não há estado de integração a restaurar; objetos de simulação não são commits e não se fez limpeza em `.git`.

### Comparação da árvore resultante

| Verificação | Resultado |
|---|---|
| `git rev-parse 'master^{tree}'` | `b4f079f69b3d94be968aa84a980124f008b06064` |
| Árvore devolvida pelo merge-tree | `b4f079f69b3d94be968aa84a980124f008b06064` |
| `git cat-file -t <resultado>` | `tree` |
| `git diff --exit-code 'master^{tree}' <resultado>` | vazio, exit 0 |
| `Test-Path .git/MERGE_HEAD` após simulação | `False` |

Isso comprova que **todos os ficheiros tracked e respetivos modos/conteúdos do resultado simulado são idênticos aos locais**, incluindo o fencing e as consolidações LINA-14/LINA-15A. Não há ficheiros resultantes diferentes nem resolução manual necessária.

Única sobreposição de alterações entre os lados desde o ancestral: adição do documento B4.0-D em ambos com o mesmo blob e modo. A simulação resolve essa adição automaticamente. Os relatórios desta tarefa são untracked e não fazem parte dos inputs da simulação.

Num merge normal futuro desses tips, espera-se um novo commit com parents `0d9580d` e `e5b3da0`, árvore igual à atual, e ambos os históricos preservados. Esse commit ainda **não existe como resultado desta tarefa**. Se os relatórios forem commitados entretanto, o novo HEAD e a árvore serão diferentes e a verificação deverá ser repetida.

## 5. Risco

Classificação: **baixo**, fundamentada em exit 0 do merge-tree, ausência de conflitos, igualdade exata das árvores e incorporação integral do único conteúdo remoto. Não há evidência de conflito semântico, perda de código ou reintrodução de arquitetura antiga.

Limites: a simulação valida integração de árvores para os hashes identificados; não executa hooks de commit, políticas do servidor, testes funcionais ou release. Não prova que nenhum terceiro vá atualizar o remoto. A working tree conserva os relatórios não commitados, cujo destino deve ser decidido antes da operação real.

## 6. Recomendação e critérios de conclusão

Opção: **merge normal seguro** para os tips auditados; não requer resolução manual. A operação adequada na fase seguinte é um merge normal de `origin/master` em `master`, preservando ambos os históricos, após autorização explícita e decisão sobre os dois relatórios. Não se recomenda rebase, reset, cherry-pick, force push, estratégia `ours` ou limpeza.

Para a execução futura: confirmar novamente estado/referências e atualidade do remoto; preservar os relatórios; repetir a simulação se houver novo HEAD; validar o resultado real e a ancestralidade antes de decidir qualquer push. Esta recomendação não executa nem autoriza a fase seguinte.

| Pergunta | Resposta comprovada |
|---|---|
| Por que divergiram? | Reset histórico retirou de `master` o commit já publicado, seguido por nove commits locais. |
| O que contém `e5b3da0`? | Apenas o documento arquitetural B4.0-D, 155 linhas. |
| Conteúdo integralmente em `master`? | Sim, introduzido em `86676a4`, com blob/modo e patch do path idênticos. |
| Merge normal produzirá conflitos? | A simulação dos tips atuais terminou sem conflitos, exit 0. |
| Preservará ambos os históricos? | Sim: merge com os dois tips como parents, sem reescrita. Nenhum merge real foi feito. |
| Operação segura seguinte? | Merge normal, condicionado a autorização e nova confirmação dos inputs. |

## 7. Quality gate e preservação do estado

Estado final esperado e confirmado após criação/revisão deste relatório:

```text
?? docs/audits/architecture/LINA-GIT-DIVERGENCE-AUDIT-001.md
?? docs/audits/architecture/LINA-GIT-DIVERGENCE-INTEGRATION-AUDIT-001.md
```

HEAD e `master` permanecem `0d9580d2adfb68586f96a05014c954b66a0c2b00`; `origin/master` permanece `e5b3da038165e68dc9fa049267fcc08c36c9383c`. Sem alterações tracked/staged, sem novo commit nos branches, sem estado de merge. Branches e stashes não foram criados, removidos ou limpos. O SHA-256 final do relatório anterior coincide com o inicial: `D4924CDC0FE7CF08988CF3A621EB0AEA10D844E25B1BB37DEC2607C99665B4BC`.

`git diff --check` e `git diff --no-index --check -- /dev/null <novo-relatório>` sem erros. O diff do novo relatório foi revisto; diff no-index normal devolve exit 1 por existir um ficheiro novo, não por falha de validação.

Comandos principais: `Get-Location`, `Get-Content`, `Get-FileHash`, `rg`, `Test-Path`, `git --version`, `git merge-tree -h`, `git status`, `git branch --show-current`, `git rev-parse`, `git show-ref`, `git stash list`, `git log`, `git reflog show`, `git rev-list`, `git merge-base`, `git show`, `git ls-tree`, `git patch-id --stable`, `git merge-tree --write-tree --messages`, `git cat-file -t` e `git diff`/`--check`. `stash list` foi exclusivamente leitura.

Build, testes, typecheck, release-check, `npm ci` e `npm install` dispensados: tarefa documental/Git sem alteração ou execução de código. Nenhuma nota do vault alterada, embedding gerado, escrita de índice/`saveData`, novo comando do plugin ou chamada externa/provider nesta fase. Único ficheiro criado nesta fase: este relatório; o anterior foi preservado byte a byte. Sem merge real, commit, push, reset, rebase, cherry-pick, revert ou limpeza.

Adequação do modelo: recolha automatizada adequada a modelo económico; interpretação de equivalência parcial de patches e preservação de ancestralidade requer revisão especializada.

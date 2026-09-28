# LINA-04 — Publicação da release 0.3.0

**Estado:** bloqueada antes de criar commit, tag, push ou GitHub Release.

## Verificações concluídas

- Branch atual: `master`.
- A versão 0.3.0, os testes, documentação e release notes já tinham sido aprovados na verificação final anterior.
- `git diff --check` passou.
- Os assets locais de distribuição existem: `manifest.json`, `main.js` e `styles.css`.
- A consulta remota confirmou que a tag `v0.3.0` ainda não existe em `origin`.

## Bloqueio

O `gh auth status` reportou que o token da conta ativa `anselmopinheiro` em `github.com` é inválido. Sem uma sessão GitHub válida, não é possível criar nem confirmar a GitHub Release.

Como a especificação exige parar perante um problema encontrado durante a publicação, não foram executados:

- commit final;
- criação da tag `v0.3.0`;
- push de `master` ou da tag;
- criação da GitHub Release;
- publicação de assets.

## Retoma necessária

Reautenticar o GitHub CLI para a conta com permissão sobre `anselmopinheiro/lina` (por exemplo, `gh auth refresh -h github.com`) e voltar a solicitar a publicação. Após isso, deve-se repetir a verificação remota e executar o processo de commit, tag, push e release de forma atómica.

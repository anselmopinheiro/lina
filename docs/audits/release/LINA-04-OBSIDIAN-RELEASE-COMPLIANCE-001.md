# LINA-04 — Conformidade da release do Obsidian 0.3.0

## 1. Problema identificado

O Obsidian não reconhecia a release porque `manifest.json` declara a versão `0.3.0`, enquanto a publicação existente estava associada à tag `v0.3.0`. O fluxo de Community Plugins procura uma release cuja tag seja idêntica ao valor de `manifest.json`, sem prefixo `v`.

## 2. Estado inicial

- Manifest: `id: lina`, `name: Lina`, `version: 0.3.0`, `minAppVersion: 1.13.0` e restantes campos obrigatórios presentes.
- Release anterior: título `0.3.0`, tag `v0.3.0`, publicada e com assets corretos.
- Assets anteriores correspondiam ao build final, mas a tag incompatível impedia a deteção pelo Obsidian.

## 3. Requisitos do Obsidian verificados

- A documentação oficial do Obsidian exige que a tag da GitHub Release coincida exatamente com a versão em `manifest.json`.
- A release deve estar publicada, não draft e não prerelease.
- Os assets requeridos são `main.js`, `manifest.json` e `styles.css` quando o plugin fornece CSS.

Referências: [Obsidian community releases](https://github.com/obsidianmd/obsidian-releases) e [Obsidian sample plugin release guidance](https://github.com/obsidianmd/obsidian-sample-plugin).

## 4. Alterações realizadas

1. Criada e enviada a tag anotada `0.3.0` no mesmo commit de release.
2. Criada a release pública `Lina 0.3.0` com tag `0.3.0` e notas de release em inglês.
3. Publicados `main.js`, `manifest.json` e `styles.css` do build final.
4. Removidas a release e a tag obsoletas `v0.3.0` para eliminar duplicação e ambiguidade.

Não foram alterados código, funcionalidades, schemas, storage ou contratos.

## 5. Release final

- Release: [Lina 0.3.0](https://github.com/anselmopinheiro/lina/releases/tag/0.3.0)
- Tag: `0.3.0`
- Estado: publicada, não draft, não prerelease.
- Assets: `main.js` (1,232,054 bytes), `manifest.json` (352 bytes), `styles.css` (13,979 bytes).

## 6. Validação

- `git status --short`: sem alterações rastreadas; apenas relatórios de auditoria ainda não commitados.
- `git diff --check`: passou.
- `gh release list`: mostra `Lina 0.3.0` como Latest com tag `0.3.0`.
- `gh release view 0.3.0`: confirmou tag exata, estado público e os três assets obrigatórios.
- `git ls-remote --tags origin 0.3.0 v0.3.0`: confirmou apenas `0.3.0`.

## Decisão

**CONFORME PARA DISTRIBUIÇÃO NO OBSIDIAN.** A tag da release corresponde agora exatamente à versão `0.3.0` do manifest, permitindo que o fluxo de instalação/atualização do Obsidian encontre a publicação correta.

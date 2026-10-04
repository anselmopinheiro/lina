# M1 — Preflight de Runtime e Documentação

**Documento:** `M1-PREFLIGHT-RUNTIME-DOCUMENTACAO-001`
**Data:** 2026-10-04
**Escopo:** remover apenas os bloqueios de runtime e de documentação antes da
implementação M1. Não cria schema, não abre SQLite, não ativa shadow write e
não altera o pipeline de embeddings.

## Conclusão

> **`BLOCKED_RUNTIME`**

O bloqueio documental foi resolvido: a arquitetura de persistência/publicação
foi restaurada e adaptada em
[`ARQUITETURA-PERSISTENCIA-PUBLICACAO-EMBEDDINGS-001.md`](ARQUITETURA-PERSISTENCIA-PUBLICACAO-EMBEDDINGS-001.md).
O bloqueio de runtime permanece porque não foi possível observar, dentro do
processo real do plugin, a presença de `node:sqlite` e `DatabaseSync`.

Não se infere a disponibilidade no Obsidian a partir do Node CLI local. A prova
de runtime é uma condição de entrada para M1, não uma falha que se possa
contornar instalando outra biblioteca SQLite.

## 1. Evidência recolhida

| Verificação | Resultado | Interpretação |
|---|---|---|
| Executável instalado | `Obsidian.exe` 1.12.7.0 | diverge da alegação de 1.13.7 da PoC/prompt |
| Node do terminal de desenvolvimento | v20.19.6 | não representa o runtime do plugin |
| `require('node:sqlite')` no CLI | `ERR_UNKNOWN_BUILTIN_MODULE` | indisponível no CLI atual; não prova ausência no Obsidian |
| `builtinModules.includes('node:sqlite')` no CLI | `false` | o external automático do esbuild não o inclui neste ambiente |
| runtime real do plugin | não observável nesta sessão | a ponte de automação não expõe aplicações nativas, apesar de Obsidian estar instalado |
| dependências SQLite alternativas | nenhuma encontrada | mantida a proibição de introduzir `better-sqlite3`, `sqlite3`, `sql.js` ou equivalentes |

O `node:sqlite` foi adicionado no Node 22.5.0 e `DatabaseSync` é síncrono; a
documentação Node confirma que o módulo só é acessível com o esquema `node:`.
Assim, a alegação do LinaPoC (Node 22 no Electron) é tecnicamente plausível,
mas não foi revalidada na instalação de Obsidian acessível nesta tarefa.

## 2. Runtime: condição objetiva para desbloquear M1

Num Obsidian Desktop real, com o plugin Lina carregado, executar uma prova
reversível que apenas lê:

```ts
{
  node: process.versions.node,
  electron: process.versions.electron,
  platform: process.platform,
  databaseSync: typeof require("node:sqlite").DatabaseSync,
}
```

O resultado aceite exige Node >= 22.5 e `databaseSync === "function"`. A prova
não deve abrir ficheiros, criar tabelas nem adicionar um caminho de produção.
Registar a versão observada e remover qualquer artefacto temporário antes da
implementação M1. Se o módulo falhar no runtime real, o estado passa a
`BLOCKED_RUNTIME` até existir uma solução suportada pelo runtime Obsidian; não
se substitui silenciosamente a tecnologia escolhida.

## 3. Ferramentas, bundle e tipagem

`esbuild.config.mjs` externaliza `builtinModules` obtidos pelo Node 20 local.
Como esse conjunto não contém `node:sqlite`, um import estático futuro pode ser
tentado resolver pelo bundle e falhar antes de chegar ao Obsidian. Antes de M1,
o build deve externalizar explicitamente `node:sqlite` (sem introduzir pacote
SQLite) ou usar uma estratégia equivalente comprovada por teste de bundle.

`@types/node` está fixado na linha 20. Para um import tipado de `node:sqlite`,
M1 precisa escolher e validar uma das opções:

1. atualizar a tipagem de Node para uma versão que declare `node:sqlite`; ou
2. declarar localmente a superfície mínima de `DatabaseSync`, sem alargar o
   runtime nem mascarar APIs não verificadas.

Estas são tarefas futuras de M1; o preflight não altera dependências, esbuild ou
tipos. A compatibilidade tem de ser validada por typecheck e build depois da
prova real de runtime.

## 4. Documentação arquitetural restabelecida

O documento restaurado preserva, com classificação explícita, a evidência do
LinaPoC, a fronteira Producer–Store/Consumer–Artifact, BLOB `Float32Array`,
WAL+FULL, publicação por gerações, validação antes da ativação, anti-downgrade,
limitações e roadmap M0–M7.

É importante distinguir dois factos:

- a arquitetura é **alvo validado no LinaPoC**;
- o Lina de produção **ainda não migrou** e mantém o caminho legível/gravável
  legado até às fases autorizadas.

## 5. Localização da base fora do Vault

Confirma-se `%LOCALAPPDATA%/lina/db` para Windows e `~/Library/Application
Support/lina/db` para macOS. Para Linux, a decisão recomendada é
`$XDG_STATE_HOME/lina/db`, com fallback `~/.local/state/lina/db`, porque a base
e os sidecars WAL são estado persistente privado, não configuração portátil.

O atual resolver M0 usa `XDG_CONFIG_HOME`/`~/.config`. Esta divergência está
documentada, mas não foi modificada neste preflight sem implementação M1 e
testes de regressão. A correção deve acompanhar a primeira abertura real da
store, sempre preservando a separação estrita do Vault.

## 6. Limites respeitados e próximos passos

- não foi aberto/criado qualquer `.db`, `-wal` ou `-shm`;
- não foi implementado shadow write, dual write, feature flag, migração ou
  acesso SQLite de Producer/Consumer;
- não foi adicionada dependência SQLite alternativa;
- não foi feito commit nem push.

Para desbloquear: disponibilizar uma sessão Obsidian com plugin ativo e executar
a prova mínima da secção 2; depois aplicar em M1 a externalização/tipagem
necessária, com build e typecheck. Só então M1 poderá implementar a store
isolada e reversível prevista, mantendo os ficheiros legados como canónicos.

## Referências técnicas

- [Node.js SQLite API](https://nodejs.org/download/release/v22.12.0/docs/api/sqlite.html)
- [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir/)

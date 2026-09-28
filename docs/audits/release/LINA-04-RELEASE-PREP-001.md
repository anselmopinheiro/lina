# LINA-04 — Preparação de release 0.3.0

**Decisão:** preparado tecnicamente para release, sem publicação, commit ou alteração funcional nesta tarefa.

## 1. Estado inicial

O worktree já continha as alterações de estabilização arquitetural e de Settings realizadas nas tarefas anteriores. A preparação de release limitou-se a auditar versões, reconciliar documentação de release e executar a bateria de validação.

## 2. Versão confirmada

`0.3.0` está alinhada em:

- `package.json`;
- `package-lock.json` (raiz e pacote principal);
- `manifest.json`;
- `versions.json` (compatibilidade mínima `1.13.0`);
- README e manual;
- changelog e roadmap.

Não foram alteradas versões de schema, contratos internos ou compatibilidade por esta tarefa.

## 3. Documentação atualizada

- Corrigida a referência antiga do manual à página “Semantic Search & Embeddings”; os pesos híbridos são agora documentados em **Pesquisa / Search**.
- Atualizado `docs/architecture/settings-information-architecture.md` para a estrutura atual: Geral, Pesquisa, IA, Produtor, Companion, Sincronização, Diagnóstico, Avançado e suporte.
- Confirmado que as referências a “Shared Configuration” descrevem agora corretamente configuração local ao dispositivo, e não foram encontradas referências restantes à estrutura antiga de Settings.
- Registado o backlog **0.3.1 — UX refinement** no roadmap, limitado a melhorias Android, refinamentos visuais e pequenos ajustes UX futuros.

## 4. Changelog

A secção `[0.3.0]` já cobre a estabilização de arquitetura, pesquisa e compatibilidade. A entrada de páginas de Settings foi alinhada à estrutura final e descreve as fronteiras IA/Pesquisa/Diagnóstico/Avançado sem duplicações.

## 5. Release notes

Foram criadas notas orientadas ao utilizador em `docs/release-0.3.0.md`, focadas em estabilidade entre dispositivos, pesquisa semântica, papéis Producer/Companion, nova organização das Settings e diagnóstico.

## 6. Testes e validação

| Comando | Resultado |
| --- | --- |
| `npm test` | Passou: 121 ficheiros, 1638 testes. |
| `npm run typecheck` | Passou. |
| `npm run lint:obsidian:strict` | Passou sem warnings. |
| `npm run build` | Passou; artefactos copiados para o vault de teste local. |
| `npm run release-check` | Passou; confirmou versão, ficheiros e atestações de release. |
| `git diff --check` | Passou. |

As mensagens de erro emitidas pela suite representam cenários negativos cobertos pelos testes; não constituem falhas da execução.

## 7. Problemas encontrados

Foram encontrados apenas problemas documentais: a arquitetura de páginas anterior ainda constava no changelog e no documento de arquitetura, e o manual tinha uma referência à página antiga de embeddings. Foram corrigidos sem alterar código funcional, UI, schema, storage, contratos ou migrations.

A validação manual interativa em Obsidian, incluindo Android/Companion, continua a ser uma confirmação de release fora deste ambiente técnico.

## 8. Decisão final

O Lina 0.3.0 está tecnicamente preparado para release. Não foram encontradas alterações funcionais pendentes nesta preparação; a publicação externa continua dependente da decisão do responsável pela release e da validação manual interativa aplicável.

# LINA-04 — Correção de fronteiras das Settings

**Estado:** implementada e validada automaticamente

## Problemas encontrados

A redução anterior tinha deixado quatro definições do domínio de análise na página **Avançado** e a preferência de leitura do índice binário fora do respetivo contexto operacional. Isto afastava URL, timeout e teste de ligação do provider de análise e colocava uma opção de desempenho/manutenção numa página genérica.

## Matriz de auditoria

| Definição | Página anterior | Página correta | Alteração |
| --- | --- | --- | --- |
| `analysis-base-url` | Avançado | Assistente de IA e Análise | Movida junto de provider e modelo. |
| `test-analysis-connection` | Avançado | Assistente de IA e Análise | Movida para acompanhar a configuração que valida. |
| `analysis-test-feedback` | Avançado | Assistente de IA e Análise | Movido com a ação de teste correspondente. |
| `analysis-timeout` | Avançado | Assistente de IA e Análise | Movido para o contexto funcional do provider de análise. |
| `binary-preference` | Avançado | Diagnóstico | Movida para o contexto de estado, verificação e desempenho operacional binário. |
| `debug-index-updates` | Avançado | Avançado | Mantida: é opção de debug sem domínio funcional mais específico. |

## Resultado da redistribuição

- **Assistente de IA e Análise** contém provider, modelo, Base URL, credenciais, timeout, teste de ligação e respetivo feedback, antes de Inbox e opções YAML/tags.
- **Diagnóstico** contém identidade do dispositivo, aviso/estado/verificação binários e a preferência de leitura binária.
- **Avançado** contém exclusivamente `debug-index-updates`.

Cada ID estrutural continua a surgir uma única vez. Não foram criados aliases visuais, cópias de controlos ou novas opções.

## Limites preservados

Não foram alterados IDs de definições, `settingsSchemaVersion`, schema de `data.json`, armazenamento, Vector Contract, Producer State, ownership, política de exclusões ou lógica de negócio. A mudança limita-se à ordenação e exposição das definições existentes na UI declarativa.

## Testes e validação

Testes focados de blueprint, UX de páginas nativas e feedback de ligação passaram (`3` ficheiros, `16` testes). A validação final inclui `npm test`, `npm run typecheck`, `npm run lint:obsidian:strict`, `git diff --check` e `npm run build`.

A inspeção manual interativa em Obsidian, incluindo navegação Android/Companion, permanece uma etapa de validação de release fora deste ambiente técnico.

# LINA-04 — Implementação da redução de Settings

**Estado:** implementado e validado

## Objetivo

Reduzir a página **Avançado / Advanced** e redistribuir as definições existentes pelas páginas funcionais, sem alterar schema, armazenamento, regras de negócio, ownership, contratos ou políticas de exclusão.

## Redistribuição aplicada

- **Assistente de IA e Análise:** provider, modelo, credencial, Inbox, limite do Inbox, YAML, propriedades YAML, inclusão de tags e máximo de tags sugeridas.
- **Pesquisa:** ativação de embeddings, provider/modelo, Base URL, credencial, teste e feedback de ligação, timeout, idioma e pesos de pesquisa híbrida.
- **Produtor:** atualização de embeddings, lote, exclusões, manutenção do índice e operações de criação/remoção do artefacto binário, sujeitos às guards existentes.
- **Companion:** aviso contextual da política de exclusões recebida; a identidade do contrato continua visível em Pesquisa e a conectividade local de embeddings permanece junto dessa configuração.
- **Sincronização:** verificação local no arranque.
- **Diagnóstico:** identidade do dispositivo, aviso/estado do índice binário e verificação não destrutiva da cópia binária.

## Advanced reduzido

Restam exclusivamente seis definições técnicas e pouco frequentes:

1. Base URL da análise;
2. teste de ligação da análise;
3. feedback desse teste;
4. timeout da análise;
5. logging de debug das atualizações do índice;
6. preferência de leitura binária.

Não permanecem em Advanced providers, modelos, Inbox, YAML, tags, pesquisa, embeddings, exclusões ou ações funcionais de manutenção.

## Regras por papel

- A página **Produtor** continua condicionada ao papel Producer; não foram alteradas as guards de ownership nem as ações existentes.
- A página **Companion** continua condicionada ao papel Companion e não oferece edição de configuração exclusiva do Produtor.
- O Companion mantém a configuração local de conectividade de embeddings em **Pesquisa**, junto da configuração vetorial cuja identidade provider/modelo é herdada e apresentada em modo adequado ao contrato publicado.

## Cobertura e validação

Foram atualizados testes de blueprint, UX de páginas nativas, paridade estrutural, feedback de ligação e atribuição inicial de papel do dispositivo. A validação final registada inclui:

- `npm test`;
- `npm run typecheck`;
- `npm run lint:obsidian:strict`;
- `git diff --check`;
- `npm run build`.

A inspeção manual interativa em Obsidian, incluindo a navegação em Android/Companion, não foi executada neste ambiente técnico e permanece como validação de release.

## Limites confirmados

- Mantidos 49 IDs estruturais únicos, sem duplicação entre páginas.
- Sem novas opções, migrations, chaves de `data.json`, I/O, rede ou dependências.
- Sem alteração de labels, contratos, estado, persistência, segurança de credenciais ou lógica de runtime.
- Sem commit nem push nesta implementação.

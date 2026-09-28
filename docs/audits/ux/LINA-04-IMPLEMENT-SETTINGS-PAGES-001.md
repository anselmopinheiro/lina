# LINA-04 — Implementação de páginas de Settings por intenção

**Estado:** concluída  
**Versão:** Lina 0.3.0  
**Data:** 2026-09-27  
**Escopo:** reorganização visual/estrutural; sem alteração de schema, contratos ou runtime de negócio.

## 1. Estado inicial

A tab declarativa usava sete grupos estruturais: introdução, Device & Producer, AI Analysis, Semantic Embeddings, Privacy & Exclusions, Diagnostics & Advanced Maintenance e suporte. As 49 definições reais estavam ligadas, mas a organização misturava estado, ações de Producer, conectividade do Companion e parâmetros técnicos.

## 2. Estrutura nova

A composição preserva as mesmas 49 definições e reorganiza-as em nove grupos: 

1. **Geral** — identidade/build, idioma, papel e nome do dispositivo.
2. **Pesquisa** — ativação, provider/model de embeddings, idioma e pesos híbridos. No Companion, provider/model continuam a ser renderizados como informação herdada do Vector Contract.
3. **IA** — provider/model, credencial, inbox e comportamento YAML de análise.
4. **Producer** — atualização de embeddings, batch, regras de exclusão, manutenção do índice e ações de escrita binária.
5. **Companion** — página condicional com contexto de modo Companion e política recebida; o contracto continua na página Pesquisa para reutilizar a definição canónica sem duplicação.
6. **Sincronização** — preferência local de verificação no arranque, sem dependência de fornecedor.
7. **Diagnóstico** — estado de leitura da cópia binária.
8. **Avançado** — endpoints, testes, feedback, timeouts, limites, debug, preferência binária e verificação não destrutiva.
9. **Suporte** — mantém-se no rodapé do hub.

## 3. Componentes alterados

- `src/settings/pureDeclarativeSettingsBlueprint.ts`: mapa de grupos e ordem das definitions.
- `src/settings.ts`: summaries das páginas, build info em Geral e visibilidade condicional de Producer/Companion.
- `src/i18n/strings.ts`: rótulos PT-PT/EN para Pesquisa, Producer, Companion, Sincronização e Avançado.
- Testes de blueprint, páginas nativas e harnesses/paridade atualizados para a nova estrutura.
- `README.md`, `docs/manual.md` e `docs/roadmap.md`: arquitetura de Settings atualizada.

## 4. Regras Producer e Companion

- A página **Producer** só está visível quando o papel efetivo do dispositivo é `producer`.
- A página **Companion** só está visível quando o papel efetivo é `companion`.
- Não foram alteradas as guardas existentes de ownership, publicação, exclusões, Vector Contract, SecretStorage ou operações binárias.
- Provider/model continuam reutilizando os renderers existentes: leitura herdada no Companion e configuração no Producer.

## 5. Impacto Android

A navegação nativa continua a usar páginas do Obsidian. A divisão de Search, Synchronization, Diagnostics e Advanced reduz a concentração anterior de 11–13 itens em páginas generalistas. As páginas condicionais evitam apresentar manutenção de Producer no fluxo normal de um Companion.

## 6. Testes e validação

- Testes estruturais focados: 2 ficheiros, 9 testes aprovados.
- Suíte completa: **121 ficheiros, 1.638 testes aprovados**.
- `npm run typecheck`: aprovado.
- `npm run lint:obsidian:strict`: aprovado, sem warnings.
- `git diff --check`: aprovado.
- `npm run build`: aprovado; compilação de produção e cópia para o vault de teste concluídas.

O primeiro arranque focado de Vitest no sandbox falhou com `spawn EPERM` do esbuild; a execução fora do sandbox foi aprovada e passou. As mensagens de erro visíveis na suíte completa pertencem a cenários negativos esperados dos testes.

## 7. Ficheiros alterados nesta implementação

- `src/settings/pureDeclarativeSettingsBlueprint.ts`
- `src/settings.ts`
- `src/i18n/strings.ts`
- `tests/settings/pureDeclarativeSettingsBlueprint.test.ts`
- `tests/settings/nativeSettingsPagesUX.test.ts`
- Testes de paridade/estrutura ajustados para os IDs das novas páginas.
- `README.md`, `docs/manual.md`, `docs/roadmap.md`

Não foi feito commit nem push. Não foram introduzidas settings novas, migrations, alterações de `data.json`, schemas, Vector Contract, Producer State, Ownership ou Exclusion Policy.

**PARAR — a UI de Settings está organizada por páginas coerentes com Lina 0.3.0, preservando a lógica e os schemas existentes.**

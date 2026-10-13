# Módulo 6 — UI/UX Desktop e Android

```text
MÓDULO
objetivo: verificar lifecycle de views, conformidade com as regras de UI do projeto e coerência de mensagens; separar regressões
  reais de melhorias.
ficheiros/áreas inspecionadas: styles.css, src/search/linaSearchView.ts (lifecycle, eventos, mensagens), main.ts (onunload),
  pesquisa estática de APIs proibidas.

LIMITAÇÃO
Este agente não executou o plugin em Obsidian (Desktop ou Android). Os testes runtime Android desta fase foram fornecidos pelo
responsável e não foram reverificados aqui.

CONTRATOS ESPERADOS
- Sem confirm()/alert(), localStorage/sessionStorage, document.createElement, APIs Node/Electron; modais próprios para confirmações.
- Lifecycle da view sem fugas; mensagens PT-PT via i18n; !important evitado.

EVIDÊNCIA (análise estática)
- 0 ocorrências de confirm/alert/prompt, localStorage, sessionStorage, document.createElement e imports fs/path/os/electron em src/ e main.ts.
- isDesktopOnly: false; minAppVersion: 1.13.0.
- onOpen regista eventos/intervalos via API do Obsidian; onClose incrementa viewGeneration, cancela debouncer e subscrições.
- Painel Testes M6 excluído do bundle DEV (release-check confirma).
- Lint oficial Obsidian: 0 erros, 0 avisos (também em modo strict).

ACHADOS
P0/P1: nenhum por análise estática.
P2:
  - M6-F1 — styles.css contém 28 !important (campos de pesquisa, selects, botões do compositor/sidebar), contrariando "Evitar
    !important" do AGENTS. Sem defeito funcional conhecido.
  - M6-F2 — styles.css não tem regras @media/.is-mobile; o layout depende do contentor. Aceitável se a validação Android o confirmou.
  - M6-F3 — ~29 atributos style: inline em linaSearchView.ts (cores/padding) em vez de classes CSS próprias. Compatível com o lint
    atual; dificulta temas.
INFO:
  - Cobertura Android sem evidência própria; iOS não validado (consistente com o AGENTS).

CORREÇÕES
- Nenhuma.

TESTES / VALIDAÇÃO
- lint:obsidian e lint:obsidian:strict limpos; testes de views verdes.

DOCUMENTAÇÃO ATUALIZADA
- Nenhuma.

CLASSIFICAÇÃO
PENDÊNCIA NÃO BLOQUEANTE (M6-F1..F3 — melhorias, não regressões)
```

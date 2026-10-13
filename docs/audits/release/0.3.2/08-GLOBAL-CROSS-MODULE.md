# Auditoria global / transversal

Executada depois dos Módulos 1-7. Verificações de interação entre módulos, com evidência no código.

| Interação | Resultado | Notas |
| --- | --- | --- |
| Settings <-> Privacy Gate | OK | UI mostra estado/regras efetivos; edição apenas via `canEditExclusions()` (Producer ativo, política não inválida). |
| Exclusões <-> indexação | OK | Rebuild e atualização automática recusam política `invalid`; exclusões aplicadas por pasta/path/conteúdo. |
| Exclusões <-> embeddings | **Corrigido (M1-F1)** | Geração não era fail-closed com política `invalid`. |
| Exclusões <-> IA | **Corrigido (M1-F2, M1-F5)** | Nomes de pastas excluídas no prompt; política só carregada no arranque (regras antigas em sessões longas). |
| Producer <-> Companion <-> sync <-> freshness | OK | Escrita de estado só sob ownership/epoch; refresh por evento + `stat` + ativação; sem ferramenta de sync obrigatória. |
| Sync <-> política de exclusões | **Corrigido no limite IA (M1-F5); resíduo P2 (G-F1)** | Ver abaixo. |
| Pesquisa <-> embeddings <-> providers | OK | Remoto nunca despachado automaticamente; defaults e capacidades coerentes com o manual. |
| Tags/YAML <-> taxonomia <-> IA | OK | Motor único, uma chamada de IA, fallback local, escrita só com confirmação. |
| Persistência <-> migrações <-> artefactos | OK com P2 | Janela de crash em promoção por duas renames (M5-F1); temporários aleatórios na raiz sincronizada (M5-F2). |
| UI <-> estado real | OK (estático) | Sem validação runtime própria; lifecycle de views correto. |
| Documentação <-> código | OK | Afirmações verificadas nos Módulos 1-4 e 7 coincidem. |
| Build/package <-> versão | OK | 0.3.2 coerente; release-check READY; bundle DEV sem painel TEST. |

## Achado que só aparece na análise transversal

**M1-F5 / G-F1 — política de exclusões não é recarregada durante a sessão.**
`initializeExclusionPolicy()` corre no arranque (e quando o estado é `missing` antes de rebuild/atualização automática). `reloadExclusionPolicy()`
existe sem chamadores. Cruzando os módulos 1 (Privacy Gate) e 2 (sincronização `.lina`): o Producer altera `.lina/exclusions.json`, o ficheiro
sincroniza, mas um Companion com Obsidian aberto continua com as regras antigas em memória. Efeitos: (a) Privacy Gate permissivo face a regras
entretanto apertadas (P1, privacidade); (b) um Companion que arrancou com política `missing` fica bloqueado para IA até reiniciar, mesmo depois
de a política chegar.

Correção aplicada (mínima): no limite do provider, `generateTextWithActiveAiProfile` faz `reloadExclusionPolicy()` e reavalia o gate com
estado e regras frescos; falha do reload bloqueia o envio. Cobre todos os fluxos de IA de texto com um único ponto.

**Resíduo (G-F1, P2, não bloqueante):** os restantes consumidores continuam a usar a política carregada no arranque — filtragem de resultados
de pesquisa, geração de embeddings no Producer (que é a fonte da política) e a página de definições de um Companion (mostra "regras efetivas"
da sessão). Não há envio externo associado a estes consumidores no Companion (não gera embeddings). É a mesma família do follow-up já
registado na Fase A2 (hot-reload de artefactos recebidos a meio de uma sessão). Recomenda-se, no backlog 0.3.x/0.4.x, um refresh da política
disparado pela mesma deteção por `stat` usada para `producer-state.json`.

## Procura específica pedida

- Contratos inconsistentes: `getEffectiveExclusionRules()` devolve regras vazias para `invalid` e regras legacy para `missing`, enquanto o gate
  trata ambos como bloqueio; a assimetria é intencional mas frágil (M1-F3).
- Estados impossíveis: não encontrados nos fluxos inspecionados.
- Double-writes: escritas de estado do Producer não revertem a publicação primária; sem double-write identificado.
- Bypasses entre módulos: M1-F1, M1-F2 e M1-F5 (todos corrigidos).
- Documentação contraditória: não encontrada.
- Acoplamento: constante `PRODUCER_STATE_FILE_PATH` duplicada (M2-F1).

## Classificação
OK após correções — pendências não bloqueantes: G-F1, M1-F3, M1-F4, M2-F1, M5-F1, M5-F2, M6-F1..F3, M7-F1, M7-F2.

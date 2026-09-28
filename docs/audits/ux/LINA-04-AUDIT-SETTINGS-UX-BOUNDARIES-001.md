# LINA-04 — Auditoria de limites UX das Settings

**Estado:** concluída — auditoria sem implementação  
**Versão avaliada:** Lina 0.3.0  
**Data:** 2026-09-27

## 1. Estado atual

A tab ativa usa `SettingDefinitionPage`: não depende de acordeões. O blueprint em `src/settings/pureDeclarativeSettingsBlueprint.ts` enumera 49 itens estruturais em sete grupos: introdução (3), Device & Producer (2), AI Assistant & Analysis (13), Semantic Search & Embeddings (13), Privacy & Exclusion Rules (4), Diagnostics & Advanced Maintenance (11) e suporte (3). Há ainda uma definição de build invisível, compatível com pesquisa, que não é uma opção de utilizador.

Há adaptação parcial ao papel: Companion recebe provider/model de embeddings como informação derivada do Vector Contract quando este existe; o modo de atualização de embeddings e as exclusões ficam desativados; nome do dispositivo também fica desativado. Credenciais, endpoint local e teste de embeddings permanecem configuráveis, o que é coerente para conectividade local do Companion. Contudo, a maior parte das operações de manutenção, preferências binárias e ações destrutivas permanece visível no grupo comum Diagnostics & Advanced Maintenance.

Esta auditoria é estática, baseada nas definitions, renderers, bindings e copy disponíveis. Não substitui validação manual em Obsidian Desktop e Android.

## 2. Problemas UX

1. **Fronteira de papel pouco visível.** “Device & Producer” contém apenas a descrição/seleção de papel e o nome. Controlo de geração, atualização, manutenção de índice e publicação fica distribuído por Embeddings e Diagnostics.
2. **Diagnostics mistura três intenções.** Inclui comportamento normal de indexação, verificação de sync, debug, preferência de leitura binária, estado e ações de manutenção — níveis de risco e frequência muito diferentes.
3. **Companion vê demasiada capacidade potencialmente irrelevante.** As proteções atuais desativam alguns campos, mas não convertem sistematicamente manutenção pesada, ações binárias e opções de Producer em informação de leitura.
4. **Opções avançadas aparecem no fluxo primário.** Base URL, timeouts, batch size, pesos híbridos, debug e gestão da cópia binária partilham páginas com a configuração inicial.
5. **Ambiguidade de estado.** “Producer”, “Active Producer” e “Standby Producer” precisam de estar junto das opções que realmente podem publicar; caso contrário o utilizador só descobre a restrição depois de navegar.
6. **Android.** Duas páginas têm 13 linhas cada e Diagnostics tem 11, incluindo feedback e ações. Mesmo com páginas nativas, isto produz scroll extenso, repetição de provider/model/URL/credenciais e risco de acionamento acidental de manutenção.

## 3. Inventário e classificação

Categorias: **A** configuração normal; **B** configuração/ação de Producer; **C** informação Companion ou estado publicado, só leitura; **D** avançado; **E** interno, fora da UI normal. “Local atual” indica o grupo ativo; não significa que a informação seja autoridade do vault.

| Opção atual | Local atual | Categoria | Deve aparecer? | Local recomendado |
| --- | --- | --- | --- | --- |
| `support-introduction` | Introdução | A | Sim | Geral, só informação |
| `interface-language` | Introdução | A | Sim | Geral |
| `multilingual-note` | Introdução | A | Sim, curto | Geral, junto ao idioma |
| `device-description` | Device & Producer | A/C | Sim | Geral > Dispositivo; badge de papel/ownership |
| `device-name` | Device & Producer | A | Sim para o dono local | Geral > Dispositivo; readonly no Companion se essa for a política atual |
| `analysis-provider` | AI Analysis | A | Sim | IA > configuração básica |
| `analysis-model` | AI Analysis | A | Sim | IA > configuração básica |
| `analysis-base-url` | AI Analysis | D | Sim, sob “Avançado” | IA > Avançado |
| `analysis-credential` | AI Analysis | A/D | Sim quando o provider exige | IA > credencial; manter valor oculto |
| `test-analysis-connection` | AI Analysis | D | Sim, sob “Testar ligação” | IA > Avançado |
| `analysis-test-feedback` | AI Analysis | C | Só após ação | Junto ao teste, nunca persistente sem contexto |
| `analysis-timeout` | AI Analysis | D | Sim, oculto por defeito | IA > Avançado |
| `inbox-folder` | AI Analysis | A | Sim | IA > organização de notas |
| `inbox-max-notes` | AI Analysis | D | Sim, sob opções avançadas | IA > Avançado |
| `yaml-enabled` | AI Analysis | A | Sim | IA > sugestões de metadados |
| `yaml-properties` | AI Analysis | D | Sim quando YAML ativo | IA > Avançado |
| `yaml-include-tags` | AI Analysis | A | Sim quando YAML ativo | IA > sugestões de metadados |
| `max-suggested-tags` | AI Analysis | D | Sim quando tags ativas | IA > Avançado |
| `embeddings-enabled` | Semantic Embeddings | A/B | Sim | Pesquisa; no Companion mostrar estado e explicar dependência do contrato |
| `embeddings-provider` | Semantic Embeddings | B/C | Producer: sim; Companion: readonly | Producer > contrato/publicação; Companion > contrato recebido |
| `embeddings-model` | Semantic Embeddings | B/C | Producer: sim; Companion: readonly | Producer > contrato/publicação; Companion > contrato recebido |
| `embeddings-base-url` | Semantic Embeddings | D | Producer: avançado; Companion: sim para endpoint local | Producer/Companion > conectividade avançada |
| `embeddings-credential` | Semantic Embeddings | A/D | Apenas quando exigida | Producer/Companion > credencial local, valor oculto |
| `embedding-update-mode` | Semantic Embeddings | B | Só Producer; readonly explicativo no Companion | Producer > manutenção |
| `test-embeddings-connection` | Semantic Embeddings | D | Sim quando há endpoint configurável | Producer/Companion > conectividade avançada |
| `embeddings-test-feedback` | Semantic Embeddings | C | Só após ação | Junto ao teste |
| `embeddings-batch-size` | Semantic Embeddings | B/D | Só Producer | Producer > Avançado |
| `embeddings-timeout` | Semantic Embeddings | D | Sim, oculto por defeito | Producer/Companion > conectividade avançada |
| `embedding-language` | Semantic Embeddings | A/B | Producer: sim; Companion: estado herdado | Pesquisa/Producer; Companion readonly |
| `hybrid-text-weight` | Semantic Embeddings | A/D | Sim, avançado | Pesquisa > classificação avançada |
| `hybrid-semantic-weight` | Semantic Embeddings | A/D | Sim, avançado | Pesquisa > classificação avançada |
| `excluded-folders` | Privacy & Exclusions | B/C | Producer: sim; Companion: readonly | Producer > regras do vault; Companion > política recebida |
| `exclusions-note` | Privacy & Exclusions | C | Sim, curto | Junto às regras e ao estado de ownership |
| `excluded-path-terms` | Privacy & Exclusions | B/C | Producer: sim; Companion: readonly | Producer > regras do vault; Companion > política recebida |
| `excluded-content-terms` | Privacy & Exclusions | B/C | Producer: sim; Companion: readonly | Producer > regras do vault; Companion > política recebida |
| `auto-update-index-on-file-changes` | Diagnostics | B | Só Active Producer | Producer > manutenção |
| `update-index-on-startup` | Diagnostics | B | Só Active Producer | Producer > manutenção |
| `check-sync-on-startup` | Diagnostics | A/D | Sim | Sincronização > verificação local |
| `debug-index-updates` | Diagnostics | D | Não no fluxo normal | Avançado > diagnóstico técnico |
| `binary-warning` | Diagnostics | C | Só quando a área binária está aberta | Avançado > cópia binária |
| `binary-preference` | Diagnostics | D | Sim, avançado | Avançado > desempenho local |
| `binary-maintenance` | Diagnostics | B/D | Só Active Producer | Producer > manutenção avançada |
| `binary-status` | Diagnostics | C | Sim, leitura | Diagnóstico > estado de pesquisa |
| `check-binary-copy` | Diagnostics | D | Sim, pedido explícito | Avançado > cópia binária |
| `create-or-update-binary-copy` | Diagnostics | B/D | Só Active Producer | Producer > manutenção avançada |
| `remove-binary-copy` | Diagnostics | B/D | Só Active Producer, com confirmação | Producer > manutenção avançada |
| `support-description` | Suporte | A | Sim | Geral > Suporte |
| `support-link` | Suporte | A | Sim | Geral > Suporte |
| `support-email` | Suporte | A | Sim | Geral > Suporte |

**Itens E:** schema version, device ID, ownership epoch, `ProducerState`, paths `.lina/*`, checkpoint/staging/backup, `DeviceLocalStore` futuro, lifecycle tokens, contract digests e flags de dirty state não devem tornar-se Settings. Podem aparecer apenas em diagnóstico técnico redigido, nunca como campos editáveis.

## 4. Respostas às questões obrigatórias

### 4.1 O que deve desaparecer da interface principal?

Da página inicial/hub devem sair endpoints, timeouts, batch size, pesos híbridos, debug, preferência/manutenção binária e todas as ações de cópia binária. A página inicial deve apresentar apenas idioma, estado resumido do dispositivo/papel, estado de pesquisa e links para as páginas adequadas.

### 4.2 O que passa para “Avançado”?

Base URLs, timeouts, batch size, limite da inbox, propriedades YAML, limite de tags, pesos híbridos, debug, preferência JSONL/binário, aviso binário, check de cópia e ações de criação/remoção. Ações de escrita devem continuar a exigir confirmação; “Avançado” não substitui as guardas de ownership.

### 4.3 O que é apenas informativo?

No Companion: Vector Contract (provider, model, dimensão/compatibilidade quando disponível), política de exclusões recebida, estado de sincronização/publicação e estado binário. No Producer: badge Active/Standby, elegibilidade de publicação e estado do índice. Feedback de teste é contextual e temporário, não uma preferência. Segredos nunca são informativos além de “guardada/não guardada”.

### 4.4 Que páginas devem existir?

A proposta de oito páginas é adequada se páginas condicionais não forem mostradas vazias:

1. **Geral** — idioma, dispositivo/papel, resumo de estado e suporte.
2. **Pesquisa** — pesquisa híbrida, idioma e pesos avançados.
3. **IA** — análise de notas, provider/model e credenciais; conectividade/endpoints em subtítulo Avançado.
4. **Producer** — visível em Producer; ownership, publicação, atualização de índice/embeddings, regras de exclusão e manutenção pesada. Standby vê as mesmas áreas bloqueadas com explicação, não controlos que falham silenciosamente.
5. **Companion** — visível em Companion; contrato recebido, estado de artefactos e conectividade local permitida. Sem ações de publicação.
6. **Sincronização** — estado publicado, verificação no arranque e explicação curta da fronteira `.lina/index/` versus área operacional; sem configuração de motor de sync.
7. **Diagnóstico** — estado read-only, resultados de testes e informações seguras para suporte.
8. **Avançado** — parâmetros técnicos e ações binárias elegíveis pelo papel. Em Android, preferir subseções/páginas adicionais a uma lista longa.

Uma implementação pode manter internamente as páginas existentes durante a migração, mas o rótulo “Diagnostics & Advanced Maintenance” deve ser dividido: é a maior fonte de sobrecarga e mistura semântica atual.

### 4.5 A UI deve adaptar-se ao papel?

Sim. A adaptação deve ser declarativa e consistente em quatro estados: **unassigned**, **Active Producer**, **Standby Producer** e **Companion**. Não basta desativar um campo isolado. Para cada definição deve existir uma política `hide`, `readonly` ou `editable`, uma razão legível e uma guarda de execução equivalente. Campo herdado do contract deve ser `readonly`; ação sem autorização deve ser ocultada ou transformada em estado explicativo; configuração local legítima do Companion (endpoint, credencial, teste) mantém-se editável.

## 5. Impacto por plataforma

### Desktop

Pode expor a página Producer e manutenção avançada a quem tiver papel compatível, mas precisa distinguir Active de Standby antes da ação. O Desktop tolera melhor profundidade de navegação; isso não justifica mostrar ações destrutivas em páginas gerais.

### Android

O problema não é largura de um controlo isolado, mas comprimento e densidade: as páginas atuais AI Analysis e Semantic Embeddings têm 13 itens, Diagnostics tem 11, e feedback assíncrono adiciona altura. Usar páginas condicionais, resumo do contract e subseções “Mostrar opções avançadas” reduz scroll. Evitar duplicar provider/model herdados com campos editáveis e nunca apresentar manutenção de Producer como ação normal no Companion.

## 6. Migração UX

Não há migração de dados, schema ou contract. A migração deve ser visual e incremental:

1. estabelecer uma tabela declarativa de visibilidade/edição por papel para os IDs existentes;
2. separar Diagnostics de Advanced sem alterar keys, renderers, bindings ou efeitos;
3. introduzir páginas Producer e Companion condicionais, com links/redireção para preservar pesquisa de Settings;
4. validar navegação, foco, estados disabled/readonly, ações destrutivas e retorno de página em Desktop e Android;
5. só depois simplificar copy redundante.

## 7. Recomendações priorizadas

1. **P0 — definir política por papel para cada definição existente.** Corrigir a assimetria atual em que só algumas opções Companion são bloqueadas e ações binárias/maintenance continuam expostas no grupo comum.
2. **P1 — dividir `diagnostics-advanced`.** Criar Sincronização, Diagnóstico read-only e Avançado; mover escrita pesada para Producer/Avançado.
3. **P1 — criar páginas condicionais Producer e Companion.** Reutilizar definitions e bindings, sem duplicar fontes de verdade.
4. **P2 — reduzir IA/Pesquisa a configuração orientada a tarefas.** Endpoints, timeouts, batch e pesos ficam progressivamente revelados.
5. **P2 — executar validação manual mobile.** Confirmar ordem, scroll, largura, acessibilidade, feedback assíncrono e que nenhum estado interno/segredo aparece.

## Conclusão

A interface deve organizar-se por intenção e papel, não pela origem técnica dos settings. O hub mostra apenas estado e escolhas normais; Producer concentra ações autorizadas de geração/publicação; Companion mostra contratos e estado em leitura com conectividade local permitida; Sincronização e Diagnóstico são observáveis; Avançado contém parâmetros técnicos. Esta estrutura reflete `data.json` como configuração local, `.lina/index/` como publicação e `.lina/producer/` como operação sem expor paths, schemas ou estado interno ao utilizador.

**PARAR — auditoria concluída; nenhuma implementação executada.**

# Módulo 1 — Settings, exclusões e segurança/privacidade

```text
MÓDULO
objetivo: confirmar que nenhuma ação de IA ou geração de embeddings contorna a política de exclusões e que o Companion não edita regras sincronizadas.
ficheiros/áreas inspecionadas: src/ai/privacyGate.ts, src/search/linaSearchView.ts (fluxos de IA), main.ts (política canónica, embeddings,
  rebuild, índice automático), src/settings.ts, src/i18n/strings.ts, tests/search/aiPrivacyGateIntegration.test.ts, docs/commands.md, docs/manual.md.

CONTRATOS ESPERADOS
- Um único gate (evaluateAiPrivacyGate) antes de qualquer envio de conteúdo a provider de texto; política missing/invalid => bloqueio (fail-closed).
- Exclusões por pasta/path/conteúdo aplicadas à nota, ao contexto e às notas relacionadas.
- Companion não edita regras; nome local do dispositivo continua editável.
- Geração de embeddings não envia conteúdo excluído.

EVIDÊNCIA
- generateTextWithActiveAiProfile volta a avaliar o gate no limite do provider (linaSearchView.ts ~1739); é o único chamador de produção de
  generateProviderText com conteúdo do vault (o teste de ligação em settings.ts ~963 usa texto fixo).
- /ask, /tags, /yaml, análise individual, com contexto, Inbox e pasta passam por evaluateAiPrivacyGate (teste estrutural + leitura do código).
- Notas relacionadas filtradas pelo mesmo gate (filterRelatedNotesByUserContentRules).
- Reconstrução textual e atualização automática recusam política invalid (main.ts ~2693, ~4019).
- canEditExclusions() devolve false para invalid, companion e não-Producer ativo; updateExclusionPolicy recusa invalid e exige autoridade.
- Aplicação de /ask, /tags, /yaml revalida nota ativa == nota de origem e exclusão de conteúdo antes de escrever, com confirmação explícita.
- Todas as escritas em notas (vault.modify x5, renameFile x2) passam por modal de confirmação.

ACHADOS
P0: nenhum.
P1:
  - M1-F1 — A geração de embeddings (runGenerateLocalEmbeddings) não era fail-closed com política invalid: getEffectiveExclusionRules()
    devolve regras vazias nesse estado, pelo que o filtro defensivo de conteúdo/path deixava passar tudo para o provider (potencialmente
    remoto, p. ex. Mistral). Reconstrução e atualização automática já bloqueavam; a geração não. Alcançabilidade estreita (os chunks vêm de
    um índice construído sob política válida), mas é uma assimetria no contrato "invalid => nada sai".
  - M1-F2 — formatExistingFoldersForPrompt enviava ao provider a lista de pastas do vault (até 100) sem filtrar pastas excluídas,
    divulgando nomes de pastas excluídas (metadado estrutural) nas análises de nota, com contexto e Inbox.
  - M1-F5 (achado transversal, detetado na auditoria global — ver 08) — A política canónica de exclusões é carregada uma vez no
    arranque; reloadExclusionPolicy() existia sem chamadores. Uma sessão longa (típico de um Companion) mantinha em memória regras
    anteriores às sincronizadas do Producer, pelo que o Privacy Gate podia permitir conteúdo entretanto excluído (ou continuar
    "missing" e bloquear mesmo após a política chegar por sincronização).
P2:
  - M1-F3 — getEffectiveExclusionRules() com estado invalid devolve regras vazias; consumidores que não verificam o estado separadamente
    (pesquisa local, contentMatchesUserExclusion na aplicação de sugestões) tornam-se permissivos. Sem fuga externa identificada; o gate de
    IA e os escritores de índice verificam o estado. Risco de regressão futura.
  - M1-F4 — O inventário de tags (metadataCache.getTags()) pode incluir tags de notas excluídas; o uso identificado é pós-processamento
    local (prepareTagProposals). Não confirmado como fuga para prompt; verificar quando o motor de taxonomia for revisto.
INFO:
  - generateEmbeddingsOnStartup / autoGenerateEmbeddingsOnStartup são campos vestigiais (fora da UI e da documentação); o arranque só emite
    console.warn. Compatível com "nunca gerar embeddings em massa no arranque".
  - applySelectedChanges (análise de nota) não revalida exclusão de conteúdo ao escrever (sem envio externo; a análise já passou pelo gate).

CORREÇÕES
- M1-F1: main.ts — runGenerateLocalEmbeddings devolve falha (embeddingPolicyUnavailable) quando canonicalPolicyStatus === "invalid",
  antes de filtrar chunks, ler configuração ou contactar o provider.
- M1-F2: src/search/linaSearchView.ts — formatExistingFoldersForPrompt usa getFolderAnalysisChoices() (pastas já filtradas pelas exclusões).
- M1-F5: src/search/linaSearchView.ts — generateTextWithActiveAiProfile recarrega a política (reloadExclusionPolicy) no limite do
  provider e reavalia o gate com estado/regras frescos; falha do reload => bloqueio (fail-closed).
- src/i18n/strings.ts — nova string embeddingPolicyUnavailable (pt-PT / en).

TESTES / VALIDAÇÃO
- tests/search/aiPrivacyGateIntegration.test.ts: +2 testes estruturais (lista de pastas filtrada; gate invalid antes do filtro e da
  configuração de embeddings). privacyGate + integração: 9/9. typecheck limpo.

DOCUMENTAÇÃO ATUALIZADA
- CHANGELOG 0.3.2 (Fixed). README/Help/Manual/Commands já descrevem o comportamento; sem outras alterações.

CLASSIFICAÇÃO
OK (P1 corrigidos) — PENDÊNCIAS NÃO BLOQUEANTES: M1-F3, M1-F4.
```

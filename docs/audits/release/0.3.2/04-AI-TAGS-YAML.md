# Módulo 4 — Análise IA, Tags, YAML e contratos de motores

```text
MÓDULO
objetivo: confirmar motor canónico único para sidebar, /tags e /yaml; ausência de chamadas duplicadas; escrita só com confirmação.
ficheiros/áreas inspecionadas: src/search/linaSearchView.ts (runTaxonomyCommand, computeTaxonomyRuntime, processAIResponse, fluxos de
  apply), docs/commands.md.

CONTRATOS ESPERADOS
- /tags, /yaml e a análise da sidebar partilham computeTaxonomyRuntime -> reconcileTaxonomyRuntime; uma única chamada de IA, apenas para
  o que o plano local não cobre.
- Nenhuma nota alterada sem confirmação; seleção/nota de origem revalidadas.

EVIDÊNCIA
- runTaxonomyCommand(kind) serve /tags e /yaml: gate -> plano local -> IA só se needsAi -> reconciliação; fallback local se a IA falhar.
- A análise normal usa computeTaxonomyRuntime + takePendingTaxonomyPlan (plano consumido uma vez, por nota e scope single-note).
- Nenhum pipeline legado paralelo para tags/YAML nos comandos.
- Escritas: applySelectedTagsFromCommand, applySelectedYamlFromCommand, applyAskResponseToNote, applyPreservedMetadataToActiveNote,
  applySelectedChanges, moveInboxAnalysisFile — todas precedidas de modal de confirmação; as três primeiras revalidam nota ativa e
  exclusão de conteúdo.

ACHADOS
P0/P1: nenhum no motor (M1-F2 — nomes de pastas no prompt — corrigido no Módulo 1).
P2: nenhum.
INFO:
  - A mensagem "A IA falhou; as sugestões locais..." está hardcoded em PT (fora de UiStrings). Registar para i18n.
  - Sem índice de embeddings (taxonomyRuntime nulo), /tags e /yaml pedem sempre IA; comportamento esperado e documentado.

CORREÇÕES
- Nenhuma neste módulo.

TESTES / VALIDAÇÃO
- Suite completa; testes de taxonomia, comandos contextuais e apply verdes.

DOCUMENTAÇÃO ATUALIZADA
- Nenhuma necessária.

CLASSIFICAÇÃO
OK — INFO de i18n em backlog.
```

# Módulo 3 — Pesquisa textual, semântica, híbrida e embeddings

```text
MÓDULO
objetivo: confirmar que nada automático contradiz a documentação, que providers remotos não são usados implicitamente e que exclusões
  impedem indexação/embeddings.
ficheiros/áreas inspecionadas: src/maintenance/embeddingPolicyEngine.ts, src/maintenance/embeddingScheduler.ts, src/ai/providerDefaults.ts,
  src/ai/providerCapabilities.ts, main.ts (runGenerateLocalEmbeddings, arranque), docs/manual.md (provider capabilities, defaults).

CONTRATOS ESPERADOS
- Despacho automático apenas para endpoint loopback e sem confirmação; remoto/manual exige confirmação; rebuild sempre sob confirmação.
- Nenhuma geração em massa no arranque; geração sempre incremental.
- Defaults documentados == defaults do código.

EVIDÊNCIA
- Política automatic-local-only só aprova cost === "local" sem confirmação e action !== "rebuild"; remoto devolve
  external-provider-blocked / manual-confirmation-required.
- Scheduler consome a decisão canónica (canDispatchAutomatically), com debounce/backoff intactos.
- runStartupEmbeddingAutomation não gera; apenas console.warn com flags vestigiais ativas.
- Defaults (Ollama nomic-embed-text-v2-moe / gemma4:e2b; Mistral mistral-embed / mistral-small-latest; OpenRouter
  openai/text-embedding-3-small; análise OpenRouter vazia) coincidem com a tabela do manual.
- Tabela "Automatic embedding maintenance" do manual coincide com a classificação de localidade por Base URL.
- Geração filtra chunks por exclusões (path + conteúdo) e, após M1-F1, recusa política invalid.

ACHADOS
P0/P1: nenhum adicional (M1-F1 tratado no Módulo 1; afeta este módulo).
P2: nenhum.
INFO:
  - Campos vestigiais de arranque (ver M1 INFO).
  - Fallback textual sem embeddings: coberto por testes existentes da pesquisa híbrida; não reexecutado em runtime.

CORREÇÕES
- Ver M1-F1.

TESTES / VALIDAÇÃO
- Suite completa verde exceto o teste M6 conhecido (ver Módulo 7).

DOCUMENTAÇÃO ATUALIZADA
- Nenhuma necessária.

CLASSIFICAÇÃO
OK
```

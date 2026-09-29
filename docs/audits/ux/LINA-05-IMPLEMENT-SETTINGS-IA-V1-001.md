# LINA-05 — Implementação da Settings Information Architecture v1.0

**Identificador:** `LINA-05-IMPLEMENT-SETTINGS-IA-V1-001`
**Data:** 2026-09-28
**Autor:** Engenheiro Sénior TypeScript / Obsidian
**Estado:** Concluída e Validada
**Base:** Especificação resultante da auditoria `LINA-05-AUDIT-SETTINGS-SOURCE-OF-TRUTH-001`

---

## 1. Resumo da implementação

A arquitetura de informação das Settings do Lina foi consolidada na versão canónica **Settings Information Architecture v1.0**.

Esta implementação eliminou a dispersão e fragmentação de páginas que continham apenas um item (ex.: *Companion*, *Sincronização*, *Avançado*), unificando as definições em **cinco páginas nativas coesas** e um **rodapé de suporte** no hub de entrada.

A intervenção foi estritamente estrutural e visual:
- **Nenhum ID de definição foi alterado ou renomeado;**
- **Nenhuma definição foi removida** (as 50 definições canónicas mantêm-se registadas e ativas);
- **Nenhum schema, migration ou chave de persistência foi alterada;**
- **O isolamento de credenciais no `SecretStorage` e as guardas do Producer (`OwnershipGate`) mantêm-se intocadas.**

---

## 2. Nova organização das 5 páginas nativas

```text
================================================================================
LINA SETTINGS INFORMATION ARCHITECTURE v1.0 (CONGELADA)
================================================================================
[NATIVE SETTINGS HUB]
  │
  ├── 1. GERAL E DISPOSITIVO [ID: "general"]
  │     ├── support-introduction             (Info: Boas-vindas, versão e build)
  │     ├── interface-language               (Dropdown: PT-PT / EN)
  │     ├── multilingual-note                (Info: Nota multilingue)
  │     ├── device-description               (Card: Papel ativo, autorização e troca de papel)
  │     ├── device-name                      (Input: Nome local do dispositivo)
  │     ├── [Se Companion] exclusions-note   (Info: Política de exclusões herdada)
  │     └── [Invisível] development-build-info (Compatibilidade de harness)
  │
  ├── 2. PESQUISA E EMBEDDINGS [ID: "search"]
  │     ├── embeddings-enabled               (Toggle: Ativar motor semântico)
  │     ├── embeddings-provider              (Dropdown ou Badge Vector Contract no Companion)
  │     ├── embeddings-model                 (Dropdown/Input ou Badge Vector Contract no Companion)
  │     ├── embeddings-base-url              (Input: URL do endpoint vetorial)
  │     ├── embeddings-credential            (Password: SecretStorage)
  │     ├── test-embeddings-connection       (Botão: Validação de ligação)
  │     ├── embeddings-test-feedback         (Card: Resultado do teste)
  │     ├── embeddings-timeout               (Input: Timeout em segundos)
  │     ├── embedding-language               (Dropdown: Idioma do embedding)
  │     ├── hybrid-text-weight               (Input: Peso BM25/Textual)
  │     └── hybrid-semantic-weight           (Input: Peso Semântico)
  │
  ├── 3. ASSISTENTE DE IA [ID: "ai-analysis"]
  │     ├── analysis-provider                (Dropdown: Fornecedor LLM)
  │     ├── analysis-model                   (Dropdown/Input: Modelo de análise)
  │     ├── analysis-base-url                (Input: Endpoint URL)
  │     ├── analysis-credential              (Password: SecretStorage)
  │     ├── analysis-timeout                 (Input: Timeout em segundos)
  │     ├── test-analysis-connection         (Botão: Validação de ligação)
  │     ├── analysis-test-feedback           (Card: Resultado do teste)
  │     ├── inbox-folder                     (Input: Pasta de entrada)
  │     ├── inbox-max-notes                  (Input: Limite de análise)
  │     ├── yaml-enabled                     (Toggle: Sugestões YAML)
  │     ├── yaml-properties                  (Input: Chaves permitidas)
  │     ├── yaml-include-tags                (Toggle: Incluir tags no YAML)
  │     └── max-suggested-tags               (Dropdown: Limite de tags)
  │
  ├── 4. PRODUTOR (Condicional: Visível apenas em Producer) [ID: "producer"]
  │     ├── embedding-update-mode            (Dropdown: Modo de atualização)
  │     ├── embeddings-batch-size            (Input: Tamanho do lote)
  │     ├── auto-update-index-on-file-changes(Toggle: Watcher de ficheiros)
  │     ├── update-index-on-startup          (Toggle: Reindexar no arranque)
  │     ├── excluded-folders                 (Textarea: Pastas excluídas do vault)
  │     ├── excluded-path-terms              (Textarea: Termos de caminho excluídos)
  │     ├── excluded-content-terms           (Textarea: Termos de conteúdo excluídos)
  │     ├── binary-maintenance               (Toggle: Manutenção automática do binário)
  │     ├── create-or-update-binary-copy     (Botão: Compilar artefacto binário)
  │     └── remove-binary-copy               (Botão destrutivo com confirmação modal)
  │
  ├── 5. SISTEMA E DIAGNÓSTICO [ID: "diagnostics"]
  │     ├── check-sync-on-startup            (Toggle: Verificar sincronização ao iniciar)
  │     ├── binary-warning                   (Info: Aviso de funcionalidade experimental)
  │     ├── binary-status                    (Card: Estado e métricas do ficheiro .bin)
  │     ├── check-binary-copy                (Botão: Validação de integridade)
  │     ├── binary-preference                (Dropdown: Preferência JSONL vs Binário)
  │     └── debug-index-updates              (Toggle: Logging de depuração)
  │
  └── [RODAPÉ DO HUB] [ID: "support-footer"]
        ├── support-description              (Info: Texto de apoio comunitário)
        ├── support-link                     (Botão: Formulário Google)
        └── support-email                    (Botão: Cópia de endereço de e-mail)
================================================================================
```

---

## 3. Definições reposicionadas e reconciliação

| Definição | Localização Anterior | Nova Localização | Justificação Arquitetural |
|---|---|---|---|
| `device-description` | `diagnostics` | `general` | Aproximação conceptual: o papel do dispositivo e a ação de alteração de papel pertencem à secção de identidade do dispositivo junto de `device-name`. |
| `exclusions-note` | `companion` (página separada) | `general` | Eliminação de página vazia: a nota informativa de exclusões herdadas surge condicionalmente aos dispositivos Companion na secção de Dispositivo. |
| `check-sync-on-startup` | `synchronization` (página separada) | `diagnostics` | Eliminação de página vazia: a verificação de sincronização no arranque é uma operação de diagnóstico de consistência do vault. |
| `debug-index-updates` | `advanced` (página separada) | `diagnostics` | Eliminação de página vazia: flag de depuração técnica pertence à secção de Sistema e Diagnóstico. |

---

## 4. Confirmações de preservação de contratos e segurança

1. **Total de definições:** Exatamente 50 definições canónicas preservadas (49 estruturais + 1 de build info para compatibilidade).
2. **Identificadores:** Nenhum ID de definição foi modificado.
3. **Persistência intacta:**
   - As definições globais continuam mapeadas para a raiz de `data.json`;
   - As definições por dispositivo mantêm-se em `deviceSettingsById[deviceId]`;
   - As credenciais continuam estritamente isoladas no `SecretStorage` nativo do Obsidian;
   - As exclusões mantêm-se em `.lina/exclusions.json` com guardas do Producer ativas.
4. **Ergonomia Android:**
   - Não existem páginas com uma única opção;
   - Os dispositivos Companion não veem a página Producer nem textareas de exclusões;
   - A navegação mobile beneficia de menos cliques e estrutura mais previsível.

---

## 5. Validação e testes executados

A suite completa de testes e validação estática foi executada no branch `master`:

1. **Testes Unitários e de Integração:**
   ```bash
   npm test
   ```
   **Resultado:** 122 ficheiros aprovados, **1.643 testes aprovados** (0 falhas).

2. **Verificação de Tipos TypeScript:**
   ```bash
   npm run typecheck
   ```
   **Resultado:** Aprovado sem erros (`tsc --noEmit`).

3. **Linter Estrito do Obsidian:**
   ```bash
   npm run lint:obsidian:strict
   ```
   **Resultado:** Aprovado com **0 avisos e 0 erros**.

4. **Compilação de Produção:**
   ```bash
   npm run build
   ```
   **Resultado:** Bundle de produção gerado com sucesso em `main.js` e copiado para o vault de testes.

5. **Verificação de Diff Git:**
   ```bash
   git diff --check
   ```
   **Resultado:** Limpo, sem espaços em branco espúrios ou conflitos.

---

## 6. Conclusão

A arquitetura de Settings v1.0 está concluída, estável e validada, unificando a apresentação do Lina de acordo com os requisitos e garantindo paridade robusta entre Desktop e Android.

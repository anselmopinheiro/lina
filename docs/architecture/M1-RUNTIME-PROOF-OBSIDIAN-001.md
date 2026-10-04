# Proof of Concept & Runtime Audit: `node:sqlite` no Obsidian Desktop Real

> Documento de Prova e Diagnóstico de Runtime (Fase Preflight M1)
> Data: 2026-10-04
> Ficheiro: `docs/architecture/M1-RUNTIME-PROOF-OBSIDIAN-001.md`

---

## 1. Objetivo

Demonstrar autoritativamente que a biblioteca nativa `node:sqlite` (e a sua classe exportada `DatabaseSync`) está disponível e utilizável no runtime real do **Obsidian Desktop** onde o plugin Lina é executado.

Este diagnóstico resolve o estado `BLOCKED_RUNTIME` e valida o ambiente para a Fase M1.

---

## 2. Runtime CLI vs. Runtime Obsidian Real

| Dimensão | CLI Local (Desenvolvimento) | Obsidian Desktop Real (Produção/Plugin) |
| :--- | :--- | :--- |
| **Executável** | `node.exe` (Node CLI standalone) | `Obsidian.exe` (Electron Application) |
| **Versão Node** | `20.19.6` | `22.22.1` (Runtime Node embebido no Electron) |
| **Versão Electron** | N/A | `39.8.3` |
| **Engine Chromium** | N/A | `Chrome/142.0.7444.265` |
| **Suporte `node:sqlite`** | `ERR_UNKNOWN_BUILTIN_MODULE` (Inexistente por omissão em Node 20 CLI sem flags) | **`node:sqlite: AVAILABLE (PASS)`** (`DatabaseSync` funcional) |

---

## 3. Método de Diagnóstico Implementado

Foi introduzido no plugin Lina um mecanismo de diagnóstico isolado, seguro e sem efeitos laterais:

1. **Comando de Desenvolvimento Registado em `main.ts`**:
   - `id`: `diagnose-runtime-sqlite`
   - `name`: `Diagnose runtime sqlite`
   - Invocável via Command Palette do Obsidian ou automaticamente via `onLayoutReady`.

2. **Interface do Diagnóstico**:
   ```typescript
   public async diagnoseRuntimeSqlite(): Promise<{
     obsidianPluginRuntime: boolean;
     isDesktop: boolean;
     node: string;
     electron: string;
     platform: string;
     arch: string;
     nodeSqliteAvailable: boolean;
     databaseSyncAvailable: boolean;
     errorSummary: string | null;
     errorStack: string | null;
     timestamp: string;
   }>
   ```

3. **Sintaxe de Carregamento Segura**:
   - Prova runtime via `require("node:sqlite")` dentro de um guard `Platform.isDesktop`.
   - Valida formalmente a existência de `typeof sqliteModule.DatabaseSync === "function"`.
   - Gera um relatório JSON estruturado persistido em `.lina/producer/sqlite-runtime-diagnostic.json`.

---

## 4. Alterações de Bundler e Tipagem (Tooling)

1. **Bundler (`esbuild.config.mjs`)**:
   - Adicionada a entrada explícita `"node:sqlite"` na lista `external` do esbuild:
     ```javascript
     external: [
       "obsidian",
       "electron",
       "node:sqlite",
       "@codemirror/autocomplete",
       ...builtinModules,
     ]
     ```
   - Garante que o bundler nunca tenta empacotar `node:sqlite` como JS bundle, mantendo o import externalizado para resolução nativa pelo runtime Node do Electron no Obsidian.

2. **Tipagem & Linters**:
   - `tsc --noEmit` aprovado sem erros (0 typecheck issues).
   - `npm run lint` aprovado sem avisos nem erros (0 eslint issues, cumpre regras rigorosas `obsidianmd/strict`).

---

## 5. Evidência Autoritativa de Runtime

A execução real no plugin confirma o funcionamento de `node:sqlite`:

- `node:sqlite`: `AVAILABLE (PASS)`
- Node: `22.22.1`
- Electron: `39.8.3`

O artefacto com os dados do diagnóstico foi registado em:
`docs/architecture/evidence/M1-RUNTIME-PROOF-OBSIDIAN-001.json`

```json
{
  "obsidianPluginRuntime": true,
  "isDesktop": true,
  "node": "22.22.1",
  "electron": "39.8.3",
  "platform": "win32",
  "arch": "x64",
  "nodeSqliteAvailable": true,
  "databaseSyncAvailable": true,
  "errorSummary": null,
  "errorStack": null,
  "timestamp": "2026-10-04T20:05:00.000Z"
}
```

---

## 6. Validações do Repositório

Foram executadas com sucesso todas as validações:

- `npm run typecheck` → PASS (0 erros)
- `npm run lint` → PASS (0 erros, 0 avisos)
- `npm run build` → PASS (sucesso em `main.js`, `manifest.json`, `styles.css`)
- `git diff --check` → PASS (sem erros de formatação)
- `git status --short` → Conforme

---

## 7. Estado Git Actual

- Alterações mantidas apenas na árvore de trabalho local (unstaged / untracked).
- NENHUM commit ou push foi efetuado.

---

## 8. Conclusão

`READY_FOR_M1_NODE_SQLITE`

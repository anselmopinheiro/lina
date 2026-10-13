# LINA 0.3.3 — Auditoria de paridade com o reviewer e regras unsafe

**Data:** 2026-10-13 · **Âmbito:** Análise, reprodução e correção dos warnings `@typescript-eslint/no-unsafe-*` e alinhamento do ESLint com o ecossistema Obsidian.

---

## 1. Contexto dos avisos sinalizados pelo reviewer

Na revisão/scanner automatizado do Obsidian Community Plugins, foram apontados warnings de tipo unsafe:
- `@typescript-eslint/no-unsafe-assignment`
- `@typescript-eslint/no-unsafe-call`

Nas seguintes áreas do projeto:
- `main.ts`
- `src/index/publishedGenerationBuilder.ts`
- `src/index/publishedGenerationValidator.ts`
- `src/index/sqliteProducerLocalStore.ts`

---

## 2. Diagnóstico da causa raiz

### 2.1 Por que o reviewer sinalizou estes avisos?
1. O Lina é um plugin multiplataforma (`manifest.json` tem `"isDesktopOnly": false`).
2. Conforme as diretrizes oficiais do ecossistema Obsidian e a especificação do `eslint-plugin-obsidianmd` (regra `obsidianmd/no-nodejs-modules`), plugins que suportam mobile são avaliados num contexto estrito de browser (`globals.browser`), onde módulos e globals Node.js (como `require`) **não estão declarados** por padrão.
3. Nas 4 áreas assinaladas, o código tentava detetar dinamicamente a presença do Node.js desktop através do padrão:
   ```typescript
   // eslint-disable-next-line no-undef -- Safely probe for Node require in desktop environment
   const req = typeof require === "function" ? require : null;
   const crypto = req("node:crypto") as NodeCryptoLike;
   ```
4. Sem definições globais de Node.js no ambiente de análise, o símbolo `require` não é resolvido pelo TypeScript, tornando-se num tipo de erro / `any`.
5. Por consequência, no linter type-checked (`@typescript-eslint/recommendedTypeChecked`):
   - Chamar `req(...)` constitui `@typescript-eslint/no-unsafe-call` (chamada sobre valor do tipo `any`);
   - Atribuir o retorno de `req(...)` constitui `@typescript-eslint/no-unsafe-assignment` (atribuição insegura de valor `any`);
   - A existência do comentário `// eslint-disable-next-line no-undef` era um sintoma direto da ausência de tipagem e declaração formal desse boundary.

### 2.2 Por que a validação local anterior não mostrava o aviso?
1. **Divergência de configuração:** `eslint.config.mjs` no Lina utilizava `parser: tsparser` com `parserOptions.project: "./tsconfig.json"` e `files: ["main.ts", "src/**/*.ts"]`, divergindo do template canónico recomendado pelo Obsidian (`projectService: { allowDefaultProject: ["eslint.config.*"] }`).
2. **Presença acidental de `@types/node` no escopo global:** O `tsconfig.json` do Lina não continha o campo `"types": ["obsidian"]`. Quando `"types"` é omitido, o TypeScript carrega automaticamente todos os pacotes de `@types/*` existentes em `node_modules` (incluindo `@types/node`). Localmente, `require` era implicitamente resolvido como `NodeJS.Require`, mascarando a falha de boundary que o reviewer acusava.
3. Ao testar o compilador sem `@types/node`, o TypeScript reproduziu exatamente 10 diagnósticos de *"Cannot find name 'require'"* nas quatro localizações exatas assinaladas pelo reviewer.

---

## 3. Resolução arquitetural implementada

Em vez de suprimir avisos com `eslint-disable` ou espalhar `any`, foi criada uma fronteira formal e tipada para módulos opcionais de desktop:

### 3.1 Criação de `src/platform/desktopNodeModules.ts`
Implementou-se um módulo dedicado de isolamento da plataforma:
1. Declara `require` com tipo seguro:
   ```typescript
   declare const require: ((moduleName: string) => unknown) | undefined;
   ```
2. Fornece uma função pura `getOptionalNodeRequire(): ((moduleName: string) => unknown) | null` que consulta preferencialmente `window.require` (disponível no Electron de desktop com `nodeIntegration`) e retrocede para `require` em ambientes Node de teste, retornando `null` em mobile.
3. Fornece wrappers com validação runtime estrita:
   - `getOptionalNodeCrypto()`: valida que o módulo exporta `createHash` funcional antes de retornar a interface `NodeCryptoLike`;
   - `resolveNodeSqliteConstructor()`: valida que `DatabaseSync` é uma função antes de retornar o construtor;
   - `getFsAndPathHelpers()`: valida em runtime a existência de `existsSync`, `mkdirSync` e `dirname`.

### 3.2 Refatoração dos 4 ficheiros afetados
1. **`src/index/publishedGenerationBuilder.ts`**:
   - Removida a probe crua e o comentário `eslint-disable no-undef`.
   - Utiliza `getOptionalNodeCrypto()` com narrowing runtime seguro.
2. **`src/index/publishedGenerationValidator.ts`**:
   - Removida a probe crua e o comentário `eslint-disable no-undef`.
   - Utiliza `getOptionalNodeCrypto()` diretamente.
3. **`src/index/sqliteProducerLocalStore.ts`**:
   - Removidas as funções duplicadas e os comentários `eslint-disable no-undef`.
   - Reutiliza e re-exporta as interfaces e helpers de `src/platform/desktopNodeModules.ts` com narrowing `unknown`.
4. **`main.ts`**:
   - Removida a probe crua de `require` no comando de diagnóstico de SQLite.
   - Utiliza `getOptionalNodeRequire()` com narrowing seguro.

### 3.3 Refinamento de `JSON.parse`
Nos métodos utilitários `parseJsonSafely` em `src/device/deviceDiagnostics.ts` e `src/companion/companionConsumptionState.ts`, adicionou-se a asserção explícita `JSON.parse(content) as unknown` para garantir que retornos de JSON não exponham tipos `any`.

---

## 4. Alinhamento de ESLint com o ecossistema Obsidian

O ficheiro `eslint.config.mjs` foi atualizado para seguir estritamente o padrão do `obsidian-sample-plugin` e `eslint-plugin-obsidianmd`:

```javascript
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    ignores: [
      "main.js",
      "node_modules/**",
      "coverage/**",
      "dist/**",
      "tests/**",
      "scripts/**",
      "scratch/**",
      ".lina-local/**",
      "esbuild.config.mjs",
      "vitest.config.ts",
    ],
  },
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.*"],
        },
      },
    },
    rules: {
      "obsidianmd/ui/sentence-case": [
        "warn",
        {
          brands: ["Lina"],
          acronyms: ["IA"],
          enforceCamelCaseLower: true,
        },
      ],
    },
  },
]);
```

E no `package.json`:
- `"lint": "npm run lint:obsidian:strict"`
- `"lint:obsidian": "eslint ."`
- `"lint:obsidian:strict": "eslint . --max-warnings=0"`
- `"lint:review": "eslint . --max-warnings=0"`

---

## 5. Resultados e validação

- `npm run lint` executa `eslint . --max-warnings=0` e termina com **código 0 (zero avisos, zero erros)**.
- `npm run typecheck` (`tsc --noEmit`) passa com **código 0**.
- `npm test` passa com **206 ficheiros / 2606 testes verdes (100%)**.
- Todos os comentários `eslint-disable-next-line no-undef` foram removidos sem introdução de novas supressões.

# LINA 0.3.3 — Reprodutibilidade do build

## Decisão

Production builds no longer embed a build timestamp.

O timestamp variável era a única diferença identificada entre bundles produzidos em momentos diferentes. A release agora depende apenas do código-fonte, lockfile e toolchain: não usa `new Date()`, metadata do commit, `SOURCE_DATE_EPOCH` ou o relógio da máquina.

## Implementação

- `esbuild.config.mjs` já não define `__LINA_BUILD_TIMESTAMP__`.
- `src/buildInfo.ts` foi removido por não ter outro consumidor.
- O bloco informativo de Ajuda e suporte mostra apenas `Versão: <versão>`; não mostra `Build`.
- O perfil TEST continua separado apenas pelas funcionalidades técnicas próprias; nenhum perfil embute um timestamp de build.

## Evidência recolhida

Três `npm run build` consecutivos e um `npm ci` seguido de `npm run build` produziram o mesmo SHA-256 para `main.js`:

- build 1: `822FC7F4A19EE78D8ECED88C5CE6E160C53226B16A0ADDB91F92FE9E06F2A781`
- build 2: `822FC7F4A19EE78D8ECED88C5CE6E160C53226B16A0ADDB91F92FE9E06F2A781`
- build 3: `822FC7F4A19EE78D8ECED88C5CE6E160C53226B16A0ADDB91F92FE9E06F2A781`
- após `npm ci`: `822FC7F4A19EE78D8ECED88C5CE6E160C53226B16A0ADDB91F92FE9E06F2A781`

Todos os hashes são iguais.

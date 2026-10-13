# LINA 0.3.3 — Prontidão de release

## Reprodutibilidade

Production builds no longer embed a build timestamp. O bundle de produção não usa data/hora de compilação, data do commit ou `SOURCE_DATE_EPOCH`.

Antes da release, confirmar quatro builds de `main.js` com o mesmo SHA-256: três builds consecutivos e outro após `npm ci`.

Evidência obtida: os quatro builds produziram `822FC7F4A19EE78D8ECED88C5CE6E160C53226B16A0ADDB91F92FE9E06F2A781`.

## Gates

- `npm test`
- `npm run lint:obsidian`
- `npm run lint:obsidian:strict`
- `npm run lint:review`
- `npm run typecheck`
- `npm run build`
- `npm run release-check`
- `git diff --check`

Todos os gates acima passaram para esta alteração.

Não criar tag, release ou push nesta fase.

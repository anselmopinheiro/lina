# Módulo 7 — Build, testes, packaging e documentação

```text
MÓDULO
objetivo: confirmar gates técnicos, coerência de versão/packaging e que a documentação corresponde ao código.
ficheiros/áreas inspecionadas: manifest.json, package.json, package-lock.json, versions.json, main.js, styles.css, scripts/release-check.js,
  README.md, docs/help.md, docs/manual.md, docs/GLOSSARIO.md, docs/commands.md, CHANGELOG.md, docs/release-notes-0.3.2.md.

EVIDÊNCIA (gates, após todas as correções)
- npm run typecheck ............ limpo
- npm run build ................ concluído (perfil DEV); main.js tracked e regenerado (inclui as correções)
- npm run release-check ........ READY FOR OBSIDIAN RELEASE (bundle DEV sem diagnósticos TEST-only M6)
- npm run lint:obsidian ........ 0 erros, 0 avisos
- npm run lint:obsidian:strict . 0 erros, 0 avisos (--max-warnings=0)
- git diff --check ............. limpo
- npm test ..................... 2605 passed / 1 failed (206 ficheiros)

TESTE FALHADO CONHECIDO (M6)
- tests/index/m6DesktopRuntimeValidation.test.ts:102 — "validates M6 desktop cutover runtime on real zettel vault":
  expect(legacyIndex?.count).toBe(2303), recebido 2302.
- Assinatura idêntica no baseline (antes de alterações) e no estado final; independente das correções desta auditoria.
- Causa: o teste depende de um vault real (zettel) cuja contagem de chunks derivou; contraria a regra do AGENTS "nunca depender de um vault real".
- Classificação: NÃO BLOQUEANTE, nos termos definidos para esta fase (a falha permanece exatamente a mesma).
- Consequência prática: `npm run release:validate` (lint + test + build + release-check) falha localmente por este teste. O CI (typecheck, build,
  release-check) não executa npm test.

COERÊNCIA DE VERSÃO / PACKAGING
- manifest 0.3.2, package 0.3.2, package-lock 0.3.2, versions.json 0.3.2 -> minAppVersion 1.13.0, isDesktopOnly false.
- Assets de release previstos: main.js, manifest.json, styles.css (release-check estrutural OK).

DOCUMENTAÇÃO — verificação contra o código
- Gate de privacidade fail-closed, comandos /ask /tags /yaml, Companion read-only, sync agnóstico, defaults de providers, tabela de
  manutenção automática: coerentes com o código (ver Módulos 1-4).
- README/Help/Manual/Glossário/Commands/Release notes referem 0.3.2 (Alpha). Roadmap não alterado (fora do âmbito).

ACHADOS
P0/P1: nenhum.
P2:
  - M7-F1 — Teste M6 acoplado a vault real (ver acima); deveria ser ignorado/condicionado quando o vault não existe ou usar fixture.
  - M7-F2 — O CI não executa npm test nem lint; a regressão local (M7-F1) não é visível no CI e vice-versa. Considerar adicionar `npm test`
    ao CI depois de resolvido M7-F1.
INFO:
  - README-pt.md e docs/manual-alfa.md são legados (AGENTS) e não foram tocados.

CORREÇÕES
- CHANGELOG 0.3.2 (Fixed): registo das correções de privacidade desta auditoria.

DOCUMENTAÇÃO ATUALIZADA
- CHANGELOG.md.

CLASSIFICAÇÃO
PENDÊNCIA NÃO BLOQUEANTE (M7-F1, M7-F2)
```

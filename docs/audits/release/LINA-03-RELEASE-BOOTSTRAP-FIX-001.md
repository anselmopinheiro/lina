# LINA-03-RELEASE-BOOTSTRAP-FIX-001 — Relatório de Preparação de Release 0.3.1

**Decisão:** Preparado tecnicamente para release de patch pública (`0.3.1`), com documentação completa, testes executados e conformidade validada com o ecossistema Obsidian. Sem alterações funcionais ou arquiteturais não autorizadas.

---

## 1. Contexto da Correção

Na versão `0.3.0`, o Lina introduziu a separação arquitetural entre:
- `.lina/index/`: artefactos canónicos publicados e sincronizáveis, consumidos de forma segura pelos dispositivos Companion;
- `.lina/producer/`: área de armazenamento operacional local exclusiva do dispositivo Active Producer, contendo staging candidates, checkpoints intermédios e backups de rollback.

Após a disponibilização da release 0.3.0, foi identificada uma falha operacional durante o processo de geração de embeddings:
```text
ENOENT: no such file or directory, rename .lina/producer/staging/embeddings.checkpoint.tmp -> .lina/producer/checkpoints/embeddings.checkpoint.json
```

A tarefa `LINA-03-AUDIT-PRODUCER-BOOTSTRAP-001` diagnosticou detalhadamente a causa raiz e a tarefa `LINA-03-FIX-PRODUCER-BOOTSTRAP-001` implementou a correção necessária, que agora é empacotada nesta release de patch `0.3.1`.

---

## 2. Problema Original

1. **Guarda Prematura em `ensureProducerWorkDirectories`:**
   A função verificava se `.lina/producer/staging` existia no disco. Caso positivo, assumia que todos os diretórios operacionais (`checkpoints`, `backups`, etc.) já existiam, retornando prematuramente. Em vaults novos ou onde diretórios tivessem sido parcialmente removidos/omitidos, a diretoria `checkpoints` não era criada.
2. **Mesma fragilidade em `ensureBinaryProducerWorkDirectories`:**
   A área binária continha a mesma guarda prematura baseada exclusivamente em `staging`.
3. **Escrita sem garantia prévia em `completeInterruptedFirstPublication`:**
   O fluxo de recuperação de publicação interrompida não garantia ativamente a existência das diretorias operacionais antes de invocar a persistência de checkpoints.
4. **Falta de validação no `FakeAdapter`:**
   O adapter de teste pré-criava as pastas operacionais em memória, mascarando a dependência do filesystem real e não validava que a pasta de destino num `rename` precisava de existir.

---

## 3. Alterações Implementadas

1. **Garantia Idempotente e Recursiva de Diretórios:**
   - Em `src/index/embeddingPersistence.ts`, foi removida a verificação precoce de `staging`. A função `ensureProducerWorkDirectories()` itera e assegura com `adapter.mkdir` todos os caminhos definidos em `PRODUCER_WORK_DIRECTORIES` (`staging`, `checkpoints`, `backups`).
   - Em `src/index/embeddingBinaryStorage.ts`, a mesma correção foi aplicada em `ensureBinaryProducerWorkDirectories()` para as diretorias de trabalho binárias.
2. **Proteção de Recuperação de Publicação Interrompida:**
   - `ensureProducerWorkDirectories` foi exportada e passa a ser chamada explicitamente em `completeInterruptedFirstPublication()` antes de salvar checkpoints ou staging.
3. **Inicialização Preventiva no Save do Índice Textual:**
   - Em `src/index/indexStore.ts`, foi adicionada a criação preventiva da diretoria `.lina/producer/checkpoints` em `saveTextIndex()` para garantir que a infraestrutura operacional de checkpoints está disponível desde a primeira gravação de índice.
4. **Endurecimento do Test Harness:**
   - O `FakeAdapter` (`tests/helpers/fakeAdapter.ts`) deixou de pré-popular artificialmente `.lina/producer/*`, ganhou a opção `emptyFolders` e passou a exigir a existência da pasta destino em operações de `rename`, emulando o comportamento de filesystems reais (como Node.js `fs.promises.rename` e Android).
5. **Cobertura de Regressão Automatizada:**
   - Implementada suite dedicada `tests/index/producerOperationalBootstrap.test.ts` cobrindo:
     - Caso 1: Primeiro arranque com criação atómica de checkpoints;
     - Caso 2: Re-criação após eliminação de `.lina/producer/checkpoints`;
     - Caso 3: Recuperação de primeira publicação interrompida sem pastas pré-existentes;
     - Caso 4: Bootstrap operacional binário independente;
     - Caso 5: Criação preventiva durante `saveTextIndex`.

---

## 4. Impacto no Utilizador

- **Fiabilidade Elevada:** Eliminação total de erros `ENOENT` durante o processamento e salvamento de embeddings.
- **Transparência e Automação:** Lina gere todas as pastas operacionais automaticamente sem exigir qualquer criação manual de pastas ou intervenção técnica pelo utilizador.
- **Zero Migrações:** Não existem migrações de dados, schemas alterados ou risco para as notas do utilizador.
- **Compatibilidade Integral:** Vaults existentes em 0.3.0 e versões anteriores continuam plenamente compatíveis.

---

## 5. Documentação Atualizada

Foram auditados e atualizados os seguintes ficheiros com a versão `0.3.1`:
1. `package.json` — versão atualizada para `0.3.1`.
2. `package-lock.json` — versão atualizada para `0.3.1` (raiz e pacote de topo).
3. `manifest.json` — versão atualizada para `0.3.1`, mantendo `minAppVersion: "1.13.0"`.
4. `versions.json` — adicionada entrada `"0.3.1": "1.13.0"`.
5. `README.md` — atualizado badge de versão e declaração de versão atual para `0.3.1`.
6. `CHANGELOG.md` — adicionada secção `## [0.3.1] - 2026-09-28` com secção `### Fixed` e notas de `### Changed`.
7. `docs/manual.md` — atualizada indicação de versão para `0.3.1`.
8. `docs/roadmap.md` — marcada a estabilização 0.3.1 como concluída e ajustado o backlog subsequente de refinamento UX para 0.3.2.
9. `docs/release-0.3.1.md` — criadas notas de lançamento em inglês internacional, orientadas ao utilizador final.

---

## 6. Testes Realizados

| Comando | Resultado | Notas |
| :--- | :--- | :--- |
| `npm test` | **Aprovado** | 122 ficheiros de teste, 1643 testes passaram com sucesso. |
| `npm run typecheck` | **Aprovado** | TypeScript compila sem erros (`tsc --noEmit`). |
| `npm run lint:obsidian:strict` | **Aprovado** | ESLint estrito do Obsidian passa com 0 erros e 0 warnings. |
| `npm run build` | **Aprovado** | Bundling via esbuild em modo production concluiu com sucesso; ficheiro `main.js` gerado. |
| `npm run release-check` | **Aprovado** | Validação de `manifest.json`, ficheiros obrigatórios (`main.js`, `manifest.json`, `styles.css`) e atestações CI. |
| `git diff --check` | **Aprovado** | Sem whitespace errors ou conflitos pendentes. |

---

## 7. Estado da Release

A release de correção `0.3.1` está:
- Devidamente isolada e limitada à correção de estabilidade do bootstrap do Producer;
- Totalmente coberta por testes automatizados de regressão;
- Formalmente alinhada em todos os metadados e documentação do repositório;
- **Pronta para publicação no ecossistema de plugins comunitários do Obsidian.**

# LINA-03 — Correção do Bootstrap da Área Operacional do Producer

**Identificador:** LINA-03-FIX-PRODUCER-BOOTSTRAP-001  
**Tipo de tarefa:** Implementação e testes de regressão de bootstrap operacional  
**Versão:** Lina 0.3.0  
**Data:** 2026-09-28  
**Estado:** Concluído (Validado com 122 ficheiros e 1643 testes com sucesso)

---

## 1. Causa Corrigida

Na auditoria `LINA-03-AUDIT-PRODUCER-BOOTSTRAP-001`, identificou-se que a rotina `ensureProducerWorkDirectories()` continha uma guarda sentinela prematura:

```typescript
if ((await app.vault.adapter.stat(".lina/producer/staging"))?.type === "folder") return;
```

Essa linha assumia falsamente que a presença da pasta `staging/` garantia a existência de toda a árvore operacional do Producer. No entanto:
1. `saveTextIndex()` criava preventivamente `staging/` e `backups/`, mas omitia `checkpoints/`.
2. Em qualquer vault onde o índice de texto fosse inicializado antes dos embeddings (situação padrão em vaults novos e migrados), a pasta `staging/` já existia.
3. Ao tentar escrever o primeiro checkpoint parcial de embeddings, `ensureProducerWorkDirectories()` retornava imediatamente sem criar `.lina/producer/checkpoints/`.
4. A escrita do ficheiro temporário em `staging/` sucedia, mas o `rename` atómico para `.lina/producer/checkpoints/embeddings.checkpoint.jsonl` falhava com:
   ```text
   ENOENT: no such file or directory, rename '.lina/producer/staging/embeddings.checkpoint.tmp' -> '.lina/producer/checkpoints/embeddings.checkpoint.jsonl'
   ```
5. Defeito análogo latente existia em `ensureBinaryProducerWorkDirectories()` em `src/index/embeddingBinaryStorage.ts`.

---

## 2. Ficheiros Alterados

| Ficheiro | Modificação Efetuada |
| :--- | :--- |
| [`src/index/embeddingPersistence.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingPersistence.ts) | • Removida a guarda prematura baseada na pasta `staging` em `ensureProducerWorkDirectories()`.<br>• Garantida a verificação e criação individual e idempotente de cada diretório em `PRODUCER_WORK_DIRECTORIES` (`.lina`, `.lina/producer`, `.lina/producer/checkpoints`, `.lina/producer/staging`, `.lina/producer/backups`).<br>• Exportada a função `ensureProducerWorkDirectories()` para observabilidade e testes.<br>• Adicionada garantia preventiva de diretórios em `completeInterruptedFirstPublication()`. |
| [`src/index/indexStore.ts`](file:///d:/_dev/obsidian/lina/src/index/indexStore.ts) | • Adicionada a pasta `.lina/producer/checkpoints` à criação preventiva em `saveTextIndex()` (junto a `staging` e `backups`), eliminando a assimetria na raiz do subsistema textual. |
| [`src/index/embeddingBinaryStorage.ts`](file:///d:/_dev/obsidian/lina/src/index/embeddingBinaryStorage.ts) | • Removida a guarda sentinela prematura de `ensureBinaryProducerWorkDirectories()`, assegurando verificação e criação individual para os diretórios usados por backups e staging binários. |
| [`tests/helpers/fakeAdapter.ts`](file:///d:/_dev/obsidian/lina/tests/helpers/fakeAdapter.ts) | • Eliminada a pré-população indiscriminada das pastas do Producer (`.lina/producer/*`) no construtor.<br>• Implementada validação realista no método `rename()`: falha com `ENOENT` quando o diretório pai de destino não existe em `this.folders`.<br>• Adicionada opção `emptyFolders` para permitir testar vaults completamente vazios sem `.lina`. |
| [`tests/index/embeddingBatching.test.ts`](file:///d:/_dev/obsidian/lina/tests/index/embeddingBatching.test.ts) | • Ajustado o limite de microticks de `waitForCalls()` de 100 para 500 para permitir a liquidação das operações assíncronas do sistema de ficheiros. |
| [`tests/index/embeddingLifecycle.integration.test.ts`](file:///d:/_dev/obsidian/lina/tests/index/embeddingLifecycle.integration.test.ts) | • Ajustado o limite de microticks de `waitForCalls()` de 200 para 500 para estabilidade determinística das asserções de lifecycle com I/O real simulado. |
| [`tests/index/producerOperationalBootstrap.test.ts`](file:///d:/_dev/obsidian/lina/tests/index/producerOperationalBootstrap.test.ts) | • Novo ficheiro de testes com cobertura direta dos 4 casos de regressão exigidos na especificação. |
| [`main.js`](file:///d:/_dev/obsidian/lina/main.js) | • Bundle de produção atualizado via `npm run build`. |

---

## 3. Estratégia de Bootstrap Implementada

A estratégia de inicialização do armazenamento operacional do Producer passa a assentar em três pilares defensivos:

1. **Idempotência Individual:**
   Cada pasta é verificada via `adapter.stat()`. Apenas diretórios em falta recebem chamada de `adapter.mkdir()`. Se já existirem como pasta, são ignorados de forma segura; se existir um ficheiro com o mesmo nome, é lançado erro tipado defensivo.
2. **Defesa em Profundidade (Textual + Embeddings):**
   - O subsistema textual (`indexStore.ts`) cria antecipadamente `checkpoints/` em simultâneo com `staging/` e `backups/`.
   - O subsistema de embeddings (`embeddingPersistence.ts`) não confia cegamente no subsistema textual e garante incondicionalmente a presença de todos os diretórios operacionais antes de qualquer escrita de checkpoint ou publicação.
   - O subsistema binário (`embeddingBinaryStorage.ts`) assegura igualmente os seus diretórios de forma individual.
3. **Resiliência a Eliminações Externas (Auto-healing):**
   Se qualquer pasta operacional (`checkpoints/`, `staging/` ou `backups/`) for eliminada em tempo de execução por sincronizadores externos ou intervenção manual, a próxima chamada de escrita deteta a ausência e recria o diretório automaticamente antes do `rename`.

---

## 4. Testes de Regressão Criados

Foi adicionada uma suíte focada em [`tests/index/producerOperationalBootstrap.test.ts`](file:///d:/_dev/obsidian/lina/tests/index/producerOperationalBootstrap.test.ts) cobrindo todos os cenários solicitados:

- **Caso 1: `staging` existe mas `checkpoints` não existe:**
  Simula um vault onde `staging/` e `backups/` já foram criados pelo índice textual. Executa `writeEmbeddingCheckpoint()` e confirma que `.lina/producer/checkpoints` é criado automaticamente e o ficheiro de checkpoint é persistido sem qualquer erro `ENOENT`.
- **Caso 2: Vault novo sem `.lina`:**
  Utiliza `FakeAdapter(undefined, { emptyFolders: true })` onde nem `.lina` nem qualquer subdiretório existe. Confirma que a estrutura completa (`.lina/`, `.lina/producer/`, `checkpoints/`, `staging/`, `backups/`) é criada e utilizável sem intervenção manual.
- **Caso 3: Diretório operacional removido externamente:**
  Garante o bootstrap inicial, remove `.lina/producer/checkpoints/` externamente, e executa uma nova escrita de checkpoint. Confirma que o diretório é recriado antes da operação de `rename`.
- **Caso 4: FakeAdapter valida pasta de destino no rename:**
  Testa que o `FakeAdapter.rename()` rejeita com erro `ENOENT: no such file or directory, rename ...` quando a pasta de destino não existe, e conclui com sucesso após criação via `mkdir()`.
- **Caso Adicional: Criação preventiva por `saveTextIndex`:**
  Confirma que a indexação textual inicial cria a totalidade das pastas operacionais do Producer (`checkpoints`, `staging`, `backups`).

---

## 5. Validações Executadas

Todos os comandos de validação passaram com sucesso:

1. **Testes globais:**
   ```bash
   npm test
   # Test Files: 122 passed (122)
   # Tests:      1643 passed (1643)
   ```
2. **Typecheck estrito TypeScript:**
   ```bash
   npm run typecheck
   # tsc --noEmit: 0 erros
   ```
3. **Linter estrito Obsidian:**
   ```bash
   npm run lint:obsidian:strict
   # eslint main.ts "src/**/*.ts" --max-warnings=0: 0 erros, 0 avisos
   ```
4. **Verificação de diff:**
   ```bash
   git diff --check
   # 0 erros de formatação ou whitespace
   ```
5. **Compilação de produção:**
   ```bash
   npm run build
   # Bundle gerado e sincronizado com o test-vault
   ```

---

## 6. Confirmação da Preservação Arquitetural

- **Fronteira canónica intacta:** O diretório `.lina/index/` continua a albergar exclusivamente os artefactos canónicos publicados (`manifest.json`, `notes.json`, `chunks.jsonl`, `embeddings.jsonl`, e artefactos binários).
- **Isolamento operacional preservado:** A área `.lina/producer/` mantém o seu papel estrito de área de trabalho e staging local do Active Producer, sem interferência nos Companions.
- **Contratos inalterados:** Nenhum schema, contrato de vetores, política de exclusão ou interface pública de persistência foi alterado.

---

## Conclusão da Condição de Paragem

> **Aprovado:** Um vault novo (sem diretórios `.lina`) e um vault migrado (com `staging` pré-existente e `checkpoints` ausente) geram agora embeddings com checkpoints atómicos bem-sucedidos sem qualquer necessidade de intervenção manual.

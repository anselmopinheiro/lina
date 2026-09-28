# LINA-03 — Auditoria de Bootstrap da Área Operacional do Producer

**Identificador:** LINA-03-AUDIT-PRODUCER-BOOTSTRAP-001  
**Tipo de auditoria:** Auditoria de arquitetura e armazenamento operacional  
**Versão:** Lina 0.3.0  
**Data:** 2026-09-28  
**Estado:** Concluída (Causa identificada; recomendações sem implementação de código)

---

## Sumário Executivo

Durante a execução da geração de embeddings no Lina 0.3.0, foi registada uma falha em tempo de execução com o erro:

```text
ENOENT: no such file or directory, rename '.lina/producer/staging/embeddings.checkpoint.tmp' -> '.lina/producer/checkpoints/embeddings.checkpoint.jsonl'
```

A presente auditoria determinou a causa exata desta falha:
1. **Omissão estrutural:** A rotina de persistência do índice textual (`saveTextIndex` em `src/index/indexStore.ts`) cria `.lina/`, `.lina/index/`, `.lina/producer/staging/` e `.lina/producer/backups/`, mas **não cria** `.lina/producer/checkpoints/`.
2. **Guarda prematura (sentinela falsa):** A função de garantia de diretórios dos embeddings (`ensureProducerWorkDirectories` em `src/index/embeddingPersistence.ts`, linha 280) contém uma condição de retorno imediato (`if ((await app.vault.adapter.stat(".lina/producer/staging"))?.type === "folder") return;`), assumindo incorretamente que a existência de `staging/` prova a existência de `checkpoints/`.
3. **Falha na operação atómica:** Como o índice textual corre sempre antes da geração de embeddings, `staging/` já existe, o loop de criação de pastas é abortado prematuramente, a pasta `checkpoints/` nunca é criada e o comando `rename` para a pasta inexistente falha com `ENOENT`.
4. **Ponto cego nos testes:** A suíte de testes unitários não detetou o erro porque o mock `FakeAdapter` pré-popula todas as pastas no construtor e não valida a existência da pasta de destino na operação `rename`.

A separação arquitetural entre `.lina/index/` (publicado) e `.lina/producer/` (operacional privado) mantém-se válida e intacta; a falha é estritamente no mecanismo de bootstrap e verificação de integridade dos diretórios locais.

---

## 1. Estrutura Atual do Armazenamento

Na versão 0.3.0, o Lina opera com uma fronteira estrita entre dados canónicos sincronizáveis e área de trabalho privada do Producer:

```text
.lina/
├── index/                         # Publicado e Canónico (Sincronizado)
│   ├── manifest.json              # Vector Contract e metadados de publicação
│   ├── notes.json                 # Metadados de notas indexadas
│   ├── chunks.jsonl               # Chunks de texto
│   ├── embeddings.jsonl           # Vetores publicados em formato JSONL
│   ├── embeddings.binary.manifest.json  # Manifesto binário (se ativo)
│   ├── embeddings.meta.jsonl      # Metadados de vetores binários (se ativo)
│   └── embeddings.vectors.f32     # Vetores Float32Array em formato binário (se ativo)
│
└── producer/                      # Operacional Privado do Active Producer (Não sincronizado)
    ├── checkpoints/               # Checkpoints parciais recuperáveis
    │   ├── embeddings.checkpoint.jsonl
    │   └── embeddings.checkpoint.meta.json
    ├── staging/                   # Ficheiros temporários e candidatos pré-validação
    │   ├── embeddings.checkpoint.tmp
    │   ├── embeddings.checkpoint.meta.tmp
    │   ├── embeddings.publish.tmp
    │   ├── manifest.publish.tmp
    │   ├── notes.json.tmp-*
    │   └── chunks.jsonl.tmp-*
    └── backups/                   # Backups atómicos rotativos para suporte a rollback
        ├── embeddings.checkpoint.backup
        ├── embeddings.checkpoint.meta.backup
        ├── embeddings.publish.backup
        ├── manifest.publish.backup
        ├── notes.json.bak-*
        └── chunks.jsonl.bak-*
```

---

## 2. Mapeamento de Armazenamento e Pontos de Criação

A análise ao código-fonte identifica onde os caminhos da pasta operacional `.lina/producer/` são definidos e onde ocorre a sua criação:

| Diretório / Ficheiro | Ficheiro de Definição | Constante / Referência | Função de Criação | Momento de Criação |
| :--- | :--- | :--- | :--- | :--- |
| `.lina/producer/` | `src/index/embeddingPersistence.ts`<br>`src/index/indexStore.ts`<br>`src/index/embeddingBinaryStorage.ts` | `PRODUCER_WORK_DIRECTORIES`<br>`BINARY_PRODUCER_WORK_DIRECTORIES` | `ensureProducerWorkDirectories()`<br>`saveTextIndex()` via `ensureFolder()`<br>`ensureBinaryProducerWorkDirectories()` | Apenas em tempo de escrita (lazy); ausente no bootstrap global do plugin (`main.ts`). |
| `.lina/producer/staging/` | `src/index/embeddingPersistence.ts`<br>`src/index/indexStore.ts`<br>`src/index/embeddingBinaryStorage.ts` | `EMBEDDING_PERSISTENCE_FILES.checkpointTemporary`<br>`producerStagingFolderPath` (L409) | `ensureProducerWorkDirectories()`<br>`saveTextIndex()` (L414) | Criado logo no scan/indexação textual inicial das notas (`saveTextIndex`). |
| `.lina/producer/backups/` | `src/index/embeddingPersistence.ts`<br>`src/index/indexStore.ts`<br>`src/index/embeddingBinaryStorage.ts` | `EMBEDDING_PERSISTENCE_FILES.checkpointBackup`<br>`producerBackupsFolderPath` (L410) | `ensureProducerWorkDirectories()`<br>`saveTextIndex()` (L415) | Criado logo no scan/indexação textual inicial das notas (`saveTextIndex`). |
| `.lina/producer/checkpoints/` | `src/index/embeddingPersistence.ts` | `EMBEDDING_PERSISTENCE_FILES.checkpoint` (L19)<br>`EMBEDDING_PERSISTENCE_FILES.checkpointMetadata` (L20) | `ensureProducerWorkDirectories()` (L279–289) | **Supostamente** no primeiro checkpoint de embeddings, mas **neutralizado** por retorno antecipado. |

---

## 3. Verificação das Funções de Inicialização

Não existem funções como `ensureProducerStorage()`, `initializeProducerStorage()` ou `prepareProducerDirectories()` no arranque do plugin (`main.ts` ou lifecycle de startup).

A criação de diretórios opera de modo descentralizado e reativo:

### A. Em `src/index/indexStore.ts` (linhas 406–416)
```typescript
const linaFolderPath = ".lina";
const indexFolderPath = ".lina/index";
const producerStagingFolderPath = ".lina/producer/staging";
const producerBackupsFolderPath = ".lina/producer/backups";

await ensureFolder(app, linaFolderPath);
await ensureFolder(app, indexFolderPath);
await ensureFolder(app, producerStagingFolderPath);
await ensureFolder(app, producerBackupsFolderPath);
```
- **Avaliação:** Garante com sucesso `.lina`, `.lina/index`, `.lina/producer/staging` e `.lina/producer/backups`.
- **Falha:** Omite completamente `.lina/producer/checkpoints`.

### B. Em `src/index/embeddingPersistence.ts` (linhas 279–289)
```typescript
const PRODUCER_WORK_DIRECTORIES = [
  ".lina",
  ".lina/producer",
  ".lina/producer/checkpoints",
  ".lina/producer/staging",
  ".lina/producer/backups"
] as const;

async function ensureProducerWorkDirectories(app: App): Promise<void> {
  if ((await app.vault.adapter.stat(".lina/producer/staging"))?.type === "folder") return;
  if (typeof (app.vault.adapter as { mkdir?: unknown }).mkdir !== "function") return;

  for (const path of PRODUCER_WORK_DIRECTORIES) {
    const stat = await app.vault.adapter.stat(path);
    if (stat?.type === "folder") continue;
    if (stat) throw new Error(`Expected producer work directory at ${path}.`);
    await app.vault.adapter.mkdir(path);
  }
}
```
- **Avaliação:** Define a lista correta e completa em `PRODUCER_WORK_DIRECTORIES`.
- **Falha Crítica:** A linha 280:
  ```typescript
  if ((await app.vault.adapter.stat(".lina/producer/staging"))?.type === "folder") return;
  ```
  assume falsamente que a presença de `staging` atesta a existência de todos os outros diretórios. Como `saveTextIndex` cria `staging` primeiro, esta condição avalia sempre como verdadeira. As linhas 283–288 nunca são executadas em operações normais.

### C. Em `src/index/embeddingBinaryStorage.ts` (linhas 183–193)
```typescript
async function ensureBinaryProducerWorkDirectories(adapter: BinaryEmbeddingDataAdapter): Promise<void> {
  if ((await adapter.stat(".lina/producer/staging"))?.type === "folder") return;
  if (!adapter.mkdir) return;

  for (const path of BINARY_PRODUCER_WORK_DIRECTORIES) {
    const stat = await adapter.stat(path);
    if (stat?.type === "folder") continue;
    if (stat) throw new Error(`Expected binary Producer work directory at ${path}.`);
    await adapter.mkdir(path);
  }
}
```
- **Avaliação:** Apresenta a mesma fragilidade estrutural (sentinela em `staging`), o que significa que se `backups` for removido externamente, também não será recriado enquanto `staging` existir.

---

## 4. Auditoria do Fluxo de Geração de Embeddings

Seguindo passo a passo a cadeia de execução:

1. **Pedido de geração de embeddings:**
   - O utilizador ou o planeador dispara `generateEmbeddingsForChunks()` (`src/index/embeddingGenerator.ts`).
2. **Processamento do primeiro lote:**
   - O lote de chunks é calculado e os vetores são obtidos do provider.
   - `persistResolvedInputs()` é invocado para persistir o lote (linhas 1306–1335).
3. **Escrita do Checkpoint:**
   - É chamado `writeEmbeddingCheckpoint()` (`src/index/embeddingPersistence.ts`, linha 654).
   - Invocação de `ensureProducerWorkDirectories(app)` (linha 663).
   - Como `saveTextIndex()` correu previamente no vault, `.lina/producer/staging/` existe como diretório.
   - A guarda na linha 280 avalia como verdadeira e faz **`return` imediato**.
   - A pasta `.lina/producer/checkpoints/` **não é criada**.
4. **Checkpoint Temporário:**
   - O conteúdo serializado é escrito em `files.checkpointTemporary` (`.lina/producer/staging/embeddings.checkpoint.tmp`).
   - Escrita bem-sucedida (o diretório `staging/` existe).
   - Os metadados temporários são escritos em `files.checkpointMetadataTemporary` (`.lina/producer/staging/embeddings.checkpoint.meta.tmp`).
   - Escrita bem-sucedida.
5. **Rename Atómico:**
   - `writeEmbeddingCheckpoint()` executa:
     ```typescript
     await renameEmbeddingPersistenceArtifact(adapter, files.checkpointTemporary, files.checkpoint, retryOptions);
     ```
   - Onde `files.checkpoint` é `.lina/producer/checkpoints/embeddings.checkpoint.jsonl`.
   - O sistema de ficheiros subjacente (Node.js `fs.promises.rename` via Obsidian `DataAdapter`) tenta renomear o ficheiro para um diretório pai inexistente (`.lina/producer/checkpoints/`).
   - O sistema operativo devolve imediatamente:
     ```text
     ENOENT: no such file or directory, rename '.lina/producer/staging/embeddings.checkpoint.tmp' -> '.lina/producer/checkpoints/embeddings.checkpoint.jsonl'
     ```
6. **Tratamento de Erros e Aborto:**
   - O erro não é classificado como bloqueio temporário do Windows (`isTransientWindowsRenameError()` apenas tolera `EBUSY` e `EPERM`).
   - O erro é relançado, capturado pelo bloco `catch (error)` de `writeEmbeddingCheckpoint()`.
   - O rollback elimina os ficheiros temporários em `staging/`.
   - `generateEmbeddingsForChunks()` regista o erro em `checkpointWriteError`:
     `"Não foi possível guardar o checkpoint de embeddings: ENOENT: no such file or directory, rename ..."`
   - A geração é interrompida no final do primeiro lote e retorna falha irrecuperável.
7. **Publicação:**
   - Nunca é alcançada.

---

## 5. Avaliação de Cenários

### Cenário 1: Vault Novo (sem `.lina/`)
- Ao iniciar o plugin no Obsidian, o evento `layout-ready` ou o scanner de arranque despoleta a indexação textual inicial.
- `saveTextIndex()` corre e cria `.lina/`, `.lina/index/`, `.lina/producer/staging/` e `.lina/producer/backups/`.
- Quando o utilizador inicia a sua primeira geração de embeddings, a pasta `staging/` já existe.
- A geração falha com `ENOENT` logo no primeiro lote.
- **Resultado:** **Falha total sem intervenção manual.**

### Cenário 2: Vault Migrado (upgrade para 0.3.0)
- Um vault proveniente da versão 0.2.x possui ficheiros em `.lina/index/`.
- Ao atualizar para 0.3.0, não existe rotina de migração nem de criação prévia de pastas do Producer.
- No arranque da 0.3.0, qualquer escrita no índice textual cria `staging/` e `backups/`.
- A pasta `.lina/producer/checkpoints/` nunca é criada.
- A primeira geração na versão 0.3.0 falha com `ENOENT`.
- **Resultado:** **Falha total na transição.**

### Cenário 3: Diretórios Removidos
- Caso um utilizador, script de backup ou ferramenta externa elimine a pasta `.lina/producer/checkpoints/` enquanto `.lina/producer/staging/` permanecer intacta:
- O Lina não recria a pasta `checkpoints/` devido à condição sentinela.
- A geração falha repetidamente com `ENOENT`.
- O mesmo sucede se a pasta `backups/` for eliminada: no segundo lote de checkpoint (ou na publicação canónica) onde um backup é efetuado, o rename para `backups/` falha com `ENOENT`.
- **Resultado:** **Ausência de auto-recuperação/auto-healing.**

---

## 6. Análise do Ângulo Morto nos Testes (Por que os testes passaram?)

A suíte de testes automatizados conta com mais de 640 testes funcionais, mas este defeito não foi intercetado. A razão foi identificada em `tests/helpers/fakeAdapter.ts`:

1. **Pré-população no construtor:**
   Nas linhas 66–71 de `tests/helpers/fakeAdapter.ts`:
   ```typescript
   this.folders.add(".lina");
   this.folders.add(".lina/index");
   this.folders.add(".lina/producer");
   this.folders.add(".lina/producer/checkpoints");
   this.folders.add(".lina/producer/staging");
   this.folders.add(".lina/producer/backups");
   ```
   O adaptador de teste simulava um estado onde todos os diretórios já existiam à partida.
2. **Implementação de `rename()` desprovida de validação de diretórios:**
   Nas linhas 266–285 de `tests/helpers/fakeAdapter.ts`, o método `rename` limita-se a mover o objeto entre chaves de um `Map` (`this.files`), sem verificar se o diretório pai de destino se encontra registado em `this.folders`.

Em ambiente real de produção (Node.js/Electron), a chamada `rename` falha atomicamente no kernel do sistema operativo se a diretoria de destino não existir.

---

## 7. Causa Identificada

1. **Causa Raiz Primária:**  
   A linha 280 de `src/index/embeddingPersistence.ts`:
   ```typescript
   if ((await app.vault.adapter.stat(".lina/producer/staging"))?.type === "folder") return;
   ```
   É um atalho indevido (sentinela única) que presume paridade entre a existência de `staging` e a de `checkpoints` e `backups`.

2. **Causa Raiz Secundária:**  
   Assimetria e acoplamento fraco de responsabilidades entre `src/index/indexStore.ts` e `src/index/embeddingPersistence.ts`. O módulo de texto cria preventivamente pastas do Producer que satisfazem a sentinela do módulo de embeddings, impedindo este último de completar o seu próprio bootstrap.

3. **Causa Análoga Latente:**  
   A linha 184 de `src/index/embeddingBinaryStorage.ts` reproduz a mesma sentinela prematura:
   ```typescript
   if ((await adapter.stat(".lina/producer/staging"))?.type === "folder") return;
   ```

---

## 8. Avaliação de Risco

- **Gravidade Funcional:** **Crítica / Bloqueante**. Impede completamente a geração de embeddings em qualquer vault a correr Lina 0.3.0.
- **Risco de Perda de Dados:** **Nulo**. O mecanismo transacional funciona defensivamente e limpa os artefactos temporários de `staging/` no rollback após a exceção.
- **Risco Arquitetural:** **Baixo**. A separação lógica entre `.lina/index/` e `.lina/producer/` é correta e responde às exigências de isolamento de sincronização (Syncthing/Obsidian Sync). Trata-se puramente de uma falha de bootstrap local no sistema de ficheiros.

---

## 9. Recomendações Técnicas para Implementação Futura

As seguintes ações corretivas concretas devem ser planeadas para a fase de implementação:

### A. Eliminação das guardas sentinela em `ensureProducerWorkDirectories`
Em `src/index/embeddingPersistence.ts`:
- Remover incondicionalmente a linha 280 (`if ((await app.vault.adapter.stat(".lina/producer/staging"))?.type === "folder") return;`).
- Manter o ciclo de iteração sobre `PRODUCER_WORK_DIRECTORIES` para verificar (`stat`) e criar (`mkdir`) cada pasta individualmente se não existir.
- O custo de I/O é negligenciável (4 a 5 chamadas síncronas/assíncronas de `stat` no arranque de um lote de geração).

### B. Correção em `ensureBinaryProducerWorkDirectories`
Em `src/index/embeddingBinaryStorage.ts`:
- Remover igualmente a guarda sentinela prematura na linha 184 para prevenir falhas no armazenamento binário caso a pasta `backups/` não exista.

### C. Alinhamento preventivo em `saveTextIndex`
Em `src/index/indexStore.ts` (linhas 406–416):
- Incluir a garantia de criação de `.lina/producer/checkpoints` conjuntamente com `staging` e `backups`, assegurando coerência global da pasta operacional do Producer desde o primeiro momento de vida do vault.

### D. Reforço do Harness de Testes
Em `tests/helpers/fakeAdapter.ts`:
- Remover a pré-criação cega de subpastas do Producer no construtor para permitir testar vaults sem bootstrap.
- No método `rename()` do `FakeAdapter`, validar se o diretório pai do caminho de destino existe em `this.folders`, lançando erro `ENOENT` simulado caso contrário.
- Adicionar testes de regressão específicos a testar o fluxo de escrita de checkpoint num vault onde a pasta `checkpoints/` não existe previamente.

---

## Conclusão da Condição de Paragem

- **Causa identificada:** Sentinela prematura em `ensureProducerWorkDirectories()` associada à omissão de `checkpoints/` em `saveTextIndex()`.
- **Locais concretos de correção:**
  - `src/index/embeddingPersistence.ts` (função `ensureProducerWorkDirectories`, linhas 279–289);
  - `src/index/embeddingBinaryStorage.ts` (função `ensureBinaryProducerWorkDirectories`, linhas 183–193);
  - `src/index/indexStore.ts` (função `saveTextIndex`, linhas 406–416);
  - `tests/helpers/fakeAdapter.ts` (linhas 66–71 e 266–285).
- **Recomendação segura:** Remoção das sentinelas falsas e validação/criação idempotente diretório a diretório, preservando integralmente os contratos e a separação arquitetural de sincronização de dados.
- **Nenhum código de produção foi alterado nesta tarefa.**

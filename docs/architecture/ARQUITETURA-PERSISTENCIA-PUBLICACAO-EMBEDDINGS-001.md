# Arquitetura — Persistência Canónica e Publicação de Embeddings

**Documento:** `ARQUITETURA-PERSISTENCIA-PUBLICACAO-EMBEDDINGS-001`
**Data de adaptação para Lina:** 2026-10-04
**Origem:** consolidação experimental das fases 1–8 do `LinaPoC`
**Estado no Lina:** arquitetura-alvo documentada; não é ainda a arquitetura de produção.

## 1. Finalidade e âmbito

O `LinaPoC` demonstrou uma arquitetura Producer–Consumer em que o estado
canónico local do Producer é uma base SQLite privada e os dispositivos que
consomem pesquisa recebem apenas artefactos derivados, publicáveis e
sincronizáveis. Esta cópia adapta a decisão ao repositório Lina sem alegar que
a migração já ocorreu: no estado atual, os artefactos JSONL/binários legados
continuam a ser o caminho de produção.

O documento preserva a direção técnica validada no PoC e é a referência para a
migração M0–M7. Não autoriza, por si só, a abertura de uma base de dados, uma
escrita shadow, uma migração de schema ou uma alteração do Consumer.

## 2. Evidência do LinaPoC e respetivo grau

| Fase PoC | Questão | Resultado no PoC | Grau no Lina atual |
|---|---|---|---|
| 1 | `node:sqlite`/`DatabaseSync` no Obsidian Desktop | PASS no Electron 39 / Node 22 | A revalidar no runtime do Lina antes de M1 |
| 2 | `Float32Array` ↔ BLOB SQLite | roundtrip byte a byte em 384/768/1536 dimensões | demonstrado no PoC; não integrado |
| 3/3B | escala, memória e responsividade | PASS até 100k vetores | demonstrado no PoC; não integrado |
| 4 | WAL, `synchronous=FULL`, transações e `quick_check` | PASS | demonstrado no PoC; não integrado |
| 5 | recuperação após `taskkill /F` | PASS | demonstrado no PoC; não integrado |
| 6 | reconstrução de binário derivado | PASS, sem recalcular IA | demonstrado no PoC; não integrado |
| 7 | Consumer sem SQLite | PASS | decisão arquitetural preservada |
| 8 | entrega não atómica, truncada e fora de ordem | PASS nos cenários S1–S10 | demonstrado no PoC; não integrado |

### Classificação explícita

- **Demonstrado no LinaPoC:** SQLite privado fora do Vault; BLOB `Float32Array`;
  WAL+FULL; recuperação de crash; publicação determinística; Consumer sem
  SQLite; validação antes da ativação; anti-downgrade e idempotência.
- **Parcialmente demonstrado:** metadados relacionais complementares e impacto
  acima de 200k vetores em memória limitada.
- **Não demonstrado / fora de âmbito:** sincronização real multi-dispositivo,
  conflito de dois Producers, mobile Producer, ANN/HNSW e migração ao vivo da
  persistência legada do Lina.

## 3. Arquitetura-alvo

```text
Producer Desktop
  notas + chunks + embeddings
             │
             ▼
  ProducerLocalStore (SQLite privado, fora do Vault)
  WAL + FULL + transações explícitas
             │ snapshot estável e ordenado
             ▼
  PublicationBuilder ──► generation-N/{manifest.json,vectors.bin,records.json}
                               │
                         fronteira de sincronização
                               │
             Consumer / Companion read-only
  validate-first → anti-downgrade → activate-after
```

O Producer é Desktop. O Consumer/Companion nunca instancia SQLite nem recebe
`.db`, `-wal` ou `-shm`; lê unicamente artefactos publicados. A sincronização é
agnóstica (por exemplo Obsidian Sync ou Syncthing) e não fornece atomicidade:
essa propriedade pertence ao protocolo de publicação/validação.

## 4. Decisões fechadas

1. SQLite é a futura fonte canónica única do estado semântico e relacional do
   Active Producer.
2. A base local e os seus sidecars ficam estritamente fora do Vault e nunca são
   sincronizados.
3. Embeddings usam BLOB `Float32Array`, IEEE-754 little-endian, quatro bytes por
   dimensão; JSON não é o formato canónico de vetores.
4. A configuração de durabilidade é `journal_mode=WAL` e `synchronous=FULL`,
   com transações explícitas (`BEGIN IMMEDIATE`/`COMMIT`).
5. `vectors.bin`, `records.json` e o manifesto são derivados reconstruíveis,
   não uma segunda fonte de verdade.
6. A publicação ordena deterministamente (`ORDER BY id ASC`), calcula hashes e
   só expõe uma geração após a sua materialização completa.
7. O Consumer valida presença, versão, dimensões, tamanho, hash e sanidade antes
   de ativar; mantém a geração anterior perante falha.
8. Uma geração inferior à ativa é rejeitada; repetir a mesma geração é idempotente.

## 5. Modelo canónico proposto

O schema expandido é uma referência para fases futuras, não um schema já criado
no Lina. Inclui `lina_schema_version`, `lina_documents`, `lina_chunks`,
`lina_embeddings` e `lina_publication_history`. A tabela de embeddings associa
um `chunk_id` estável a `model_id`, `dim`, `dtype='float32'` e `blob BLOB`.

M1 permanece deliberadamente mais estreita: cria apenas a base, o `user_version`
e o schema mínimo autorizado na prompt M1. A adoção das tabelas de documentos,
chunks, embeddings e histórico requer fases explícitas posteriores.

## 6. Contrato de publicação futuro

```text
published/
├── CURRENT
└── generation-000042/
    ├── manifest.json
    ├── vectors.bin
    └── records.json
```

O `manifest.json` terá pelo menos `formatVersion`, geração monotónica,
`modelId`, dimensão, `dtype`, `recordCount`, tamanho esperado e SHA-256. A
construção usa staging, sincronização física quando suportada, rename para a
geração final e atualização do ponteiro apenas depois de validar o conjunto.

## 7. Limitações e questões ainda abertas

- mobile continua Consumer-only;
- ownership de um único Producer continua a ser pré-requisito;
- retenção/GC de gerações ainda necessita de política própria;
- ANN/USearch/HNSW não faz parte desta persistência;
- atualizações incrementais e migração da persistência legada exigem fases
  próprias;
- testes de rede real multi-dispositivo continuam fora das provas do PoC.

## 8. Roadmap M0–M7

| Marco | Objetivo | Estado neste repositório |
|---|---|---|
| M0 | contratos inertes e resolução privada de caminho | concluído no commit atual |
| M1 | preflight runtime e SQLite mínimo isolado; shadow write reversível | preflight pendente desta decisão |
| M2 | persistência local canónica para dados do Producer | não iniciado |
| M3 | publicação por gerações derivada da store | não iniciado |
| M4 | validação/ativação Consumer e compatibilidade | não iniciado |
| M5 | migração controlada e observabilidade | não iniciado |
| M6 | endurecimento, recuperação e operações | não iniciado |
| M7 | remoção do legado após critérios de saída | não iniciado |

Cada marco exige testes, gates e reversão definidos na sua própria fase. M1 não
altera a autoridade dos ficheiros legados nem permite que o Consumer leia SQLite.

## 9. Decisão de localização por plataforma

O store é estado local persistente, não configuração. O caminho-alvo é:

| Plataforma | Diretório preferencial |
|---|---|
| Windows | `%LOCALAPPDATA%/lina/db` |
| macOS | `~/Library/Application Support/lina/db` |
| Linux | `$XDG_STATE_HOME/lina/db`, fallback `~/.local/state/lina/db` |

Em Linux, `XDG_STATE_HOME` é preferível a `XDG_CONFIG_HOME`: a especificação XDG
reserva-o para estado que persiste entre reinícios mas não deve ser portátil
como dados de utilizador. A alteração do resolver existente, se aprovada, fica
para M1 e deve incluir os seus testes; este documento não a executa.

## 10. Critérios de avanço

Antes de qualquer `node:sqlite` no código Lina, é obrigatório comprovar no
processo real do plugin a versão Node/Electron, a disponibilidade de
`DatabaseSync`, o comportamento do bundler e a tipagem. Um sucesso no Node CLI
do desenvolvimento não substitui essa prova. Até à conclusão desses critérios,
a arquitetura permanece uma proposta documentada e o SQLite não é aberto em
produção.

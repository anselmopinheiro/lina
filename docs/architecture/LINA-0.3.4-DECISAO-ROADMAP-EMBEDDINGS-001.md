# LINA-0.3.4 — Decisão arquitetural e roadmap de embeddings

**Documento:** `LINA-0.3.4-DECISAO-ROADMAP-EMBEDDINGS-001`
**Natureza:** registo de decisão e roadmap para trabalho futuro. Não é implementação.
**Baseline Git no momento do registo:** branch `master`, HEAD `21fd8c5` (0.3.3).

---

## 1. Estado de desenvolvimento: FROZEN

> **Nenhuma nova implementação, refatoração arquitetural ou desenvolvimento da 0.3.4 começa sem autorização explícita de retoma.**

- A **0.3.3 permanece em validação funcional**.
- O uso real da 0.3.3 pode produzir novos casos documentais e de regressão (query, modo, resultado esperado), mas **não autoriza correções**.
- Este documento não autoriza implementação imediata, nem alterações a código, configuração, flags, índices, vault, migrações ou M-series.

---

## 2. Decisão

A futura 0.3.4 seguirá a **solução leve baseada na arquitetura atual**. O subsistema **M-series (M0–M6)** fica **`DORMANT`**: sem remoção e **sem cutover na 0.3.4**.

### 2.1 Fundamentação (auditorias de 2026-10-16/17)

- O JSONL continua no caminho crítico de geração e publicação do M-series: `performProducerSqliteCanonicalWrite` chama `publishCanonicalEmbeddings` (o mesmo publicador JSONL, com a mesma validação pós-publicação).
- A geração imutável só ocorre depois de a projeção legada ter passado.
- O gerador normal não alimenta diretamente o SQLite; o único chamador do escritor canónico é o comando manual `diagnose-m3-canonical`, que lê os registos do JSONL.
- O M-series retira o JSONL apenas do **runtime** (leitura), e acrescenta um store SQLite local, por dispositivo, não sincronizado.
- Não há GC efetivo de gerações; notas excluídas ou eliminadas podem persistir no SQLite e em gerações históricas.
- O teto móvel permanece na mesma ordem de grandeza (~3,7–3,8 mil registos a 1024 dimensões), porque o Reader usa os mesmos limites do binário.
- O cutover acrescentaria complexidade sem resolver o bloqueio que originou a análise.

### 2.2 Contratos fixados

- Embeddings: **1024 dimensões**.
- Não avaliar 768/512 nem quantização nesta fase.
- Não aumentar simplesmente resource limits.
- Não tornar o binário canónico.
- Não remover o JSONL.
- Não introduzir sharding.
- Preservar compatibilidade e recovery dos formatos existentes.

---

## 3. Objetivo da solução leve

Não basta melhorar o erro. A 0.3.4 deve fazer com que o **JSONL deixe de bloquear a atualização e a utilização do índice binário**, mantendo-o como artefacto canónico e compatível nesta fase.

Fluxo conceptual: `geração → validação prévia → publicação → binário produzido diretamente → runtime binário`.

---

## 4. Escopo mínimo (para quando houver retoma)

1. **Validação pré-publicação.** Medir o candidato antes de trocar o estado canónico; se exceder limites, não publicar parcialmente, não depender de rollback posterior e devolver erro específico de recursos (não "vault bloqueado"). Isoladamente melhora atomicidade e diagnóstico, mas não resolve o limite.
2. **Produção direta do binário.** Construir o binário a partir dos registos disponíveis durante a publicação, sem reler nem fazer parse integral do JSONL. O tamanho do JSONL não pode impedir a atualização do binário enquanto este estiver dentro dos limites suportados.
3. **Checkpoint linear.** Eliminar o crescimento quadrático: a persistência por batches não reescreve cumulativamente todos os registos.
4. **Runtime desktop.** Com binário e manifesto válidos, não reler integralmente o JSONL só para validação; usar o binário como caminho efetivo; fallback e recovery apenas quando explicitamente necessário.
5. **Observabilidade.** Distinguir completo, utilizável mas parcial/desatualizado, a gerar, falhou e limite de recursos. Expor `chunks com embedding / total de chunks`. "Hybrid search available" não pode ocultar atualização falhada nem cobertura parcial.
6. **Mobile.** Antes de alterar a leitura: medir RAM real em Android, medir a leitura do binário, avaliar leitura sem cópia e digest por blocos, e corrigir o estimador para refletir cópias e compactação reais. Otimizações móveis exigem benchmark real.

---

## 5. PENDÊNCIA ARQUITETURAL — ABERTA

> **Estado: ABERTA. Não resolvida, não aprovada.** A decisão final fica para a **primeira fase de desenho da 0.3.4, após descongelamento**.

### 5.1 A colisão

Dois requisitos do escopo mínimo entram em conflito quando o limite se aplica ao JSONL:

1. **Rejeitar antes da publicação** um candidato acima do resource limit (secção 4.1).
2. **Garantir que o crescimento do JSONL não bloqueia o binário** enquanto este estiver dentro dos seus limites (secção 4.2).

Com o JSONL acima do limite de leitura integral (hoje ~53,33 MiB no desktop), a regra 1 impede toda a publicação, binário incluído. Já hoje a LINA-15C classifica um canónico acima do guard como `INCOMPATIBLE` com rebuild confirmado, pelo que o estado "JSONL acima do limite" tem de ter uma semântica explícita no lifecycle.

### 5.2 Hipótese atualmente preferida — NÃO APROVADA

Permitir publicar **JSONL íntegro** mesmo quando excede a capacidade de leitura integral do dispositivo, separando três conceitos:

- **validade / integridade** do artefacto;
- **capacidade de publicação**;
- **capacidade de leitura integral em memória**.

Implicaria rever os guards de leitura e a classificação `INCOMPATIBLE`/`resource-limit-exceeded` do lifecycle e da recuperação do par canónico (LINA-15C/15H). É a mais coerente com os contratos fixados (JSONL canónico, sem sharding, binário derivado), mas é também a que mais toca no lifecycle.

### 5.3 Alternativas menos favoráveis

- **Avançar o binário mantendo o último JSONL válido:** cria desalinhamento entre canónico e derivado, que a LINA-15H trata como par inconsistente.
- **Truncar ou particionar o JSONL:** contraria os contratos atuais e o âmbito "sem sharding".

---

## 6. M-series: `DORMANT` / NO CUTOVER IN 0.3.4

- Não remover o código nesta fase.
- Reavaliar apenas perante necessidade justificada de store local de produtor, ou limites estruturais comprovados da solução leve.
- Uma retoma exige nova decisão sobre: JSONL no caminho crítico, ownership do SQLite, bootstrap e sincronização, GC e privacidade, G5, G7, fallback e compatibilidade desktop/mobile.
- **Privacidade:** se o M-series voltar a ser considerado, o GC é requisito de privacidade. Exclusões e eliminação de notas terão de abranger todos os stores relevantes (store local, geração ativa, gerações históricas e artefactos sincronizados).
- **`diagnose-m3-canonical`:** o comando manual continua registado e pode escrever estado de produtor num Companion desktop. Deve ser tratado separadamente, para impedir alterações acidentais, sem reabrir o M-series.
- **Conflitos documentação ↔ código registados** (não corrigidos):
  - os documentos M6 afirmam `LEGACY_FALLBACK` perante indisponibilidade da geração; o código devolve `PUBLISHED_BLOCKED` para qualquer estado do Reader diferente de `OK` (`main.ts`, `getRuntimeEmbeddingIndex`); `LEGACY_FALLBACK` só existe num mock de teste;
  - `producerSqliteShadowWriteEnabled` tem default `true` mas é inerte (`shadowWriteOptions` nunca é definido por chamadores de produção);
  - a cache publicada não classifica registos stale/missing/orphan, ao contrário do caminho legado (suspeita; não confirmada a jusante).

---

## 7. Casos reais para regressão futura

1. **`03_Pessoal/Administração/contactos/Perito seguros.md`** — a exclusão acidental da pasta `03_Pessoal/` (valor por defeito de `indexExcludedFolders`) fez a nota desaparecer corretamente do corpus e da pesquisa (textual, semântica e híbrida). Caso para a política de exclusões. Vault de diagnóstico: `Anselmo`.
2. **`canonical-resource-limit-exceeded`** — observado com **2887 chunks / 2624 embeddings** (1024 d, Mistral `mistral-embed`): o candidato JSONL (~56,8 MB estimados) excede o limite de leitura desktop (~53,33 MiB, `3× ficheiro + 32 MiB ≤ 192 MiB`); o erro nasce na validação pós-publicação (`validateCanonicalFiles`), depois dos renames, e o rollback preserva o canónico anterior. Revelou o teto do JSONL e deve tornar-se regressão da 0.3.4.

---

## 8. Fora do âmbito

Cutover do M-series; SQLite/gerações como arquitetura de produção; remoção do JSONL; binário canónico; sharding; quantização; dimensões diferentes de 1024; aumento simples de limites; GC/G5/G7/N1/N2 do M-series (salvo neutralização necessária de comportamento dormente); redesign amplo da pesquisa semântica.

---

## 9. Critérios de aceitação da futura 0.3.4

1. Candidato acima do limite falha antes de alterar o estado publicado.
2. Binário produzido sem reler integralmente o JSONL.
3. Crescimento do JSONL não bloqueia o binário dentro dos limites suportados.
4. Checkpoint deixa de ter crescimento quadrático.
5. Desktop usa binário válido sem leitura integral desnecessária do JSONL.
6. Estados parcial, falhado e limite são observáveis.
7. Cobertura de embeddings é reportável.
8. Integridade, recovery e compatibilidade com a 0.3.3 preservados.
9. Casos reais recolhidos na validação funcional tornam-se testes de regressão.
10. Alterações móveis são validadas em Android real.

Quando a implementação for autorizada, deve ser dividida em fases pequenas e verificáveis, sem reabrir as decisões fixadas neste documento (exceto a pendência da secção 5, que é o primeiro ponto de desenho).

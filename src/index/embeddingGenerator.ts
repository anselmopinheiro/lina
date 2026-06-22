import { App } from "obsidian";
import { requestUrl, normalizePath } from "obsidian";
import { Chunk } from "./chunker";
import { hashContent } from "./noteHasher";

export interface EmbeddingRecord {
  chunkId: string;
  path: string;
  index: number;
  textHash: string;
  model: string;
  provider: string;
  dimensions: number;
  embedding: number[];
  createdAt: string;
  embeddingInputHash?: string;
}

export interface EmbeddingProgress {
  current: number;
  total: number;
}

export interface GenerateEmbeddingsOptions {
  /** URL base do Ollama, ex: http://localhost:11434 */
  baseUrl: string;
  /** Modelo de embeddings, ex: nomic-embed-text */
  model: string;
  provider: string;
  /** Timeout em ms por pedido */
  timeoutMs: number;
  /** Se true, só gera para chunks sem embedding válido ou desatualizado */
  incremental?: boolean;
  /** Callback de progresso */
  onProgress?: (progress: EmbeddingProgress, chunkText?: string) => void;
  /** Sinal para abortar */
  abortSignal?: AbortSignal;
}

export interface EmbeddingResult {
  success: boolean;
  total: number;
  generated: number;
  kept: number;
  dimensions: number;
}

interface OllamaEmbedResponse {
  embeddings?: number[][];
}

// Versão da estratégia de input para embeddings
export const EMBEDDING_INPUT_VERSION = 1;

// Modos de prefixo para embeddings
export type EmbeddingPrefixMode = "none" | "nomic-search-query-document";

// Modelos Nomic que suportam prefixos
export const NOMIC_PREFIX_MODELS = new Set([
  "nomic-embed-text-v2-moe",
  "nomic-embed-text",
  "nomic-embed-text-v1.5",
  "nomic-embed-text-v2",
]);

// Deteta se um modelo suporta prefixos Nomic
export function getPrefixModeForModel(model: string): EmbeddingPrefixMode {
  const normalizedModel = model.toLowerCase();
  return NOMIC_PREFIX_MODELS.has(normalizedModel) ? "nomic-search-query-document" : "none";
}

// Aplica prefixo ao texto de input para embeddings
export function applyEmbeddingPrefix(text: string, prefixMode: EmbeddingPrefixMode, isQuery: boolean): string {
  if (prefixMode === "nomic-search-query-document") {
    return isQuery ? `search_query: ${text}` : `search_document: ${text}`;
  }
  return text;
}

/**
 * Constrói o texto enriquecido para gerar embeddings com contexto da nota.
 * Este texto NÃO é guardado em embeddings.jsonl, apenas usado como input para o modelo.
 */
export function buildEmbeddingInput(chunk: Chunk, prefixMode: EmbeddingPrefixMode = "none"): string {
  const pathParts = chunk.path.split('/');
  const fileName = pathParts[pathParts.length - 1] || '';
  const basename = fileName.replace('.md', '');

  const enrichedText = `Título: ${basename}
Caminho: ${chunk.path}
Bloco: ${chunk.chunkIndex}
Conteúdo:
${chunk.text}`;

  // Aplicar prefixo para documentos (não é query)
  return applyEmbeddingPrefix(enrichedText, prefixMode, false);
}

/**
 * Gera embedding para um único texto via /api/embed do Ollama.
 * Retorna o array de números ou null em caso de erro.
 */
export async function generateSingleEmbedding(
  baseUrl: string,
  model: string,
  input: string,
  timeoutMs: number
): Promise<number[] | null> {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const embedUrl = `${normalizedBaseUrl}/api/embed`;

  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), timeoutMs);
  });

  const requestPromise = (async (): Promise<number[] | null> => {
    try {
      const response = await requestUrl({
        url: embedUrl,
        method: "POST",
        contentType: "application/json",
        body: JSON.stringify({
          model,
          input,
        }),
      });

      if (response.status !== 200) {
        console.warn(`Ollama /api/embed status ${response.status}`);
        return null;
      }

      const data = response.json as OllamaEmbedResponse;

      if (!data || !Array.isArray(data.embeddings)) {
        console.warn("Resposta do Ollama sem campo embeddings ou campo nao array:", data);
        return null;
      }

      if (data.embeddings.length === 0) {
        console.warn("Resposta do Ollama com array embeddings vazio");
        return null;
      }

      const embedding = data.embeddings[0];

      if (!Array.isArray(embedding)) {
        console.warn("Embedding devolvido nao e array");
        return null;
      }

      if (embedding.length === 0) {
        console.warn("Embedding devolvido e array vazio");
        return null;
      }

      const allNumbers = embedding.every((v: unknown) => typeof v === "number");
      if (!allNumbers) {
        console.warn("Embedding contem valores nao numericos");
        return null;
      }

      return embedding;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn("Erro ao gerar embedding:", msg);
      return null;
    }
  })();

  return await Promise.race([requestPromise, timeoutPromise]);
}

/**
 * Confirma se um EmbeddingRecord e valido para um dado chunk e modelo.
 * Com a nova estratégia de input enriquecido, embeddings sem embeddingInputHash
 * são considerados desatualizados e precisam ser regenerados.
 */
function isValidEmbedding(
  record: EmbeddingRecord,
  chunk: Chunk,
  model: string,
  provider: string
): boolean {
  if (record.chunkId !== chunk.chunkId) return false;
  if (record.textHash !== chunk.textHash) return false;
  if (record.model !== model) return false;
  if (record.provider !== provider) return false;
  if (!Array.isArray(record.embedding)) return false;
  if (record.embedding.length === 0) return false;
  if (!record.embedding.every((v: unknown) => typeof v === "number")) return false;

  // Embeddings sem embeddingInputHash são considerados desatualizados
  // e precisam ser regenerados com a nova estratégia de input enriquecido
  if (!record.embeddingInputHash) return false;

  return true;
}

/**
 * Le o ficheiro embeddings.jsonl e devolve um mapa de chunkId -> EmbeddingRecord.
 */
export async function readExistingEmbeddings(app: App): Promise<Map<string, EmbeddingRecord>> {
  const map = new Map<string, EmbeddingRecord>();
  const adapter = app.vault.adapter;
  const embeddingsPath = normalizePath(".lina/index/embeddings.jsonl");
  try {
    const stat = await adapter.stat(embeddingsPath);
    if (!stat || stat.type !== "file") return map;
    const content = await adapter.read(embeddingsPath);
    const lines = content.trim().split("\n").filter((l) => l.length > 0);
    for (const line of lines) {
      try {
        const rec = JSON.parse(line) as EmbeddingRecord;
        if (rec.chunkId) {
          map.set(rec.chunkId, rec);
        }
      } catch {
        // ignorar linhas mal formatadas
      }
    }
  } catch {
    // ficheiro nao existe
  }
  return map;
}

/**
 * Determina chunks que precisam de novo embedding.
 * Devolve { toGenerate: Chunk[], keptCount: number, validRecords: EmbeddingRecord[] }.
 */
export function determineChunksToGenerate(
  chunks: Chunk[],
  existingMap: Map<string, EmbeddingRecord>,
  model: string,
  provider: string
): { toGenerate: Chunk[]; keptCount: number; validRecords: EmbeddingRecord[] } {
  const validRecords: EmbeddingRecord[] = [];
  const toGenerate: Chunk[] = [];

  for (const chunk of chunks) {
    const existing = existingMap.get(chunk.chunkId);
    if (existing && isValidEmbedding(existing, chunk, model, provider)) {
      validRecords.push(existing);
    } else {
      toGenerate.push(chunk);
    }
  }

  return { toGenerate, keptCount: validRecords.length, validRecords };
}

/**
 * Gera embeddings para chunks, com suporte incremental.
 * Usa texto enriquecido (título, caminho, bloco, conteúdo) como input para o modelo.
 * Usa escrita segura: ficheiro temporario -> substituicao no final.
 * Devolve EmbeddingResult com success, total, generated, kept, dimensions.
 */
export async function generateEmbeddingsForChunks(
  app: App,
  chunks: Chunk[],
  options: GenerateEmbeddingsOptions
): Promise<EmbeddingResult> {
  const adapter = app.vault.adapter;
  const indexFolder = normalizePath(".lina/index");
  const tempFilePath = normalizePath(`${indexFolder}/embeddings.tmp.jsonl`);
  const finalFilePath = normalizePath(`${indexFolder}/embeddings.jsonl`);

  const model = options.model;
  const provider = options.provider;

  // Determinar o que precisa de ser gerado
  let existingMap = new Map<string, EmbeddingRecord>();
  let keptRecords: EmbeddingRecord[] = [];
  let toGenerate: Chunk[] = chunks;

  if (options.incremental) {
    existingMap = await readExistingEmbeddings(app);
    const result = determineChunksToGenerate(chunks, existingMap, model, provider);
    toGenerate = result.toGenerate;
    keptRecords = result.validRecords;
  }

  const totalToGenerate = toGenerate.length;
  const totalChunks = chunks.length;

  // Se nao ha nada para gerar
  if (totalToGenerate === 0 && options.incremental) {
    const dim = keptRecords.length > 0 ? keptRecords[0].dimensions : 0;
    return { success: true, total: totalChunks, generated: 0, kept: keptRecords.length, dimensions: dim };
  }

  // Notificar progresso inicial
  if (options.onProgress) {
    options.onProgress({ current: 0, total: totalChunks });
  }

  const now = new Date().toISOString();
  const newRecords: EmbeddingRecord[] = [];

  for (let i = 0; i < totalToGenerate; i++) {
    if (options.abortSignal?.aborted) {
      console.warn("Geracao de embeddings abortada pelo utilizador");
      return { success: false, total: 0, generated: 0, kept: 0, dimensions: 0 };
    }

    const chunk = toGenerate[i];

  // Determinar modo de prefixo para este modelo
  const prefixMode = getPrefixModeForModel(model);

  // Construir texto enriquecido para o embedding
  // Usa título, caminho, bloco e conteúdo do chunk
  const enrichedInput = buildEmbeddingInput(chunk, prefixMode);

    const embedding = await generateSingleEmbedding(
      options.baseUrl,
      model,
      enrichedInput,
      options.timeoutMs
    );

    if (embedding === null) {
      console.error(`Embedding falhou para chunk ${chunk.chunkId} (${i + 1}/${totalToGenerate})`);
      return { success: false, total: 0, generated: 0, kept: 0, dimensions: 0 };
    }

    // Calcular hash sobre o texto enriquecido (apenas para validação, não guardar o texto)
    const embeddingInputHash = hashContent(enrichedInput);

    newRecords.push({
      chunkId: chunk.chunkId,
      path: chunk.path,
      index: chunk.chunkIndex,
      textHash: chunk.textHash,
      model,
      provider,
      dimensions: embedding.length,
      embedding,
      createdAt: now,
      embeddingInputHash,
    });

    if (options.onProgress) {
      options.onProgress({ current: keptRecords.length + i + 1, total: totalChunks });
    }
  }

  // Combinar registos mantidos + novos
  const allRecords = [...keptRecords, ...newRecords];

  // Ordenar por chunkId para consistencia
  allRecords.sort((a, b) => a.chunkId.localeCompare(b.chunkId));

  // Escrever ficheiro temporario
  const jsonlContent = allRecords.map((r) => JSON.stringify(r)).join("\n");
  try {
    await adapter.write(tempFilePath, jsonlContent);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Erro ao escrever ficheiro temporario de embeddings:", msg);
    return { success: false, total: 0, generated: 0, kept: 0, dimensions: 0 };
  }

  // Substituir ficheiro final pelo temporario
  try {
    const finalStat = await adapter.stat(finalFilePath);
    if (finalStat && finalStat.type === "file") {
      await adapter.remove(finalFilePath);
    }
    const tempContent = await adapter.read(tempFilePath);
    await adapter.write(finalFilePath, tempContent);
    await adapter.remove(tempFilePath);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Erro ao substituir ficheiro de embeddings:", msg);
    return { success: false, total: 0, generated: 0, kept: 0, dimensions: 0 };
  }

  const dim = allRecords.length > 0 ? allRecords[0].dimensions : 0;
  return {
    success: true,
    total: allRecords.length,
    generated: newRecords.length,
    kept: keptRecords.length,
    dimensions: dim,
  };
}

/**
 * Atualiza manifest.json com secao embeddings.
 * Inclui informacao sobre a estrategia de input enriquecido.
 */
export async function updateManifestWithEmbeddings(
  app: App,
  embeddingsCount: number,
  dimensions: number,
  model: string,
  provider: string
): Promise<boolean> {
  try {
    const adapter = app.vault.adapter;
    const manifestPath = normalizePath(".lina/index/manifest.json");

    const manifestStat = await adapter.stat(manifestPath);
    if (!manifestStat || manifestStat.type !== "file") {
      console.error("manifest.json nao encontrado");
      return false;
    }

    const content = await adapter.read(manifestPath);
    const manifest = JSON.parse(content) as Record<string, unknown>;

    const now = new Date().toISOString();

    manifest.embeddingsEnabled = true;
    manifest.embeddings = {
      enabled: true,
      provider,
      model,
      totalEmbeddings: embeddingsCount,
      dimensions,
      updatedAt: now,
      sourceTotalChunks: embeddingsCount,
    };

    // Adicionar informacao sobre a estrategia de input dos embeddings
    const prefixMode = getPrefixModeForModel(model);
    manifest.embeddingInput = {
      version: EMBEDDING_INPUT_VERSION,
      includesTitle: true,
      includesPath: true,
      includesChunkIndex: true,
      includesChunkText: true,
      prefixMode: prefixMode,
      usesSearchQueryPrefix: prefixMode === "nomic-search-query-document",
      usesSearchDocumentPrefix: prefixMode === "nomic-search-query-document",
    };

    await adapter.write(manifestPath, JSON.stringify(manifest, null, 2));
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Erro ao atualizar manifest.json com embeddings:", msg);
    return false;
  }
}

/**
 * Le estado detalhado dos embeddings lendo diretamente o ficheiro embeddings.jsonl
 * e chunks.jsonl, sem depender do manifesto que pode estar desatualizado.
 * Inclui validacao do embeddingInputHash para identificar embeddings desatualizados.
 */
export async function readEmbeddingStatus(app: App): Promise<{
  exists: boolean;
  totalEmbeddings: number;
  totalChunks: number;
  validCount: number;
  staleCount: number;
  missingCount: number;
  obsoleteCount: number;
  model: string;
  provider: string;
  dimensions: number;
  updatedAt: string;
  expectedPrefixMode?: EmbeddingPrefixMode;
  manifestPrefixMode?: EmbeddingPrefixMode;
  isPrefixModeMismatch?: boolean;
  prefixModeStaleCount?: number;
  error?: string;
} | null> {
  try {
    const adapter = app.vault.adapter;

    // Ler manifest para obter modelo/provider/data/prefixo se existir
    const manifestPath = normalizePath(".lina/index/manifest.json");
    let manifestModel = "";
    let manifestProvider = "";
    let manifestDimensions = 0;
    let manifestUpdatedAt = "";
    let manifestPrefixMode: EmbeddingPrefixMode = "none";
    let manifestHasEmbeddings = false;

    const manifestStat = await adapter.stat(manifestPath);
    if (manifestStat && manifestStat.type === "file") {
      try {
        const manifestContent = await adapter.read(manifestPath);
        const manifest = JSON.parse(manifestContent) as Record<string, unknown>;
        const emb = manifest.embeddings as Record<string, unknown> | undefined;
        if (emb && manifest.embeddingsEnabled) {
          manifestHasEmbeddings = true;
          manifestModel = (emb.model as string) ?? "";
          manifestProvider = (emb.provider as string) ?? "";
          manifestDimensions = (emb.dimensions as number) ?? 0;
          manifestUpdatedAt = (emb.updatedAt as string) ?? "";
        }

        // Ler modo de prefixo do manifesto
        const embeddingInput = manifest.embeddingInput as Record<string, unknown> | undefined;
        if (embeddingInput) {
          manifestPrefixMode = (embeddingInput.prefixMode as EmbeddingPrefixMode) ?? "none";
        }
      } catch {
        // ignorar
      }
    }

    // Ler chunks.jsonl
    const chunksPath = normalizePath(".lina/index/chunks.jsonl");
    let chunkIds = new Set<string>();
    let totalChunks = 0;
    try {
      const chunksStat = await adapter.stat(chunksPath);
      if (chunksStat && chunksStat.type === "file") {
        const content = await adapter.read(chunksPath);
        const lines = content.trim().split("\n").filter((l) => l.length > 0);
        totalChunks = lines.length;
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as { chunkId?: string };
            if (parsed.chunkId) {
              chunkIds.add(parsed.chunkId);
            }
          } catch {
            // ignorar linhas mal formatadas
          }
        }
      }
    } catch {
      // ignorar
    }

    // Ler embeddings.jsonl
    const embeddingsPath = normalizePath(".lina/index/embeddings.jsonl");
    let totalEmbeddings = 0;
    let validCount = 0;
    let staleCount = 0;
    let obsoleteCount = 0;
    let dims = 0;
    let model = manifestModel;
    let provider = manifestProvider;
    const seenChunkIds = new Set<string>();

    try {
      const embStat = await adapter.stat(embeddingsPath);
      if (embStat && embStat.type === "file") {
        const content = await adapter.read(embeddingsPath);
        const lines = content.trim().split("\n").filter((l) => l.length > 0);
        totalEmbeddings = lines.length;

        for (const line of lines) {
          try {
            const rec = JSON.parse(line) as EmbeddingRecord;
            if (!rec.chunkId) continue;

            // Verificar se o chunk ainda existe
            if (!chunkIds.has(rec.chunkId)) {
              obsoleteCount++;
              continue;
            }

            // Verificar validade do embedding
            const embeddingValido =
              Array.isArray(rec.embedding) &&
              rec.embedding.length > 0 &&
              rec.embedding.every((v: unknown) => typeof v === "number") &&
              rec.textHash &&
              rec.model &&
              rec.provider &&
              rec.dimensions === rec.embedding.length;

            if (embeddingValido) {
              // Verificar se o embedding tem embeddingInputHash (nova estratégia)
              if (!rec.embeddingInputHash) {
                staleCount++;
              } else {
                validCount++;
                seenChunkIds.add(rec.chunkId);
              }

              if (!model && rec.model) model = rec.model;
              if (!provider && rec.provider) provider = rec.provider;
              if (dims === 0 && rec.dimensions) dims = rec.dimensions;
            }
          } catch {
            // ignorar linhas mal formatadas
          }
        }
      }
    } catch {
      // ignorar
    }

    const missingCount = Math.max(0, totalChunks - validCount - staleCount);

    // Verificar se os embeddings estão desatualizados por alteração do modo de prefixo
    let prefixModeStaleCount = 0;
    const expectedPrefixMode = getPrefixModeForModel(model || manifestModel);

    // Se temos embeddings válidos mas o modo de prefixo mudou, marcar como desatualizados
    if (validCount > 0 && expectedPrefixMode !== manifestPrefixMode) {
      // Todos os embeddings válidos estão desatualizados por alteração do modo de prefixo
      prefixModeStaleCount = validCount;
      staleCount += prefixModeStaleCount;
      validCount = 0; // Não há embeddings válidos se o modo de prefixo mudou
    }

    return {
      exists: totalEmbeddings > 0,
      totalEmbeddings,
      totalChunks,
      validCount,
      staleCount,
      missingCount,
      obsoleteCount,
      model: model || manifestModel,
      provider: provider || manifestProvider,
      dimensions: dims || manifestDimensions,
      updatedAt: manifestUpdatedAt,
      expectedPrefixMode: expectedPrefixMode,
      manifestPrefixMode: manifestPrefixMode,
      isPrefixModeMismatch: expectedPrefixMode !== manifestPrefixMode,
      prefixModeStaleCount: prefixModeStaleCount,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      exists: false,
      totalEmbeddings: 0,
      totalChunks: 0,
      validCount: 0,
      staleCount: 0,
      missingCount: 0,
      obsoleteCount: 0,
      model: "",
      provider: "",
      dimensions: 0,
      updatedAt: "",
      error: msg,
    };
  }
}
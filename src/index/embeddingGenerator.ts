import { App } from "obsidian";
import { requestUrl, normalizePath } from "obsidian";
import { Chunk } from "./chunker";

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

/**
 * Confirma se um EmbeddingRecord e valido para um dado chunk e modelo.
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
  return true;
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
 * Le embeddings.jsonl existente e devolve mapa chunkId -> record.
 */
export async function readExistingEmbeddings(app: App): Promise<Map<string, EmbeddingRecord>> {
  const map = new Map<string, EmbeddingRecord>();
  try {
    const adapter = app.vault.adapter;
    const path = normalizePath(".lina/index/embeddings.jsonl");
    const stat = await adapter.stat(path);
    if (!stat || stat.type !== "file") return map;

    const content = await adapter.read(path);
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
    const embedding = await generateSingleEmbedding(
      options.baseUrl,
      model,
      chunk.text,
      options.timeoutMs
    );

    if (embedding === null) {
      console.error(`Embedding falhou para chunk ${chunk.chunkId} (${i + 1}/${totalToGenerate})`);
      return { success: false, total: 0, generated: 0, kept: 0, dimensions: 0 };
    }

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

    await adapter.write(manifestPath, JSON.stringify(manifest, null, 2));
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Erro ao atualizar manifest.json com embeddings:", msg);
    return false;
  }
}

/**
 * Le estado detalhado dos embeddings a partir do manifest e de chunks.jsonl.
 */
export async function readEmbeddingStatus(app: App): Promise<{
  exists: boolean;
  totalEmbeddings: number;
  totalChunks: number;
  staleCount: number;
  missingCount: number;
  model: string;
  provider: string;
  dimensions: number;
  updatedAt: string;
  error?: string;
} | null> {
  try {
    const adapter = app.vault.adapter;
    const manifestPath = normalizePath(".lina/index/manifest.json");

    const manifestStat = await adapter.stat(manifestPath);
    if (!manifestStat || manifestStat.type !== "file") {
      return null;
    }

    const manifestContent = await adapter.read(manifestPath);
    const manifest = JSON.parse(manifestContent) as Record<string, unknown>;
    const emb = manifest.embeddings as Record<string, unknown> | undefined;

    if (!emb || !manifest.embeddingsEnabled) {
      return null;
    }

    // Tentar ler chunks.jsonl para comparar total
    const chunksPath = normalizePath(".lina/index/chunks.jsonl");
    let totalChunks = (manifest.totalChunks as number) ?? 0;
    try {
      const chunksStat = await adapter.stat(chunksPath);
      if (chunksStat && chunksStat.type === "file") {
        const content = await adapter.read(chunksPath);
        const lines = content.trim().split("\n").filter((l) => l.length > 0);
        totalChunks = lines.length;
      }
    } catch {
      // ignorar
    }

    const totalEmbeddings = (emb.totalEmbeddings as number) ?? 0;
    const missingCount = Math.max(0, totalChunks - totalEmbeddings);
    const staleCount = 0; // simplificacao: nao ha stale sem ler todos os ficheiros

    return {
      exists: true,
      totalEmbeddings,
      totalChunks,
      staleCount,
      missingCount,
      model: (emb.model as string) ?? "",
      provider: (emb.provider as string) ?? "",
      dimensions: (emb.dimensions as number) ?? 0,
      updatedAt: (emb.updatedAt as string) ?? "",
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      exists: false,
      totalEmbeddings: 0,
      totalChunks: 0,
      staleCount: 0,
      missingCount: 0,
      model: "",
      provider: "",
      dimensions: 0,
      updatedAt: "",
      error: msg,
    };
  }
}
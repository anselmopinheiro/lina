import { App } from "obsidian";
import { normalizePath } from "obsidian";
import { generateProviderEmbedding } from "../ai/embeddingProvider";
import {
  EmbeddingErrorCategory,
  EmbeddingErrorScope,
  EmbeddingGenerationStatus,
  isValidEmbeddingVector,
  operationError
} from "../ai/embeddingTypes";
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
  /** URL base do provider, ex: http://localhost:11434 ou https://api.mistral.ai/v1 */
  baseUrl: string;
  /** Modelo de embeddings, ex: nomic-embed-text ou mistral-embed */
  model: string;
  provider: string;
  /** Chave API para providers remotos, quando necessaria */
  apiKey?: string;
  /** Timeout em ms por pedido */
  timeoutMs: number;
  /** Se true, só gera para chunks sem embedding válido ou desatualizado */
  incremental?: boolean;
  /** Callback de progresso */
  onProgress?: (progress: EmbeddingProgress, chunkText?: string) => void;
  /** Filtro defensivo para impedir embeddings de conteúdo excluído */
  shouldExcludeContent?: (content: string, path: string) => boolean;
  /** Sinal para abortar */
  abortSignal?: AbortSignal;
  onDiagnostic?: (details: EmbeddingGenerationDiagnosticEvent) => void;
}

export interface EmbeddingResult {
  success: boolean;
  total: number;
  generated: number;
  kept: number;
  failed: number;
  dimensions: number;
  /** Código HTTP quando o primeiro erro é de rede/API, para diagnóstico */
  errorStatus?: number;
  /** Provider que reportou o erro, para diagnóstico */
  errorProvider?: string;
  errorCategory?: EmbeddingErrorCategory;
  errorScope?: EmbeddingErrorScope;
  errorMessage?: string;
  requestCount?: number;
  validationCandidatesTested?: number;
  validationCandidateLimit?: number;
  fallbackUsed?: boolean;
  fallbackReason?: string;
  outcome?: "completed" | "completed-with-partial-failures" | "validation-failed" | "generation-failed";
}

export interface EmbeddingGenerationDiagnosticEvent {
  stage: "validation" | "generation";
  result: "started" | "succeeded" | "failed" | "skipped";
  provider: string;
  model: string;
  durationMs?: number;
  errorCategory?: EmbeddingErrorCategory;
  errorScope?: EmbeddingErrorScope;
  fatal?: boolean;
  candidateIndex?: number;
  totalCandidates?: number;
  candidatesTested?: number;
  dimensions?: number;
  fullGenerationStarted?: boolean;
  requestCount?: number;
  fallbackUsed?: boolean;
  fallbackReason?: string;
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
 * Gera embedding para um único texto via provider configurado.
 * Retorna o array de números ou null em caso de erro.
 */
export interface SingleEmbeddingResult {
  embedding: number[] | null;
  /** Código HTTP quando disponível, para diagnóstico de erros de API */
  status?: number;
  /** Mensagem de erro do provider */
  errorMessage?: string;
  errorCategory?: EmbeddingErrorCategory;
  errorScope?: EmbeddingErrorScope;
  fatal?: boolean;
  requestCount?: number;
}

export async function generateSingleEmbedding(
  baseUrl: string,
  model: string,
  input: string,
  timeoutMs: number,
  provider: string = "ollama",
  apiKey: string = ""
): Promise<SingleEmbeddingResult> {
  const status = await generateProviderEmbedding({
    provider,
    baseUrl,
    apiKey,
    model,
    input,
    timeoutMs,
  });

  if (!status.success || !status.embedding) {
    console.warn("Erro ao gerar embedding:", status.message);
    return {
      embedding: null,
      status: status.status,
      errorMessage: status.message,
      errorCategory: status.errorCategory,
      errorScope: status.errorScope,
      fatal: status.fatal,
      requestCount: status.requestCount,
    };
  }

  if (!isValidEmbeddingVector(status.embedding)) {
    return {
      embedding: null,
      status: status.status,
      errorMessage: "Embedding devolvido com vetor inválido.",
      errorCategory: "invalid-vector",
      errorScope: "operation",
      fatal: true,
      requestCount: status.requestCount,
    };
  }

  if (typeof status.dimension === "number" && status.dimension !== status.embedding.length) {
    return {
      embedding: null,
      status: status.status,
      errorMessage: "Dimensão de embedding incompatível com o vetor devolvido.",
      errorCategory: "dimension-mismatch",
      errorScope: "operation",
      fatal: true,
      requestCount: status.requestCount,
    };
  }

  return { embedding: status.embedding, requestCount: status.requestCount };
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
  if (!isValidEmbeddingVector(record.embedding)) return false;

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

const SUPPORTED_EMBEDDING_PROVIDERS = new Set(["ollama", "mistral"]);

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function buildFailureResult(
  total: number,
  kept: number,
  failed: number,
  status: EmbeddingGenerationStatus,
  outcome: "validation-failed" | "generation-failed",
  generated: number = 0,
  dimensions: number = 0
): EmbeddingResult {
  return {
    success: false,
    total,
    generated,
    kept,
    failed,
    dimensions,
    errorStatus: status.status,
    errorProvider: status.provider,
    errorCategory: status.errorCategory ?? "unknown",
    errorScope: status.errorScope ?? "operation",
    errorMessage: status.message,
    requestCount: status.requestCount ?? 0,
    fallbackUsed: status.fallbackUsed,
    fallbackReason: status.fallbackReason,
    outcome,
  };
}

const MAX_VALIDATION_CANDIDATES = 3;

function validateEmbeddingGenerationConfig(options: GenerateEmbeddingsOptions): EmbeddingGenerationStatus | null {
  const provider = options.provider.toLowerCase();
  if (!SUPPORTED_EMBEDDING_PROVIDERS.has(provider)) {
    return operationError("unsupported-provider", `Provider de embeddings "${options.provider}" ainda não é suportado para geração persistente.`, {
      provider: options.provider,
      requestCount: 0,
    });
  }

  if (!options.model.trim()) {
    return operationError("configuration", "Modelo de embeddings não configurado.", {
      provider,
      requestCount: 0,
    });
  }

  if (!options.baseUrl.trim()) {
    return operationError("configuration", "URL base de embeddings não configurada.", {
      provider,
      requestCount: 0,
    });
  }

  if (!isValidHttpUrl(options.baseUrl)) {
    return operationError("configuration", "URL base de embeddings inválida.", {
      provider,
      requestCount: 0,
    });
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    return operationError("configuration", "Timeout de embeddings inválido.", {
      provider,
      requestCount: 0,
    });
  }

  if (provider === "mistral" && !options.apiKey?.trim()) {
    return operationError("configuration", "Chave API da Mistral em falta. Define uma chave local nas definições do Lina.", {
      provider,
      requestCount: 0,
    });
  }

  return null;
}

function selectEmbeddingValidationCandidates(chunks: Chunk[]): Chunk[] {
  return [...chunks]
    .sort((a, b) => {
      const pathOrder = a.path.localeCompare(b.path);
      if (pathOrder !== 0) return pathOrder;
      if (a.chunkIndex !== b.chunkIndex) return a.chunkIndex - b.chunkIndex;
      return a.chunkId.localeCompare(b.chunkId);
    })
    .slice(0, MAX_VALIDATION_CANDIDATES);
}

async function validateEmbeddingProviderCandidate(
  chunk: Chunk,
  options: GenerateEmbeddingsOptions
): Promise<EmbeddingGenerationStatus> {
  const prefixMode = getPrefixModeForModel(options.model);
  const input = buildEmbeddingInput(chunk, prefixMode);
  const status = await generateProviderEmbedding({
    provider: options.provider,
    baseUrl: options.baseUrl,
    apiKey: options.apiKey ?? "",
    model: options.model,
    input,
    timeoutMs: options.timeoutMs,
  });

  if (!status.success) {
    return {
      ...status,
      errorCategory: status.errorCategory ?? "unknown",
      errorScope: status.errorScope ?? "operation",
      fatal: status.fatal ?? true,
    };
  }

  if (!isValidEmbeddingVector(status.embedding)) {
    return operationError("invalid-vector", "A resposta do provider não contém um vetor de embeddings válido.", {
      provider: status.provider ?? options.provider,
      endpoint: status.endpoint,
      status: status.status,
      apiMessage: status.apiMessage,
      requestCount: status.requestCount,
    });
  }

  if (typeof status.dimension === "number" && status.dimension !== status.embedding.length) {
    return operationError("dimension-mismatch", "A dimensão reportada pelo provider não coincide com o tamanho do vetor.", {
      provider: status.provider ?? options.provider,
      endpoint: status.endpoint,
      status: status.status,
      apiMessage: status.apiMessage,
      requestCount: status.requestCount,
    });
  }

  return {
    ...status,
    dimension: status.embedding.length,
    provider: status.provider ?? options.provider,
    requestCount: status.requestCount ?? 1,
  };
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
  const safeChunks = options.shouldExcludeContent
    ? chunks.filter((chunk) => !options.shouldExcludeContent?.(chunk.text, chunk.path))
    : chunks;

  // Determinar o que precisa de ser gerado
  let existingMap = new Map<string, EmbeddingRecord>();
  let keptRecords: EmbeddingRecord[] = [];
  let toGenerate: Chunk[] = safeChunks;

  if (options.incremental) {
    existingMap = await readExistingEmbeddings(app);
    const result = determineChunksToGenerate(safeChunks, existingMap, model, provider);
    toGenerate = result.toGenerate;
    keptRecords = result.validRecords;
  }

  const totalToGenerate = toGenerate.length;
  const totalChunks = safeChunks.length;

  const configError = validateEmbeddingGenerationConfig(options);
  if (configError) {
    options.onDiagnostic?.({
      stage: "validation",
      result: "failed",
      provider,
      model,
      errorCategory: configError.errorCategory,
      fullGenerationStarted: false,
      requestCount: configError.requestCount ?? 0,
    });
    return buildFailureResult(totalChunks, keptRecords.length, totalToGenerate, configError, "validation-failed");
  }

  // Se nao ha nada para gerar
  if (totalToGenerate === 0 && options.incremental) {
    const dim = keptRecords.length > 0 ? keptRecords[0].dimensions : 0;
    options.onDiagnostic?.({
      stage: "validation",
      result: "skipped",
      provider,
      model,
      fullGenerationStarted: false,
      requestCount: 0,
    });
    return { success: true, total: totalChunks, generated: 0, kept: keptRecords.length, failed: 0, dimensions: dim, outcome: "completed" };
  }

  if (totalToGenerate === 0) {
    const noChunksError = operationError("configuration", "Não existem chunks elegíveis para gerar embeddings.", {
      provider,
      requestCount: 0,
    });
    options.onDiagnostic?.({
      stage: "validation",
      result: "failed",
      provider,
      model,
      errorCategory: noChunksError.errorCategory,
      fullGenerationStarted: false,
      requestCount: 0,
    });
    return buildFailureResult(totalChunks, keptRecords.length, 0, noChunksError, "validation-failed");
  }

  const validationStartedAt = Date.now();
  const validationCandidates = selectEmbeddingValidationCandidates(toGenerate);
  options.onDiagnostic?.({
    stage: "validation",
    result: "started",
    provider,
    model,
    fullGenerationStarted: false,
    requestCount: 0,
    totalCandidates: validationCandidates.length,
  });
  let totalRequestCount = 0;
  let validationStatus: EmbeddingGenerationStatus | null = null;
  let candidatesTested = 0;
  let lastInputRejection: EmbeddingGenerationStatus | null = null;

  for (let candidateIndex = 0; candidateIndex < validationCandidates.length; candidateIndex++) {
    const candidateStatus = await validateEmbeddingProviderCandidate(validationCandidates[candidateIndex], options);
    candidatesTested = candidateIndex + 1;
    totalRequestCount += candidateStatus.requestCount ?? 0;

    if (candidateStatus.success) {
      validationStatus = {
        ...candidateStatus,
        requestCount: totalRequestCount,
      };
      options.onDiagnostic?.({
        stage: "validation",
        result: "succeeded",
        provider,
        model,
        durationMs: Date.now() - validationStartedAt,
        candidateIndex: candidatesTested,
        totalCandidates: validationCandidates.length,
        candidatesTested,
        dimensions: validationStatus.dimension,
        fullGenerationStarted: true,
        requestCount: totalRequestCount,
        fallbackUsed: validationStatus.fallbackUsed,
        fallbackReason: validationStatus.fallbackReason,
      });
      break;
    }

    const normalizedStatus: EmbeddingGenerationStatus = {
      ...candidateStatus,
      errorCategory: candidateStatus.errorCategory ?? "unknown",
      errorScope: candidateStatus.errorScope ?? "operation",
      fatal: candidateStatus.fatal ?? true,
      requestCount: totalRequestCount,
    };
    const isInputSpecificRejection = normalizedStatus.errorScope === "input" && normalizedStatus.fatal === false;
    options.onDiagnostic?.({
      stage: "validation",
      result: "failed",
      provider,
      model,
      durationMs: Date.now() - validationStartedAt,
      errorCategory: normalizedStatus.errorCategory,
      errorScope: normalizedStatus.errorScope,
      fatal: normalizedStatus.fatal,
      candidateIndex: candidatesTested,
      totalCandidates: validationCandidates.length,
      candidatesTested,
      fullGenerationStarted: false,
      requestCount: totalRequestCount,
      fallbackUsed: normalizedStatus.fallbackUsed,
      fallbackReason: normalizedStatus.fallbackReason,
    });

    if (!isInputSpecificRejection) {
      return {
        ...buildFailureResult(totalChunks, keptRecords.length, totalToGenerate, normalizedStatus, "validation-failed"),
        validationCandidatesTested: candidatesTested,
        validationCandidateLimit: MAX_VALIDATION_CANDIDATES,
        requestCount: totalRequestCount,
      };
    }

    lastInputRejection = normalizedStatus;
  }

  if (!validationStatus) {
    const rejectionStatus: EmbeddingGenerationStatus = {
      ...(lastInputRejection ?? operationError("input-rejected", "Os candidatos de validação foram rejeitados pelo provider por razões específicas do input.", {
        provider,
        requestCount: totalRequestCount,
      })),
      success: false,
      message: "Os candidatos de validação foram rejeitados pelo provider por razões específicas do input.",
      errorCategory: lastInputRejection?.errorCategory ?? "input-rejected",
      errorScope: "input",
      fatal: false,
      requestCount: totalRequestCount,
    };
    return {
      ...buildFailureResult(totalChunks, keptRecords.length, totalToGenerate, rejectionStatus, "validation-failed"),
      validationCandidatesTested: candidatesTested,
      validationCandidateLimit: MAX_VALIDATION_CANDIDATES,
      requestCount: totalRequestCount,
    };
  }
  const expectedDimensions = validationStatus.dimension ?? 0;
  options.onDiagnostic?.({
    stage: "generation",
    result: "started",
    provider,
    model,
    fullGenerationStarted: true,
    requestCount: totalRequestCount,
    dimensions: expectedDimensions,
    candidatesTested,
  });

  // Notificar progresso inicial
  if (options.onProgress) {
    options.onProgress({ current: 0, total: totalChunks });
  }

  const now = new Date().toISOString();
  const newRecords: EmbeddingRecord[] = [];

  let failedCount = 0;
  let firstErrorStatus: number | undefined;
  let firstErrorProvider: string | undefined;

  for (let i = 0; i < totalToGenerate; i++) {
    if (options.abortSignal?.aborted) {
      console.warn("Geracao de embeddings abortada pelo utilizador");
      // Guardar progresso parcial antes de abortar
      try {
        const partialRecords = [...keptRecords, ...newRecords];
        const partialContent = partialRecords.map((r) => JSON.stringify(r)).join("\n");
        await adapter.write(tempFilePath, partialContent);
        const finalStat = await adapter.stat(finalFilePath);
        if (finalStat && finalStat.type === "file") {
          await adapter.remove(finalFilePath);
        }
        const tempContent = await adapter.read(tempFilePath);
        await adapter.write(finalFilePath, tempContent);
        await adapter.remove(tempFilePath);
      } catch {
        // ignorar erro ao guardar progresso parcial durante abort
      }
      return { success: false, total: 0, generated: 0, kept: 0, failed: 0, dimensions: 0 };
    }

    const chunk = toGenerate[i];

    // Determinar modo de prefixo para este modelo
    const prefixMode = getPrefixModeForModel(model);

    // Construir texto enriquecido para o embedding
    // Usa título, caminho, bloco e conteúdo do chunk
    const enrichedInput = buildEmbeddingInput(chunk, prefixMode);

    const singleResult = await generateSingleEmbedding(
      options.baseUrl,
      model,
      enrichedInput,
      options.timeoutMs,
      provider,
      options.apiKey ?? ""
    );

    if (singleResult.embedding === null) {
      totalRequestCount += singleResult.requestCount ?? 0;
      failedCount++;
      if (!firstErrorStatus && singleResult.status) {
        firstErrorStatus = singleResult.status;
        firstErrorProvider = provider;
      }
      console.error(`Embedding falhou para chunk ${chunk.chunkId} (${i + 1}/${totalToGenerate}), status: ${singleResult.status ?? "N/A"}`);

      // Em caso de erro 429 (rate limit) ou 401/403, parar imediatamente para não agravar
      const isFatalOperationError = singleResult.fatal !== false || singleResult.errorScope !== "input";
      if (isFatalOperationError) {
        // Guardar progresso parcial antes de parar
        try {
          const partialRecords = [...keptRecords, ...newRecords];
          const partialContent = partialRecords.map((r) => JSON.stringify(r)).join("\n");
          await adapter.write(tempFilePath, partialContent);
          const finalStat = await adapter.stat(finalFilePath);
          if (finalStat && finalStat.type === "file") {
            await adapter.remove(finalFilePath);
          }
          const tempContent = await adapter.read(tempFilePath);
          await adapter.write(finalFilePath, tempContent);
          await adapter.remove(tempFilePath);
        } catch {
          // se nao conseguirmos guardar parcialmente, continuar com o erro
        }
        const partialCombined = [...keptRecords, ...newRecords];
        const generationError = operationError(singleResult.errorCategory ?? "unknown", singleResult.errorMessage ?? "Erro ao gerar embedding.", {
          provider: firstErrorProvider ?? provider,
          status: firstErrorStatus,
          errorScope: singleResult.errorScope ?? "operation",
          fatal: true,
          requestCount: totalRequestCount,
        });
        options.onDiagnostic?.({
          stage: "generation",
          result: "failed",
          provider,
          model,
          errorCategory: generationError.errorCategory,
          fullGenerationStarted: true,
          requestCount: totalRequestCount,
        });
        return {
          success: false,
          total: totalChunks,
          generated: newRecords.length,
          kept: keptRecords.length,
          failed: failedCount + (totalToGenerate - i - 1), // contar restantes como falhados também
          dimensions: partialCombined.length > 0 ? partialCombined[0].dimensions : 0,
          errorStatus: firstErrorStatus,
          errorProvider: firstErrorProvider,
          errorCategory: generationError.errorCategory,
          errorScope: generationError.errorScope,
          errorMessage: generationError.message,
          requestCount: totalRequestCount,
          validationCandidatesTested: candidatesTested,
          validationCandidateLimit: MAX_VALIDATION_CANDIDATES,
          outcome: "generation-failed",
        };
      }
      // Para outros erros, continuar a tentar os chunks seguintes
      continue;
    }

    if (expectedDimensions > 0 && singleResult.embedding.length !== expectedDimensions) {
      totalRequestCount += singleResult.requestCount ?? 0;
      failedCount++;
      console.error(`Embedding falhou para chunk ${chunk.chunkId} (${i + 1}/${totalToGenerate}): dimensão incompatível.`);

      try {
        const partialRecords = [...keptRecords, ...newRecords];
        const partialContent = partialRecords.map((r) => JSON.stringify(r)).join("\n");
        await adapter.write(tempFilePath, partialContent);
        const finalStat = await adapter.stat(finalFilePath);
        if (finalStat && finalStat.type === "file") {
          await adapter.remove(finalFilePath);
        }
        const tempContent = await adapter.read(tempFilePath);
        await adapter.write(finalFilePath, tempContent);
        await adapter.remove(tempFilePath);
      } catch {
        // se nao conseguirmos guardar parcialmente, continuar com o erro
      }

      const dimensionError = operationError("dimension-mismatch", "A dimensão do embedding gerado não coincide com a dimensão validada inicialmente.", {
        provider,
        errorScope: "operation",
        fatal: true,
        requestCount: totalRequestCount,
      });
      options.onDiagnostic?.({
        stage: "generation",
        result: "failed",
        provider,
        model,
        errorCategory: dimensionError.errorCategory,
        errorScope: dimensionError.errorScope,
        fatal: dimensionError.fatal,
        fullGenerationStarted: true,
        requestCount: totalRequestCount,
        dimensions: expectedDimensions,
      });

      return {
        success: false,
        total: totalChunks,
        generated: newRecords.length,
        kept: keptRecords.length,
        failed: failedCount + (totalToGenerate - i - 1),
        dimensions: newRecords.length > 0 ? newRecords[0].dimensions : 0,
        errorCategory: dimensionError.errorCategory,
        errorScope: dimensionError.errorScope,
        errorMessage: dimensionError.message,
        requestCount: totalRequestCount,
        validationCandidatesTested: candidatesTested,
        validationCandidateLimit: MAX_VALIDATION_CANDIDATES,
        outcome: "generation-failed",
      };
    }

    // Calcular hash sobre o texto enriquecido (apenas para validação, não guardar o texto)
    const embeddingInputHash = hashContent(enrichedInput);
    totalRequestCount += singleResult.requestCount ?? 0;

    newRecords.push({
      chunkId: chunk.chunkId,
      path: chunk.path,
      index: chunk.chunkIndex,
      textHash: chunk.textHash,
      model,
      provider,
      dimensions: singleResult.embedding.length,
      embedding: singleResult.embedding,
      createdAt: now,
      embeddingInputHash,
    });

    if (options.onProgress) {
      options.onProgress({ current: keptRecords.length + newRecords.length, total: totalChunks });
    }
  }

  // Combinar registos mantidos + novos
  const allRecords = [...keptRecords, ...newRecords];

  // Ordenar por chunkId para consistencia
  allRecords.sort((a, b) => a.chunkId.localeCompare(b.chunkId));

  // Escrever ficheiro temporario
  try {
    const jsonlContent = allRecords.map((r) => JSON.stringify(r)).join("\n");
    await adapter.write(tempFilePath, jsonlContent);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Erro ao escrever ficheiro temporario de embeddings:", msg);
    return { success: false, total: 0, generated: 0, kept: 0, failed: 0, dimensions: 0 };
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
    return { success: false, total: 0, generated: 0, kept: 0, failed: 0, dimensions: 0 };
  }

  const dim = allRecords.length > 0 ? allRecords[0].dimensions : 0;
  options.onDiagnostic?.({
    stage: "generation",
    result: "succeeded",
    provider,
    model,
    fullGenerationStarted: true,
    requestCount: totalRequestCount,
  });
  return {
    success: true,
    total: allRecords.length,
    generated: newRecords.length,
    kept: keptRecords.length,
    failed: failedCount,
    dimensions: dim,
    requestCount: totalRequestCount,
    validationCandidatesTested: candidatesTested,
    validationCandidateLimit: MAX_VALIDATION_CANDIDATES,
    fallbackUsed: validationStatus.fallbackUsed,
    fallbackReason: validationStatus.fallbackReason,
    outcome: failedCount > 0 ? "completed-with-partial-failures" : "completed",
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

    const manifestStat = await adapter.stat(manifestPath);
    if (manifestStat && manifestStat.type === "file") {
      try {
        const manifestContent = await adapter.read(manifestPath);
        const manifest = JSON.parse(manifestContent) as Record<string, unknown>;
        const emb = manifest.embeddings as Record<string, unknown> | undefined;
        if (emb && manifest.embeddingsEnabled) {
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
              isValidEmbeddingVector(rec.embedding) &&
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

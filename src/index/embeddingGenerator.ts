import { App } from "obsidian";
import { normalizePath } from "obsidian";
import { generateProviderEmbedding, generateProviderEmbeddings } from "../ai/embeddingProvider";
import {
  EmbeddingEndpointMode,
  EmbeddingErrorCategory,
  EmbeddingErrorScope,
  EmbeddingGenerationStatus,
  isValidEmbeddingVector,
  operationError
} from "../ai/embeddingTypes";
import { Chunk } from "./chunker";
import { hashContent } from "./noteHasher";
import { readIndexedChunks } from "./indexStore";
import {
  calculateEmbeddingState,
  EmbeddingStateSummary,
  filterEmbeddingRecordsForSearch,
  NextGenerationEmbeddingIdentity,
  PublishedEmbeddingIdentity,
} from "./embeddingState";
import {
  EMBEDDING_CHECKPOINT_SCHEMA_VERSION,
  EmbeddingCheckpointMetadata,
  EmbeddingPersistenceDiagnostic,
  EmbeddingRecord,
  loadEmbeddingCheckpoint,
  publishCanonicalEmbeddings,
  recoverEmbeddingPersistenceArtifacts,
  readRecoverableEmbeddingCheckpointRecords,
  removeEmbeddingCheckpoint,
  writeEmbeddingCheckpoint,
} from "./embeddingPersistence";
import { EmbeddingResourceProfile, evaluateEmbeddingBridgeRead } from "./embeddingResourceGuard";
import { getDeviceCapabilities } from "../capabilities/deviceCapabilities";

function defaultEmbeddingResourceProfile(): EmbeddingResourceProfile {
  return getDeviceCapabilities().resourceProfile;
}
import {
  calculateEmbeddingUpdatePlan,
  EmbeddingUpdatePlan,
  EmbeddingUpdatePlanPreview,
  EmbeddingUpdatePlanReason,
  summarizeEmbeddingUpdatePlan,
} from "./embeddingUpdatePlan";

export type { EmbeddingRecord } from "./embeddingPersistence";

export interface EmbeddingProgress {
  totalChunks: number;
  processedChunks: number;
  generatedChunks: number;
  failedChunks: number;
  reusedChunks: number;
  currentChunk?: number;
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
  /** Número máximo de inputs por pedido nativo durante a geração persistente. */
  batchSize?: number;
  /** Se true, só gera para chunks sem embedding válido ou desatualizado */
  incremental?: boolean;
  /** Callback de progresso */
  onProgress?: (progress: EmbeddingProgress, chunkText?: string) => void;
  /** Filtro defensivo para impedir embeddings de conteúdo excluído */
  shouldExcludeContent?: (content: string, path: string) => boolean;
  /** Sinal para abortar */
  abortSignal?: AbortSignal;
  /** Chamado quando a escrita persistente entra no ponto de não-retorno cooperativo. */
  onPersisting?: () => void;
  /** Identificador central guardado apenas no sidecar interno do checkpoint. */
  operationId?: string;
  onDiagnostic?: (details: EmbeddingGenerationDiagnosticEvent) => void;
}

export interface EmbeddingResult {
  success: boolean;
  /** Canonical publication that completed this generation, when one occurred. */
  publicationId?: string;
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
  outcome?: "completed" | "completed-with-partial-failures" | "validation-failed" | "generation-failed" | "cancelled";
}

export interface EmbeddingProviderGenerationDiagnosticEvent {
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
  endpoint?: string;
  configuredBatchSize?: number;
  effectiveBatchSize?: number;
  batchNumber?: number;
  totalBatches?: number;
  inputCount?: number;
  subdivisionDepth?: number;
  subdivisionReason?: string;
}

export type EmbeddingGenerationDiagnosticEvent =
  | EmbeddingProviderGenerationDiagnosticEvent
  | EmbeddingPersistenceDiagnostic;

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
 * O embeddingInputHash tem de corresponder ao input enriquecido atual;
 * valores ausentes ou obsoletos são regenerados.
 */
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
    if (!evaluateEmbeddingBridgeRead(stat.size, defaultEmbeddingResourceProfile()).allowed) return map;
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

export async function readCanonicalEmbeddingRecords(app: App, resourceProfile: EmbeddingResourceProfile = defaultEmbeddingResourceProfile()): Promise<unknown[]> {
  const adapter = app.vault.adapter;
  const embeddingsPath = normalizePath(".lina/index/embeddings.jsonl");
  try {
    const stat = await adapter.stat(embeddingsPath);
    if (!stat || stat.type !== "file") return [];
    if (!evaluateEmbeddingBridgeRead(stat.size, resourceProfile).allowed) return [];
    const content = await adapter.read(embeddingsPath);
    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return undefined;
        }
      });
  } catch {
    return [];
  }
}

async function readCanonicalEmbeddingFileState(app: App, resourceProfile: EmbeddingResourceProfile = defaultEmbeddingResourceProfile()): Promise<{ exists: boolean; records: unknown[] }> {
  const adapter = app.vault.adapter;
  const embeddingsPath = normalizePath(".lina/index/embeddings.jsonl");
  try {
    const stat = await adapter.stat(embeddingsPath);
    if (!stat || stat.type !== "file") return { exists: false, records: [] };
    if (!evaluateEmbeddingBridgeRead(stat.size, resourceProfile).allowed) return { exists: true, records: [] };
    return { exists: true, records: await readCanonicalEmbeddingRecords(app, resourceProfile) };
  } catch {
    return { exists: false, records: [] };
  }
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
  const state = calculateEmbeddingState({
    chunks,
    canonicalRecords: [...existingMap.values()],
    publishedIdentity: {},
    nextGenerationIdentity: getNextGenerationEmbeddingIdentity(provider, model),
    buildInput: buildEmbeddingInput,
    hashInput: hashContent,
  });
  const validRecords = [...existingMap.values()].filter((record) => state.reusableForNextGenerationChunkIds.has(record.chunkId));
  const toGenerate = chunks.filter((chunk) => !state.reusableForNextGenerationChunkIds.has(chunk.chunkId));

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

function buildCancelledResult(
  total: number,
  kept: number,
  generated: number,
  failed: number,
  dimensions: number,
  requestCount: number,
  candidatesTested?: number
): EmbeddingResult {
  return {
    success: false,
    total,
    generated,
    kept,
    failed,
    dimensions,
    requestCount,
    validationCandidatesTested: candidatesTested,
    validationCandidateLimit: MAX_VALIDATION_CANDIDATES,
    outcome: "cancelled",
  };
}

function isEmbeddingGenerationCancelled(options: GenerateEmbeddingsOptions): boolean {
  return options.abortSignal?.aborted === true;
}

function emitEmbeddingProgress(
  options: GenerateEmbeddingsOptions,
  progress: EmbeddingProgress
): void {
  options.onProgress?.({
    totalChunks: progress.totalChunks,
    processedChunks: Math.min(Math.max(0, progress.processedChunks), Math.max(0, progress.totalChunks)),
    generatedChunks: Math.max(0, progress.generatedChunks),
    failedChunks: Math.max(0, progress.failedChunks),
    reusedChunks: Math.max(0, progress.reusedChunks),
    currentChunk: progress.currentChunk,
  });
}

const MAX_VALIDATION_CANDIDATES = 3;
export const MAX_EMBEDDING_BATCH_SIZE = 50;

export function normalizeEmbeddingBatchSize(value: unknown, fallback: number = 10): number {
  const fallbackValue = Number.isFinite(fallback) ? Math.trunc(fallback) : 10;
  const numericValue = typeof value === "number" ? value : Number(value);
  const integerValue = Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallbackValue;
  return Math.min(MAX_EMBEDDING_BATCH_SIZE, Math.max(1, integerValue));
}

interface PreparedEmbeddingInput {
  chunk: Chunk;
  input: string;
}

interface ResolvedEmbeddingInput {
  item: PreparedEmbeddingInput;
  embedding: number[] | null;
  error?: EmbeddingGenerationStatus;
}

interface EmbeddingBatchProcessingResult {
  resolved: ResolvedEmbeddingInput[];
  requestCount: number;
  fatalStatus?: EmbeddingGenerationStatus;
  cancelled?: boolean;
}

interface EmbeddingBatchProcessingContext {
  options: GenerateEmbeddingsOptions;
  endpointMode: EmbeddingEndpointMode;
  expectedDimensions: number;
  batchNumber: number;
  totalBatches: number;
  configuredBatchSize: number;
  effectiveBatchSize: number;
  onResolved: (resolved: ResolvedEmbeddingInput[]) => Promise<void>;
  shouldStop: () => boolean;
}

async function processEmbeddingBatchSequentially(
  items: PreparedEmbeddingInput[],
  context: EmbeddingBatchProcessingContext,
  subdivisionDepth: number = 0
): Promise<EmbeddingBatchProcessingResult> {
  if (isEmbeddingGenerationCancelled(context.options) || context.shouldStop()) {
    return { resolved: [], requestCount: 0, cancelled: true };
  }

  const startedAt = Date.now();
  context.options.onDiagnostic?.({
    stage: "generation",
    result: "started",
    provider: context.options.provider,
    model: context.options.model,
    configuredBatchSize: context.configuredBatchSize,
    effectiveBatchSize: context.effectiveBatchSize,
    batchNumber: context.batchNumber,
    totalBatches: context.totalBatches,
    inputCount: items.length,
    subdivisionDepth,
    requestCount: 0,
  });

  if (isEmbeddingGenerationCancelled(context.options)) {
    return { resolved: [], requestCount: 0, cancelled: true };
  }

  const status = await generateProviderEmbeddings({
    provider: context.options.provider,
    baseUrl: context.options.baseUrl,
    apiKey: context.options.apiKey ?? "",
    model: context.options.model,
    inputs: items.map((item) => item.input),
    timeoutMs: context.options.timeoutMs,
    signal: context.options.abortSignal,
    endpointMode: context.endpointMode,
  });
  const requestCount = status.requestCount ?? 0;

  if (status.success) {
    const embeddings = status.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== items.length) {
      return {
        resolved: [],
        requestCount,
        fatalStatus: operationError("invalid-response", "O provider devolveu um número de embeddings diferente do número de inputs.", {
          provider: status.provider ?? context.options.provider,
          endpoint: status.endpoint,
          status: status.status,
          requestCount,
        }),
      };
    }

    for (const embedding of embeddings) {
      if (!isValidEmbeddingVector(embedding)) {
        return {
          resolved: [],
          requestCount,
          fatalStatus: operationError("invalid-vector", "O provider devolveu um vetor de embeddings inválido.", {
            provider: status.provider ?? context.options.provider,
            endpoint: status.endpoint,
            status: status.status,
            requestCount,
          }),
        };
      }
      if (context.expectedDimensions > 0 && embedding.length !== context.expectedDimensions) {
        return {
          resolved: [],
          requestCount,
          fatalStatus: operationError("dimension-mismatch", "A dimensão de um embedding do lote não coincide com a dimensão validada inicialmente.", {
            provider: status.provider ?? context.options.provider,
            endpoint: status.endpoint,
            status: status.status,
            requestCount,
          }),
        };
      }
    }

    const resolved = items.map((item, index) => ({ item, embedding: embeddings[index] }));
    await context.onResolved(resolved);
    context.options.onDiagnostic?.({
      stage: "generation",
      result: "succeeded",
      provider: context.options.provider,
      model: context.options.model,
      endpoint: status.endpoint,
      durationMs: Date.now() - startedAt,
      configuredBatchSize: context.configuredBatchSize,
      effectiveBatchSize: context.effectiveBatchSize,
      batchNumber: context.batchNumber,
      totalBatches: context.totalBatches,
      inputCount: items.length,
      subdivisionDepth,
      requestCount,
    });
    return {
      resolved,
      requestCount,
      cancelled: isEmbeddingGenerationCancelled(context.options),
    };
  }

  if (isEmbeddingGenerationCancelled(context.options)) {
    return { resolved: [], requestCount, cancelled: true };
  }

  const inputSpecificFailure = status.errorScope === "input" && status.fatal === false;
  if (!inputSpecificFailure) {
    context.options.onDiagnostic?.({
      stage: "generation",
      result: "failed",
      provider: context.options.provider,
      model: context.options.model,
      endpoint: status.endpoint,
      durationMs: Date.now() - startedAt,
      errorCategory: status.errorCategory,
      errorScope: status.errorScope,
      fatal: status.fatal,
      configuredBatchSize: context.configuredBatchSize,
      effectiveBatchSize: context.effectiveBatchSize,
      batchNumber: context.batchNumber,
      totalBatches: context.totalBatches,
      inputCount: items.length,
      subdivisionDepth,
      requestCount,
    });
    return { resolved: [], requestCount, fatalStatus: status };
  }

  if (items.length === 1) {
    const resolved = [{ item: items[0], embedding: null, error: status }];
    await context.onResolved(resolved);
    return {
      resolved,
      requestCount,
    };
  }

  if (isEmbeddingGenerationCancelled(context.options)) {
    return { resolved: [], requestCount, cancelled: true };
  }

  context.options.onDiagnostic?.({
    stage: "generation",
    result: "failed",
    provider: context.options.provider,
    model: context.options.model,
    endpoint: status.endpoint,
    durationMs: Date.now() - startedAt,
    errorCategory: status.errorCategory,
    errorScope: status.errorScope,
    fatal: status.fatal,
    configuredBatchSize: context.configuredBatchSize,
    effectiveBatchSize: context.effectiveBatchSize,
    batchNumber: context.batchNumber,
    totalBatches: context.totalBatches,
    inputCount: items.length,
    subdivisionDepth,
    subdivisionReason: status.errorCategory ?? "input-rejected",
    requestCount,
  });

  const midpoint = Math.floor(items.length / 2);
  const left = await processEmbeddingBatchSequentially(items.slice(0, midpoint), context, subdivisionDepth + 1);
  const leftRequestCount = requestCount + left.requestCount;
  if (left.cancelled || left.fatalStatus || context.shouldStop()) {
    return { ...left, requestCount: leftRequestCount };
  }

  if (isEmbeddingGenerationCancelled(context.options)) {
    return { resolved: left.resolved, requestCount: leftRequestCount, cancelled: true };
  }

  const right = await processEmbeddingBatchSequentially(items.slice(midpoint), context, subdivisionDepth + 1);
  return {
    resolved: [...left.resolved, ...right.resolved],
    requestCount: leftRequestCount + right.requestCount,
    fatalStatus: right.fatalStatus,
    cancelled: right.cancelled,
  };
}

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

export function getEmbeddingInputFormatVersion(model: string): string {
  return `${EMBEDDING_INPUT_VERSION}:${getPrefixModeForModel(model)}`;
}

export function getNextGenerationEmbeddingIdentity(
  provider: string,
  model: string,
  dimensions?: number
): NextGenerationEmbeddingIdentity {
  return {
    provider,
    model,
    dimensions,
    inputVersion: EMBEDDING_INPUT_VERSION,
    prefixMode: getPrefixModeForModel(model),
  };
}

function hasCompletePublishedIdentity(identity: PublishedEmbeddingIdentity): identity is Required<PublishedEmbeddingIdentity> {
  return typeof identity.provider === "string"
    && identity.provider.trim().length > 0
    && typeof identity.model === "string"
    && identity.model.trim().length > 0
    && typeof identity.dimensions === "number"
    && Number.isInteger(identity.dimensions)
    && identity.dimensions > 0
    && typeof identity.inputVersion === "number"
    && Number.isInteger(identity.inputVersion)
    && identity.inputVersion > 0
    && (identity.prefixMode === "none" || identity.prefixMode === "nomic-search-query-document");
}

function resolvePreValidationTargetIdentity(
  provider: string,
  model: string,
  publishedIdentity: PublishedEmbeddingIdentity,
  checkpointDimension?: number
): NextGenerationEmbeddingIdentity {
  const target = getNextGenerationEmbeddingIdentity(provider, model);
  if (
    hasCompletePublishedIdentity(publishedIdentity)
    && publishedIdentity.provider === target.provider
    && publishedIdentity.model === target.model
    && publishedIdentity.inputVersion === target.inputVersion
    && publishedIdentity.prefixMode === target.prefixMode
  ) {
    return { ...target, dimensions: publishedIdentity.dimensions };
  }

  if (typeof checkpointDimension === "number" && Number.isInteger(checkpointDimension) && checkpointDimension > 0) {
    return { ...target, dimensions: checkpointDimension };
  }

  return target;
}

function formatEmbeddingPlanMode(plan: EmbeddingUpdatePlan): string {
  if (plan.mode === "incremental") return "Atualizacao incremental";
  if (plan.mode === "initial-build") return "Construcao inicial";
  return "Reconstrucao completa";
}

function describeEmbeddingPlanReason(reasons: readonly EmbeddingUpdatePlanReason[]): string {
  if (reasons.includes("provider-changed")) return "o provider de embeddings mudou";
  if (reasons.includes("model-changed")) return "o modelo de embeddings mudou";
  if (reasons.includes("dimension-changed")) return "a dimensao dos embeddings mudou";
  if (reasons.includes("input-version-changed")) return "o formato de input dos embeddings mudou";
  if (reasons.includes("prefix-mode-changed")) return "o modo de prefixo dos embeddings mudou";
  if (reasons.includes("published-identity-incomplete")) return "o manifesto publicado nao prova compatibilidade";
  if (reasons.includes("canonical-identity-mixed")) return "o indice canonico contem identidades misturadas";
  if (reasons.includes("canonical-record-identity-mismatch")) return "o canonico nao coincide com a identidade publicada";
  if (reasons.includes("canonical-missing") || reasons.includes("canonical-empty")) return "ainda nao existe indice canonico de embeddings";
  return "identidade alvo resolvida";
}

function emitEmbeddingPlanDiagnostic(
  options: GenerateEmbeddingsOptions,
  plan: EmbeddingUpdatePlan,
  provider: string,
  model: string
): void {
  options.onDiagnostic?.({
    stage: "generation",
    result: "skipped",
    provider,
    model,
    subdivisionReason: [
      formatEmbeddingPlanMode(plan),
      describeEmbeddingPlanReason(plan.reasons),
      `${plan.toGenerateCount} to generate`,
      `${plan.reusableCanonicalCount + plan.recoverableCheckpointCount} reused`,
      `${plan.obsoleteToDropCount} obsolete`,
    ].join("; "),
    requestCount: 0,
  });
}

async function publishPlannedEmbeddingRecords(
  app: App,
  plan: EmbeddingUpdatePlan,
  provider: string,
  model: string,
  prefixMode: EmbeddingPrefixMode,
  options: GenerateEmbeddingsOptions,
  requestCount: number,
  candidatesTested?: number,
  generated: number = 0,
  failed: number = 0
): Promise<EmbeddingResult> {
  const dim = plan.recordsToPublish[0]?.dimensions ?? plan.targetIdentity.dimensions ?? 0;
  options.onPersisting?.();
  const publication = await publishCanonicalEmbeddings(app, plan.recordsToPublish, {
    provider,
    model,
    dimensions: dim,
    inputVersion: EMBEDDING_INPUT_VERSION,
    prefixMode,
  }, options.onDiagnostic);

  if (!publication.success) {
    return {
      success: false,
      total: plan.totalChunks,
      generated,
      kept: plan.reusableCanonicalCount + plan.recoverableCheckpointCount,
      failed: Math.max(failed, plan.toGenerateCount - generated),
      dimensions: dim,
      errorCategory: "unknown",
      errorScope: "operation",
      errorMessage: publication.error ?? "Nao foi possivel publicar o indice canonico de embeddings.",
      requestCount,
      validationCandidatesTested: candidatesTested,
      validationCandidateLimit: MAX_VALIDATION_CANDIDATES,
      outcome: "generation-failed",
    };
  }

  return {
    success: true,
    publicationId: publication.publicationId,
    total: plan.recordsToPublish.length,
    generated,
    kept: plan.reusableCanonicalCount + plan.recoverableCheckpointCount,
    failed,
    dimensions: dim,
    requestCount,
    validationCandidatesTested: candidatesTested,
    validationCandidateLimit: candidatesTested === undefined ? undefined : MAX_VALIDATION_CANDIDATES,
    outcome: failed > 0 ? "completed-with-partial-failures" : "completed",
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
  const model = options.model;
  const provider = options.provider;
  const inputFormatVersion = getEmbeddingInputFormatVersion(model);
  const configuredBatchSize = normalizeEmbeddingBatchSize(options.batchSize, 1);
  if (isEmbeddingGenerationCancelled(options)) {
    return buildCancelledResult(0, 0, 0, 0, 0, 0);
  }

  const safeChunks = options.shouldExcludeContent
    ? chunks.filter((chunk) => !options.shouldExcludeContent?.(chunk.text, chunk.path))
    : chunks;

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
    return buildFailureResult(totalChunks, 0, totalChunks, configError, "validation-failed");
  }

  await recoverEmbeddingPersistenceArtifacts(app, options.onDiagnostic);
  const manifestValue = await readEmbeddingManifest(app);
  const { identity: publishedIdentity } = parsePublishedEmbeddingIdentity(manifestValue);
  const canonicalFile = await readCanonicalEmbeddingFileState(app);
  const checkpointLoad = await loadEmbeddingCheckpoint(app, {
    provider,
    model,
    inputFormatVersion,
  }, options.onDiagnostic);
  const checkpointRecordsForPlan = checkpointLoad.status === "available" ? checkpointLoad.records : [];
  const preliminaryTargetIdentity = resolvePreValidationTargetIdentity(
    provider,
    model,
    publishedIdentity,
    checkpointLoad.status === "available" ? checkpointLoad.metadata.dimension : undefined
  );
  let plan = calculateEmbeddingUpdatePlan({
    chunks: safeChunks,
    canonicalRecords: options.incremental ? canonicalFile.records : [],
    canonicalExists: options.incremental ? canonicalFile.exists : false,
    checkpointRecords: checkpointRecordsForPlan,
    publishedIdentity: options.incremental ? publishedIdentity : {},
    targetIdentity: preliminaryTargetIdentity,
    buildInput: buildEmbeddingInput,
    hashInput: hashContent,
  });
  let keptRecords = [...plan.reusableCanonicalRecords, ...plan.recoverableCheckpointRecords];
  let checkpointRecords = plan.recoverableCheckpointRecords;
  let toGenerate = plan.chunksToGenerate;
  let totalToGenerate = toGenerate.length;

  emitEmbeddingProgress(options, {
    totalChunks,
    processedChunks: keptRecords.length,
    generatedChunks: 0,
    failedChunks: 0,
    reusedChunks: keptRecords.length,
  });

  if (isEmbeddingGenerationCancelled(options)) {
    return buildCancelledResult(totalChunks, keptRecords.length, 0, 0, keptRecords[0]?.dimensions ?? 0, 0);
  }

  // Se nao ha nada para gerar
  if (totalToGenerate === 0 && plan.requiresPublication) {
    emitEmbeddingPlanDiagnostic(options, plan, provider, model);
    options.onDiagnostic?.({
      stage: "validation",
      result: "skipped",
      provider,
      model,
      fullGenerationStarted: false,
      requestCount: 0,
    });
    return await publishPlannedEmbeddingRecords(
      app,
      plan,
      provider,
      model,
      preliminaryTargetIdentity.prefixMode,
      options,
      0
    );
  }

  if (totalToGenerate === 0 && options.incremental) {
    const dim = keptRecords.length > 0 ? keptRecords[0].dimensions : preliminaryTargetIdentity.dimensions ?? 0;
    emitEmbeddingPlanDiagnostic(options, plan, provider, model);
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
    configuredBatchSize,
  });
  let totalRequestCount = 0;
  let validationStatus: EmbeddingGenerationStatus | null = null;
  let candidatesTested = 0;
  let lastInputRejection: EmbeddingGenerationStatus | null = null;

  for (let candidateIndex = 0; candidateIndex < validationCandidates.length; candidateIndex++) {
    if (isEmbeddingGenerationCancelled(options)) {
      return buildCancelledResult(totalChunks, keptRecords.length, 0, 0, keptRecords[0]?.dimensions ?? 0, totalRequestCount, candidatesTested);
    }

    const candidateStatus = await validateEmbeddingProviderCandidate(validationCandidates[candidateIndex], options);
    candidatesTested = candidateIndex + 1;
    totalRequestCount += candidateStatus.requestCount ?? 0;

    if (isEmbeddingGenerationCancelled(options)) {
      return buildCancelledResult(totalChunks, keptRecords.length, 0, 0, candidateStatus.dimension ?? keptRecords[0]?.dimensions ?? 0, totalRequestCount, candidatesTested);
    }

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
  let checkpointCreatedAt = new Date().toISOString();
  if (checkpointLoad.status === "available") {
    checkpointCreatedAt = checkpointLoad.metadata.createdAt;
    if (checkpointLoad.metadata.dimension !== expectedDimensions) {
      await removeEmbeddingCheckpoint(app, options.onDiagnostic);
      options.onDiagnostic?.({
        stage: "checkpoint",
        result: "skipped",
        reason: "dimension-mismatch",
        records: checkpointLoad.records.length,
        ignoredRecords: checkpointLoad.records.length,
      });
    }
  }

  const targetIdentity = getNextGenerationEmbeddingIdentity(provider, model, expectedDimensions);
  plan = calculateEmbeddingUpdatePlan({
    chunks: safeChunks,
    canonicalRecords: options.incremental ? canonicalFile.records : [],
    canonicalExists: options.incremental ? canonicalFile.exists : false,
    checkpointRecords: checkpointLoad.status === "available" && checkpointLoad.metadata.dimension === expectedDimensions
      ? checkpointLoad.records
      : [],
    publishedIdentity: options.incremental ? publishedIdentity : {},
    targetIdentity,
    buildInput: buildEmbeddingInput,
    hashInput: hashContent,
  });
  keptRecords = [...plan.reusableCanonicalRecords, ...plan.recoverableCheckpointRecords];
  checkpointRecords = plan.recoverableCheckpointRecords;
  toGenerate = plan.chunksToGenerate;
  totalToGenerate = toGenerate.length;
  emitEmbeddingPlanDiagnostic(options, plan, provider, model);

  if (checkpointLoad.status === "available" && checkpointLoad.metadata.dimension === expectedDimensions) {
    options.onDiagnostic?.({
      stage: "checkpoint",
      result: "succeeded",
      reason: "record-compatibility-checked",
      records: checkpointLoad.records.length,
      reusedRecords: checkpointRecords.length,
      ignoredRecords: checkpointLoad.records.length - checkpointRecords.length,
    });
  }

  if (isEmbeddingGenerationCancelled(options)) {
    return buildCancelledResult(totalChunks, keptRecords.length, 0, 0, expectedDimensions, totalRequestCount, candidatesTested);
  }

  if (totalToGenerate === 0) {
    return await publishPlannedEmbeddingRecords(
      app,
      plan,
      provider,
      model,
      targetIdentity.prefixMode,
      options,
      totalRequestCount,
      candidatesTested
    );
  }

  const endpointMode: EmbeddingEndpointMode = provider.toLowerCase() === "ollama" && (
    validationStatus.endpointMode === "legacy-single" || validationStatus.fallbackUsed === true
  )
    ? "legacy-single"
    : "native-batch";
  const effectiveBatchSize = endpointMode === "legacy-single" ? 1 : configuredBatchSize;
  const totalBatches = Math.ceil(totalToGenerate / effectiveBatchSize);

  options.onDiagnostic?.({
    stage: "generation",
    result: "started",
    provider,
    model,
    fullGenerationStarted: true,
    requestCount: totalRequestCount,
    dimensions: expectedDimensions,
    candidatesTested,
    endpoint: validationStatus.endpoint,
    configuredBatchSize,
    effectiveBatchSize,
    totalBatches,
  });

  // Notificar progresso inicial da fase de geração, sem contar a validação como chunk processado.
  emitEmbeddingProgress(options, {
    totalChunks,
    processedChunks: keptRecords.length,
    generatedChunks: 0,
    failedChunks: 0,
    reusedChunks: keptRecords.length,
  });

  const now = new Date().toISOString();
  const newRecords: EmbeddingRecord[] = [];

  let failedCount = 0;
  const prefixMode = getPrefixModeForModel(model);
  let checkpointWriteError: string | null = null;
  let checkpointMetadata: EmbeddingCheckpointMetadata = {
    schemaVersion: EMBEDDING_CHECKPOINT_SCHEMA_VERSION,
    operationId: options.operationId ?? `embedding-${Date.now()}`,
    createdAt: checkpointCreatedAt,
    updatedAt: checkpointCreatedAt,
    provider,
    model,
    dimension: expectedDimensions,
    inputFormatVersion,
    completedRecords: checkpointRecords.length,
  };

  const persistResolvedInputs = async (resolvedInputs: ResolvedEmbeddingInput[]): Promise<void> => {
    const generatedRecords = resolvedInputs
      .filter((resolved): resolved is ResolvedEmbeddingInput & { embedding: number[] } => resolved.embedding !== null)
      .map((resolved) => ({
        chunkId: resolved.item.chunk.chunkId,
        path: resolved.item.chunk.path,
        index: resolved.item.chunk.chunkIndex,
        textHash: resolved.item.chunk.textHash,
        model,
        provider,
        dimensions: resolved.embedding.length,
        embedding: resolved.embedding,
        createdAt: now,
        embeddingInputHash: hashContent(resolved.item.input),
      }));

    if (generatedRecords.length > 0) {
      try {
        checkpointMetadata = await writeEmbeddingCheckpoint(
          app,
          checkpointMetadata,
          [...checkpointRecords, ...newRecords, ...generatedRecords],
          options.onDiagnostic
        );
      } catch (error) {
        checkpointWriteError = error instanceof Error ? error.message : String(error);
        return;
      }
    }

    let generatedIndex = 0;
    for (const resolved of resolvedInputs) {
      if (resolved.embedding === null) {
        failedCount++;
      } else {
        newRecords.push(generatedRecords[generatedIndex]);
        generatedIndex++;
      }

      emitEmbeddingProgress(options, {
        totalChunks,
        processedChunks: keptRecords.length + newRecords.length + failedCount,
        generatedChunks: newRecords.length,
        failedChunks: failedCount,
        reusedChunks: keptRecords.length,
        currentChunk: keptRecords.length + newRecords.length + failedCount,
      });
    }
  };

  for (let offset = 0; offset < totalToGenerate; offset += effectiveBatchSize) {
    if (isEmbeddingGenerationCancelled(options)) {
      console.warn("Geracao de embeddings cancelada pelo utilizador");
      return buildCancelledResult(totalChunks, keptRecords.length, newRecords.length, failedCount, expectedDimensions, totalRequestCount, candidatesTested);
    }

    const batchNumber = Math.floor(offset / effectiveBatchSize) + 1;
    const batchItems = toGenerate
      .slice(offset, offset + effectiveBatchSize)
      .map((chunk) => ({
        chunk,
        input: buildEmbeddingInput(chunk, prefixMode),
      }));

    if (isEmbeddingGenerationCancelled(options)) {
      return buildCancelledResult(totalChunks, keptRecords.length, newRecords.length, failedCount, expectedDimensions, totalRequestCount, candidatesTested);
    }

    const batchResult = await processEmbeddingBatchSequentially(batchItems, {
      options,
      endpointMode,
      expectedDimensions,
      batchNumber,
      totalBatches,
      configuredBatchSize,
      effectiveBatchSize,
      onResolved: persistResolvedInputs,
      shouldStop: () => checkpointWriteError !== null,
    });
    totalRequestCount += batchResult.requestCount;

    if (checkpointWriteError !== null) {
      if (isEmbeddingGenerationCancelled(options)) {
        return buildCancelledResult(
          totalChunks,
          keptRecords.length,
          newRecords.length,
          failedCount,
          expectedDimensions,
          totalRequestCount,
          candidatesTested
        );
      }
      const checkpointError = operationError("unknown", `Não foi possível guardar o checkpoint de embeddings: ${String(checkpointWriteError)}`, {
        provider,
        requestCount: totalRequestCount,
      });
      return {
        ...buildFailureResult(
          totalChunks,
          keptRecords.length,
          Math.max(0, totalToGenerate - newRecords.length),
          checkpointError,
          "generation-failed",
          newRecords.length,
          expectedDimensions
        ),
        validationCandidatesTested: candidatesTested,
        validationCandidateLimit: MAX_VALIDATION_CANDIDATES,
      };
    }

    if (batchResult.cancelled || isEmbeddingGenerationCancelled(options)) {
      return buildCancelledResult(totalChunks, keptRecords.length, newRecords.length, failedCount, expectedDimensions, totalRequestCount, candidatesTested);
    }

    if (batchResult.fatalStatus) {
      const generationError: EmbeddingGenerationStatus = {
        ...batchResult.fatalStatus,
        errorCategory: batchResult.fatalStatus.errorCategory ?? "unknown",
        errorScope: batchResult.fatalStatus.errorScope ?? "operation",
        fatal: true,
        requestCount: totalRequestCount,
      };
      options.onDiagnostic?.({
        stage: "generation",
        result: "failed",
        provider,
        model,
        endpoint: generationError.endpoint,
        errorCategory: generationError.errorCategory,
        errorScope: generationError.errorScope,
        fatal: true,
        fullGenerationStarted: true,
        requestCount: totalRequestCount,
        configuredBatchSize,
        effectiveBatchSize,
        batchNumber,
        totalBatches,
      });
      return {
        success: false,
        total: totalChunks,
        generated: newRecords.length,
        kept: keptRecords.length,
        failed: totalToGenerate - newRecords.length,
        dimensions: newRecords[0]?.dimensions ?? keptRecords[0]?.dimensions ?? 0,
        errorStatus: generationError.status,
        errorProvider: generationError.provider ?? provider,
        errorCategory: generationError.errorCategory,
        errorScope: generationError.errorScope,
        errorMessage: generationError.message,
        requestCount: totalRequestCount,
        validationCandidatesTested: candidatesTested,
        validationCandidateLimit: MAX_VALIDATION_CANDIDATES,
        outcome: "generation-failed",
      };
    }
  }

  if (isEmbeddingGenerationCancelled(options)) {
    return buildCancelledResult(totalChunks, keptRecords.length, newRecords.length, failedCount, expectedDimensions, totalRequestCount, candidatesTested);
  }

  options.onPersisting?.();

  // Combinar registos mantidos + novos
  const allRecords = [...keptRecords, ...newRecords];
  const dim = allRecords.length > 0 ? allRecords[0].dimensions : 0;
  const publication = await publishCanonicalEmbeddings(app, allRecords, {
    provider,
    model,
    dimensions: dim,
    inputVersion: EMBEDDING_INPUT_VERSION,
    prefixMode,
  }, options.onDiagnostic);
  if (!publication.success) {
    return {
      success: false,
      total: totalChunks,
      generated: newRecords.length,
      kept: keptRecords.length,
      failed: Math.max(failedCount, totalToGenerate - newRecords.length),
      dimensions: dim,
      errorCategory: "unknown",
      errorScope: "operation",
      errorMessage: publication.error ?? "Não foi possível publicar o índice canónico de embeddings.",
      requestCount: totalRequestCount,
      validationCandidatesTested: candidatesTested,
      validationCandidateLimit: MAX_VALIDATION_CANDIDATES,
      fallbackUsed: validationStatus.fallbackUsed,
      fallbackReason: validationStatus.fallbackReason,
      outcome: "generation-failed",
    };
  }

  options.onDiagnostic?.({
    stage: "generation",
    result: "succeeded",
    provider,
    model,
    fullGenerationStarted: true,
    requestCount: totalRequestCount,
    configuredBatchSize,
    effectiveBatchSize,
    totalBatches,
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
 * Le estado detalhado dos embeddings lendo diretamente o ficheiro embeddings.jsonl
 * e chunks.jsonl, sem depender do manifesto que pode estar desatualizado.
 * Inclui validacao do embeddingInputHash para identificar embeddings desatualizados.
 */

export interface ReadEmbeddingStatusOptions {
  nextGenerationIdentity?: NextGenerationEmbeddingIdentity;
  operationActive?: boolean;
  currentChunks?: readonly Chunk[];
  resourceProfile?: EmbeddingResourceProfile;
}

export interface ReadEmbeddingUpdatePreviewOptions {
  provider: string;
  model: string;
  incremental?: boolean;
  currentChunks?: readonly Chunk[];
}

export interface EmbeddingIndexStatus extends EmbeddingStateSummary {
  exists: boolean;
  totalEmbeddings: number;
  model: string;
  provider: string;
  dimensions: number;
  updatedAt: string;
  publishedIdentity: PublishedEmbeddingIdentity;
  validForSearchChunkIds: ReadonlySet<string>;
  expectedPrefixMode?: EmbeddingPrefixMode;
  manifestPrefixMode?: EmbeddingPrefixMode;
  isPrefixModeMismatch?: boolean;
  detailsAvailable?: boolean;
  resourceLimitCode?: string;
  error?: string;
}

export async function readEmbeddingUpdatePreview(
  app: App,
  options: ReadEmbeddingUpdatePreviewOptions
): Promise<EmbeddingUpdatePlanPreview> {
  const provider = options.provider;
  const model = options.model;
  const inputFormatVersion = getEmbeddingInputFormatVersion(model);
  const manifestValue = await readEmbeddingManifest(app);
  const { identity: publishedIdentity } = parsePublishedEmbeddingIdentity(manifestValue);
  const chunks = options.currentChunks ? [...options.currentChunks] : await readIndexedChunks(app) ?? [];
  const canonicalFile = await readCanonicalEmbeddingFileState(app);
  const checkpointRecords = await readRecoverableEmbeddingCheckpointRecords(app, {
    provider,
    model,
    inputFormatVersion,
  });
  const checkpointDimension = checkpointRecords.find((record) => Number.isInteger(record.dimensions) && record.dimensions > 0)?.dimensions;
  const targetIdentity = resolvePreValidationTargetIdentity(provider, model, publishedIdentity, checkpointDimension);
  const incremental = options.incremental ?? true;
  const plan = calculateEmbeddingUpdatePlan({
    chunks,
    canonicalRecords: incremental ? canonicalFile.records : [],
    canonicalExists: incremental ? canonicalFile.exists : false,
    checkpointRecords,
    publishedIdentity: incremental ? publishedIdentity : {},
    targetIdentity,
    buildInput: buildEmbeddingInput,
    hashInput: hashContent,
  });

  return summarizeEmbeddingUpdatePlan(plan);
}

async function readEmbeddingManifest(app: App): Promise<unknown> {
  try {
    const adapter = app.vault.adapter;
    const manifestPath = normalizePath(".lina/index/manifest.json");
    const manifestStat = await adapter.stat(manifestPath);
    if (manifestStat?.type === "file") {
      return JSON.parse(await adapter.read(manifestPath)) as unknown;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parsePublishedEmbeddingIdentity(manifest: unknown): { identity: PublishedEmbeddingIdentity; updatedAt: string } {
  if (!isObject(manifest) || manifest.embeddingsEnabled !== true || !isObject(manifest.embeddings)) {
    return { identity: {}, updatedAt: "" };
  }

  const embeddings = manifest.embeddings;
  const input = isObject(manifest.embeddingInput) ? manifest.embeddingInput : {};
  return {
    identity: {
      provider: typeof embeddings.provider === "string" ? embeddings.provider : undefined,
      model: typeof embeddings.model === "string" ? embeddings.model : undefined,
      dimensions: typeof embeddings.dimensions === "number" ? embeddings.dimensions : undefined,
      inputVersion: typeof input.version === "number" ? input.version : undefined,
      prefixMode: input.prefixMode === "none" || input.prefixMode === "nomic-search-query-document"
        ? input.prefixMode
        : undefined,
    },
    updatedAt: typeof embeddings.updatedAt === "string" ? embeddings.updatedAt : "",
  };
}

export async function readEmbeddingStatus(
  app: App,
  options: ReadEmbeddingStatusOptions = {}
): Promise<EmbeddingIndexStatus | null> {
  try {
    const adapter = app.vault.adapter;
    let manifestValue: unknown;
    try {
      const manifestPath = normalizePath(".lina/index/manifest.json");
      const manifestStat = await adapter.stat(manifestPath);
      if (manifestStat?.type === "file") manifestValue = JSON.parse(await adapter.read(manifestPath)) as unknown;
    } catch {
      manifestValue = undefined;
    }

    const { identity: publishedIdentity, updatedAt } = parsePublishedEmbeddingIdentity(manifestValue);
    const resourceProfile = options.resourceProfile ?? defaultEmbeddingResourceProfile();
    const embeddingsPath = normalizePath(".lina/index/embeddings.jsonl");
    const embeddingsStat = await adapter.stat(embeddingsPath);
    if (embeddingsStat?.type === "file") {
      const bridgeDecision = evaluateEmbeddingBridgeRead(embeddingsStat.size, resourceProfile);
      if (!bridgeDecision.allowed) {
        return {
          exists: true,
          totalEmbeddings: 0,
          totalChunks: 0,
          totalCanonicalRecords: 0,
          validCount: 0,
          missingCount: 0,
          staleCount: 0,
          obsoleteCount: 0,
          validForSearchCount: 0,
          reusableForNextGenerationCount: 0,
          recoverableCheckpointCount: 0,
          operationActive: options.operationActive ?? false,
          duplicateRecordCount: 0,
          invalidRecordCount: 0,
          model: publishedIdentity.model ?? "",
          provider: publishedIdentity.provider ?? "",
          dimensions: publishedIdentity.dimensions ?? 0,
          updatedAt,
          publishedIdentity,
          validForSearchChunkIds: new Set(),
          expectedPrefixMode: options.nextGenerationIdentity?.prefixMode,
          manifestPrefixMode: publishedIdentity.prefixMode,
          isPrefixModeMismatch: false,
          detailsAvailable: false,
          resourceLimitCode: bridgeDecision.code,
          error: bridgeDecision.code,
        };
      }
    }
    const chunks = options.currentChunks ? [...options.currentChunks] : await readIndexedChunks(app) ?? [];
    const canonicalRecords = await readCanonicalEmbeddingRecords(app, resourceProfile);
    const nextGenerationIdentity = options.nextGenerationIdentity;
    const checkpointRecords = nextGenerationIdentity
      ? await readRecoverableEmbeddingCheckpointRecords(app, {
          provider: nextGenerationIdentity.provider,
          model: nextGenerationIdentity.model,
          dimension: nextGenerationIdentity.dimensions,
          inputFormatVersion: `${nextGenerationIdentity.inputVersion}:${nextGenerationIdentity.prefixMode}`,
        })
      : [];
    const recoverableCheckpointCount = nextGenerationIdentity
      ? calculateEmbeddingState({
          chunks,
          canonicalRecords: checkpointRecords,
          publishedIdentity: {},
          nextGenerationIdentity,
          buildInput: buildEmbeddingInput,
          hashInput: hashContent,
        }).summary.reusableForNextGenerationCount
      : 0;
    const state = calculateEmbeddingState({
      chunks,
      canonicalRecords,
      publishedIdentity,
      nextGenerationIdentity,
      recoverableCheckpointCount,
      operationActive: options.operationActive,
      buildInput: buildEmbeddingInput,
      hashInput: hashContent,
    });
    const expectedPrefixMode = nextGenerationIdentity?.prefixMode;
    const manifestPrefixMode = publishedIdentity.prefixMode;

    return {
      ...state.summary,
      exists: canonicalRecords.length > 0,
      totalEmbeddings: state.summary.totalCanonicalRecords,
      model: publishedIdentity.model ?? "",
      provider: publishedIdentity.provider ?? "",
      dimensions: publishedIdentity.dimensions ?? 0,
      updatedAt,
      publishedIdentity,
      validForSearchChunkIds: state.validForSearchChunkIds,
      expectedPrefixMode,
      manifestPrefixMode,
      isPrefixModeMismatch: !!expectedPrefixMode && !!manifestPrefixMode && expectedPrefixMode !== manifestPrefixMode,
      detailsAvailable: true,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      exists: false,
      totalEmbeddings: 0,
      totalChunks: 0,
      totalCanonicalRecords: 0,
      validCount: 0,
      missingCount: 0,
      staleCount: 0,
      obsoleteCount: 0,
      validForSearchCount: 0,
      reusableForNextGenerationCount: 0,
      recoverableCheckpointCount: 0,
      operationActive: options.operationActive ?? false,
      duplicateRecordCount: 0,
      invalidRecordCount: 0,
      model: "",
      provider: "",
      dimensions: 0,
      updatedAt: "",
      publishedIdentity: {},
      validForSearchChunkIds: new Set(),
      detailsAvailable: false,
      error: msg,
    };
  }
}

export function filterSearchableEmbeddingRecords(
  records: readonly EmbeddingRecord[],
  status: Pick<EmbeddingIndexStatus, "validForSearchChunkIds">
): EmbeddingRecord[] {
  return filterEmbeddingRecordsForSearch(records, status.validForSearchChunkIds);
}

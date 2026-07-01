import { ItemView, Modal, Notice, TFile, TFolder, WorkspaceLeaf, normalizePath } from "obsidian";
import LinaPlugin from "../../main";
import { Chunk } from "../index/chunker";
import { EmbeddingRecord, readEmbeddingStatus, getPrefixModeForModel, applyEmbeddingPrefix } from "../index/embeddingGenerator";
import { readIndexedChunks, readIndexedNotes, readTextIndexStatus } from "../index/indexStore";
import { getSemanticSearchAvailability, runHybridSearch, type HybridSearchResult } from "./hybridSearch";
import { searchSemanticIndex } from "./semanticSearch";
import { searchTextIndex } from "./textSearch";
import { generateOllamaText, generateOllamaEmbedding } from "../ai/ollamaProvider";
import { generateMistralText } from "../ai/mistralProvider";
import {
  getLocalAnalysisProvider,
  getLocalAnalysisModel,
  getLocalAnalysisBaseUrl,
  getLocalAnalysisApiKey,
  getLocalAnalysisTimeout,
  getLocalEmbeddingsProvider,
  getLocalEmbeddingsModel
} from "../settings";
import { getStrings, UiStrings } from "../i18n/strings";
import { parseMultilineSetting, shouldExcludeContent, shouldExcludePath } from "../index/indexExclusions";

export const LINA_SEARCH_VIEW_TYPE = "lina-search-view";

/**
 * Interface para notas relacionadas usadas no contexto de análise.
 */
interface RelatedNote {
  title: string;
  path: string;
  snippet: string;
  score?: number;
  baseScore?: number;
  source?: HybridSearchResult["source"];
  textOrigin?: HybridSearchResult["textOrigin"];
  textScore?: number;
  semanticScore?: number;
  folderRelation?: "same-folder" | "same-root" | "different-folder";
}

// ---------------------------------------------------------------------------
// Interfaces para análise estruturada (Fase 5A)
// ---------------------------------------------------------------------------

/**
 * Link interno estruturado sugerido pela IA.
 */
interface StructuredInternalLink {
  path: string;
  reason: string;
}

/**
 * Resultado estruturado da análise da IA.
 */
interface StructuredAnalysisResult {
  summary: string;
  suggestedTitle?: string;
  noteType?: string;
  mainTopic?: string;
  suggestedFolder?: string;
  yaml?: Record<string, string | string[]>;
  tags?: string[];
  internalLinks?: StructuredInternalLink[];
  tasks?: string[];
  analysis?: string;
  confidence?: string;
  limitations?: string;
}

type SuggestedYaml = NonNullable<StructuredAnalysisResult["yaml"]>;

type SelectableKind = "yaml" | "tag" | "task" | "analysis" | "title" | "rename-file" | "move" | "ai-link" | "related-link";
type PreservedMetadataKind = "yaml" | "tag";
type AnalysisScope = "single-note" | "batch";

interface RenderedSelectableItem {
  id: string;
  kind: SelectableKind;
  label: string;
  value: string;
  path?: string;
  title?: string;
  reason?: string;
  description?: string;
}

interface PreservedMetadataItem {
  id: string;
  kind: PreservedMetadataKind;
  label: string;
  value: string;
}

interface SelectableSectionItem {
  id: string;
  label: string;
  kind?: SelectableKind;
  value?: string;
  path?: string;
  title?: string;
  reason?: string;
  description?: string;
}

interface SelectedAnalysisLink {
  kind: "ai-link" | "related-link";
  path: string;
  title: string;
  reason?: string;
}

interface ExistingVaultTag {
  original: string;
  normalized: string;
  count: number;
}

interface FolderMoveResolution {
  rawSuggestedFolder: string;
  resolvedFolderPath: string | null;
  currentFolderPath: string;
  finalTargetPath: string | null;
  exists: boolean;
  isInbox: boolean;
  isCurrentFolder: boolean;
  hasCollision: boolean;
  isValid: boolean;
  canMove: boolean;
  reason: string;
}

interface InboxNoteAnalysisResult {
  file: TFile;
  result?: StructuredAnalysisResult;
  error?: string;
  warning?: string;
}

interface FolderMarkdownNotesOptions {
  includeSubfolders: boolean;
  maxNotes: number;
  sortBy?: "mtime" | "name";
}

interface FolderMarkdownNotesResult {
  folder: TFolder;
  notes: TFile[];
  totalFound: number;
  totalEligible: number;
  totalExcludedByPath: number;
  totalTruncated: number;
}

// ---------------------------------------------------------------------------

type SearchMode = "hibrida" | "textual" | "semantica";

const MAX_NOTES_DISPLAY = 20;
const RAW_REQUEST_MULTIPLIER = 3; // pedir mais resultados brutos para compensar agrupamento

const SECCAO_TAREFAS = "## Tarefas sugeridas pelo Lina";
const SECCAO_ANALISE = "## Análise Lina";

async function loadEmbeddings(view: LinaSearchView): Promise<EmbeddingRecord[] | null> {
  try {
    const adapter = view.app.vault.adapter;
    const path = normalizePath(".lina/index/embeddings.jsonl");
    const stat = await adapter.stat(path);
    if (!stat || stat.type !== "file") {
      return null;
    }

    const content = await adapter.read(path);
    const lines = content.trim().split("\n").filter((line) => line.length > 0);
    const records: EmbeddingRecord[] = [];

    for (const line of lines) {
      try {
        records.push(JSON.parse(line) as EmbeddingRecord);
      } catch {
        // ignorar linhas inválidas
      }
    }

    return records;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Interface única para cartão de nota agrupado
// ---------------------------------------------------------------------------
interface GroupedNoteCard {
  path: string;
  normalizedPath: string;
  basename: string;
  snippet: string;                // melhor excerto
  score: number;                  // score principal (finalScore, score, ou similarity)
  textScore?: number;             // melhor textScore (híbrida)
  semanticScore?: number;         // melhor semelhança semântica (híbrida)
  origin: string;                 // origem formatada
  termsFound: string[];           // termos agregados (sem duplicados)
  totalTerms: number;
  termCoverage: number;           // 0..1
  extraSnippets: string[];        // até 2 snippets adicionais diferentes do principal
  chunkCount: number;             // quantos chunks/resultados foram agrupados
}

// ---------------------------------------------------------------------------
// Agrupamento central: resultados brutos → cartões de nota
// ---------------------------------------------------------------------------
type AnyResult = {
  path: string;
  basename: string;
  snippet: string;
  score?: number;
  finalScore?: number;
  similarity?: number;
  textScore?: number;
  semanticSimilarity?: number;
  textOrigin?: string;
  source?: string;
  termCoverage?: number;
  termsFound?: string[];
  totalTerms?: number;
};

function normalizeResultPath(path: string): string {
  return path.replace(/\\/g, "/").trim().toLowerCase();
}

function groupResultsByNote(results: AnyResult[]): GroupedNoteCard[] {
  const groups = new Map<string, AnyResult[]>();

  for (const r of results) {
    const key = normalizeResultPath(r.path);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const cards: GroupedNoteCard[] = [];

  for (const [normalizedPath, items] of groups) {
    // Escolher resultado principal
    // Para híbrida: maior finalScore
    // Para textual: maior score
    // Para semântica: maior similarity
    items.sort((a, b) => {
      const scoreA = b.finalScore ?? b.score ?? b.similarity ?? 0;
      const scoreB = a.finalScore ?? a.score ?? a.similarity ?? 0;
      return scoreA - scoreB;
    });
    const main = items[0];

    // Agregar termos
    const allTerms = new Set<string>();
    let maxTotalTerms = 0;
    for (const item of items) {
      if (item.termsFound) item.termsFound.forEach(t => allTerms.add(t));
      if (item.totalTerms && item.totalTerms > maxTotalTerms) maxTotalTerms = item.totalTerms;
    }
    const coverage = maxTotalTerms > 0 ? allTerms.size / maxTotalTerms : 0;

    // Melhores scores agregados
    const bestTextScore = items.reduce((max, r) => Math.max(max, r.textScore ?? 0), 0);
    const bestSemanticScore = items.reduce((max, r) => Math.max(max, r.semanticSimilarity ?? 0), 0);

    // Origem
    let origin = "Desconhecida";
    if (main.textOrigin) {
      switch (main.textOrigin) {
        case "nome": origin = "Nome"; break;
        case "caminho": origin = "Caminho"; break;
        case "conteudo": origin = "Conteúdo"; break;
      }
    } else if (main.source) {
      switch (main.source) {
        case "hibrida": origin = "Híbrida"; break;
        case "semantica": origin = "Semântica"; break;
        case "textual": origin = "Textual"; break;
      }
    }

    // Excertos adicionais (até 2, diferentes do principal)
    const extraSnippets: string[] = [];
    for (const item of items) {
      if (item === main) continue;
      if (extraSnippets.length >= 2) break;
      if (item.snippet !== main.snippet && !extraSnippets.includes(item.snippet)) {
        extraSnippets.push(item.snippet);
      }
    }

    const mainScore = main.finalScore ?? main.score ?? main.similarity ?? 0;

    cards.push({
      path: main.path,
      normalizedPath,
      basename: main.basename,
      snippet: main.snippet,
      score: mainScore,
      textScore: bestTextScore > 0 ? bestTextScore : undefined,
      semanticScore: bestSemanticScore > 0 ? bestSemanticScore : undefined,
      origin,
      termsFound: Array.from(allTerms),
      totalTerms: maxTotalTerms,
      termCoverage: coverage,
      extraSnippets,
      chunkCount: items.length,
    });
  }

  // Ordenar cartões por score descendente
  cards.sort((a, b) => b.score - a.score);

  console.debug(`Lina agrupamento: ${results.length} resultados brutos → ${cards.length} notas únicas`);

  return cards;
}

// ---------------------------------------------------------------------------
// Destaque seguro de termos (sem innerHTML)
// ---------------------------------------------------------------------------

/** Palavras demasiado curtas ou vazias para destacar */
const MIN_TERM_LENGTH = 2;
const STOP_WORDS = new Set(["de", "e", "a", "o", "do", "da", "em", "no", "na", "os", "as", "dos", "das", "ao", "aos", "para", "com", "por", "que", "se", "é", "um", "uma"]);

/**
 * Verifica se um termo deve ser destacado.
 * Ignora termos curtos e stop words comuns.
 */
function shouldHighlightTerm(term: string): boolean {
  const t = term.trim().toLowerCase();
  return t.length >= MIN_TERM_LENGTH && !STOP_WORDS.has(t);
}

function isWordCharacterForHighlight(char: string): boolean {
  return !!char && (char.toLowerCase() !== char.toUpperCase() || /[0-9_-]/.test(char));
}

/**
 * Constrói nós DOM seguros para texto com termos destacados.
 * @param container - elemento onde adicionar os spans
 * @param text - texto original
 * @param terms - lista de termos a destacar (case-insensitive, ignorando stop words)
 */
function renderHighlightedText(container: HTMLElement, text: string, terms: string[]): void {
  if (!text || !terms || terms.length === 0) {
    container.createSpan({ text });
    return;
  }

  // Filtrar termos válidos e escapar para regex
  const validTerms = terms.filter(shouldHighlightTerm).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (validTerms.length === 0) {
    container.createSpan({ text });
    return;
  }

  // Construir regex combinado case-insensitive
  const regex = new RegExp(`(${validTerms.join("|")})`, "gi");
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    let matchStart = match.index;
    let matchEnd = regex.lastIndex;

    while (matchStart > lastIndex && isWordCharacterForHighlight(text.charAt(matchStart - 1))) {
      matchStart--;
    }

    while (matchEnd < text.length && isWordCharacterForHighlight(text.charAt(matchEnd))) {
      matchEnd++;
    }

    // Texto antes do match
    if (matchStart > lastIndex) {
      container.createSpan({ text: text.substring(lastIndex, matchStart) });
    }
    // Termo destacado
    const mark = container.createEl("mark");
    mark.textContent = text.substring(matchStart, matchEnd);
    mark.addClass("lina-bg-highlight");
    mark.addClass("lina-color-inherit");
    mark.addClass("lina-radius-2");
    mark.addClass("lina-p-0-2");
    lastIndex = matchEnd;
    regex.lastIndex = matchEnd;
  }

  // Restante do texto
  if (lastIndex < text.length) {
    container.createSpan({ text: text.substring(lastIndex) });
  }
}

function normalizeSearchResultText(text: string): string {
  return text
    .replace(/\.md$/i, "")
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function snippetLooksLikeFrontmatter(snippet: string): boolean {
  const trimmed = snippet.trim();
  if (!trimmed) return false;

  if (trimmed.startsWith("---")) return true;

  const lines = trimmed.split("\n").map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) return false;

  const yamlLikeLines = lines.filter(line =>
    /^[A-Za-zÀ-ÿ0-9_-]+:\s*/.test(line) ||
    line.startsWith("- ")
  );

  if (lines.length > 1) {
    return yamlLikeLines.length >= Math.max(2, Math.ceil(lines.length * 0.6));
  }

  const inlineYamlFields = trimmed.match(/(?:^|\s)[A-Za-zÀ-ÿ0-9_-]+:\s+\S/g) ?? [];
  return inlineYamlFields.length >= 2;
}

function snippetRepeatsTitle(snippet: string, title: string): boolean {
  const normalizedSnippet = normalizeSearchResultText(snippet);
  const normalizedTitle = normalizeSearchResultText(title);

  return !!normalizedSnippet && !!normalizedTitle && normalizedSnippet === normalizedTitle;
}

function cleanSearchSnippet(snippet: string): string {
  return snippet
    .replace(/^---\s*/, "")
    .replace(/---\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getReadableSearchOrigin(origin: string, L: UiStrings): string {
  switch (origin) {
    case "Nome":
      return `${L.originFoundIn} ${L.originFileName}`;
    case "Caminho":
      return `${L.originFoundIn} ${L.originFilePath}`;
    case "Conteúdo":
    case "Híbrida":
    case "Textual":
    case "Semântica":
      return `${L.originFoundIn} ${L.originFileContent}`;
    default:
      return L.originNote;
  }
}

type SearchSnippetDisplay = {
  text: string;
  shouldHighlight: boolean;
  isFallback: boolean;
};

function getSearchSnippetDisplay(card: GroupedNoteCard): SearchSnippetDisplay | null {
  const allSnippets = [card.snippet, ...card.extraSnippets]
    .map(raw => ({
      cleaned: cleanSearchSnippet(raw),
      isFrontmatter: snippetLooksLikeFrontmatter(raw),
    }))
    .filter(snippet => snippet.cleaned.length > 0);

  const usefulSnippet = allSnippets.find(snippet =>
    !snippet.isFrontmatter &&
    !snippetRepeatsTitle(snippet.cleaned, card.basename)
  );

  if (usefulSnippet) {
    const text = usefulSnippet.cleaned.length > 280
      ? `${usefulSnippet.cleaned.substring(0, 280)}...`
      : usefulSnippet.cleaned;
    return { text, shouldHighlight: true, isFallback: false };
  }

  if (allSnippets.some(snippet => snippet.isFrontmatter)) {
    return {
      text: "Correspondência encontrada nos metadados da nota.",
      shouldHighlight: false,
      isFallback: true,
    };
  }

  if (allSnippets.some(snippet => snippetRepeatsTitle(snippet.cleaned, card.basename)) || card.origin === "Nome") {
    return {
      text: "Correspondência encontrada no nome da nota.",
      shouldHighlight: false,
      isFallback: true,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Funções auxiliares para normalização (Fase 5A)
// ---------------------------------------------------------------------------

/**
 * Normaliza uma tag: minúsculas, sem acentos, espaços convertidos para underscore.
 */
function normalizarTag(tag: string): string {
  let t = tag.trim().toLowerCase();
  // Remover acentos
  t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Converter espaços para underscore
  t = t.replace(/\s+/g, "_");
  // Remover caracteres não alfanuméricos exceto hífen e underscore
  t = t.replace(/[^a-z0-9_-]/g, "");
  return t;
}

/**
 * Normaliza uma lista de tags.
 */
function normalizarTags(tags: string[]): string[] {
  const normalized = tags.map(normalizarTag).filter(t => t.length > 0);
  return [...new Set(normalized)];
}

function extrairTagsDeValorYaml(value: string | string[]): string[] {
  if (Array.isArray(value)) {
    return normalizarTags(value);
  }

  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inlineItems = trimmed
      .substring(1, trimmed.length - 1)
      .split(",")
      .map(tag => tag.trim().replace(/^["']|["']$/g, ""));
    return normalizarTags(inlineItems);
  }

  return normalizarTags(trimmed.split(",").map(tag => tag.trim()));
}

function formatTagUsageLabel(count: number, alreadyUsedLabel: string): string {
  return `${alreadyUsedLabel}: ${count}`;
}

function normalizeComparableText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeTaskText(text: string): string {
  return normalizeComparableText(text.replace(/^- \[[ xX]\]\s*/, ""));
}

function getMarkdownSection(content: string, heading: string): string {
  const sectionStart = content.indexOf(heading);
  if (sectionStart < 0) return "";

  const sectionBodyStart = sectionStart + heading.length;
  const afterHeading = content.substring(sectionBodyStart);
      const nextSectionMatch = afterHeading.match(/\n##\s+/);
      const sectionEnd = nextSectionMatch ? sectionBodyStart + (nextSectionMatch.index ?? afterHeading.length) : content.length;
      return content.substring(sectionStart, Math.trunc(sectionEnd));
}

/**
 * Remove ou substitui caracteres inválidos para nomes de ficheiro,
 * preservando acentos, espaços e maiúsculas.
 * Apenas remove: \ / : * ? " < > |
 */
function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, " ");
}

/**
 * Capitaliza a primeira letra de cada palavra, mas mantém em minúsculas
 * palavras curtas como "e", "de", "do", "da", "dos", "das", "em", "no", "na", "para".
 */
function capitalizarTitulo(text: string): string {
  const minúsculas = new Set([
    "e", "de", "do", "da", "dos", "das",
    "em", "no", "na", "num", "numa",
    "para", "pra", "pro",
    "a", "ao", "aos", "as", "o", "os",
    "um", "uns", "uma", "umas",
    "com", "por", "que", "se", "lhe", "lhes",
    "ou", "mas", "mais", "menos",
    "ser", "ter", "haver", "dar", "ir", "vir",
    "este", "esta", "estes", "estas",
    "esse", "essa", "esses", "essas",
    "aquele", "aquela", "aqueles", "aquelas",
  ]);

  return text
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      if (index === 0) {
        // Primeira palavra: sempre maiúscula
        return word.charAt(0).toUpperCase() + word.slice(1);
      }
      if (minúsculas.has(word.toLowerCase())) {
        return word.toLowerCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/**
 * Gera um nome de ficheiro legível a partir de um título sugerido.
 * Preserva acentos, maiúsculas naturais e espaços.
 * Apenas remove caracteres inválidos para nomes de ficheiro.
 *
 * Exemplo:
 *   "backup e restauração de drivers windows"
 *   → "Backup e Restauração de Drivers Windows.md"
 */
function makeReadableFileName(title: string): string {
  let base = title.trim();
  // Remover caracteres inválidos para nomes de ficheiro
  base = sanitizeFileName(base);
  // Colapsar espaços múltiplos
  base = base.replace(/\s+/g, " ").trim();
  // Capitalizar como título
  base = capitalizarTitulo(base);

  // Limitar comprimento para evitar nomes demasiado longos
  if (base.length > 80) {
    base = base.substring(0, 80).replace(/\s+$/g, "");
  }

  return base ? `${base}.md` : "";
}

const INVALID_FOLDER_SEGMENT_CHARS = new Set(["<", ">", ":", "\"", "|", "?", "*"]);

function isAsciiControlCharacter(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 0 && code <= 31;
}

function hasInvalidFolderSegmentChars(value: string): boolean {
  return Array.from(value)
    .some(char => INVALID_FOLDER_SEGMENT_CHARS.has(char) || isAsciiControlCharacter(char));
}

function getPathInSameFolder(file: TFile, fileName: string): string {
  const separatorIndex = file.path.lastIndexOf("/");
  if (separatorIndex < 0) return normalizePath(fileName);

  const folder = file.path.substring(0, separatorIndex);
  return normalizePath(`${folder}/${fileName}`);
}

function getFolderPathForFile(file: TFile): string {
  return getFolderPathFromPath(file.path);
}

function getFolderPathFromPath(path: string): string {
  const separatorIndex = path.lastIndexOf("/");
  if (separatorIndex < 0) return "";

  return path.substring(0, separatorIndex);
}

function getPathInFolder(folderPath: string, fileName: string): string {
  return normalizePath(folderPath ? `${folderPath}/${fileName}` : fileName);
}

function normalizePathForComparison(path: string): string {
  return normalizePath(path).replace(/\\/g, "/").trim().toLowerCase();
}

function normalizeSuggestedFolderPath(suggestedFolder?: string): { path: string; isValid: boolean } {
  const raw = (suggestedFolder ?? "").trim();
  if (!raw) return { path: "", isValid: false };

  let cleaned = raw.replace(/\\/g, "/").trim();
  if (/^[a-zA-Z]:/.test(cleaned)) return { path: "", isValid: false };
  if (/^\/{2,}/.test(cleaned)) return { path: "", isValid: false };
  if (cleaned.includes("..")) return { path: "", isValid: false };

  cleaned = cleaned.replace(/^\/+/, "");

  const parts = cleaned
    .split("/")
    .map(part => part.replace(/\.\./g, "").trim())
    .filter(part => part.length > 0);

  if (parts.length === 0) return { path: "", isValid: false };

  if (parts.some(part => part === "." || hasInvalidFolderSegmentChars(part))) {
    return { path: "", isValid: false };
  }

  const normalized = normalizePath(parts.join("/")).replace(/^\/+/, "");
  return normalized ? { path: normalized, isValid: true } : { path: "", isValid: false };
}

function getLastPathSegment(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(part => part.trim().length > 0);
  return parts[parts.length - 1] ?? "";
}

function normalizeFolderNameForMatching(path: string): string {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .map(part => part.trim().replace(/^\d+[\s_.-]*/, ""))
    .join("/")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[._\-\s,;:()[\]{}]+/g, "")
    .replace(/[^a-z0-9/]/g, "");
}

function normalizeFolderSegmentForMatching(path: string): string {
  return normalizeFolderNameForMatching(getLastPathSegment(path));
}

function isSameFolderForMatching(a: string, b: string): boolean {
  const fullA = normalizeFolderNameForMatching(a);
  const fullB = normalizeFolderNameForMatching(b);
  const segmentA = normalizeFolderSegmentForMatching(a);
  const segmentB = normalizeFolderSegmentForMatching(b);

  return fullA === fullB || segmentA === fullB || fullA === segmentB || segmentA === segmentB;
}

/**
 * Tenta extrair JSON válido da resposta da IA.
 * Procura por um bloco JSON entre ```json ... ``` ou {} no texto.
 */
function extrairJsonDaResposta(text: string): { json?: StructuredAnalysisResult; error?: string } {
  // Tentar extrair bloco ```json ... ```
  const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1]) as StructuredAnalysisResult;
      return { json: parsed };
    } catch {
      // Continuar para próxima tentativa
    }
  }

  // Tentar extrair primeiro objeto JSON {} encontrado
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as StructuredAnalysisResult;
      return { json: parsed };
    } catch {
      return { error: "JSON inválido encontrado mas não pôde ser analisado." };
    }
  }

  return { error: "Nenhum JSON encontrado na resposta." };
}

/**
 * Normaliza um caminho para comparação segura.
 * - substitui `\` por `/`
 * - faz trim()
 * - converte para minúsculas
 * - remove extensão .md se existir
 * Permite comparar caminhos com e sem .md como equivalentes.
 */
function normalizePathSafe(path: string): string {
  return path.replace(/\\/g, "/").trim().toLowerCase().replace(/\.md$/, "");
}

function getBasenameWithoutExtension(path: string): string {
  const normalized = path.replace(/\\/g, "/").trim().replace(/\.md$/i, "");
  const parts = normalized.split("/").filter(part => part.length > 0);
  return parts[parts.length - 1] || normalized;
}

function formatObsidianWikiLink(path: string, title?: string): string {
  const pathWithoutExtension = path.replace(/\\/g, "/").trim().replace(/\.md$/i, "");
  const cleanTitle = (title && title.trim().length > 0 ? title.trim() : getBasenameWithoutExtension(path)).replace(/\|/g, "-");
  return `[[${pathWithoutExtension}|${cleanTitle}]]`;
}

function extractExistingAnalysisLinkPaths(content: string): Set<string> {
  const existing = new Set<string>();
  const analysisSection = getMarkdownSection(content, SECCAO_ANALISE);
  if (!analysisSection) return existing;

  const wikiLinkRegex = /\[\[([^|\]\n]+)(?:\|[^\]\n]+)?\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = wikiLinkRegex.exec(analysisSection)) !== null) {
    existing.add(normalizePathSafe(match[1]));
  }

  return existing;
}

function extractExistingWikiLinkTargets(content: string): Set<string> {
  const existing = new Set<string>();
  const wikiLinkRegex = /\[\[([^|\]\n#]+)(?:#[^|\]\n]*)?(?:\|[^\]\n]+)?\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = wikiLinkRegex.exec(content)) !== null) {
    const target = match[1]?.trim();
    if (!target) continue;

    existing.add(normalizePathSafe(target));
    existing.add(normalizePathSafe(getBasenameWithoutExtension(target)));
  }

  return existing;
}

function isAlreadyLinkedNote(candidatePath: string, existingTargets: Set<string>): boolean {
  const normalizedPath = normalizePathSafe(candidatePath);
  const normalizedBasename = normalizePathSafe(getBasenameWithoutExtension(candidatePath));

  return existingTargets.has(normalizedPath) || existingTargets.has(normalizedBasename);
}

/**
 * Filtra links internos inválidos após parsing.
 * Remove links que:
 * - são a própria nota atual
 * - não existem na lista de notas relacionadas permitidas
 * - estão duplicados
 */
function filtrarLinksInternos(
  links: StructuredInternalLink[],
  currentPath: string,
  allowedPaths: string[]
): StructuredInternalLink[] {
  const currentNormalized = normalizePathSafe(currentPath);
  const allowedNormalized = new Set(allowedPaths.map(p => normalizePathSafe(p)));
  const seen = new Set<string>();
  const valid: StructuredInternalLink[] = [];

  for (const link of links) {
    if (!link.path) continue;

    const linkNormalized = normalizePathSafe(link.path);

    // Excluir a própria nota atual
    if (linkNormalized === currentNormalized) continue;

    // Excluir se não estiver na lista de notas relacionadas permitidas
    if (!allowedNormalized.has(linkNormalized)) continue;

    // Excluir duplicados
    if (seen.has(linkNormalized)) continue;

    seen.add(linkNormalized);
    valid.push(link);
  }

  return valid;
}

/**
 * Remove propriedades YAML que não estão na lista permitida.
 * Remove sempre 'tags' do YAML, pois as tags são tratadas separadamente na secção "Tags sugeridas".
 */
function filtrarYamlValido(
  yaml: Record<string, string | string[]>,
  allowedProperties: string
): Record<string, string | string[]> {
  const allowed = allowedProperties.split(",").map(p => p.trim().toLowerCase());
  const filtered: Record<string, string | string[]> = {};

  for (const [key, value] of Object.entries(yaml)) {
    if (allowed.includes(key.toLowerCase())) {
      // Remover sempre 'tags' do YAML - as tags são mostradas na secção "Tags sugeridas"
      if (key.toLowerCase() === "tags") {
        continue;
      }
      filtered[key] = value;
    }
  }

  return filtered;
}

// ---------------------------------------------------------------------------
// Funções de frontmatter/YAML (Fase 5B)
// ---------------------------------------------------------------------------

/**
 * Extrai o frontmatter de um conteúdo Markdown.
 * Retorna { frontmatter, body, hasFrontmatter }
 */
function extrairFrontmatter(content: string): { frontmatter: string; body: string; hasFrontmatter: boolean } {
  const trimmed = content.trim();
  if (trimmed.startsWith("---")) {
    const endIndex = trimmed.indexOf("---", 3);
    if (endIndex > 0) {
      return {
        frontmatter: trimmed.substring(3, endIndex).trim(),
        body: trimmed.substring(endIndex + 3).trim(),
        hasFrontmatter: true,
      };
    }
  }
  return { frontmatter: "", body: trimmed, hasFrontmatter: false };
}

/**
 * Analisa linhas de frontmatter YAML e devolve um mapa de propriedades.
 * Não usa parser YAML completo para evitar dependências.
 */
function parseFrontmatterLines(frontmatter: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = frontmatter.split("\n");
  let currentKey = "";
  for (const line of lines) {
    const trimmed = line.trim();
    // Ignorar linhas de lista (ex: "- tag")
    if (trimmed.startsWith("- ")) continue;
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex > 0) {
      currentKey = trimmed.substring(0, colonIndex).trim();
      const value = trimmed.substring(colonIndex + 1).trim();
      map.set(currentKey, value);
    }
  }
  return map;
}

/**
 * Verifica se uma secção já existe no corpo da nota.
 */
function secaoExiste(body: string, titulo: string): boolean {
  return body.includes(titulo);
}

/**
 * Obtém tags já existentes no frontmatter.
 */
function extrairTagsDoFrontmatter(frontmatter: string): string[] {
  const lines = frontmatter.split("\n");
  let inTags = false;
  const tags: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("tags:")) {
      inTags = true;
      const afterColon = trimmed.substring(5).trim();
      if (afterColon.length > 0) {
        if (afterColon.startsWith("[") && afterColon.endsWith("]")) {
          tags.push(...extrairTagsDeValorYaml(afterColon));
          inTags = false;
          continue;
        }
        // Formato "tags: valor1, valor2"
        tags.push(...extrairTagsDeValorYaml(afterColon));
        inTags = false;
      }
      continue;
    }
    if (inTags) {
      if (trimmed.startsWith("- ")) {
        tags.push(normalizarTag(trimmed.substring(2).trim()));
      } else if (trimmed.includes(":")) {
        inTags = false;
      } else if (trimmed.length === 0) {
        inTags = false;
      }
    }
  }
  return [...new Set(tags.filter(tag => tag.length > 0))];
}

// ---------------------------------------------------------------------------
// View principal
// ---------------------------------------------------------------------------
export class LinaSearchView extends ItemView {
  private plugin: LinaPlugin;
  private stateContainer!: HTMLDivElement;
  private actionsContainer!: HTMLDivElement;
  private detailsContainer!: HTMLDivElement;
  private queryInput!: HTMLInputElement;
  private statusEl!: HTMLDivElement;
  private resultsSectionEl!: HTMLDetailsElement;
  private resultsSummaryEl!: HTMLElement;
  private resultsChevronEl!: HTMLSpanElement;
  private resultsStatusEl!: HTMLDivElement;
  private resultsEl!: HTMLDivElement;
  private searchModeRadioButtons: {
    textual: HTMLInputElement;
    hibrida: HTMLInputElement;
    semantica: HTMLInputElement;
  } = {
    textual: null!,
    hibrida: null!,
    semantica: null!
  };
  private searchButtonContainer!: HTMLDivElement;
  private currentMode: SearchMode = "hibrida";
  private detailsVisible = false;

  // Estado da pré-visualização estruturada (Fase 5A)
  private structuredSelections: Map<string, boolean> = new Map();

  // Estado para impedir cliques duplicados nos botões de geração de embeddings
  private isGeneratingEmbeddings: boolean = false;

  // Mapeamento robusto de itens selecionáveis para recolha correta
  private selectableItemsMap: Map<string, RenderedSelectableItem> = new Map();

  // Resultado estruturado atual (para aplicar à nota)
  private currentStructuredResult?: StructuredAnalysisResult;

  /** Caminho do ficheiro ativo para aplicar alterações */
  private currentActiveFilePath?: string;
  private currentAnalysisSourcePath?: string | null;
  private currentAnalysisScope?: AnalysisScope;
  private lastSuggestedMetadataScope?: AnalysisScope;
  private lastSuggestedTags: string[] = [];
  private lastSuggestedYaml: SuggestedYaml = {};
  private preservedMetadataSelections: Map<string, boolean> = new Map();
  private preservedMetadataItems: Map<string, PreservedMetadataItem> = new Map();
  private analysisRunId = 0;

  constructor(leaf: WorkspaceLeaf, plugin: LinaPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  /** Obtém o idioma atual da interface. */
  private get lang() {
    return this.plugin.settings.interfaceLanguage ?? "pt-PT";
  }

  /** Obtém o objeto de strings traduzidas para o idioma atual. */
  private get L(): UiStrings {
    return getStrings(this.lang);
  }

  private getExcludedContentTerms(): string[] {
    return parseMultilineSetting(this.plugin.settings.indexExcludedContentContains ?? "");
  }

  private contentMatchesUserExclusion(content: string): boolean {
    const excludedContentContains = this.getExcludedContentTerms();
    if (excludedContentContains.length === 0) {
      return false;
    }

    return shouldExcludeContent(content, excludedContentContains).excluded;
  }

  private filterChunksByUserContentRules(chunks: Chunk[]): Chunk[] {
    const excludedContentContains = this.getExcludedContentTerms();
    if (excludedContentContains.length === 0) {
      return chunks;
    }

    return chunks.filter((chunk) => !shouldExcludeContent(chunk.text, excludedContentContains).excluded);
  }

  /**
   * Verifica se a nota já contém conteúdo gerado pelo Lina.
   * Usa os marcadores de secção que o próprio Lina insere.
   */
  private hasLinaGeneratedContent(content: string): boolean {
    return content.includes(SECCAO_ANALISE) || content.includes(SECCAO_TAREFAS);
  }

  /**
   * Pede confirmação ao utilizador antes de reinserir conteúdo IA numa nota
   * que já contém conteúdo gerado pelo Lina.
   */
  private async confirmReinsertAiContent(): Promise<boolean> {
    const confirmed = await new Promise<boolean>((resolve) => {
      const modal = new Modal(this.app);
      modal.setTitle(this.L.confirmReinsertAiTitle);
      modal.contentEl.createEl("p", { text: this.L.confirmReinsertAiIntro });
      modal.contentEl.createEl("p", {
        text: this.L.confirmReinsertAiWarning,
        attr: { style: "color: var(--text-warning);" }
      });

      const buttonContainer = modal.contentEl.createDiv();
      buttonContainer.addClass("lina-display-flex");
      buttonContainer.addClass("lina-justify-between");
      buttonContainer.addClass("lina-mt-12");

      const cancelButton = buttonContainer.createEl("button", { text: this.L.confirmCancelButton });
      cancelButton.addClass("lina-mr-8");
      const continueButton = buttonContainer.createEl("button", { text: this.L.confirmReinsertAiButton });

      cancelButton.addEventListener("click", () => {
        modal.close();
        resolve(false);
      });

      continueButton.addEventListener("click", () => {
        modal.close();
        resolve(true);
      });

      window.setTimeout(() => cancelButton.focus(), 50);
    });

    return confirmed;
  }

  private filterNotesByFilteredChunks(
    notes: NonNullable<Awaited<ReturnType<typeof readIndexedNotes>>>,
    chunks: Chunk[],
    allChunks: Chunk[] = chunks
  ): NonNullable<Awaited<ReturnType<typeof readIndexedNotes>>> {
    if (this.getExcludedContentTerms().length === 0) {
      return notes;
    }

    const allowedPaths = new Set(chunks.map((chunk) => chunk.path));
    const indexedChunkPaths = new Set(allChunks.map((chunk) => chunk.path));
    return notes.filter((note) => allowedPaths.has(note.path) || !indexedChunkPaths.has(note.path));
  }

  private async filterRelatedNotesByUserContentRules(relatedNotes: RelatedNote[]): Promise<{ notes: RelatedNote[]; excludedCount: number }> {
    if (this.getExcludedContentTerms().length === 0) {
      return { notes: relatedNotes, excludedCount: 0 };
    }

    const safeNotes: RelatedNote[] = [];
    let excludedCount = 0;

    for (const note of relatedNotes) {
      const file = this.app.vault.getAbstractFileByPath(note.path);
      if (!(file instanceof TFile)) {
        excludedCount++;
        continue;
      }

      try {
        const content = await this.app.vault.read(file);
        if (this.contentMatchesUserExclusion(content)) {
          excludedCount++;
          continue;
        }
        safeNotes.push(note);
      } catch {
        excludedCount++;
      }
    }

    return { notes: safeNotes, excludedCount };
  }

  private getExistingVaultTags(): Map<string, ExistingVaultTag> {
    const existingTags = new Map<string, ExistingVaultTag>();
    const metaCache = this.app.metadataCache as unknown as Record<string, unknown> & { getTags?: () => Record<string, number> };
    const rawTags = metaCache.getTags?.() ?? {};
    const tags = rawTags;

    for (const [original, rawCount] of Object.entries(tags)) {
      const count = typeof rawCount === 'number' ? rawCount : 0;
      const normalized = normalizarTag(original);
      if (!normalized) continue;

      const existing = existingTags.get(normalized);
      if (existing) {
        existing.count += count;
      } else {
        existingTags.set(normalized, {
          original,
          normalized,
          count
        });
      }
    }

    return existingTags;
  }

  private getExistingVaultFolders(): string[] {
    return this.app.vault.getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder)
      .map(folder => normalizePath(folder.path).replace(/^\/+|\/+$/g, ""))
      .filter(path => path.length > 0)
      .sort((a, b) => a.localeCompare(b));
  }

  private getPathExclusionsForAnalysis(): { excludedFolders: string[]; excludedPathContains: string[] } {
    return {
      excludedFolders: parseMultilineSetting(this.plugin.settings.indexExcludedFolders ?? ""),
      excludedPathContains: parseMultilineSetting(this.plugin.settings.indexExcludedPathContains ?? "")
    };
  }

  private isPathExcludedFromFolderAnalysis(path: string): boolean {
    return shouldExcludePath(path, this.getPathExclusionsForAnalysis(), this.app.vault.configDir).excluded;
  }

  private getFolderAnalysisMaxNotes(): number {
    const value = this.plugin.settings.folderAnalysisMaxNotes ?? 10;
    return Math.min(20, Math.max(1, Number.isFinite(value) ? value : 10));
  }

  private normalizeFolderPathForAnalysis(folderPath: string): string {
    const trimmed = folderPath.trim();
    if (!trimmed) return "";
    return normalizePath(trimmed).replace(/^\/+|\/+$/g, "");
  }

  private getFolderMarkdownNotes(folderPath: string, options: FolderMarkdownNotesOptions): FolderMarkdownNotesResult {
    const normalizedFolderPath = this.normalizeFolderPathForAnalysis(folderPath);
    const folder = this.app.vault.getAbstractFileByPath(normalizedFolderPath);
    if (!(folder instanceof TFolder)) {
      throw new Error(this.L.folderAnalysisFolderMissing);
    }

    const includeSubfolders = options.includeSubfolders;
    const sortBy = options.sortBy ?? "mtime";
    const maxNotes = Math.min(20, Math.max(1, options.maxNotes));
    const eligibleFiles: TFile[] = [];
    let totalFound = 0;
    let totalExcludedByPath = 0;

    const visitFolder = (currentFolder: TFolder) => {
      for (const child of currentFolder.children) {
        if (child instanceof TFile) {
          if (child.extension !== "md") continue;
          totalFound++;
          if (this.isPathExcludedFromFolderAnalysis(child.path)) {
            totalExcludedByPath++;
            continue;
          }
          eligibleFiles.push(child);
        } else if (includeSubfolders && child instanceof TFolder) {
          visitFolder(child);
        }
      }
    };

    visitFolder(folder);

    eligibleFiles.sort((a, b) => {
      if (sortBy === "name") {
        return a.path.localeCompare(b.path);
      }
      return b.stat.mtime - a.stat.mtime || a.path.localeCompare(b.path);
    });

    const notes = eligibleFiles.slice(0, maxNotes);

    return {
      folder,
      notes,
      totalFound,
      totalEligible: eligibleFiles.length,
      totalExcludedByPath,
      totalTruncated: Math.max(0, eligibleFiles.length - notes.length)
    };
  }

  private getFolderAnalysisChoices(): string[] {
    return this.getExistingVaultFolders()
      .filter(folder => !this.isPathExcludedFromFolderAnalysis(`${folder}/__lina_folder_check__.md`));
  }

  private getPreferredFolderAnalysisPath(folderChoices: string[]): string {
    const activeFile = this.app.workspace.getActiveFile();
    const activeFolder = activeFile instanceof TFile ? getFolderPathForFile(activeFile) : "";
    const candidates = [
      activeFolder,
      this.plugin.settings.lastAnalyzedFolderPath ?? "",
      this.plugin.settings.inboxFolderPath ?? "",
      folderChoices[0] ?? ""
    ].map(value => this.normalizeFolderPathForAnalysis(value)).filter(value => value.length > 0);

    return candidates.find(candidate => folderChoices.includes(candidate)) ?? folderChoices[0] ?? "";
  }

  private isInboxFolderPath(folderPath: string): boolean {
    const inboxPath = normalizePath((this.plugin.settings.inboxFolderPath ?? "").trim()).replace(/^\/+|\/+$/g, "");
    const folderSegment = normalizeFolderSegmentForMatching(folderPath);

    if (folderSegment === "inbox") return true;
    if (!inboxPath) return false;

    return isSameFolderForMatching(folderPath, inboxPath);
  }

  private getExistingRootFolders(existingFolders: string[]): string[] {
    return existingFolders.filter(folder => !folder.includes("/") && !this.isInboxFolderPath(folder));
  }

  private formatExistingFoldersForPrompt(currentPath: string, title: string, content: string): string {
    const existingFolders = this.getExistingVaultFolders();
    const currentFolder = getFolderPathFromPath(currentPath);
    const rootFolders = this.getExistingRootFolders(existingFolders);
    const haystack = normalizeFolderNameForMatching(`${title} ${currentPath} ${content.substring(0, 1200)}`);

    const scored = existingFolders
      .filter(folder => !this.isInboxFolderPath(folder))
      .map(folder => {
        const segment = normalizeFolderSegmentForMatching(folder);
        const full = normalizeFolderNameForMatching(folder);
        let score = 0;
        if (folder === currentFolder) score += 100;
        if (!folder.includes("/")) score += 30;
        if (segment && haystack.includes(segment)) score += 20;
        if (full && haystack.includes(full)) score += 30;
        return { folder, score };
      })
      .sort((a, b) => b.score - a.score || a.folder.localeCompare(b.folder));

    const selected = new Set<string>();
    for (const folder of rootFolders.slice(0, 20)) selected.add(folder);
    if (currentFolder && !this.isInboxFolderPath(currentFolder)) selected.add(currentFolder);
    for (const item of scored) {
      if (selected.size >= 100) break;
      selected.add(item.folder);
    }

    if (selected.size === 0) {
      return "Nenhuma pasta existente adequada encontrada fora da Inbox.";
    }

    return Array.from(selected).slice(0, 100).map(folder => `* ${folder}`).join("\n");
  }

  private applyFolderSuggestionResolution(result: StructuredAnalysisResult, currentPath: string): FolderMoveResolution {
    const existingFolders = this.getExistingVaultFolders();
    const currentFolder = currentPath ? getFolderPathFromPath(currentPath) : "";
    const currentFileName = currentPath ? currentPath.split("/").pop() : undefined;
    const resolution = this.resolveFolderMove(result.suggestedFolder, existingFolders, currentFolder, currentFileName, currentPath);

    if (resolution.resolvedFolderPath && resolution.exists) {
      result.suggestedFolder = resolution.resolvedFolderPath;
    }

    return resolution;
  }

  private resolveFolderMove(
    suggestedFolder: string | undefined,
    existingFolders: string[],
    currentFolderPath: string,
    currentFileName?: string,
    currentFilePath?: string
  ): FolderMoveResolution {
    const rawSuggestedFolder = (suggestedFolder ?? "").trim();
    const normalized = normalizeSuggestedFolderPath(rawSuggestedFolder);

    const baseResolution = (
      values: Partial<Omit<FolderMoveResolution, "rawSuggestedFolder" | "currentFolderPath" | "canMove">>
    ): FolderMoveResolution => {
      const resolvedFolderPath = values.resolvedFolderPath ?? null;
      const finalTargetPath = values.finalTargetPath ?? (
        currentFileName && resolvedFolderPath ? getPathInFolder(resolvedFolderPath, currentFileName) : null
      );
      const canMove =
        !!currentFileName &&
        !!currentFilePath &&
        values.isValid === true &&
        values.exists === true &&
        values.isInbox !== true &&
        values.isCurrentFolder !== true &&
        values.hasCollision !== true;

      return {
        rawSuggestedFolder,
        resolvedFolderPath,
        currentFolderPath,
        finalTargetPath,
        exists: values.exists ?? false,
        isInbox: values.isInbox ?? false,
        isCurrentFolder: values.isCurrentFolder ?? false,
        hasCollision: values.hasCollision ?? false,
        isValid: values.isValid ?? false,
        canMove,
        reason: values.reason ?? "A pasta sugerida não é válida."
      };
    };

    if (!normalized.isValid) {
      return baseResolution({
        isValid: false,
        reason: "A pasta sugerida não é válida."
      });
    }

    const normalizedSuggestion = normalized.path;
    const exactExisting = existingFolders.find(folder => normalizePathForComparison(folder) === normalizePathForComparison(normalizedSuggestion));
    const approximateExisting = exactExisting ?? existingFolders.find(folder => isSameFolderForMatching(folder, normalizedSuggestion));
    const resolvedFolderPath = approximateExisting ?? normalizedSuggestion;
    const exists = !!approximateExisting;
    const isInbox = !!resolvedFolderPath && (this.isInboxFolderPath(resolvedFolderPath) || normalizeFolderSegmentForMatching(resolvedFolderPath) === "inbox");
    const isCurrentFolder = exists && normalizePathForComparison(resolvedFolderPath) === normalizePathForComparison(currentFolderPath);
    const finalTargetPath = currentFileName ? getPathInFolder(resolvedFolderPath, currentFileName) : null;
    const existingDestination = finalTargetPath
      ? this.app.vault.getAbstractFileByPath(finalTargetPath)
      : null;
    const hasCollision = !!(
      existingDestination &&
      currentFilePath &&
      finalTargetPath &&
      normalizePathForComparison(finalTargetPath) !== normalizePathForComparison(currentFilePath)
    );

    let reason = "Pasta existente. Pode mover a nota.";
    if (isInbox) {
      reason = "A Inbox não deve ser usada como destino de organização.";
    } else if (!exists) {
      reason = "A pasta sugerida não existe. O Lina não cria pastas automaticamente nesta fase.";
    } else if (!currentFileName || !currentFilePath) {
      reason = "Não existe ficheiro Markdown alvo.";
    } else if (isCurrentFolder) {
      reason = "A nota já está na pasta sugerida.";
    } else if (hasCollision) {
      reason = "Já existe um ficheiro com este nome na pasta de destino.";
    }

    return baseResolution({
      resolvedFolderPath,
      finalTargetPath,
      exists,
      isInbox,
      isCurrentFolder,
      hasCollision,
      isValid: true,
      reason
    });
  }

  private confirmApplySuggestions(summaryLines: string[], includesRename: boolean, includesMove: boolean): Promise<boolean> {
    return new Promise(resolve => {
      const modal = new Modal(this.app);
      modal.titleEl.setText(this.L.confirmApplyTitle);

      const intro = modal.contentEl.createDiv({ text: this.L.confirmApplyIntro });
      intro.addClass("lina-mb-8");

      const list = modal.contentEl.createEl("ul");
      list.addClass("lina-mt-0");
      for (const line of summaryLines) {
        list.createEl("li", { text: line });
      }

      const warning = modal.contentEl.createDiv({
        text: includesMove
          ? this.L.confirmApplyWarningMove
          : includesRename
          ? this.L.confirmApplyWarningRename
          : this.L.confirmApplyWarning
      });
      warning.addClass("lina-mt-12");

      const buttons = modal.contentEl.createDiv();
      buttons.addClass("lina-display-flex");
      buttons.addClass("lina-justify-end");
      buttons.addClass("lina-gap-8");
      buttons.addClass("lina-mt-16");

      const cancelButton = buttons.createEl("button", { text: this.L.confirmCancelButton });
      const applyButton = buttons.createEl("button", { text: this.L.confirmApplyButton });
      applyButton.classList.add("mod-cta");

      let resolved = false;
      const finish = (value: boolean) => {
        if (resolved) return;
        resolved = true;
        modal.close();
        resolve(value);
      };

      cancelButton.addEventListener("click", () => finish(false));
      applyButton.addEventListener("click", () => finish(true));
      modal.onClose = () => finish(false);
      modal.open();
    });
  }

  private renderContextExclusionWarning(): void {
    if (!this.analysisResultEl) return;

    const warning = this.analysisResultEl.createDiv({
      text: this.L.analysisContextExcludedByUserRules
    });
    warning.addClass("lina-color-warning");
    warning.addClass("lina-bg-hover");
    warning.addClass("lina-p-8");
    warning.addClass("lina-radius-4");
    warning.addClass("lina-mb-8");
    warning.addClass("lina-fs-085");
  }

  private renderUserContentExcludedBlock(): void {
    if (!this.analysisResultEl) return;

    this.analysisResultEl.createDiv({
      text: this.L.analysisExcludedByUserRules,
      attr: { style: "color: var(--text-error); padding: 8px 0;" }
    });
  }

  private getActiveTextAiProfile(): { provider: string; model: string; baseUrl: string; isLocal: boolean } {
    const provider = getLocalAnalysisProvider() || this.plugin.settings.aiProvider || "ollama";
    const model = getLocalAnalysisModel() || this.plugin.settings.aiAnalysisModel || (provider === "ollama" ? "gemma4:e2b" : "mistral-small-latest");
    const baseUrl = getLocalAnalysisBaseUrl() || this.plugin.settings.aiBaseUrl || (provider === "ollama" ? "http://localhost:11434" : "https://api.mistral.ai/v1");
    const isLocal = provider === "ollama";
    return { provider, model, baseUrl, isLocal };
  }

  private async generateTextWithActiveAiProfile(
    profile: { provider: string; model: string; baseUrl: string; isLocal: boolean },
    prompt: string
  ): Promise<{ success: boolean; message: string; text?: string }> {
    const baseUrl = profile.baseUrl || (profile.provider === "ollama" ? "http://localhost:11434" : "https://api.mistral.ai/v1");
    const model = profile.model || (profile.provider === "ollama" ? "gemma4:e2b" : "mistral-small-latest");
    const timeoutStr = getLocalAnalysisTimeout() || String(this.plugin.settings.aiRequestTimeoutSeconds || 60);
    const timeoutMs = parseInt(timeoutStr) * 1000;

    if (profile.provider === "ollama") {
      return generateOllamaText(baseUrl, model, prompt, timeoutMs);
    }

    if (profile.provider === "mistral") {
      const apiKey = getLocalAnalysisApiKey();
      if (!apiKey) {
        return {
          success: false,
          message: this.L.settingsApiKeyMissing,
        };
      }
      return generateMistralText(baseUrl, apiKey, model, prompt, timeoutMs);
    }

    return {
      success: false,
      message: `O provider "${profile.provider}" ainda não está implementado nesta versão.`,
    };
  }

  getViewType(): string {
    return LINA_SEARCH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Lina";
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    this.analysisSectionEl = undefined;
    this.analysisResultEl = undefined;
    this.analysisTitleEl = undefined;
    this.analysisNoteNameEl = undefined;
    this.analysisSummaryEl = undefined;
    this.analysisChevronEl = undefined;

    contentEl.createEl("h2", { text: "Lina" });

    const searchSection = contentEl.createDiv();
    searchSection.addClass("lina-mb-14");
    searchSection.createEl("h3", { text: this.L.sectionSearch });

    this.queryInput = searchSection.createEl("input", {
      type: "text",
      placeholder: this.L.searchPlaceholder,
    });
    this.queryInput.addClass("lina-w-full");
    this.queryInput.addClass("lina-mb-8");
    this.queryInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        void this.runSearch();
      }
    });

    const controlsRow = searchSection.createDiv();
    controlsRow.addClass("lina-display-flex");
    controlsRow.addClass("lina-flex-column");
    controlsRow.addClass("lina-gap-8");
    controlsRow.addClass("lina-mb-12");

    // Opções exclusivas para tipos de pesquisa
    const searchTypeContainer = controlsRow.createDiv();
    searchTypeContainer.addClass("lina-display-flex");
    searchTypeContainer.addClass("lina-gap-12");
    searchTypeContainer.addClass("lina-items-center");
    searchTypeContainer.addClass("lina-flex-wrap");

    const searchModeOptions: Array<{ mode: SearchMode; label: string }> = [
      { mode: "textual", label: this.L.searchTextual },
      { mode: "hibrida", label: this.L.searchHybrid },
      { mode: "semantica", label: this.L.searchSemantic },
    ];

    for (const option of searchModeOptions) {
      const optionLabel = searchTypeContainer.createEl("label");
      optionLabel.addClass("lina-display-inline-flex");
      optionLabel.addClass("lina-items-center");
      optionLabel.addClass("lina-gap-4");
      optionLabel.addClass("lina-fs-09");
      optionLabel.addClass("lina-cursor-pointer");

      const radio = optionLabel.createEl("input");
      radio.type = "radio";
      radio.name = "lina-search-mode";
      radio.value = option.mode;
      radio.checked = this.currentMode === option.mode;
      radio.addEventListener("change", () => {
        if (radio.checked) {
          this.currentMode = option.mode;
        }
      });

      optionLabel.createSpan({ text: option.label });
      this.searchModeRadioButtons[option.mode] = radio;
    }

    this.searchButtonContainer = controlsRow.createDiv();
    this.searchButtonContainer.addClass("lina-display-flex");
    this.searchButtonContainer.addClass("lina-justify-end");
    const searchBtn = this.searchButtonContainer.createEl("button", { text: this.L.searchButton });
    searchBtn.addEventListener("click", () => void this.runSearch());

    this.resultsSectionEl = contentEl.createEl("details");
    this.resultsSectionEl.addClass("lina-hidden");
    this.resultsSectionEl.addClass("lina-mb-14");
    this.resultsSummaryEl = this.resultsSectionEl.createEl("summary");
    this.resultsSummaryEl.addClass("lina-accordion-summary");
    this.resultsSummaryEl.setAttribute("title", "Expandir ou recolher resultados da pesquisa");
    this.resultsSummaryEl.addClass("lina-display-flex");
    this.resultsSummaryEl.addClass("lina-items-center");
    this.resultsSummaryEl.addClass("lina-justify-between");
    this.resultsSummaryEl.addClass("lina-gap-8");
    this.resultsSummaryEl.addClass("lina-cursor-pointer");
    this.resultsSummaryEl.addClass("lina-mb-8");

    const resultsTitle = this.resultsSummaryEl.createSpan();
    resultsTitle.addClass("lina-display-inline-flex");
    resultsTitle.addClass("lina-items-center");
    resultsTitle.addClass("lina-gap-0");
    this.resultsChevronEl = resultsTitle.createSpan({ text: "▶" });
    this.resultsChevronEl.addClass("lina-accordion-chevron");
    this.resultsChevronEl.setAttribute("aria-hidden", "true");
    resultsTitle.createEl("strong", { text: this.L.resultsTitle });

    const closeResultsButton = this.resultsSummaryEl.createEl("button", { text: "×" });
    closeResultsButton.setAttribute("aria-label", this.L.resultsClose);
    closeResultsButton.setAttribute("title", this.L.resultsClose);
    closeResultsButton.addClass("lina-flex-shrink-0");
    closeResultsButton.addClass("lina-lh-1");
    closeResultsButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.hideSearchResultsArea(true);
    });
    this.resultsSectionEl.addEventListener("toggle", () => {
      this.syncCollapsibleSectionState(
        this.resultsSectionEl,
        this.resultsSummaryEl,
        this.resultsChevronEl
      );
    });
    this.syncCollapsibleSectionState(
      this.resultsSectionEl,
      this.resultsSummaryEl,
      this.resultsChevronEl
    );

    this.resultsStatusEl = this.resultsSectionEl.createDiv();
    this.resultsStatusEl.addClass("lina-fs-09");
    this.resultsStatusEl.addClass("lina-color-muted");
    this.resultsStatusEl.addClass("lina-mb-10");

    this.resultsEl = this.resultsSectionEl.createDiv();

    const quickActionsSection = contentEl.createEl("details");
    quickActionsSection.open = true;
    quickActionsSection.addClass("lina-mb-14");
    const quickActionsSummary = quickActionsSection.createEl("summary");
    quickActionsSummary.addClass("lina-accordion-summary");
    quickActionsSummary.setAttribute("title", this.L.sectionQuickActions);
    quickActionsSummary.addClass("lina-cursor-pointer");
    quickActionsSummary.addClass("lina-mb-8");
    const quickActionsChevron = quickActionsSummary.createSpan({ text: "▼" });
    quickActionsChevron.addClass("lina-accordion-chevron");
    quickActionsChevron.setAttribute("aria-hidden", "true");
    quickActionsSummary.createEl("strong", { text: this.L.sectionQuickActions });
    quickActionsSection.addEventListener("toggle", () => {
      this.syncCollapsibleSectionState(
        quickActionsSection,
        quickActionsSummary,
        quickActionsChevron
      );
    });
    this.syncCollapsibleSectionState(
      quickActionsSection,
      quickActionsSummary,
      quickActionsChevron
    );

    this.actionsContainer = quickActionsSection.createDiv();
    this.actionsContainer.addClass("lina-display-flex");
    this.actionsContainer.addClass("lina-flex-wrap");
    this.actionsContainer.addClass("lina-gap-8");

    this.analysisSectionEl = contentEl.createEl("details");
    this.analysisSectionEl.addClass("lina-hidden");
    this.analysisSectionEl.addClass("lina-mt-16");
    this.analysisSectionEl.addClass("lina-mb-14");
    this.analysisSectionEl.addClass("lina-border-top");
    this.analysisSectionEl.addClass("lina-pt-12");

    const stateSection = contentEl.createEl("details");
    stateSection.open = false;
    stateSection.addClass("lina-mb-14");
    const stateSummary = stateSection.createEl("summary");
    stateSummary.addClass("lina-accordion-summary");
    stateSummary.setAttribute("title", this.L.sectionState);
    stateSummary.addClass("lina-cursor-pointer");
    stateSummary.addClass("lina-mb-8");
    const stateChevron = stateSummary.createSpan({ text: "▶" });
    stateChevron.addClass("lina-accordion-chevron");
    stateChevron.setAttribute("aria-hidden", "true");
    stateSummary.createEl("strong", { text: this.L.sectionState });
    stateSection.addEventListener("toggle", () => {
      this.syncCollapsibleSectionState(
        stateSection,
        stateSummary,
        stateChevron
      );
    });
    this.syncCollapsibleSectionState(
      stateSection,
      stateSummary,
      stateChevron
    );

    this.stateContainer = stateSection.createDiv();
    this.stateContainer.addClass("lina-fs-09");
    this.stateContainer.addClass("lina-color-muted");

    this.detailsContainer = stateSection.createDiv();
    this.detailsContainer.addClass("lina-mb-14");

    this.statusEl = contentEl.createDiv();
    this.statusEl.addClass("lina-fs-09");
    this.statusEl.addClass("lina-color-muted");
    this.statusEl.addClass("lina-mb-10");

    await this.refreshState();

    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      this.handleActiveFileChange(file);
    }));

    window.setTimeout(() => this.queryInput.focus(), 50);
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  private setStatus(message: string): void {
    this.statusEl.textContent = message;
  }

  private setSearchStatus(message: string): void {
    this.resultsStatusEl.textContent = message;
  }

  private syncCollapsibleSectionState(
    section: HTMLDetailsElement,
    summary: HTMLElement,
    chevron: HTMLSpanElement
  ): void {
    const expanded = section.open;
    chevron.setText(expanded ? "▼" : "▶");
    summary.setAttribute("aria-expanded", String(expanded));
  }

  private hideAnalysisArea(clearContent: boolean): void {
    if (!this.analysisSectionEl) return;

    if (clearContent && this.analysisResultEl) {
      this.analysisResultEl.empty();
    }
    this.analysisSectionEl.open = false;
    this.syncAnalysisSectionState();
    this.analysisSectionEl.addClass("lina-hidden");
  }

  private collapseAnalysisArea(): void {
    const analysisSection = this.analysisSectionEl;
    if (analysisSection && !analysisSection.classList.contains("lina-hidden")) {
      analysisSection.open = false;
      this.syncAnalysisSectionState();
    }
  }

  private showSearchResultsArea(): void {
    this.resultsSectionEl.removeClass("lina-hidden");
    this.resultsSectionEl.addClass("lina-display-block");
    this.resultsSectionEl.open = true;
    this.syncCollapsibleSectionState(
      this.resultsSectionEl,
      this.resultsSummaryEl,
      this.resultsChevronEl
    );
  }

  private hideSearchResultsArea(clearContent: boolean): void {
    if (clearContent) {
      this.resultsEl.empty();
      this.setSearchStatus("");
    }
    this.resultsSectionEl.open = false;
    this.syncCollapsibleSectionState(
      this.resultsSectionEl,
      this.resultsSummaryEl,
      this.resultsChevronEl
    );
    this.resultsSectionEl.addClass("lina-hidden");
  }

  private collapseSearchResultsArea(): void {
    if (!this.resultsSectionEl.classList.contains("lina-hidden")) {
      this.resultsSectionEl.open = false;
      this.syncCollapsibleSectionState(
        this.resultsSectionEl,
        this.resultsSummaryEl,
        this.resultsChevronEl
      );
    }
  }

  private clearResults(): void {
    this.resultsEl.empty();
  }

  private prepareAnalysisArea(): void {
    this.analysisRunId += 1;
    this.collapseSearchResultsArea();
    this.hideAnalysisArea(true);
    this.clearLastSuggestedMetadata();
    this.currentStructuredResult = undefined;
    this.currentActiveFilePath = undefined;
    this.currentAnalysisSourcePath = undefined;
    this.currentAnalysisScope = undefined;
    this.structuredSelections.clear();
    this.selectableItemsMap.clear();
    this.preservedMetadataSelections.clear();
    this.preservedMetadataItems.clear();
    this.setStatus("");
  }

  private handleActiveFileChange(file: TFile | null): void {
    if (this.currentAnalysisSourcePath === undefined) {
      return;
    }

    const activePath = file?.path;
    if (this.currentAnalysisSourcePath !== null && activePath === this.currentAnalysisSourcePath) {
      return;
    }

    this.clearAiResultsForNoteChangePreservingSuggestedTags();
  }

  private clearAiResultsForNoteChangePreservingSuggestedTags(): void {
    this.analysisRunId += 1;
    this.currentStructuredResult = undefined;
    this.currentActiveFilePath = undefined;
    this.currentAnalysisSourcePath = undefined;
    this.currentAnalysisScope = undefined;
    this.structuredSelections.clear();
    this.selectableItemsMap.clear();
    this.preservedMetadataSelections.clear();
    this.preservedMetadataItems.clear();
    this.setStatus("");

    if (!this.analysisResultEl) {
      return;
    }

    this.analysisResultEl.empty();
    this.setAnalysisNoteName(undefined);

    if (!this.hasPreservedSuggestedMetadata()) {
      this.hideAnalysisArea(true);
      return;
    }

    if (this.analysisTitleEl) {
      this.analysisTitleEl.setText(this.L.analysisSuggestedMetadata);
    }

    if (this.analysisSectionEl) {
      this.analysisSectionEl.removeClass("lina-hidden");
      this.analysisSectionEl.addClass("lina-display-block");
      this.analysisSectionEl.open = true;
      this.syncAnalysisSectionState();
    }

    this.renderPreservedSuggestedMetadata(this.analysisResultEl);
  }

  private setLastSuggestedTags(tags: string[]): void {
    const uniqueTags: string[] = [];
    const seen = new Set<string>();

    for (const tag of normalizarTags(tags)) {
      if (seen.has(tag)) continue;
      seen.add(tag);
      uniqueTags.push(tag);
    }

    this.lastSuggestedTags = uniqueTags;
  }

  private setLastSuggestedYaml(yaml?: SuggestedYaml): void {
    this.lastSuggestedYaml = yaml ? { ...yaml } : {};
  }

  private clearLastSuggestedMetadata(): void {
    this.setLastSuggestedTags([]);
    this.setLastSuggestedYaml(undefined);
    this.lastSuggestedMetadataScope = undefined;
  }

  private preserveSingleNoteSuggestedMetadata(yaml?: SuggestedYaml, tags: string[] = []): void {
    this.setLastSuggestedYaml(yaml);
    this.setLastSuggestedTags(tags);
    this.lastSuggestedMetadataScope =
      this.lastSuggestedTags.length > 0 || Object.keys(this.lastSuggestedYaml).length > 0
        ? "single-note"
        : undefined;
  }

  private hasPreservedSuggestedMetadata(): boolean {
    return this.lastSuggestedMetadataScope === "single-note" &&
      (this.lastSuggestedTags.length > 0 || Object.keys(this.lastSuggestedYaml).length > 0);
  }

  private formatYamlLines(yaml: SuggestedYaml): string[] {
    return Object.entries(yaml).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`);
  }

  private formatYamlForClipboard(yaml: SuggestedYaml): string {
    return this.formatYamlLines(yaml).join("\n").trim();
  }

  private formatTagsForClipboard(tags: string[]): string {
    return normalizarTags(tags).join(", ");
  }

  private formatSuggestedMetadataForClipboard(): string {
    const lines: string[] = [];
    const yamlText = this.formatYamlForClipboard(this.lastSuggestedYaml);
    const tagsText = this.formatTagsForClipboard(this.lastSuggestedTags);

    if (yamlText) {
      lines.push(`## ${this.L.previewYamlSuggested}`);
      lines.push(yamlText);
    }

    if (tagsText) {
      if (lines.length > 0) lines.push("");
      lines.push(`## ${this.L.previewTagsSuggested}`);
      lines.push(tagsText);
    }

    return lines.join("\n").trim();
  }

  private renderCopyMetadataButton(container: HTMLElement, label: string, textToCopy: string): void {
    const cleanText = textToCopy.trim();
    if (!cleanText) return;

    const button = container.createEl("button", { text: label });
    button.addClass("lina-p-4-8");
    button.addClass("lina-fs-085");
    button.addClass("lina-cursor-pointer");
    button.addEventListener("click", () => {
      void this.copySuggestedMetadataToClipboard(cleanText);
    });
  }

  private async copySuggestedMetadataToClipboard(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      new Notice(this.L.analysisCopyMetadataSuccess);
    } catch (error) {
      console.warn("Lina: não foi possível copiar metadados sugeridos:", error);
      new Notice(this.L.analysisCopyError);
    }
  }

  private renderPreservedSuggestedMetadata(container: HTMLElement): void {
    this.preservedMetadataSelections.clear();
    this.preservedMetadataItems.clear();

    const section = container.createDiv();
    section.addClass("lina-mt-12");
    section.addClass("lina-mb-8");

    const titleEl = section.createEl("strong", { text: this.L.analysisSuggestedMetadata });
    titleEl.addClass("lina-fs-09");
    titleEl.addClass("lina-display-block");
    titleEl.addClass("lina-mb-4");

    const descriptionEl = section.createDiv({ text: this.L.analysisPreservedMetadataNotice });
    descriptionEl.addClass("lina-fs-085");
    descriptionEl.addClass("lina-color-muted");
    descriptionEl.addClass("lina-mb-8");

    const buttonRow = section.createDiv();
    buttonRow.addClass("lina-display-flex");
    buttonRow.addClass("lina-flex-wrap");
    buttonRow.addClass("lina-gap-8");
    buttonRow.addClass("lina-mb-8");

    this.renderCopyMetadataButton(buttonRow, this.L.analysisCopySuggestedMetadata, this.formatSuggestedMetadataForClipboard());
    this.renderCopyMetadataButton(buttonRow, this.L.analysisCopyYaml, this.formatYamlForClipboard(this.lastSuggestedYaml));
    this.renderCopyMetadataButton(buttonRow, this.L.analysisCopyTags, this.formatTagsForClipboard(this.lastSuggestedTags));

    const applyButton = buttonRow.createEl("button", { text: this.L.analysisApplyMetadataToActiveNote });
    applyButton.addClass("lina-p-4-8");
    applyButton.addClass("lina-fs-085");
    applyButton.addClass("lina-cursor-pointer");
    applyButton.addEventListener("click", () => {
      void this.applyPreservedMetadataToActiveNote().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        new Notice(`${this.L.applySuggestionsErrorPrefix}: ${message}`);
      });
    });

    if (Object.keys(this.lastSuggestedYaml).length > 0) {
      this.renderPreservedSuggestedYaml(section, this.lastSuggestedYaml);
    }

    if (this.lastSuggestedTags.length > 0) {
      this.renderPreservedSuggestedTags(section, this.lastSuggestedTags);
    }
  }

  private renderPreservedSuggestedYaml(container: HTMLElement, yaml: SuggestedYaml): void {
    const entries = Object.entries(yaml);
    if (entries.length === 0) return;

    const section = container.createDiv();
    section.addClass("lina-mt-12");
    section.addClass("lina-mb-8");

    const titleEl = section.createEl("strong", { text: this.L.previewYamlSuggested });
    titleEl.addClass("lina-fs-09");
    titleEl.addClass("lina-display-block");
    titleEl.addClass("lina-mb-4");

    for (const [key, value] of entries) {
      const label = `${key}: ${Array.isArray(value) ? value.join(", ") : value}`;
      this.createPreservedMetadataItem(section, `yaml::${key}`, label, "yaml", key);
    }
  }

  private renderPreservedSuggestedTags(container: HTMLElement, tags: string[]): void {
    const validTags = normalizarTags(tags);
    if (validTags.length === 0) return;

    const section = container.createDiv();
    section.addClass("lina-mt-12");
    section.addClass("lina-mb-8");

    const titleEl = section.createEl("strong", { text: this.L.previewTagsSuggested });
    titleEl.addClass("lina-fs-09");
    titleEl.addClass("lina-display-block");
    titleEl.addClass("lina-mb-4");

    const existingVaultTags = this.getExistingVaultTags();
    for (const tag of validTags) {
      const existingTag = existingVaultTags.get(tag);
      const statusLabel = existingTag ? formatTagUsageLabel(existingTag.count, this.L.previewTagExisting) : this.L.previewTagNew;
      this.createPreservedMetadataItem(section, `tag::${tag}`, `${tag} - ${statusLabel}`, "tag", tag);
    }
  }

  /** Cria um item selecionável apenas para metadados preservados. */
  private createPreservedMetadataItem(
    container: HTMLElement,
    id: string,
    label: string,
    kind: PreservedMetadataKind,
    value: string
  ): void {
    const item = container.createDiv();
    item.addClass("lina-display-flex");
    item.addClass("lina-items-start");
    item.addClass("lina-gap-6");
    item.addClass("lina-py-3");
    item.addClass("lina-cursor-pointer");
    item.addClass("lina-user-select-none");

    const checkbox = item.createEl("input");
    checkbox.type = "checkbox";
    checkbox.checked = false;
    checkbox.addClass("lina-checkbox-offset");
    checkbox.addClass("lina-cursor-pointer");

    this.preservedMetadataSelections.set(id, false);
    this.preservedMetadataItems.set(id, {
      id,
      kind,
      label,
      value
    });

    const labelEl = item.createDiv({ text: label });
    labelEl.addClass("lina-fs-085");
    labelEl.addClass("lina-color-normal");
    labelEl.addClass("lina-flex-1");
    labelEl.addClass("lina-break-word");

    const updateLabelStyle = () => {
      labelEl.removeClass("lina-color-accent");
      labelEl.removeClass("lina-color-normal");
      labelEl.removeClass("lina-fw-500");
      labelEl.removeClass("lina-fw-normal");
      if (checkbox.checked) {
        labelEl.addClass("lina-color-accent");
        labelEl.addClass("lina-fw-500");
      } else {
        labelEl.addClass("lina-color-normal");
        labelEl.addClass("lina-fw-normal");
      }
    };

    const toggleHandler = () => {
      checkbox.checked = !checkbox.checked;
      this.preservedMetadataSelections.set(id, checkbox.checked);
      updateLabelStyle();
    };

    checkbox.addEventListener("change", () => {
      this.preservedMetadataSelections.set(id, checkbox.checked);
      updateLabelStyle();
    });

    item.addEventListener("click", (event) => {
      if (event.target === checkbox) return;
      toggleHandler();
    });

    labelEl.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleHandler();
    });

    updateLabelStyle();
  }

  /** Conteúdo da última resposta da IA */
  private analysisSectionEl?: HTMLDetailsElement;
  private analysisSummaryEl?: HTMLElement;
  private analysisChevronEl?: HTMLSpanElement;
  private analysisResultEl?: HTMLDivElement;
  private analysisTitleEl?: HTMLHeadingElement;
  private analysisNoteNameEl?: HTMLDivElement;

  private formatEmbeddingStateText(
    hasEmbeddings: boolean,
    validEmbeddings: number,
    missingEmbeddings: number,
    staleEmbeddings: number,
    hasIncompatibility: boolean
  ): string {
    if (!hasEmbeddings || (validEmbeddings === 0 && staleEmbeddings === 0 && missingEmbeddings === 0)) {
      return this.L.stateEmbeddingsMissing;
    }
    if (hasIncompatibility) {
      return this.L.stateEmbeddingsIncompatible;
    }

    const validText = `${validEmbeddings} ${this.L.stateEmbeddingsValid}`;
    if (missingEmbeddings > 0 && staleEmbeddings > 0) {
      return `${this.L.stateEmbeddingsAttention} · ${validText} · ${missingEmbeddings} ${this.L.stateEmbeddingsMissingCount} · ${staleEmbeddings} ${this.L.stateEmbeddingsOutdatedCount}`;
    }
    if (staleEmbeddings > 0) {
      return `${this.L.stateEmbeddingsOutdated} · ${validText} · ${staleEmbeddings} ${this.L.stateEmbeddingsOutdatedCount}`;
    }
    if (missingEmbeddings > 0) {
      return `${this.L.stateEmbeddingsMissing} · ${validText} · ${missingEmbeddings} ${this.L.stateEmbeddingsMissingCount}`;
    }
    return `${this.L.stateEmbeddingsReady} · ${validText}`;
  }

  private translateSemanticAvailabilityReason(reason?: string): string {
    if (!reason) return this.L.stateSemanticUnavailable;

    if (reason === "Embeddings não existem ou estão vazios.") {
      return this.L.stateSemanticReasonNoEmbeddings;
    }
    if (reason === "Metadados dos embeddings do índice estão incompletos.") {
      return this.L.stateSemanticReasonIncompleteMetadata;
    }
    if (reason === "Provider ou modelo do dispositivo não é compatível com o índice.") {
      return this.L.stateSemanticReasonDeviceMismatch;
    }

    const compatibilityErrorPrefix = "Erro ao verificar compatibilidade:";
    if (reason.startsWith(compatibilityErrorPrefix)) {
      return `${this.L.stateSemanticReasonCompatibilityError}: ${reason.slice(compatibilityErrorPrefix.length).trim()}`;
    }

    return reason;
  }

  private formatEmbeddingProgressStatus(message: string): string {
    const match = message.match(/(\d+)\s*\/\s*(\d+)/);
    if (match) {
      return `${this.L.statusGeneratingEmbeddings} ${match[1]}/${match[2]}`;
    }
    return message;
  }

  private async refreshState(): Promise<void> {
    const indexStatus = await readTextIndexStatus(this.app);
    const embeddingStatus = await readEmbeddingStatus(this.app);

    this.stateContainer.empty();
    this.actionsContainer.empty();
    this.detailsContainer.empty();

    const autoUpdateEnabled = this.plugin.settings.autoUpdateIndexOnFileChanges ?? false;
    const manifest = indexStatus.manifest;
    const notesExist = indexStatus.exists && typeof indexStatus.totalNotes === "number";
    const chunksExist = indexStatus.exists && typeof indexStatus.totalChunks === "number";
    const indexReady = indexStatus.exists && notesExist && chunksExist;
    const totalNotes = indexStatus.totalNotes ?? 0;
    const totalChunks = indexStatus.totalChunks ?? 0;

    const validEmbeddings = embeddingStatus?.validCount ?? 0;
    const missingEmbeddings = embeddingStatus?.missingCount ?? 0;
    const staleEmbeddings = (embeddingStatus?.staleCount ?? 0) + (embeddingStatus?.obsoleteCount ?? 0);
    const embeddingsReady = !!embeddingStatus?.exists && (embeddingStatus.validCount ?? 0) > 0;
    const embeddingsIncomplete = !!embeddingStatus && (missingEmbeddings > 0 || staleEmbeddings > 0);
    const hasProviderMismatch = !!embeddingStatus?.exists && embeddingStatus?.provider &&
      (getLocalEmbeddingsProvider() || this.plugin.settings.embeddingProvider || "ollama").toLowerCase() !== embeddingStatus.provider.toLowerCase();
    const hasModelMismatch = !!embeddingStatus?.exists && embeddingStatus?.model &&
      (getLocalEmbeddingsModel() || this.plugin.settings.embeddingModel || "") !== embeddingStatus.model;
    const hasPrefixMismatch = !!embeddingStatus?.isPrefixModeMismatch;
    const hasIncompatibility = hasProviderMismatch || hasModelMismatch || hasPrefixMismatch;

    const embeddingStateText = this.formatEmbeddingStateText(
      !!embeddingStatus?.exists,
      validEmbeddings,
      missingEmbeddings,
      staleEmbeddings,
      hasIncompatibility
    );

    this.actionsContainer.appendChild(this.createActionButton(this.L.actionAnalyseNote, async () => {
      await this.analyzeCurrentNote();
    }));

    this.actionsContainer.appendChild(this.createActionButton(this.L.actionAnalyseWithContext, async () => {
      await this.analyzeCurrentNoteWithContext();
    }));

    this.actionsContainer.appendChild(this.createActionButton(this.L.actionAnalyseInbox, async () => {
      await this.analyzeInboxNotes();
    }));

    this.actionsContainer.appendChild(this.createActionButton(this.L.actionAnalyseFolder, async () => {
      await this.openFolderAnalysisModal();
    }));

    this.stateContainer.createDiv({
      text: `${indexReady ? this.L.stateIndexReady : this.L.stateIndexMissing} · ${totalNotes} ${this.L.stateNotesLabel} · ${totalChunks} ${this.L.stateChunksLabel}`
    });
    this.stateContainer.createDiv({
      text: `Embeddings: ${embeddingStateText} · ${validEmbeddings} ${this.L.stateEmbeddingsValid} · ${missingEmbeddings} ${this.L.stateEmbeddingsMissingCount}`
    });

    // Estado da semântica
    const deviceEmbeddingProvider = getLocalEmbeddingsProvider() || this.plugin.settings.embeddingProvider || "ollama";
    const deviceEmbeddingModel = getLocalEmbeddingsModel() || this.plugin.settings.embeddingModel || "";
    const semanticCompatibility = await getSemanticSearchAvailability(this.app, deviceEmbeddingProvider, deviceEmbeddingModel);

    if (semanticCompatibility.available) {
      this.stateContainer.createDiv({
        text: `${this.L.stateSemanticAvailable} · ${semanticCompatibility.indexProvider || this.L.stateUnknown} / ${semanticCompatibility.indexModel || this.L.stateUnknown}`
      });
    } else {
      const reason = this.translateSemanticAvailabilityReason(semanticCompatibility.reason);
      this.stateContainer.createDiv({
        text: `${this.L.stateSemanticUnavailable} (${reason})`
      });
    }

    const detailsToggle = this.detailsContainer.createEl("button", {
      text: this.detailsVisible ? this.L.detailsHide : this.L.detailsShow
    });
    detailsToggle.addEventListener("click", () => {
      this.detailsVisible = !this.detailsVisible;
      void this.refreshState();
    });

    if (!this.detailsVisible) {
      return;
    }

    const detailsList = this.detailsContainer.createDiv();
    detailsList.addClass("lina-mt-8");
    detailsList.addClass("lina-fs-09");
    detailsList.addClass("lina-color-muted");

    // --- Detalhes do índice ---
    detailsList.createDiv({ text: `${this.L.detailsAutoUpdate}: ${autoUpdateEnabled ? this.L.detailsAutoUpdateActive : this.L.detailsAutoUpdateInactive}` });
    detailsList.createDiv({ text: `${this.L.detailsTextIndex}: ${indexReady ? this.L.detailsTextIndexReady : this.L.detailsTextIndexMissing}` });
    detailsList.createDiv({ text: `${this.L.detailsIndexedNotes}: ${totalNotes}` });
    detailsList.createDiv({ text: `${this.L.detailsTextChunks}: ${totalChunks}` });
    detailsList.createDiv({ text: `${this.L.detailsLastIndexUpdate}: ${manifest?.updatedAt ?? this.L.stateEmbeddingsMissing}` });

    // --- Detalhes dos embeddings ---
    const detailsSeparator = detailsList.createDiv();
    detailsSeparator.addClass("lina-mt-8");
    detailsSeparator.addClass("lina-border-top");
    detailsSeparator.addClass("lina-pt-8");

    detailsList.createDiv({ text: this.L.detailsEmbeddings });
    detailsList.createDiv({ text: `  ${this.L.detailsEmbeddingsValid}: ${validEmbeddings}` });
    detailsList.createDiv({ text: `  ${this.L.detailsEmbeddingsMissing}: ${missingEmbeddings}` });
    detailsList.createDiv({ text: `  ${this.L.detailsEmbeddingsOutdated}: ${staleEmbeddings}` });
    detailsList.createDiv({ text: `  ${this.L.detailsProvider}: ${embeddingStatus?.provider ?? this.L.stateEmbeddingsMissing}` });
    detailsList.createDiv({ text: `  ${this.L.detailsModel}: ${embeddingStatus?.model ?? this.L.stateEmbeddingsMissing}` });
    detailsList.createDiv({ text: `  ${this.L.detailsDimension}: ${embeddingStatus?.dimensions ?? this.L.stateEmbeddingsMissing}` });

    // Modo de prefixo
    const expectedPrefixMode = embeddingStatus?.expectedPrefixMode || "none";
    const manifestPrefixMode = embeddingStatus?.manifestPrefixMode || "none";
    let prefixDescription = this.L.detailsPrefixNone;
    let queryPrefix = this.L.detailsPrefixNone;
    let docPrefix = this.L.detailsPrefixNone;
    if (expectedPrefixMode === "nomic-search-query-document") {
      prefixDescription = this.L.detailsPrefixNomic;
      queryPrefix = "search_query:";
      docPrefix = "search_document:";
    }
    detailsList.createDiv({ text: `  ${this.L.detailsPrefixMode}: ${prefixDescription}` });
    detailsList.createDiv({ text: `    ${this.L.detailsQueryPrefix}: ${queryPrefix}` });
    detailsList.createDiv({ text: `    ${this.L.detailsDocumentPrefix}: ${docPrefix}` });
    detailsList.createDiv({ text: `  ${this.L.detailsManifestPrefixMode}: ${manifestPrefixMode}` });
    if (embeddingStatus?.updatedAt) {
      detailsList.createDiv({ text: `  ${this.L.detailsLastEmbeddingUpdate}: ${embeddingStatus.updatedAt}` });
    }

    // --- Avisos e estado dos embeddings ---
    const warningsDiv = detailsList.createDiv();
    warningsDiv.addClass("lina-mt-8");
    warningsDiv.addClass("lina-border-top");
    warningsDiv.addClass("lina-pt-8");

    const addWarning = (text: string) => {
      const el = warningsDiv.createDiv({ text });
      el.addClass("lina-color-warning");
      el.addClass("lina-fs-085");
      el.addClass("lina-mb-2");
    };

    const addSuccess = (text: string) => {
      const el = warningsDiv.createDiv({ text });
      el.addClass("lina-color-success");
      el.addClass("lina-fs-085");
      el.addClass("lina-mb-2");
    };

    if (hasProviderMismatch) {
      addWarning(this.L.warnProviderMismatch);
    } else if (hasModelMismatch) {
      addWarning(this.L.warnModelMismatch);
    } else if (hasPrefixMismatch) {
      addWarning(this.L.warnPrefixMismatch);
    }

    if (!hasIncompatibility) {
      if (missingEmbeddings > 0) {
        addWarning(this.L.warnEmbeddingsMissing);
      }
      if (staleEmbeddings > 0) {
        addWarning(this.L.warnEmbeddingsOutdated);
      }
      if (embeddingsReady && validEmbeddings > 0 && missingEmbeddings === 0 && staleEmbeddings === 0) {
        addSuccess(this.L.warnEmbeddingsCompatible);
      }
    }

    const deviceEmbeddingProviderLabel = getLocalEmbeddingsProvider() || this.plugin.settings.embeddingProvider || "ollama";
    const deviceEmbeddingModelLabel = getLocalEmbeddingsModel() || this.plugin.settings.embeddingModel || this.L.stateNotDefined;
    detailsList.createDiv({ text: `${this.L.detailsDeviceProvider}: ${deviceEmbeddingProviderLabel}` });
    detailsList.createDiv({ text: `${this.L.detailsDeviceModel}: ${deviceEmbeddingModelLabel}` });

    const technicalActions = this.detailsContainer.createDiv();
    technicalActions.addClass("lina-display-flex");
    technicalActions.addClass("lina-flex-wrap");
    technicalActions.addClass("lina-gap-8");
    technicalActions.addClass("lina-mt-10");

    technicalActions.appendChild(this.createActionButton(indexReady ? this.L.btnRebuildIndex : this.L.btnBuildIndex, async () => {
      this.setStatus(this.L.statusBuildingIndex);
      const result = await this.plugin.rebuildTextIndex();
      this.setStatus(result.success ? this.L.statusIndexBuilt : this.L.statusIndexError);
      await this.refreshState();
    }));

    if (!embeddingsReady && staleEmbeddings === 0 && missingEmbeddings === 0) {
      const msg = detailsList.createDiv({ text: this.L.detailsEmbeddingOnlyTextual });
      msg.addClass("lina-mt-8");
      const generateBtn = this.containerEl.ownerDocument.createElement("button");
      generateBtn.textContent = this.L.btnGenerateEmbeddings;
      generateBtn.addEventListener("click", () => void this.handleEmbeddingGeneration(generateBtn, this.L.btnGenerateEmbeddings));
      technicalActions.appendChild(generateBtn);
    } else if (embeddingsIncomplete || hasIncompatibility) {
      const updateBtn = this.containerEl.ownerDocument.createElement("button");
      updateBtn.textContent = this.L.btnUpdateEmbeddings;
      updateBtn.addEventListener("click", () => void this.handleEmbeddingGeneration(updateBtn, this.L.btnUpdateEmbeddings));
      technicalActions.appendChild(updateBtn);
    }
  }

  private async openFolderAnalysisModal(): Promise<void> {
    const folderChoices = this.getFolderAnalysisChoices();

    const modal = new Modal(this.app);
    modal.titleEl.setText(this.L.folderAnalysisModalTitle);

    if (folderChoices.length === 0) {
      modal.contentEl.createDiv({
        text: this.L.folderAnalysisNoFolders,
        attr: { style: "color: var(--text-warning); padding: 8px 0;" }
      });
      const closeButton = modal.contentEl.createEl("button", { text: this.L.folderAnalysisCancelButton });
      closeButton.addEventListener("click", () => modal.close());
      modal.open();
      return;
    }

    let selectedFolderPath = this.getPreferredFolderAnalysisPath(folderChoices);
    let includeSubfolders = this.plugin.settings.folderAnalysisIncludeSubfolders ?? false;
    const maxNotes = this.getFolderAnalysisMaxNotes();

    const folderRow = modal.contentEl.createDiv();
    folderRow.addClass("lina-mb-8");
    folderRow.createDiv({ text: this.L.folderAnalysisFolder }).addClass("lina-fs-085");
    const folderSelect = folderRow.createEl("select");
    folderSelect.addClass("dropdown");
    for (const folder of folderChoices) {
      const option = folderSelect.createEl("option", { text: folder });
      option.value = folder;
    }
    folderSelect.value = selectedFolderPath;

    const includeRow = modal.contentEl.createDiv();
    includeRow.addClass("lina-display-flex");
    includeRow.addClass("lina-items-center");
    includeRow.addClass("lina-gap-6");
    includeRow.addClass("lina-mb-8");
    const includeCheckbox = includeRow.createEl("input");
    includeCheckbox.type = "checkbox";
    includeCheckbox.checked = includeSubfolders;
    includeRow.createSpan({ text: this.L.folderAnalysisIncludeSubfolders });

    modal.contentEl.createDiv({
      text: `${this.L.folderAnalysisLimit}: ${maxNotes}`,
      attr: { style: "color: var(--text-muted); font-size: 0.85em; margin-bottom: 8px;" }
    });

    const countEl = modal.contentEl.createDiv();
    countEl.addClass("lina-fs-085");
    countEl.addClass("lina-color-muted");
    countEl.addClass("lina-mb-12");

    const buttons = modal.contentEl.createDiv();
    buttons.addClass("lina-display-flex");
    buttons.addClass("lina-justify-end");
    buttons.addClass("lina-gap-8");
    buttons.addClass("lina-mt-16");

    const cancelButton = buttons.createEl("button", { text: this.L.folderAnalysisCancelButton });
    const analyzeButton = buttons.createEl("button", { text: this.L.folderAnalysisAnalyseButton });
    analyzeButton.classList.add("mod-cta");

    const updateCounts = () => {
      try {
        const collection = this.getFolderMarkdownNotes(selectedFolderPath, {
          includeSubfolders,
          maxNotes,
          sortBy: "mtime"
        });
        countEl.setText(
          `${this.L.folderAnalysisCounts}: ` +
          `${this.L.folderAnalysisCountFound}: ${collection.totalFound} · ` +
          `${this.L.folderAnalysisCountEligible}: ${collection.totalEligible} · ` +
          `${this.L.folderAnalysisCountExcludedByPath}: ${collection.totalExcludedByPath} · ` +
          `${this.L.folderAnalysisCountTruncated}: ${collection.totalTruncated}`
        );
        analyzeButton.disabled = collection.notes.length === 0;
      } catch (error) {
        countEl.setText(error instanceof Error ? error.message : String(error));
        analyzeButton.disabled = true;
      }
    };

    folderSelect.addEventListener("change", () => {
      selectedFolderPath = folderSelect.value;
      updateCounts();
    });

    includeCheckbox.addEventListener("change", () => {
      includeSubfolders = includeCheckbox.checked;
      updateCounts();
    });

    cancelButton.addEventListener("click", () => modal.close());
    analyzeButton.addEventListener("click", () => {
      const folderToAnalyze = selectedFolderPath;
      const includeSubfoldersForRun = includeSubfolders;
      modal.close();
      void this.analyzeFolderNotes(folderToAnalyze, { includeSubfolders: includeSubfoldersForRun });
    });

    updateCounts();
    modal.open();
  }

  private createActionButton(label: string, onClick: () => Promise<void>): HTMLButtonElement {
    const button = this.containerEl.ownerDocument.createElement("button");
    button.textContent = label;
    button.addEventListener("click", () => void onClick());
    return button;
  }

  private getSelectedSearchMode(): SearchMode | null {
    if (this.searchModeRadioButtons.textual?.checked) return "textual";
    if (this.searchModeRadioButtons.hibrida?.checked) return "hibrida";
    if (this.searchModeRadioButtons.semantica?.checked) return "semantica";
    return null;
  }

  private async runSearch(): Promise<void> {
    const query = this.queryInput.value.trim();
    this.collapseAnalysisArea();
    this.showSearchResultsArea();
    this.clearResults();
    this.setSearchStatus("");
    this.setStatus("");

    const selectedMode = this.getSelectedSearchMode();
    if (!selectedMode) {
      new Notice(this.L.searchSelectMode);
      this.setSearchStatus(this.L.searchSelectMode);
      return;
    }
    this.currentMode = selectedMode;

    if (!query) {
      return;
    }

    const notes = await readIndexedNotes(this.app);
    const chunks = await readIndexedChunks(this.app);

    if (!notes) {
      this.setSearchStatus(this.L.errorIndexNotReady);
      await this.refreshState();
      return;
    }

    if (!chunks) {
      this.setSearchStatus("Índice textual ainda não existe.");
      await this.refreshState();
      return;
    }

    const safeChunks = this.filterChunksByUserContentRules(chunks);
    const safeNotes = this.filterNotesByFilteredChunks(notes, safeChunks, chunks);

    this.setSearchStatus("A pesquisar...");

    try {
      if (selectedMode === "textual") {
        // Pedir mais resultados brutos para compensar agrupamento
        const rawResults = searchTextIndex(safeNotes, safeChunks, query, {
          maxResults: MAX_NOTES_DISPLAY * RAW_REQUEST_MULTIPLIER,
          maxChunksPerNote: 5,
        });
        const cards = groupResultsByNote(rawResults).slice(0, MAX_NOTES_DISPLAY);
        this.renderGroupedCards(cards);
        return;
      }

      if (selectedMode === "semantica") {
        await this.runSemanticSearchGrouped(query, safeChunks);
        return;
      }

      await this.runHybridModeGrouped(query, safeNotes, safeChunks);
    } catch (error) {
      this.setSearchStatus(`Erro na pesquisa: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async runHybridModeGrouped(query: string, notes: Awaited<ReturnType<typeof readIndexedNotes>>, chunks: Chunk[]): Promise<void> {
    const textWeight = this.plugin.settings.hybridSearchTextWeight ?? 0.7;
    const semanticWeight = this.plugin.settings.hybridSearchSemanticWeight ?? 0.3;
    const totalWeight = textWeight + semanticWeight;
    const normalisedTextWeight = totalWeight > 0 ? textWeight / totalWeight : 0.7;
    const normalisedSemanticWeight = totalWeight > 0 ? semanticWeight / totalWeight : 0.3;
    const baseUrl = this.plugin.settings.embeddingBaseUrl || this.plugin.settings.aiBaseUrl || "http://localhost:11434";
    const model = this.plugin.settings.embeddingModel || "nomic-embed-text";
    const timeoutMs = (this.plugin.settings.embeddingRequestTimeoutSeconds || 60) * 1000;
    const deviceProvider = getLocalEmbeddingsProvider() || this.plugin.settings.embeddingProvider || "ollama";
    const deviceModel = getLocalEmbeddingsModel() || this.plugin.settings.embeddingModel || model;

    const result = await runHybridSearch(this.app, notes ?? [], chunks, query, {
      baseUrl,
      model,
      timeoutMs,
      textWeight: normalisedTextWeight,
      semanticWeight: normalisedSemanticWeight,
      deviceProvider,
      deviceModel,
    });

    if (result.warnings.length > 0) {
      this.setSearchStatus(result.warnings.join(" "));
    } else {
      this.setSearchStatus("");
    }

    if (result.results.length === 0) {
      this.setSearchStatus(this.resultsStatusEl.textContent
        ? `${this.resultsStatusEl.textContent} ${this.L.searchNoResults}`
        : this.L.searchNoResults);
      return;
    }

    const cards = groupResultsByNote(result.results).slice(0, MAX_NOTES_DISPLAY);
    this.renderGroupedCards(cards);
  }

  private async runSemanticSearchGrouped(query: string, chunks: Chunk[]): Promise<void> {
    // Usar o estado dos embeddings do manifesto para validação robusta
    const embeddingStatus = await readEmbeddingStatus(this.app);
    if (!embeddingStatus || !embeddingStatus.exists || embeddingStatus.validCount === 0) {
      this.setSearchStatus(this.L.semanticNoEmbeddings);
      return;
    }

    const settingsProvider = (getLocalEmbeddingsProvider() || this.plugin.settings.embeddingProvider || "ollama").toLowerCase();
    const settingsModel = getLocalEmbeddingsModel() || this.plugin.settings.embeddingModel || "nomic-embed-text";
    const baseUrl = this.plugin.settings.embeddingBaseUrl || this.plugin.settings.aiBaseUrl || "http://localhost:11434";

    // Validar compatibilidade usando dados do manifesto/estado (mais fiável que embeddings[0]?.model)
    const indexProvider = (embeddingStatus.provider || "").toLowerCase();
    const indexModel = embeddingStatus.model || "";

    if (indexProvider && indexProvider !== settingsProvider) {
      this.setSearchStatus(`Os embeddings foram gerados com o provider "${embeddingStatus.provider}" mas a pesquisa está configurada para "${settingsProvider}". Atualiza os embeddings antes de usar a pesquisa semântica.`);
      return;
    }

    if (indexModel && indexModel !== settingsModel) {
      this.setSearchStatus(`Os embeddings foram gerados com o modelo "${indexModel}" mas a pesquisa está configurada para "${settingsModel}". Atualiza os embeddings antes de usar a pesquisa semântica.`);
      return;
    }

    // Validar modo de prefixo
    if (embeddingStatus.isPrefixModeMismatch) {
      this.setSearchStatus(`Os embeddings foram gerados com modo de prefixo diferente. Atualiza os embeddings antes de usar a pesquisa semântica.`);
      return;
    }

    // Carregar embeddings apenas depois de validar compatibilidade
    const embeddings = await loadEmbeddings(this);
    if (!embeddings || embeddings.length === 0) {
      this.setSearchStatus(this.L.semanticNoEmbeddings);
      return;
    }

    // Validar consistência da dimensão no primeiro embedding carregado
    const expectedDimension = embeddingStatus.dimensions || 0;
    if (expectedDimension > 0 && embeddings[0]?.dimensions !== expectedDimension) {
      this.setSearchStatus("Incompatibilidade de dimensão nos embeddings. Atualiza os embeddings antes de usar a pesquisa semântica.");
      return;
    }

    // Aplicar prefixo search_query: para modelos Nomic, tal como os embeddings foram indexados com search_document:
    const prefixMode = getPrefixModeForModel(settingsModel);
    const queryWithPrefix = applyEmbeddingPrefix(query, prefixMode, true);

    // Usar generateOllamaEmbedding (com fallback /api/embed → /api/embeddings), mesma função da modal
    const ollamaStatus = await generateOllamaEmbedding(baseUrl, settingsModel, queryWithPrefix);
    if (!ollamaStatus.success || !ollamaStatus.embedding) {
      this.setSearchStatus(`Erro na pesquisa semântica: a geração do embedding falhou. Verifica o provider de embeddings (${settingsModel}).`);
      return;
    }
    const queryEmbedding = ollamaStatus.embedding;

    const rawResults = searchSemanticIndex(queryEmbedding, embeddings, chunks, {
      maxResults: MAX_NOTES_DISPLAY * RAW_REQUEST_MULTIPLIER,
      maxResultsPerNote: 5,
    });
    const cards = groupResultsByNote(rawResults).slice(0, MAX_NOTES_DISPLAY);
    this.renderGroupedCards(cards);
  }

  // -----------------------------------------------------------------------
  // Renderização de cartões agrupados
  // -----------------------------------------------------------------------
  private renderGroupedCards(cards: GroupedNoteCard[], searchMode?: SearchMode): void {
    if (cards.length === 0) {
      this.setSearchStatus(this.L.searchNoResults);
      return;
    }
    this.setSearchStatus("");

    const mode = searchMode ?? this.currentMode;
    for (const card of cards) {
      this.renderHighlightedCard(card, mode);
    }
  }

  // -----------------------------------------------------------------------
  // IA — Analisar nota atual
  // -----------------------------------------------------------------------

  /** Limite de caracteres do conteúdo enviado ao modelo */
  private static readonly MAX_CONTENT_CHARS = 8000;

  /**
   * Gere o processo de geração/atualização de embeddings com feedback visual:
   * - mostra toast inicial
   * - desativa o botão durante o processo
   * - mostra toast de sucesso ou erro no fim
   * - atualiza o painel Estado
   */
  private async handleEmbeddingGeneration(button: HTMLButtonElement, label: string): Promise<void> {
    if (this.isGeneratingEmbeddings) {
      new Notice(this.L.toastEmbeddingsAlreadyRunning);
      return;
    }

    this.isGeneratingEmbeddings = true;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = this.L.statusGeneratingLabel;
    this.setStatus(this.L.statusGeneratingEmbeddings);
    new Notice(this.L.toastGeneratingEmbeddings);

    try {
      const result = await this.plugin.generateLocalEmbeddings((message) => this.setStatus(this.formatEmbeddingProgressStatus(message)));

      if (result.success) {
        this.setStatus(this.L.statusEmbeddingsSuccess);
        new Notice(this.L.toastEmbeddingsSuccess);
      } else {
        this.setStatus(this.L.statusEmbeddingsError);
        new Notice(this.L.toastEmbeddingsError);
      }

      await this.refreshState();

      // Verificar se ainda há embeddings em falta/desatualizados após a geração
      const embeddingStatus = await readEmbeddingStatus(this.app);
      const stillMissing = (embeddingStatus?.missingCount ?? 0) > 0;
      const stillStale = (embeddingStatus?.staleCount ?? 0) > 0 || (embeddingStatus?.obsoleteCount ?? 0) > 0;
      if (result.success && (stillMissing || stillStale)) {
        this.setStatus(this.L.statusEmbeddingsPartial);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.setStatus(`${this.L.statusEmbeddingsErrorPrefix}: ${msg}`);
      new Notice(`${this.L.statusEmbeddingsErrorPrefix}: ${msg}`);
    } finally {
      this.isGeneratingEmbeddings = false;
      button.disabled = false;
      button.textContent = originalText ?? label;
    }
  }

  /**
   * Encontra notas relacionadas para a nota atual usando pesquisa híbrida.
   */
  private getRelatedSourceLabel(source?: RelatedNote["source"]): string {
    switch (source) {
      case "textual":
        return this.L.relatedSourceTextual;
      case "semantica":
        return this.L.relatedSourceSemantic;
      case "hibrida":
        return this.L.relatedSourceHybrid;
      default:
        return this.L.relatedSourceHybrid;
    }
  }

  private getRelatedTextOriginReason(origin?: RelatedNote["textOrigin"]): string | undefined {
    switch (origin) {
      case "nome":
        return this.L.relatedReasonTitle;
      case "caminho":
        return this.L.relatedReasonPath;
      case "conteudo":
        return this.L.relatedReasonContent;
      default:
        return undefined;
    }
  }

  private getRelatedFolderReason(relation?: RelatedNote["folderRelation"]): string | undefined {
    switch (relation) {
      case "same-folder":
        return this.L.relatedReasonSameFolder;
      case "same-root":
        return this.L.relatedReasonSameArea;
      default:
        return undefined;
    }
  }

  private buildRelatedNoteReason(note: RelatedNote): string {
    const reasons: string[] = [];
    const textReason = this.getRelatedTextOriginReason(note.textOrigin);
    const hasSemanticSignal = note.source === "semantica" || note.source === "hibrida";

    if (textReason) {
      reasons.push(textReason);
    }

    if (hasSemanticSignal && textReason !== this.L.relatedReasonContent) {
      reasons.push(this.L.relatedReasonSimilarContent);
    } else if (note.source === "semantica" && !textReason) {
      reasons.push(this.L.relatedReasonSimilarContent);
    }

    const folderReason = this.getRelatedFolderReason(note.folderRelation);
    if (folderReason) {
      reasons.push(folderReason);
    }

    return reasons.length > 0 ? reasons.join(" + ") : this.getRelatedSourceLabel(note.source);
  }

  private formatRelatedNoteDescription(note: RelatedNote): string {
    const parts = [
      `${this.L.relatedOriginLabel}: ${this.getRelatedSourceLabel(note.source)}`,
    ];

    if (note.score !== undefined) {
      parts.push(`${this.L.relatedScoreLabel}: ${Math.round(note.score)}`);
    }

    parts.push(`${this.L.relatedReasonLabel}: ${this.buildRelatedNoteReason(note)}`);
    return parts.join(" · ");
  }

  private renderRelatedNoteSummaryItem(container: HTMLElement, note: RelatedNote): void {
    const noteItem = container.createDiv();
    noteItem.addClass("lina-mb-4");

    const mainLine = noteItem.createDiv();
    mainLine.addClass("lina-nowrap");
    mainLine.addClass("lina-overflow-hidden");
    mainLine.addClass("lina-text-ellipsis");

    const titleEl = mainLine.createSpan({ text: note.title });
    titleEl.addClass("lina-fw-500");

    mainLine.createSpan({ text: " — " });

    const pathEl = mainLine.createSpan({ text: note.path });
    pathEl.addClass("lina-color-muted");
    pathEl.addClass("lina-fs-085");

    const detailsEl = noteItem.createDiv({ text: this.formatRelatedNoteDescription(note) });
    detailsEl.addClass("lina-color-muted");
    detailsEl.addClass("lina-fs-08");
    detailsEl.addClass("lina-mt-2");
  }

  private async findRelatedNotesForCurrentNote(title: string, path: string, content: string): Promise<RelatedNote[]> {
    // Criar query melhorada a partir da nota atual
    const queryParts: string[] = [];

    // Adicionar título com mais peso
    queryParts.push(title);
    queryParts.push(title); // Repetir título para dar mais peso

    // Adicionar partes do caminho (ex: "APP Sumários") com foco em projetos
    const pathParts = path.split('/');
    for (const part of pathParts) {
      if (part && !part.endsWith('.md') && part !== title) {
        // Dar mais peso a partes que pareçam projetos (maiúsculas, números)
        if (part === part.toUpperCase() || part.includes('_') || /\d/.test(part)) {
          queryParts.push(part);
          queryParts.push(part); // Repetir para dar mais peso
        } else {
          queryParts.push(part);
        }
      }
    }

    // Adicionar primeiras linhas do conteúdo, mas filtrar linhas genéricas
    const firstLines = content.substring(0, 500);
    // Remover linhas que sejam apenas cabeçalhos genéricos
    const filteredFirstLines = firstLines.split('\n').filter(line => {
      const trimmedLine = line.trim().toLowerCase();
      // Filtrar linhas genéricas como "## Alunos", "### Avaliação", etc.
      return !trimmedLine.startsWith('## alunos') &&
             !trimmedLine.startsWith('## avaliação') &&
             !trimmedLine.startsWith('## turma') &&
             !trimmedLine.startsWith('### grupo') &&
             trimmedLine.length > 10; // Ignorar linhas muito curtas
    }).join(' ');
    queryParts.push(filteredFirstLines);

    const query = queryParts.join(' ');

    // Executar pesquisa híbrida
    const notes = await readIndexedNotes(this.app);
    const chunks = await readIndexedChunks(this.app);

    if (!notes || !chunks) {
      return [];
    }

    const safeChunks = this.filterChunksByUserContentRules(chunks);
    const safeNotes = this.filterNotesByFilteredChunks(notes, safeChunks, chunks);

    const baseUrl = this.plugin.settings.embeddingBaseUrl || this.plugin.settings.aiBaseUrl || "http://localhost:11434";
    const model = this.plugin.settings.embeddingModel || "nomic-embed-text";
    const timeoutMs = (this.plugin.settings.embeddingRequestTimeoutSeconds || 60) * 1000;
    const textWeight = this.plugin.settings.hybridSearchTextWeight ?? 0.7;
    const semanticWeight = this.plugin.settings.hybridSearchSemanticWeight ?? 0.3;
    const totalWeight = textWeight + semanticWeight;
    const normalisedTextWeight = totalWeight > 0 ? textWeight / totalWeight : 0.7;
    const normalisedSemanticWeight = totalWeight > 0 ? semanticWeight / totalWeight : 0.3;

    const result = await runHybridSearch(this.app, safeNotes, safeChunks, query, {
      baseUrl,
      model,
      timeoutMs,
      textWeight: normalisedTextWeight,
      semanticWeight: normalisedSemanticWeight,
    });

    if (result.results.length === 0) {
      return [];
    }

    // Filtrar e limitar resultados com melhorias
    const relatedNotesByPath = new Map<string, RelatedNote>();
    const currentPathNormalized = normalizeResultPath(path);
    const existingWikiLinkTargets = extractExistingWikiLinkTargets(content);

    // Score mínimo para considerar uma nota relevante
    const MIN_BASE_SCORE = 30;
    const MIN_ADJUSTED_SCORE = 25;

    for (const r of result.results) {
      const relatedPathNormalized = normalizeResultPath(r.path);
      // Excluir a própria nota atual
      if (relatedPathNormalized === currentPathNormalized) {
        continue;
      }

      if (isAlreadyLinkedNote(r.path, existingWikiLinkTargets)) {
        continue;
      }

      // Calcular pontuação ajustada com bónus/penalizações
      const baseScore = r.finalScore ?? 0;
      if (baseScore < MIN_BASE_SCORE) {
        continue;
      }

      // Aplicar bónus por proximidade de pasta
      const folderMultiplier = this.calculateFolderScore(path, r.path);
      const folderRelation: RelatedNote["folderRelation"] =
        folderMultiplier >= 1.1 ? "same-folder" :
        folderMultiplier > 1 ? "same-root" :
        "different-folder";

      // Aplicar penalização por irrelevância
      const irrelevancePenalty = this.applyIrrelevancePenalty(r.basename);

      // Calcular pontuação ajustada
      const adjustedScore = baseScore * folderMultiplier * irrelevancePenalty;

      // Aplicar score mínimo
      if (adjustedScore < MIN_ADJUSTED_SCORE) {
        continue; // Ignorar notas com pontuação demasiado baixa
      }

      // Adicionar nota relacionada com pontuação ajustada
      const relatedNote = {
        title: r.basename,
        path: r.path,
        snippet: r.snippet,
        score: adjustedScore,
        baseScore,
        source: r.source,
        textOrigin: r.textOrigin,
        textScore: r.textScore,
        semanticScore: r.semanticSimilarity,
        folderRelation,
      };
      const existing = relatedNotesByPath.get(relatedPathNormalized);
      if (!existing || (existing.score ?? 0) < adjustedScore) {
        relatedNotesByPath.set(relatedPathNormalized, relatedNote);
      }
    }

    // Ordenar por pontuação ajustada (descendente)
    const relatedNotes = Array.from(relatedNotesByPath.values());
    relatedNotes.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    return relatedNotes.slice(0, 10);
  }

  /**
   * Calcula pontuação adicional com base na proximidade de pastas.
   * Notas na mesma pasta ou projeto recebem bónus.
   */
  private calculateFolderScore(currentPath: string, relatedPath: string): number {
    const currentFolder = normalizeResultPath(getFolderPathFromPath(currentPath));
    const relatedFolder = normalizeResultPath(getFolderPathFromPath(relatedPath));

    if (currentFolder === relatedFolder) {
      return 1.15;
    }

    const currentRoot = currentFolder.split('/').filter(p => p.length > 0)[0] ?? "";
    const relatedRoot = relatedFolder.split('/').filter(p => p.length > 0)[0] ?? "";

    if (currentRoot && relatedRoot && currentRoot === relatedRoot) {
      return 1.05;
    }

    return 0.85;
  }

  /**
   * Aplica penalizações a notas claramente irrelevantes.
   * Penaliza notas que pareçam ser apenas datas, nomes de alunos, etc.
   */
  private applyIrrelevancePenalty(title: string): number {
    // Normalizar para comparação
    const normalizedTitle = title.toLowerCase();

    // Penalizar títulos que sejam principalmente datas ou números
    const dateNumberPattern = /^\d{4}_\d{4}_\d{4}$|^\d{2}_\d{2}_\d{4}$|^\d{4}-\d{2}-\d{2}$/;
    if (dateNumberPattern.test(normalizedTitle.replace(/_/g, '-'))) {
      return 0.3; // Penalização forte para notas que pareçam datas
    }

    // Penalizar títulos que contenham nomes de alunos comuns
    const studentNamePatterns = ['aluno', 'aluna', 'estudante', 'turma', 'grupo'];
    if (studentNamePatterns.some(pattern => normalizedTitle.includes(pattern))) {
      return 0.5; // Penalização média para notas de alunos
    }

    // Penalizar notas muito curtas (apenas números ou códigos)
    if (normalizedTitle.length <= 5 && /^\d+$/.test(normalizedTitle)) {
      return 0.4; // Penalização para títulos muito curtos numéricos
    }

    // Sem penalização
    return 1.0;
  }

  // -----------------------------------------------------------------------
  // Construção de prompts (Fase 5A - agora pedem JSON)
  // -----------------------------------------------------------------------

  /**
   * Constrói o prompt interno para análise da nota atual, pedindo JSON estruturado.
   */
  private buildCurrentNoteAnalysisPrompt(title: string, path: string, content: string): string {
    let truncatedContent = content;
    let truncationNote = "";

    if (content.length > LinaSearchView.MAX_CONTENT_CHARS) {
      truncatedContent = content.substring(0, LinaSearchView.MAX_CONTENT_CHARS);
      truncationNote = "\n\n(O conteúdo foi truncado por ser demasiado longo.)";
    }

    const lastSlashIndex = path.lastIndexOf('/');
    const currentFolder = lastSlashIndex >= 0 ? path.substring(0, lastSlashIndex) + '/' : '';
    const currentFilename = lastSlashIndex >= 0 ? path.substring(lastSlashIndex + 1) : path;
    const existingFoldersSection = this.formatExistingFoldersForPrompt(path, title, content);
    const lang = this.plugin.settings.aiOutputLanguage;
    let languageInstruction = "";
    switch (lang) {
      case "pt-PT":
        languageInstruction = "Responde obrigatoriamente em português europeu.";
        break;
      case "pt-BR":
        languageInstruction = "Responde obrigatoriamente em português do Brasil.";
        break;
      case "en":
        languageInstruction = "Respond in English.";
        break;
      case "es":
        languageInstruction = "Responde obligatoriamente en español.";
        break;
      case "fr":
        languageInstruction = "Réponds obligatoirement en français.";
        break;
      case "auto":
        languageInstruction = "Responde no idioma predominante da nota.";
        break;
      default:
        languageInstruction = "Responde obrigatoriamente em português europeu.";
    }

    let yamlSection = "";
    const yamlEnabled = this.plugin.settings.yamlSuggestionsEnabled;
    if (yamlEnabled) {
      yamlSection = `* A sugestão de YAML está ATIVADA.
* Sugere YAML simples com as propriedades definidas em: ${this.plugin.settings.yamlAllowedProperties}
* As tags devem ser devolvidas apenas no campo "tags". NÃO incluas "tags" dentro do objeto "yaml".
* Não crie propriedades fora da lista permitida.
* Não inventes campos como data_criacao, autor, utilizador_id, adapta_style, prazo, disciplina ou turma.`;
    } else {
      yamlSection = `* A sugestão de YAML está DESATIVADA.
* NÃO incluas YAML no JSON. O campo "yaml" deve ser omitido.`;
    }

    const linksInstruction = `* Como ainda não são passadas notas relacionadas, o campo "internalLinks" deve ser um array vazio [].`;

    return `${languageInstruction}

Analisa apenas a nota Markdown colocada entre <<<NOTA>>> e <<<FIM_NOTA>>>.

Não organizes o vault.
Não sugiras uma nova estrutura de pastas para o vault.
Não uses Markdown decorativo.
Não uses negrito.
Não uses tabelas.
Não uses ícones.
Não escrevas introduções como "Aqui está...".
Não inventes datas.
Não inventes links internos.
Não inventes caminhos de notas.

Regras para pasta sugerida:

Pastas existentes no vault que podes escolher preferencialmente:
${existingFoldersSection}

* Escolhe preferencialmente uma das pastas existentes listadas.
* Não inventes pastas na raiz do vault.
* Não sugiras INBOX, Inbox, 01_inbox ou 00_Inbox como destino.
* Se nenhuma pasta existente for adequada, propõe uma nova pasta dentro de uma pasta raiz existente listada.
* Se tiveres pouca confiança, deixa "suggestedFolder" vazio ou usa a pasta atual se ela não for Inbox.
* Se a pasta atual parecer adequada e não for Inbox, usa: "${currentFolder}"

Regras para tags (no máximo ${this.plugin.settings.maxSuggestedTags}):

* minúsculas, sem acentos, espaços convertidos para underscore
* evitar tags genéricas como "projeto", "sistema", "nota" ou "geral"
* normalizar: "Gestão de Trabalhos" → gestao_trabalhos

Regras para links internos:
${linksInstruction}

Responde APENAS com JSON válido, sem texto extra, sem formatação decorativa, sem blocos de código.

Estrutura JSON obrigatória:

{
  "summary": "resumo curto da nota em 1-2 frases",
  "suggestedTitle": "título sugerido curto e claro",
  "noteType": "tipo de nota (ex: especificacao, backlog, rascunho, nota)",
  "mainTopic": "tema principal",
  "suggestedFolder": "pasta sugerida",
  "yaml": {
    "propriedade": "valor"
  },
  "tags": ["tag1", "tag2"],
  "internalLinks": [],
  "tasks": ["tarefa 1", "tarefa 2"],
  "analysis": "texto da análise detalhada em 3-5 frases",
  "confidence": "alto | médio | baixo",
  "limitations": "limitações da análise ou 'Nenhuma.'"
}

${yamlSection}

Dados da nota:

TÍTULO:
${title}

CAMINHO_COMPLETO:
${path}

PASTA_ATUAL:
${currentFolder}

FICHEIRO:
${currentFilename}

<<<NOTA>>>
${truncatedContent}${truncationNote}
<<<FIM_NOTA>>>`;
  }

  /**
   * Constrói o prompt interno para análise da nota atual com contexto de notas relacionadas, pedindo JSON estruturado.
   */
  private buildCurrentNoteAnalysisPromptWithContext(title: string, path: string, content: string, relatedNotes: RelatedNote[]): string {
    let truncatedContent = content;
    let truncationNote = "";

    if (content.length > LinaSearchView.MAX_CONTENT_CHARS) {
      truncatedContent = content.substring(0, LinaSearchView.MAX_CONTENT_CHARS);
      truncationNote = "\n\n(O conteúdo foi truncado por ser demasiado longo.)";
    }

    const lastSlashIndex = path.lastIndexOf('/');
    const currentFolder = lastSlashIndex >= 0 ? path.substring(0, lastSlashIndex) + '/' : '';
    const currentFilename = lastSlashIndex >= 0 ? path.substring(lastSlashIndex + 1) : path;
    const existingFoldersSection = this.formatExistingFoldersForPrompt(path, title, content);

    const lang = this.plugin.settings.aiOutputLanguage;
    let languageInstruction = "";
    switch (lang) {
      case "pt-PT":
        languageInstruction = "Responde obrigatoriamente em português europeu.";
        break;
      case "pt-BR":
        languageInstruction = "Responde obrigatoriamente em português do Brasil.";
        break;
      case "en":
        languageInstruction = "Respond in English.";
        break;
      case "es":
        languageInstruction = "Responde obligatoriamente en español.";
        break;
      case "fr":
        languageInstruction = "Réponds obligatoirement en français.";
        break;
      case "auto":
        languageInstruction = "Responde no idioma predominante da nota.";
        break;
      default:
        languageInstruction = "Responde obrigatoriamente em português europeu.";
    }

    let relatedNotesSection = "";
    if (relatedNotes.length > 0) {
      relatedNotesSection = "Lista fechada de candidatos permitidos para links internos:\n\n";
      for (let i = 0; i < relatedNotes.length; i++) {
        const note = relatedNotes[i];
        relatedNotesSection += `${i + 1}. Título: ${note.title}\n`;
        relatedNotesSection += `   Caminho: ${note.path}\n`;
        if (note.score !== undefined) {
          relatedNotesSection += `   Score usado para ordenar: ${Math.round(note.score)}\n`;
        }
        relatedNotesSection += `   Origem: ${this.getRelatedSourceLabel(note.source)}\n`;
        relatedNotesSection += `   Motivo do candidato: ${this.buildRelatedNoteReason(note)}\n`;
        relatedNotesSection += `   Excerto: ${note.snippet}\n`;
        relatedNotesSection += "\n";
      }
    } else {
      relatedNotesSection = "Lista fechada de candidatos permitidos vazia. Devolve \"internalLinks\": [].";
    }

    let yamlSection = "";
    const yamlEnabled = this.plugin.settings.yamlSuggestionsEnabled;
    if (yamlEnabled) {
      yamlSection = `* A sugestão de YAML está ATIVADA.
* Sugere YAML simples com as propriedades definidas em: ${this.plugin.settings.yamlAllowedProperties}
* As tags devem ser devolvidas apenas no campo "tags". NÃO incluas "tags" dentro do objeto "yaml".
* Não crie propriedades fora da lista permitida.
* Não inventes campos como data_criacao, autor, utilizador_id, adapta_style, prazo, disciplina ou turma.`;
    } else {
      yamlSection = `* A sugestão de YAML está DESATIVADA.
* NÃO incluas YAML no JSON. O campo "yaml" deve ser omitido.`;
    }

    return `${languageInstruction}

Analisa apenas a nota Markdown colocada entre <<<NOTA>>> e <<<FIM_NOTA>>>.

Não organizes o vault.
Não sugiras uma nova estrutura de pastas para o vault.
Não uses Markdown decorativo.
Não uses negrito.
Não uses tabelas.
Não uses ícones.
Não escrevas introduções como "Aqui está...".
Não inventes datas.
Não inventes links internos.
Não inventes caminhos de notas.

${relatedNotesSection}

Regras para pasta sugerida:

Pastas existentes no vault que podes escolher preferencialmente:
${existingFoldersSection}

* Escolhe preferencialmente uma das pastas existentes listadas.
* Não inventes pastas na raiz do vault.
* Não sugiras INBOX, Inbox, 01_inbox ou 00_Inbox como destino.
* Se nenhuma pasta existente for adequada, propõe uma nova pasta dentro de uma pasta raiz existente listada.
* Se tiveres pouca confiança, deixa "suggestedFolder" vazio ou usa a pasta atual se ela não for Inbox.
* Se a pasta atual parecer adequada e não for Inbox, usa: "${currentFolder}"

Regras para tags (no máximo ${this.plugin.settings.maxSuggestedTags}):

* minúsculas, sem acentos, espaços convertidos para underscore
* evitar tags genéricas como "projeto", "sistema", "nota" ou "geral"
* normalizar: "Gestão de Trabalhos" → gestao_trabalhos

Regras estritas para links internos:

* A lista acima é FECHADA. Só podes sugerir links cujo "path" seja exatamente um dos caminhos listados em "Caminho".
* Não inventes notas, títulos, caminhos, aliases ou links novos.
* Copia o "path" exatamente como aparece no candidato. Não uses wiki links no JSON.
* Nunca sugiras a própria nota atual como link interno.
* Sugere no máximo 5 links, mas não tentes preencher o limite.
* Prefere qualidade a quantidade: é aceitável devolver zero, um ou dois links.
* Escolhe apenas notas que ajudem a compreender, aprofundar ou contextualizar a nota atual.
* Escolhe apenas notas que possam ser ligadas naturalmente no corpo da nota.
* Não escolhas uma nota só porque partilha uma palavra isolada.
* Não escolhas notas demasiado genéricas se houver alternativas mais específicas.
* Não escolhas candidatos redundantes, vagamente relacionados ou com relação duvidosa.
* Se a relação temática não for clara, não sugiras o link.
* Se nenhum candidato for suficientemente útil, põe "internalLinks": [].
* Para cada link escolhido, escreve "reason" com um motivo breve e específico.

Responde APENAS com JSON válido, sem texto extra, sem formatação decorativa, sem blocos de código.

Estrutura JSON obrigatória:

{
  "summary": "resumo curto da nota em 1-2 frases",
  "suggestedTitle": "título sugerido curto e claro",
  "noteType": "tipo de nota (ex: especificacao, backlog, rascunho, nota)",
  "mainTopic": "tema principal",
  "suggestedFolder": "pasta sugerida",
  "yaml": {
    "propriedade": "valor"
  },
  "tags": ["tag1", "tag2"],
  "internalLinks": [
    { "path": "caminho/exato/de/um/candidato.md", "reason": "motivo breve e específico" }
  ],
  "tasks": ["tarefa 1", "tarefa 2"],
  "analysis": "texto da análise detalhada em 3-5 frases",
  "confidence": "alto | médio | baixo",
  "limitations": "limitações da análise ou 'Nenhuma.'"
}

${yamlSection}

Dados da nota:

TÍTULO:
${title}

CAMINHO_COMPLETO:
${path}

PASTA_ATUAL:
${currentFolder}

FICHEIRO:
${currentFilename}

<<<NOTA>>>
${truncatedContent}${truncationNote}
<<<FIM_NOTA>>>`;
  }

  // -----------------------------------------------------------------------
  // Renderização da pré-visualização estruturada (Fase 5A)
  // -----------------------------------------------------------------------

  /**
   * Cria um item selecionável na UI.
   * Clicar apenas seleciona/desseleciona. Não escreve na nota.
   */
  private createSelectableItem(
    container: HTMLElement,
    id: string,
    label: string,
    isInitiallySelected: boolean,
    kind?: SelectableKind,
    value?: string,
    path?: string,
    title?: string,
    reason?: string,
    description?: string
  ): void {
    const item = container.createDiv();
    item.addClass("lina-display-flex");
    item.addClass("lina-items-start");
    item.addClass("lina-gap-6");
    item.addClass("lina-py-3");
    item.addClass("lina-cursor-pointer");
    item.addClass("lina-user-select-none");

    const checkbox = item.createEl("input");
    checkbox.type = "checkbox";
    checkbox.checked = isInitiallySelected;
    checkbox.addClass("lina-checkbox-offset");
    checkbox.addClass("lina-cursor-pointer");

    // Definir estado inicial no mapa
    this.structuredSelections.set(id, isInitiallySelected);

    // Registrar no mapa robusto para recolha correta
    if (kind) {
      this.selectableItemsMap.set(id, {
        id,
        kind,
        label,
        value: value ?? label,
        path,
        title,
        reason,
        description
      });
    }

    const labelWrapper = item.createDiv();
    labelWrapper.addClass("lina-flex-1");
    labelWrapper.addClass("lina-break-word");

    const labelEl = labelWrapper.createDiv({ text: label });
    labelEl.addClass("lina-fs-085");
    labelEl.addClass("lina-color-normal");

    if (description) {
      const descriptionEl = labelWrapper.createDiv({ text: description });
      descriptionEl.addClass("lina-fs-08");
      descriptionEl.addClass("lina-color-muted");
      descriptionEl.addClass("lina-mt-2");
    }

    const updateLabelStyle = () => {
      labelEl.removeClass("lina-color-accent");
      labelEl.removeClass("lina-color-normal");
      labelEl.removeClass("lina-fw-500");
      labelEl.removeClass("lina-fw-normal");
      if (checkbox.checked) {
        labelEl.addClass("lina-color-accent");
        labelEl.addClass("lina-fw-500");
      } else {
        labelEl.addClass("lina-color-normal");
        labelEl.addClass("lina-fw-normal");
      }
    };

    // Clicar no item ou no label alterna o checkbox
    const toggleHandler = () => {
      checkbox.checked = !checkbox.checked;
      this.structuredSelections.set(id, checkbox.checked);
      // Atualizar estilo visual
      updateLabelStyle();
    };

    checkbox.addEventListener("change", () => {
      this.structuredSelections.set(id, checkbox.checked);
      updateLabelStyle();
    });

    item.addEventListener("click", (e) => {
      if (e.target === checkbox) return; // Já foi tratado pelo change
      toggleHandler();
    });

    labelEl.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleHandler();
    });
  }

  /**
   * Cria uma secção da pré-visualização estruturada.
   */
  private createStructuredSection(
    container: HTMLElement,
    title: string,
    idPrefix: string,
    items: SelectableSectionItem[],
    noItemsMessage: string
  ): void {
    const section = container.createDiv();
    section.addClass("lina-mt-12");
    section.addClass("lina-mb-8");

    // Título da secção
    const titleEl = section.createEl("strong", { text: title });
    titleEl.addClass("lina-fs-09");
    titleEl.addClass("lina-display-block");
    titleEl.addClass("lina-mb-4");

    if (items.length === 0) {
      const emptyEl = section.createDiv({ text: noItemsMessage });
      emptyEl.addClass("lina-fs-08");
      emptyEl.addClass("lina-color-muted");
      emptyEl.addClass("lina-font-italic");
      return;
    }

    for (const item of items) {
      this.createSelectableItem(section, `${idPrefix}::${item.id}`, item.label, false, item.kind, item.value, item.path, item.title, item.reason, item.description);
    }
  }

  /**
   * Cria uma secção da pré-visualização estruturada com suporte para itens desativados.
   */
  private createStructuredSectionWithStatus(
    container: HTMLElement,
    title: string,
    idPrefix: string,
    items: Array<SelectableSectionItem & { disabled?: boolean }>,
    noItemsMessage: string
  ): void {
    const section = container.createDiv();
    section.addClass("lina-mt-12");
    section.addClass("lina-mb-8");

    // Título da secção
    const titleEl = section.createEl("strong", { text: title });
    titleEl.addClass("lina-fs-09");
    titleEl.addClass("lina-display-block");
    titleEl.addClass("lina-mb-4");

    if (items.length === 0) {
      const emptyEl = section.createDiv({ text: noItemsMessage });
      emptyEl.addClass("lina-fs-08");
      emptyEl.addClass("lina-color-muted");
      emptyEl.addClass("lina-font-italic");
      return;
    }

    for (const item of items) {
      if (item.disabled) {
        // Item desativado (já existe ou conflito)
        const itemDiv = section.createDiv();
        itemDiv.addClass("lina-display-flex");
        itemDiv.addClass("lina-items-start");
        itemDiv.addClass("lina-gap-6");
        itemDiv.addClass("lina-py-3");
        itemDiv.addClass("lina-opacity-06");

        // Checkbox desativada
        const checkbox = itemDiv.createEl("input");
        checkbox.type = "checkbox";
        checkbox.checked = false;
        checkbox.disabled = true;
        checkbox.addClass("lina-checkbox-offset");
        checkbox.addClass("lina-cursor-not-allowed");

        const labelEl = itemDiv.createSpan({ text: item.label });
        labelEl.addClass("lina-fs-085");
        labelEl.addClass("lina-color-muted");
        labelEl.addClass("lina-flex-1");
        labelEl.addClass("lina-break-word");

        if (item.reason === "already_exists") {
          labelEl.addClass("lina-color-accent");
        } else if (item.reason === "conflict") {
          labelEl.addClass("lina-color-warning");
        }
      } else {
        // Item selecionável
        this.createSelectableItem(section, `${idPrefix}::${item.id}`, item.label, false, item.kind, item.value, item.path, item.title, item.reason, item.description);
      }
    }
  }

  private renderCopyAiResponseButton(container: HTMLElement, responseText: string): void {
    const textToCopy = responseText.trim();
    if (!textToCopy) return;

    const buttonRow = container.createDiv();
    buttonRow.addClass("lina-display-flex");
    buttonRow.addClass("lina-justify-end");
    buttonRow.addClass("lina-mb-8");

    const copyButton = buttonRow.createEl("button", { text: this.L.analysisCopyResponse });
    copyButton.addClass("lina-p-4-8");
    copyButton.addClass("lina-fs-085");
    copyButton.addClass("lina-cursor-pointer");
    copyButton.addEventListener("click", () => {
      void this.copyAiResponseToClipboard(textToCopy);
    });
  }

  private async copyAiResponseToClipboard(responseText: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(responseText);
      new Notice(this.L.analysisCopySuccess);
    } catch (error) {
      console.warn("Lina: não foi possível copiar a resposta da IA:", error);
      new Notice(this.L.analysisCopyError);
    }
  }

  private formatStructuredAnalysisForClipboard(result: StructuredAnalysisResult): string {
    const lines: string[] = [];

    const addSection = (title: string, values: string[]): void => {
      const cleanValues = values.map(value => value.trim()).filter(value => value.length > 0);
      if (cleanValues.length === 0) return;
      if (lines.length > 0) lines.push("");
      lines.push(`## ${title}`);
      lines.push(...cleanValues);
    };

    addSection(this.L.previewSummary, result.summary ? [result.summary] : []);
    addSection(this.L.previewSuggestedTitle, result.suggestedTitle ? [result.suggestedTitle] : []);
    addSection(this.L.inboxType, result.noteType ? [result.noteType] : []);
    addSection(this.L.inboxTopic, result.mainTopic ? [result.mainTopic] : []);
    addSection(this.L.previewSuggestedFolder, result.suggestedFolder ? [result.suggestedFolder] : []);

    if (result.yaml && Object.keys(result.yaml).length > 0) {
      addSection(
        this.L.previewYamlSuggested,
        Object.entries(result.yaml).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
      );
    }

    if (result.tags && result.tags.length > 0) {
      addSection(this.L.previewTagsSuggested, result.tags.map(tag => `- ${tag}`));
    }

    if (result.internalLinks && result.internalLinks.length > 0) {
      addSection(
        this.L.previewInternalLinks,
        result.internalLinks.map(link => {
          const wikiLink = formatObsidianWikiLink(link.path, getBasenameWithoutExtension(link.path));
          return link.reason ? `- ${wikiLink} — ${link.reason}` : `- ${wikiLink}`;
        })
      );
    }

    if (result.tasks && result.tasks.length > 0) {
      addSection(this.L.previewTasksDetected, result.tasks.map(task => `- [ ] ${task}`));
    }

    addSection(this.L.previewAnalysis, result.analysis ? [result.analysis] : []);
    addSection(this.L.previewConfidence, result.confidence ? [result.confidence] : []);
    addSection(this.L.previewLimitations, result.limitations ? [result.limitations] : []);

    return lines.join("\n").trim();
  }

  private formatInboxAnalysisResultsForClipboard(
    results: InboxNoteAnalysisResult[],
    analyzedCount: number,
    totalMarkdownCount: number,
    titleText = this.L.inboxResultsTitle,
    summaryText = this.L.inboxResultsSummary
  ): string {
    const lines: string[] = [
      `# ${titleText}`,
      "",
      `${summaryText}: ${analyzedCount}/${totalMarkdownCount}.`
    ];

    for (const item of results) {
      lines.push("", `## ${item.file.name}`);

      if (item.warning) {
        lines.push(item.warning);
      }

      if (item.error) {
        lines.push(item.error);
        continue;
      }

      if (item.result) {
        const formattedResult = this.formatStructuredAnalysisForClipboard(item.result);
        if (formattedResult) {
          lines.push(formattedResult);
        }
      }
    }

    return lines.join("\n").trim();
  }

  /**
   * Renderiza a pré-visualização estruturada na vista lateral.
   */
  private async renderStructuredPreview(result: StructuredAnalysisResult, relatedNotesCount: number, relatedNotes: RelatedNote[] = [], targetFile?: TFile): Promise<void> {
    if (!this.analysisResultEl) return;

    this.analysisResultEl.empty();
    this.structuredSelections.clear();
    this.selectableItemsMap.clear();
    this.currentStructuredResult = result;

    // Guardar o caminho do ficheiro analisado para aplicar alterações nessa nota.
    const analysisFile = targetFile ?? this.app.workspace.getActiveFile() ?? undefined;
    this.currentActiveFilePath = analysisFile?.path;

    this.renderCopyAiResponseButton(this.analysisResultEl, this.formatStructuredAnalysisForClipboard(result));

    // Clarificação da UI: checkboxes são para seleção, não para estado concluído
    const clarificationContainer = this.analysisResultEl.createDiv();
    clarificationContainer.addClass("lina-mb-12");
    clarificationContainer.addClass("lina-p-8");
    clarificationContainer.addClass("lina-bg-primary-alt");
    clarificationContainer.addClass("lina-radius-4");
    clarificationContainer.addClass("lina-fs-085");

    clarificationContainer.createEl("strong", { text: this.L.previewSelectItems });
    clarificationContainer.createDiv({ text: this.L.previewCheckboxExplanation });

    // Notas relacionadas usadas
    const notesInfoContainer = this.analysisResultEl.createDiv();
    notesInfoContainer.addClass("lina-mb-12");
    notesInfoContainer.addClass("lina-fs-085");
    notesInfoContainer.addClass("lina-color-muted");

    if (relatedNotes.length > 0) {
      notesInfoContainer.createDiv({ text: `${this.L.previewRelatedNotesUsed}: ${relatedNotes.length}` });

      const notesList = notesInfoContainer.createDiv();
      notesList.addClass("lina-mt-4");
      notesList.addClass("lina-fs-08");
      notesList.addClass("lina-maxh-120");
      notesList.addClass("lina-overflow-y-auto");
      notesList.addClass("lina-border-left");
      notesList.addClass("lina-pl-8");

      for (const note of relatedNotes.slice(0, 10)) { // Limitar a 10 para não sobrecarregar
        this.renderRelatedNoteSummaryItem(notesList, note);
      }
    } else {
      notesInfoContainer.createDiv({ text: `${this.L.previewRelatedNotesUsed}: ${relatedNotesCount}` });
    }

    // Título sugerido
    if (result.suggestedTitle) {
      const titleItems: SelectableSectionItem[] = [
        {
          id: "suggested",
          label: `${this.L.renameUpdateH1}: ${result.suggestedTitle}`,
          kind: "title",
          value: result.suggestedTitle,
          title: result.suggestedTitle
        }
      ];

      if (analysisFile) {
        const readableFileName = makeReadableFileName(result.suggestedTitle);
        if (readableFileName) {
          titleItems.push({
            id: "rename_file",
            label: `${this.L.renameRenameFile}: ${readableFileName}`,
            kind: "rename-file",
            value: readableFileName,
            path: getPathInSameFolder(analysisFile, readableFileName),
            title: readableFileName
          });
        }
      }

      this.createStructuredSection(
        this.analysisResultEl,
        this.L.previewSuggestedTitle,
        "title",
        titleItems,
        ""
      );
    }

    // Pasta sugerida
    const rawSuggestedFolder = (result.suggestedFolder ?? "").trim();
    if (rawSuggestedFolder.length > 0) {
      const folderSection = this.analysisResultEl.createDiv();
      folderSection.addClass("lina-mt-12");
      folderSection.addClass("lina-mb-8");

      const titleEl = folderSection.createEl("strong", { text: this.L.previewSuggestedFolder });
      titleEl.addClass("lina-fs-09");
      titleEl.addClass("lina-display-block");
      titleEl.addClass("lina-mb-4");

      const existingFolders = this.getExistingVaultFolders();
      const currentFolder = analysisFile ? getFolderPathForFile(analysisFile) : "";
      const folderResolution = this.resolveFolderMove(
        result.suggestedFolder,
        existingFolders,
        currentFolder,
        analysisFile?.name,
        analysisFile?.path
      );
      const folderValue = folderSection.createDiv({
        text: folderResolution.resolvedFolderPath || folderResolution.rawSuggestedFolder
      });
      folderValue.addClass("lina-fs-085");
      folderValue.addClass("lina-color-muted");
      folderValue.addClass("lina-mb-4");

      const statusEl = folderSection.createDiv({ text: `${this.L.previewFolderStatus}: ${folderResolution.reason}` });
      statusEl.addClass("lina-fs-085");
      statusEl.addClass("lina-mb-4");

      const resolvedFolder = folderResolution.resolvedFolderPath ?? folderResolution.rawSuggestedFolder;
      const destinationPath = folderResolution.finalTargetPath ?? undefined;
      const canMove = folderResolution.canMove;

      if (canMove) {
        statusEl.setText(`${this.L.previewFolderStatus}: ${folderResolution.reason}`);
        statusEl.addClass("lina-color-success");
        this.createSelectableItem(
          folderSection,
          "folder::move_suggested",
          this.L.renameMoveNote,
          false,
          "move",
          resolvedFolder,
          destinationPath,
          resolvedFolder,
          folderResolution.reason
        );
      } else if (!analysisFile) {
        statusEl.setText(`${this.L.previewFolderStatus}: ${folderResolution.reason}`);
        statusEl.addClass("lina-color-warning");
      } else if (folderResolution.hasCollision) {
        statusEl.setText(`${this.L.previewFolderStatus}: ${folderResolution.reason}`);
        statusEl.addClass("lina-color-warning");
      } else {
        statusEl.addClass(folderResolution.isCurrentFolder ? "lina-color-muted" : "lina-color-warning");
      }

      if (!canMove) {
        const disabledItem = folderSection.createDiv();
        disabledItem.addClass("lina-display-flex");
        disabledItem.addClass("lina-items-start");
        disabledItem.addClass("lina-gap-6");
        disabledItem.addClass("lina-py-3");
        disabledItem.addClass("lina-opacity-065");

        const checkbox = disabledItem.createEl("input");
        checkbox.type = "checkbox";
        checkbox.checked = false;
        checkbox.disabled = true;
        checkbox.addClass("lina-checkbox-offset");
        checkbox.addClass("lina-cursor-not-allowed");

        const labelEl = disabledItem.createSpan({ text: this.L.renameMoveNote });
        labelEl.addClass("lina-fs-085");
        labelEl.addClass("lina-color-muted");
        labelEl.addClass("lina-flex-1");
        labelEl.addClass("lina-break-word");
      }
    }

    const canPreserveSuggestedMetadata = this.currentAnalysisScope === "single-note";
    const validTags = result.tags ? normalizarTags(result.tags) : [];

    if (canPreserveSuggestedMetadata) {
      this.preserveSingleNoteSuggestedMetadata(result.yaml, validTags);
    }

    // YAML sugerido - comparar com frontmatter existente
    if (result.yaml && Object.keys(result.yaml).length > 0) {
      const yamlItems: Array<SelectableSectionItem & { disabled?: boolean }> = [];
      let existingFrontmatter: Map<string, string> = new Map();

      // Ler frontmatter atual se existir
      if (analysisFile) {
        try {
          const content = await this.app.vault.read(analysisFile);
          const { frontmatter } = extrairFrontmatter(content);
          if (frontmatter) {
            existingFrontmatter = parseFrontmatterLines(frontmatter);
          }
        } catch (error) {
          console.warn("Não foi possível ler frontmatter existente:", error);
        }
      }

      // Comparar cada propriedade sugerida com o frontmatter existente
      for (const [key, value] of Object.entries(result.yaml)) {
        const valueStr = Array.isArray(value) ? value.join(", ") : String(value);
        const existingValue = existingFrontmatter.get(key);

        if (existingValue) {
          if (existingValue === valueStr) {
            // Já existe com o mesmo valor
            yamlItems.push({
              id: `yaml_${key}`,
              label: `${key}: ${valueStr} — ${this.L.previewYamlAlreadyExists}`,
              kind: "yaml",
              value: key,
              disabled: true,
              reason: "already_exists"
            });
          } else {
            // Conflito: valor diferente
            yamlItems.push({
              id: `yaml_${key}`,
              label: `${key}: ${valueStr} — ${this.L.previewYamlConflict}: ${existingValue}`,
              kind: "yaml",
              value: key,
              disabled: true,
              reason: "conflict"
            });
          }
        } else {
          // Novo campo
          yamlItems.push({
            id: `yaml_${key}`,
            label: `${key}: ${valueStr} — ${this.L.previewYamlNew}`,
            kind: "yaml",
            value: key,
            disabled: false,
            reason: "new"
          });
        }
      }

      this.createStructuredSectionWithStatus(
        this.analysisResultEl,
        this.L.previewYamlSuggested,
        "yaml",
        yamlItems,
        this.L.previewYamlDisabled
      );
    }

    // Tags sugeridas
    if (validTags.length > 0) {
      const existingVaultTags = this.getExistingVaultTags();
      const tagItems = validTags.map(tag => {
        const existingTag = existingVaultTags.get(tag);
        const value = existingTag?.normalized ?? tag;
        const statusLabel = existingTag ? formatTagUsageLabel(existingTag.count, this.L.previewTagExisting) : this.L.previewTagNew;

        return {
          id: `tag_${value}`,
          label: `${value} — ${statusLabel}`,
          kind: "tag" as const,
          value,
          reason: existingTag ? "existing-tag" : "new-tag"
        };
      });
      this.createStructuredSection(
        this.analysisResultEl,
        this.L.previewTagsSuggested,
        "tags",
        tagItems,
        this.L.previewNoTags
      );
    }

    // Links internos sugeridos
    if (result.internalLinks && result.internalLinks.length > 0) {
      const relatedNotesByPath = new Map(
        relatedNotes.map(note => [normalizePathSafe(note.path), note])
      );
      const linkItems = result.internalLinks.map(link => {
        const sourceCandidate = relatedNotesByPath.get(normalizePathSafe(link.path));
        return {
          id: `ai-link_${link.path}`,
          label: `${link.path} ${link.reason ? `— ${link.reason}` : ""}`,
          description: sourceCandidate ? this.formatRelatedNoteDescription(sourceCandidate) : undefined,
          kind: "ai-link" as const,
          value: link.path,
          path: link.path,
          title: getBasenameWithoutExtension(link.path),
          reason: link.reason
        };
      });
      this.createStructuredSection(
        this.analysisResultEl,
        this.L.previewInternalLinks,
        "ai-links",
        linkItems,
        this.L.previewNoLinks
      );
    }

    // Outras notas relacionadas (não sugeridas pela IA)
    if (relatedNotes.length > 0) {
      // Filtrar: excluir própria nota e links já sugeridos pela IA
      const aiSuggestedPaths = new Set(result.internalLinks?.map(link => normalizePathSafe(link.path)) || []);
      const currentPathNormalized = analysisFile ? normalizePathSafe(analysisFile.path) : "";

      const otherRelatedNotes = relatedNotes.filter(note => {
        const notePathNormalized = normalizePathSafe(note.path);
        // Excluir própria nota atual
        if (notePathNormalized === currentPathNormalized) return false;
        // Excluir notas já sugeridas pela IA
        if (aiSuggestedPaths.has(notePathNormalized)) return false;
        return true;
      });

      if (otherRelatedNotes.length > 0) {
        const relatedItems = otherRelatedNotes.map(note => ({
          id: `related-link_${note.path}`,
          label: `${note.title} — ${note.path}`,
          description: this.formatRelatedNoteDescription(note),
          kind: "related-link" as const,
          value: note.path,
          path: note.path,
          title: note.title,
          reason: this.buildRelatedNoteReason(note)
        }));

        this.createStructuredSection(
          this.analysisResultEl,
          this.L.previewOtherRelatedNotes,
          "related-links",
          relatedItems,
          this.L.previewNoRelated
        );
      }
    }

    // Tarefas detetadas
    if (result.tasks && result.tasks.length > 0) {
      const taskItems = result.tasks.map((task, idx) => ({
        id: `task_${idx}`,
        label: task,
        kind: "task" as const,
        value: task
      }));
      this.createStructuredSection(
        this.analysisResultEl,
        this.L.previewTasksDetected,
        "tasks",
        taskItems,
        this.L.previewNoTasks
      );
    }

    // Análise
    if (result.analysis) {
      this.createStructuredSection(
        this.analysisResultEl,
        this.L.previewAnalysis,
        "analysis",
        [{ id: "analysis_text", label: result.analysis, kind: "analysis", value: result.analysis }],
        ""
      );
    }

    // Informações adicionais
    const infoContainer = this.analysisResultEl.createDiv();
    infoContainer.addClass("lina-mt-12");
    infoContainer.addClass("lina-pt-8");
    infoContainer.addClass("lina-border-top");
    infoContainer.addClass("lina-fs-08");
    infoContainer.addClass("lina-color-muted");

    if (result.summary) {
      infoContainer.createDiv({ text: `${this.L.previewSummary}: ${result.summary}` });
    }
    if (result.confidence) {
      infoContainer.createDiv({ text: `${this.L.previewConfidence}: ${result.confidence}` });
    }
    if (result.limitations) {
      infoContainer.createDiv({ text: `${this.L.previewLimitations}: ${result.limitations}` });
    }

    // Botão "Aplicar selecionados à nota"
    const applyBtnContainer = this.analysisResultEl.createDiv();
    applyBtnContainer.addClass("lina-mt-16");
    applyBtnContainer.addClass("lina-text-center");

    const applyBtn = applyBtnContainer.createEl("button", { text: this.L.previewApplyButton });
    applyBtn.addClass("lina-p-8-16");
    applyBtn.addClass("lina-cursor-pointer");
    applyBtn.addEventListener("click", () => {
      void this.applySelectedChanges().catch((error: unknown) => {
        console.error("Lina: failed to apply selected changes", error);
      });
    });
  }

  /**
   * Processa a resposta da IA e tenta apresentá-la como pré-visualização estruturada.
   */
  private async processAIResponse(aiText: string, currentPath: string, allowedPaths: string[], relatedNotesCount: number, relatedNotes: RelatedNote[] = [], targetFile?: TFile): Promise<void> {
    if (!this.analysisResultEl) return;

    const { json, error } = extrairJsonDaResposta(aiText);

    if (json && !error) {
      // Alguns modelos ainda devolvem tags dentro de yaml.tags.
      // Mantemos as tags apenas na secção "Tags sugeridas" e removemos do YAML sugerido.
      const yamlTags = json.yaml?.tags;
      if (yamlTags && (!json.tags || json.tags.length === 0)) {
        const recoveredTags = extrairTagsDeValorYaml(yamlTags);
        if (recoveredTags.length > 0) {
          json.tags = recoveredTags;
        }
      }

      // Filtrar YAML se necessário
      if (json.yaml && this.plugin.settings.yamlSuggestionsEnabled) {
        json.yaml = filtrarYamlValido(
          json.yaml,
          this.plugin.settings.yamlAllowedProperties
        );
      }

      if (!this.plugin.settings.yamlSuggestionsEnabled) {
        delete json.yaml;
      }

      // Filtrar links internos
      if (json.internalLinks && allowedPaths.length > 0) {
        json.internalLinks = filtrarLinksInternos(json.internalLinks, currentPath, allowedPaths);
      }

      this.applyFolderSuggestionResolution(json, currentPath);
      await this.renderStructuredPreview(json, relatedNotesCount, relatedNotes, targetFile);
    } else {
      // Fallback textual
      this.clearLastSuggestedMetadata();
      this.currentStructuredResult = undefined;
      this.currentActiveFilePath = undefined;
      this.analysisResultEl.empty();
      this.renderCopyAiResponseButton(this.analysisResultEl, aiText);

      if (relatedNotes.length > 0) {
        const notesInfoContainer = this.analysisResultEl.createDiv();
        notesInfoContainer.addClass("lina-mb-12");
        notesInfoContainer.addClass("lina-fs-085");
        notesInfoContainer.addClass("lina-color-muted");

        notesInfoContainer.createDiv({ text: `Notas relacionadas usadas: ${relatedNotes.length}` });

        const notesList = this.analysisResultEl.createDiv();
        notesList.addClass("lina-mt-4");
        notesList.addClass("lina-fs-08");
        notesList.addClass("lina-maxh-120");
        notesList.addClass("lina-overflow-y-auto");
        notesList.addClass("lina-border-left");
        notesList.addClass("lina-pl-8");

        for (const note of relatedNotes.slice(0, 10)) {
          this.renderRelatedNoteSummaryItem(notesList, note);
        }
      } else if (relatedNotesCount > 0) {
        this.analysisResultEl.createDiv({
          text: `Notas relacionadas usadas: ${relatedNotesCount}`,
          attr: { style: "color: var(--text-muted); font-size: 0.85em; margin-bottom: 8px;" }
        });
      }

      const warning = this.analysisResultEl.createDiv();
      warning.addClass("lina-fs-08");
      warning.addClass("lina-color-warning");
      warning.addClass("lina-mb-8");
      warning.addClass("lina-p-4-8");
      warning.addClass("lina-bg-hover");
      warning.addClass("lina-radius-4");
      warning.textContent = "Não foi possível estruturar automaticamente a resposta. A resposta textual foi apresentada sem seleção interativa.";

      const responseEl = this.analysisResultEl.createDiv();
      responseEl.addClass("lina-fs-085");
      responseEl.addClass("lina-pre-wrap");
      responseEl.addClass("lina-break-word");
      responseEl.addClass("lina-p-8");
      responseEl.addClass("lina-bg-primary-alt");
      responseEl.addClass("lina-radius-4");
      responseEl.addClass("lina-lh-15");
      responseEl.textContent = aiText;
    }
  }

  // -----------------------------------------------------------------------
  // Aplicar selecionados à nota (Fase 5B)
  // -----------------------------------------------------------------------

  /** Recolhe apenas os YAML/tags selecionados nos metadados preservados. */
  private getSelectedPreservedMetadata(): { selectedYamlKeys: string[]; selectedTags: string[] } {
    const selectedYamlKeys: string[] = [];
    const selectedTags: string[] = [];

    for (const [id, selected] of this.preservedMetadataSelections.entries()) {
      if (!selected) continue;

      const item = this.preservedMetadataItems.get(id);
      if (!item) continue;

      if (item.kind === "yaml") {
        selectedYamlKeys.push(item.value);
      } else {
        selectedTags.push(item.value);
      }
    }

    return { selectedYamlKeys, selectedTags };
  }

  private confirmApplyPreservedMetadataToActiveNote(
    targetFile: TFile,
    selectedYamlKeys: string[],
    selectedTags: string[]
  ): Promise<boolean> {
    return new Promise(resolve => {
      const modal = new Modal(this.app);
      modal.titleEl.setText(this.L.analysisSuggestedMetadata);

      const intro = modal.contentEl.createDiv({ text: this.L.analysisConfirmApplyPreservedMetadata });
      intro.addClass("lina-mb-8");

      const list = modal.contentEl.createEl("ul");
      list.addClass("lina-mt-0");
      list.createEl("li", { text: `${this.L.analysisNoteName}: ${targetFile.path}` });
      if (selectedYamlKeys.length > 0) {
        list.createEl("li", { text: `${selectedYamlKeys.length} YAML` });
      }
      if (selectedTags.length > 0) {
        list.createEl("li", { text: `${selectedTags.length} tags` });
      }

      const warning = modal.contentEl.createDiv({ text: this.L.confirmApplyWarning });
      warning.addClass("lina-mt-12");

      const buttons = modal.contentEl.createDiv();
      buttons.addClass("lina-display-flex");
      buttons.addClass("lina-justify-end");
      buttons.addClass("lina-gap-8");
      buttons.addClass("lina-mt-16");

      const cancelButton = buttons.createEl("button", { text: this.L.confirmCancelButton });
      const applyButton = buttons.createEl("button", { text: this.L.confirmApplyButton });
      applyButton.classList.add("mod-cta");

      let resolved = false;
      const finish = (value: boolean) => {
        if (resolved) return;
        resolved = true;
        modal.close();
        resolve(value);
      };

      cancelButton.addEventListener("click", () => finish(false));
      applyButton.addEventListener("click", () => finish(true));
      modal.onClose = () => finish(false);
      modal.open();
    });
  }

  private async applyPreservedMetadataToActiveNote(): Promise<void> {
    const targetFile = this.app.workspace.getActiveFile();

    if (!(targetFile instanceof TFile)) {
      new Notice(this.L.analysisNoFile);
      return;
    }

    if (targetFile.extension !== "md") {
      new Notice(this.L.errorTargetNotMarkdown);
      return;
    }

    const { selectedYamlKeys, selectedTags } = this.getSelectedPreservedMetadata();

    if (selectedYamlKeys.length === 0 && selectedTags.length === 0) {
      new Notice(this.L.noItemSelected);
      return;
    }

    const confirmed = await this.confirmApplyPreservedMetadataToActiveNote(targetFile, selectedYamlKeys, selectedTags);
    if (!confirmed) {
      new Notice(this.L.operationCancelledNoChange);
      return;
    }

    const preservedResult: StructuredAnalysisResult = {
      summary: "",
      yaml: this.lastSuggestedYaml,
      tags: this.lastSuggestedTags
    };

    const originalContent = await this.app.vault.read(targetFile);
    const updatedContent = this.applyYamlAndTagsToNote(originalContent, preservedResult, selectedYamlKeys, selectedTags);

    if (updatedContent === originalContent) {
      new Notice(this.L.analysisNoPreservedMetadataChanges);
      return;
    }

    await this.app.vault.modify(targetFile, updatedContent);
    new Notice(this.L.analysisPreservedMetadataApplied);
  }

  /**
   * Aplica os itens selecionados na pré-visualização estruturada à nota Markdown atual.
   */
  private async applySelectedChanges(): Promise<void> {
    const result = this.currentStructuredResult;
    if (!result) {
      new Notice(this.L.noAnalysisToApply);
      return;
    }

    const targetFile = this.currentActiveFilePath
      ? this.app.vault.getAbstractFileByPath(this.currentActiveFilePath)
      : this.app.workspace.getActiveFile();

    if (!(targetFile instanceof TFile)) {
      new Notice(this.L.errorTargetNoteGone);
      return;
    }

    if (targetFile.extension !== "md") {
      new Notice(this.L.errorTargetNotMarkdown);
      return;
    }

    // Recolher itens selecionados
    const selectedYamlKeys: string[] = [];
    const selectedTags: string[] = [];
    const selectedTasks: string[] = [];
    const selectedAiLinks: SelectedAnalysisLink[] = [];
    const selectedRelatedLinks: SelectedAnalysisLink[] = [];
    let selectedItemCount = 0;
    let selectedExistingTagCount = 0;
    let selectedNewTagCount = 0;
    let titleSelected = false;
    let renameFileSelected = false;
    let renameTargetPath = "";
    let renameTargetName = "";
    let moveFolderSelected = false;
    let moveFolderPath = "";
    let analysisSelected = false;

    for (const [id, selected] of this.structuredSelections.entries()) {
      if (!selected) continue;
      selectedItemCount++;

      const item = this.selectableItemsMap.get(id);

      if (!item) {
        continue;
      }

      switch (item.kind) {
        case "yaml":
          selectedYamlKeys.push(item.value);
          break;
        case "tag":
          selectedTags.push(item.value);
          if (item.reason === "existing-tag") {
            selectedExistingTagCount++;
          } else if (item.reason === "new-tag") {
            selectedNewTagCount++;
          }
          break;
        case "task":
          selectedTasks.push(item.value);
          break;
        case "title":
          titleSelected = true;
          break;
        case "rename-file":
          renameFileSelected = true;
          renameTargetPath = item.path ?? "";
          renameTargetName = item.value;
          break;
        case "move":
          moveFolderSelected = true;
          moveFolderPath = item.value;
          break;
        case "analysis":
          analysisSelected = true;
          break;
        case "ai-link":
          if (item.path) {
            selectedAiLinks.push({
              kind: "ai-link",
              path: item.path,
              title: item.title || getBasenameWithoutExtension(item.path),
              reason: item.reason
            });
          }
          break;
        case "related-link":
          if (item.path) {
            selectedRelatedLinks.push({
              kind: "related-link",
              path: item.path,
              title: item.title || getBasenameWithoutExtension(item.path),
              reason: item.reason
            });
          }
          break;
      }
    }

    // Contar campos YAML por estado
    let newYamlCount = 0;
    let existingYamlCount = 0;
    let conflictYamlCount = 0;

    if (result.yaml) {
      let existingFrontmatter: Map<string, string> = new Map();
      try {
        const content = await this.app.vault.read(targetFile);
        const { frontmatter } = extrairFrontmatter(content);
        if (frontmatter) {
          existingFrontmatter = parseFrontmatterLines(frontmatter);
        }
      } catch (error) {
        console.warn("Não foi possível ler frontmatter existente para contagem:", error);
      }

      for (const key of selectedYamlKeys) {
        const originalKey = Object.keys(result.yaml).find(k => k.toLowerCase() === key.toLowerCase());
        if (!originalKey) continue;

        const value = result.yaml[originalKey];
        const valueStr = Array.isArray(value) ? value.join(", ") : String(value);
        const existingValue = existingFrontmatter.get(originalKey);

        if (existingValue === valueStr) {
          existingYamlCount++;
        } else if (existingValue) {
          conflictYamlCount++;
        } else {
          newYamlCount++;
        }
      }
    }

    // Verificar se há pelo menos um item selecionado
    if (selectedItemCount === 0) {
      new Notice(this.L.noItemSelected);
      return;
    }

    // Proteção de integridade: verificar se a nota já contém conteúdo IA
    try {
      const currentContent = await this.app.vault.read(targetFile);
      if (this.hasLinaGeneratedContent(currentContent)) {
        const confirmed = await this.confirmReinsertAiContent();
        if (!confirmed) {
          new Notice(this.L.operationCancelledNoChange);
          return;
        }
      }
    } catch (error) {
      console.warn("Lina: não foi possível verificar conteúdo IA existente", error);
      // Continuar com a aplicação se não conseguir ler (não bloquear)
    }

    if (renameFileSelected) {
      if (!result.suggestedTitle || result.suggestedTitle.trim().length === 0) {
        new Notice(this.L.titleEmptyNoRename);
        return;
      }

      if (!renameTargetName || !renameTargetPath) {
        new Notice(this.L.noSafeNameGenerated);
        return;
      }

      if (!moveFolderSelected && normalizePath(targetFile.path).toLowerCase() === normalizePath(renameTargetPath).toLowerCase()) {
        new Notice(this.L.suggestedNameSameAsCurrent);
        return;
      }

      if (!moveFolderSelected) {
        const existingTarget = this.app.vault.getAbstractFileByPath(renameTargetPath);
        if (existingTarget) {
          new Notice(this.L.fileAlreadyExistsDestNoRename);
          return;
        }
      }
    }

    if (moveFolderSelected) {
      const suggestedFolder = normalizeSuggestedFolderPath(moveFolderPath);
      if (!suggestedFolder.isValid) {
        new Notice(this.L.folderNotValid);
        return;
      }

      moveFolderPath = suggestedFolder.path;
      const destinationFolder = this.app.vault.getAbstractFileByPath(moveFolderPath);
      if (!(destinationFolder instanceof TFolder)) {
        new Notice(this.L.folderNotExists);
        new Notice(this.L.folderAutoCreateNotAllowed);
        return;
      }

      const currentFolderForMove = getFolderPathForFile(targetFile) ?? "";
      if (normalizePathForComparison(currentFolderForMove) === normalizePathForComparison(moveFolderPath ?? "")) {
        new Notice(this.L.noteAlreadyInFolder);
        return;
      }
    }

    const currentFolder = getFolderPathForFile(targetFile);
    const finalFolder = moveFolderSelected ? moveFolderPath : currentFolder;
    const finalFileName = renameFileSelected ? renameTargetName : targetFile.name;
    const finalPath = getPathInFolder(finalFolder, finalFileName);
    const pathWillChange = normalizePathForComparison(targetFile.path) !== normalizePathForComparison(finalPath);

    if (pathWillChange) {
      const existingTarget = this.app.vault.getAbstractFileByPath(finalPath);
      if (existingTarget) {
        if (moveFolderSelected) {
          new Notice(this.L.fileAlreadyExistsDestNoMove);
        } else {
          new Notice(this.L.fileAlreadyExistsDestNoRename);
        }
        return;
      }
    }

    const summaryLines: string[] = [];
    if (newYamlCount > 0) summaryLines.push(`${newYamlCount} campos YAML novos`);
    if (existingYamlCount > 0) summaryLines.push(`${existingYamlCount} campos YAML ignorados por já existirem`);
    if (conflictYamlCount > 0) summaryLines.push(`${conflictYamlCount} campos YAML ignorados por conflito`);
    if (selectedTags.length > 0) summaryLines.push(`${selectedTags.length} tags`);
    if (selectedExistingTagCount > 0) summaryLines.push(`${selectedExistingTagCount} tags já existentes selecionadas`);
    if (selectedNewTagCount > 0) summaryLines.push(`${selectedNewTagCount} tags novas selecionadas`);
    if (selectedTasks.length > 0) summaryLines.push(`${selectedTasks.length} tarefas`);
    if (analysisSelected) summaryLines.push("análise: sim");
    if (titleSelected) summaryLines.push("título H1: sim");
    if (renameFileSelected) {
      summaryLines.push("renomear ficheiro: sim");
      summaryLines.push(`nome atual: ${targetFile.name}`);
      summaryLines.push(`novo nome: ${renameTargetName}`);
    }
    if (moveFolderSelected) {
      summaryLines.push("mover nota: sim");
      summaryLines.push(`pasta atual: ${currentFolder || "/"}`);
      summaryLines.push(`pasta sugerida: ${moveFolderPath}`);
      summaryLines.push(`caminho final: ${finalPath}`);
    }
    if (selectedAiLinks.length > 0) summaryLines.push(`${selectedAiLinks.length} links internos sugeridos`);
    if (selectedRelatedLinks.length > 0) summaryLines.push(`${selectedRelatedLinks.length} outras notas relacionadas`);
    if (summaryLines.length === 0) summaryLines.push("itens selecionados");

    // Confirmação explícita
    const confirmed = await this.confirmApplySuggestions(summaryLines, renameFileSelected, moveFolderSelected);
    if (!confirmed) {
      new Notice(this.L.operationCancelledNoChange);
      return;
    }

    // Aplicar alterações
    try {
      const originalContent = await this.app.vault.read(targetFile);
      let content = originalContent;

      // 1. Aplicar YAML e tags no frontmatter
      if (selectedYamlKeys.length > 0 || selectedTags.length > 0) {
        content = this.applyYamlAndTagsToNote(content, result, selectedYamlKeys, selectedTags);
      }

      // 2. Aplicar título H1
      if (titleSelected && result.suggestedTitle) {
        content = this.applyTitleToNote(content, result.suggestedTitle);
      }

      // 3. Aplicar tarefas no fim
      if (selectedTasks.length > 0) {
        content = this.applyTasksToNote(content, selectedTasks);
      }

    // 4. Aplicar análise no fim (sempre aplicar se houver links selecionados, mesmo sem "análise" selecionada)
      const hasLinksToApply = selectedAiLinks.length > 0 || selectedRelatedLinks.length > 0;
      if (analysisSelected && result.analysis) {
        content = this.applyAnalysisToNote(content, result, selectedAiLinks, selectedRelatedLinks, true);
      } else if (hasLinksToApply) {
        // Aplicar apenas links se não houver análise selecionada
        content = this.applyAnalysisToNote(content, result, selectedAiLinks, selectedRelatedLinks, false);
      }

      // Escrever nota apenas se o conteúdo mudou
      if (content !== originalContent) {
        await this.app.vault.modify(targetFile, content);
      }

      // 5. Renomear ficheiro no fim, mantendo a mesma pasta
      if (pathWillChange) {
        const existingTarget = this.app.vault.getAbstractFileByPath(finalPath);
        if (existingTarget) {
          if (moveFolderSelected) {
            new Notice(this.L.fileAlreadyExistsDestNoMove);
            return;
          }
          new Notice(this.L.fileAlreadyExistsDestNoRename);
        } else {
          await this.app.fileManager.renameFile(targetFile, finalPath);
           this.currentActiveFilePath = finalPath;
          if (moveFolderSelected) {
            new Notice(this.L.noteMovedSuccess);
          } else if (renameFileSelected) {
            new Notice(this.L.fileRenamedSuccess);
          }
        }
      }

      if (content !== originalContent) {
        new Notice(this.L.suggestionsApplied);
      }

      if (selectedYamlKeys.length > 0) {
        // Verificar se houve conflitos (propriedades não substituídas)
        // (A lógica de merge já preserva existentes, só avisar se aplicável)
      }

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      new Notice(`${this.L.applySuggestionsErrorPrefix}: ${msg}`);
    }
  }

  /**
   * Aplica YAML e tags selecionados ao frontmatter da nota.
   */
  private applyYamlAndTagsToNote(
    content: string,
    result: StructuredAnalysisResult,
    selectedYamlKeys: string[],
    selectedTags: string[]
  ): string {
    const { frontmatter, body, hasFrontmatter } = extrairFrontmatter(content);
    const existingProps = parseFrontmatterLines(frontmatter);
    const existingTags = extrairTagsDoFrontmatter(frontmatter);
    const normalizedSelectedTags = normalizarTags(selectedTags);

    // Construir novas linhas YAML
    const newLines: string[] = [];

    // Adicionar campos YAML selecionados (que existem no resultado)
    if (result.yaml) {
      for (const key of selectedYamlKeys) {
        // Encontrar a chave original (ignorando lower case)
        const originalKey = Object.keys(result.yaml).find(
          k => k.toLowerCase() === key.toLowerCase()
        );
        if (!originalKey) continue;

        const value = result.yaml[originalKey];
        const valueStr = Array.isArray(value) ? value.join(", ") : String(value);

        // Verificar se já existe
        if (existingProps.has(originalKey)) {
          const existingValue = existingProps.get(originalKey);
          if (existingValue && existingValue.length > 0) {
            // Já existe com valor, não substituir
            continue;
          }
        }

        newLines.push(`${originalKey}: ${valueStr}`);
      }
    }

    // Adicionar tags selecionadas
    if (normalizedSelectedTags.length > 0) {
      const allTags = [...new Set([...existingTags, ...normalizedSelectedTags])];
      if (allTags.length > 0) {
        newLines.push("tags:");
        for (const tag of allTags) {
          newLines.push(`  - ${tag}`);
        }
      }
    }

    if (newLines.length === 0) {
      return content; // Nada a aplicar
    }

    // Construir novo conteúdo
    if (hasFrontmatter) {
      // Inserir novas linhas antes do fim do frontmatter
      const frontmatterLines = frontmatter.split("\n");
      const cleanedFrontmatterLines: string[] = [];

      for (let i = 0; i < frontmatterLines.length; i++) {
        const line = frontmatterLines[i];
        const trimmed = line.trim();

        if (trimmed.startsWith("tags:") && normalizedSelectedTags.length > 0) {
          const afterColon = trimmed.substring(5).trim();
          if (afterColon.length === 0) {
            i++;
            while (i < frontmatterLines.length && frontmatterLines[i].trim().startsWith("- ")) {
              i++;
            }
            i--;
          }
          continue;
        }

        cleanedFrontmatterLines.push(line);
      }

      // Adicionar novas linhas
      cleanedFrontmatterLines.push(...newLines);
      const newFrontmatter = cleanedFrontmatterLines.join("\n");
      return `---\n${newFrontmatter}\n---\n${body}`;
    } else {
      // Criar frontmatter do zero
      return `---\n${newLines.join("\n")}\n---\n${body}`;
    }
  }

  /**
   * Aplica o título sugerido como H1.
   */
  private applyTitleToNote(content: string, suggestedTitle: string): string {
    const lines = content.split("\n");
    let firstContentLine = 0;

    // Saltar frontmatter
    if (lines[0]?.trim() === "---") {
      for (let i = 1; i < lines.length; i++) {
        if (lines[i]?.trim() === "---") {
          firstContentLine = i + 1;
          break;
        }
      }
    }

    // Procurar H1 existente
    for (let i = firstContentLine; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith("# ") && !trimmed.startsWith("## ")) {
        // Substituir H1 existente
        lines[i] = `# ${suggestedTitle}`;
        return lines.join("\n");
      }
    }

    // Inserir H1 no início do conteúdo
    lines.splice(firstContentLine, 0, `# ${suggestedTitle}`);
    return lines.join("\n");
  }

  /**
   * Aplica tarefas selecionadas no fim da nota.
   * Garante que tarefas entram sempre como por concluir: `- [ ]`
   */
  private applyTasksToNote(content: string, selectedTasks: string[]): string {
    if (secaoExiste(content, SECCAO_TAREFAS)) {
      // Adicionar apenas tarefas novas
      const taskSectionRegex = new RegExp(`${SECCAO_TAREFAS}[\\s\\S]*$`);
      const taskSectionMatch = content.match(taskSectionRegex);
      if (taskSectionMatch) {
        const taskSection = taskSectionMatch[0];
        const existingTasks = taskSection.split("\n")
          .filter(line => line.trim().startsWith("- [ ]") || line.trim().startsWith("- [x]"))
          .map(line => normalizeTaskText(line.trim()));

        const existingTaskSet = new Set(existingTasks);
        const seenSelectedTasks = new Set<string>();
        const newTasks = selectedTasks.filter(task => {
          const normalizedTask = normalizeTaskText(task);
          if (!normalizedTask || existingTaskSet.has(normalizedTask) || seenSelectedTasks.has(normalizedTask)) {
            return false;
          }
          seenSelectedTasks.add(normalizedTask);
          return true;
        });
        if (newTasks.length === 0) return content;

        // Garantir que entram como por concluir: `- [ ]`
        const tasksToAdd = newTasks.map(t => `- [ ] ${t}`).join("\n");
        return content + "\n" + tasksToAdd;
      }
    }

    // Criar nova secção - garantir que entram como por concluir: `- [ ]`
    const seenSelectedTasks = new Set<string>();
    const uniqueTasks = selectedTasks.filter(task => {
      const normalizedTask = normalizeTaskText(task);
      if (!normalizedTask || seenSelectedTasks.has(normalizedTask)) return false;
      seenSelectedTasks.add(normalizedTask);
      return true;
    });
    const tasksBlock = uniqueTasks.map(t => `- [ ] ${t}`).join("\n");
    if (!tasksBlock) return content;
    return `${content}\n\n${SECCAO_TAREFAS}\n${tasksBlock}\n`;
  }

  /**
   * Aplica a análise no fim da nota.
   */
  private applyAnalysisToNote(
    content: string,
    result: StructuredAnalysisResult,
    selectedAiLinks: SelectedAnalysisLink[] = [],
    selectedRelatedLinks: SelectedAnalysisLink[] = [],
    includeAnalysisDetails = true
  ): string {
    const analysisLines: string[] = [];
    const analysisDetailLines: string[] = [];
    const existingAnalysisSection = getMarkdownSection(content, SECCAO_ANALISE);
    const existingLinkPaths = extractExistingAnalysisLinkPaths(content);
    const linksToWrite: SelectedAnalysisLink[] = [];
    const seenLinkPaths = new Set<string>();

    for (const link of [...selectedAiLinks, ...selectedRelatedLinks]) {
      const normalizedPath = normalizePathSafe(link.path);
      if (existingLinkPaths.has(normalizedPath)) continue;
      if (seenLinkPaths.has(normalizedPath)) continue;

      seenLinkPaths.add(normalizedPath);
      linksToWrite.push(link);
    }

    if (includeAnalysisDetails) {
      if (result.analysis) analysisDetailLines.push(result.analysis);
      else if (result.summary) analysisDetailLines.push(result.summary);
      if (result.noteType) analysisDetailLines.push(`\n${this.L.inboxType}: ${result.noteType}`);
      if (result.mainTopic) analysisDetailLines.push(`${this.L.inboxTopic}: ${result.mainTopic}`);
      if (result.suggestedFolder) analysisDetailLines.push(`${this.L.previewSuggestedFolder}: ${result.suggestedFolder}`);
      if (result.confidence) analysisDetailLines.push(`\n${this.L.previewConfidence}: ${result.confidence}`);
      if (result.limitations && result.limitations !== "Nenhuma.") analysisDetailLines.push(`${this.L.previewLimitations}: ${result.limitations}`);
    }

    const analysisDetailsText = analysisDetailLines.join("\n");
    if (
      analysisDetailsText.trim().length > 0 &&
      !normalizeComparableText(existingAnalysisSection).includes(normalizeComparableText(analysisDetailsText))
    ) {
      analysisLines.push(analysisDetailsText);
    }

    if (linksToWrite.length > 0) {
      analysisLines.push(analysisLines.length > 0 ? "\nLinks internos selecionados:" : "Links internos selecionados:");
      for (const link of linksToWrite) {
        analysisLines.push(`* ${formatObsidianWikiLink(link.path, link.title)}`);
      }
    }

    const analysisText = analysisLines.join("\n");
    if (analysisText.trim().length === 0) {
      return content;
    }

    if (secaoExiste(content, SECCAO_ANALISE)) {
      const sectionStart = content.indexOf(SECCAO_ANALISE);
      const sectionBodyStart = sectionStart + SECCAO_ANALISE.length;
      const afterHeading = content.substring(sectionBodyStart);
      const nextSectionMatch = afterHeading.match(/\n##\s+/);
      const sectionEnd = nextSectionMatch ? sectionBodyStart + (nextSectionMatch.index ?? afterHeading.length) : content.length;
      const beforeSectionEnd = content.substring(0, sectionEnd).replace(/\s+$/, "");
      const afterSectionEnd = content.substring(sectionEnd);

      return `${beforeSectionEnd}\n\n---\n${analysisText}\n${afterSectionEnd}`;
    }

    return `${content}\n\n${SECCAO_ANALISE}\n${analysisText}\n`;
  }

  // -----------------------------------------------------------------------
  // Métodos de análise
  // -----------------------------------------------------------------------

  /**
   * Analisa a nota atualmente aberta.
   */
  private async analyzeCurrentNote(): Promise<void> {
    this.prepareAnalysisArea();
    const activeFile = this.app.workspace.getActiveFile();
    await this.analyzeMarkdownFile(activeFile, {
      panelTitle: "IA — nota atual",
      analyzingMessage: "A analisar nota atual...",
      noFileMessage: "Nenhuma nota aberta. Abre uma nota Markdown primeiro.",
      nonMarkdownMessage: "O ficheiro ativo não é Markdown. Abre uma nota .md para analisar.",
      emptyMessage: "A nota atual está vazia. Não há conteúdo para analisar.",
      retryActionLabel: "Analisar nota atual"
    });
  }

  /**
   * Analisa a nota atualmente aberta com contexto de notas relacionadas.
   */
  private async analyzeCurrentNoteWithContext(): Promise<void> {
    this.prepareAnalysisArea();
    const activeFile = this.app.workspace.getActiveFile();
    await this.analyzeMarkdownFile(activeFile, {
      withContext: true,
      panelTitle: "IA — nota atual com contexto",
      analyzingMessage: "A analisar nota atual com contexto...",
      noFileMessage: "Nenhuma nota aberta. Abre uma nota Markdown primeiro.",
      nonMarkdownMessage: "O ficheiro ativo não é Markdown. Abre uma nota .md para analisar.",
      emptyMessage: "A nota atual está vazia. Não há conteúdo para analisar.",
      retryActionLabel: "Analisar com notas relacionadas"
    });
  }

  private async analyzeMarkdownFile(
    file: TFile | null,
    options: {
      withContext?: boolean;
      panelTitle: string;
      analyzingMessage: string;
      noFileMessage: string;
      nonMarkdownMessage: string;
      emptyMessage: string;
      retryActionLabel: string;
    }
  ): Promise<void> {
    const analysisRunId = this.analysisRunId;
    this.currentAnalysisScope = "single-note";
    this.ensureAnalysisPanel(options.panelTitle, file?.basename);
    if (!this.analysisResultEl) return;

    this.analysisResultEl.empty();
    this.analysisResultEl.addClass("lina-display-block");
    this.currentActiveFilePath = undefined;
    this.currentAnalysisSourcePath = undefined;

    if (!file) {
      this.analysisResultEl.createDiv({
        text: options.noFileMessage,
        attr: { style: "color: var(--text-warning); padding: 8px 0;" }
      });
      return;
    }

    const currentFile = this.app.vault.getAbstractFileByPath(file.path);
    if (!(currentFile instanceof TFile)) {
      this.analysisResultEl.createDiv({
        text: "A nota selecionada já não existe no vault.",
        attr: { style: "color: var(--text-warning); padding: 8px 0;" }
      });
      return;
    }

    this.currentAnalysisSourcePath = currentFile.path;

    if (currentFile.extension !== "md") {
      this.analysisResultEl.createDiv({
        text: options.nonMarkdownMessage,
        attr: { style: "color: var(--text-warning); padding: 8px 0;" }
      });
      return;
    }

    let content: string;
    try {
      content = await this.app.vault.read(currentFile);
    } catch (error) {
      this.analysisResultEl.createDiv({
        text: `Erro ao ler a nota: ${error instanceof Error ? error.message : String(error)}`,
        attr: { style: "color: var(--text-error); padding: 8px 0;" }
      });
      return;
    }

    if (!content || content.trim().length === 0) {
      this.analysisResultEl.createDiv({
        text: options.emptyMessage,
        attr: { style: "color: var(--text-warning); padding: 8px 0;" }
      });
      return;
    }

    if (this.contentMatchesUserExclusion(content)) {
      this.renderUserContentExcludedBlock();
      return;
    }

    const activeProfile = this.getActiveTextAiProfile();

    this.analysisResultEl.createDiv({
      text: options.analyzingMessage,
      attr: { style: "color: var(--text-muted); padding: 8px 0; font-style: italic;" }
    });

    const title = currentFile.basename;
    const path = currentFile.path;
    const initialRelatedNotes = options.withContext
      ? await this.findRelatedNotesForCurrentNote(title, path, content)
      : [];
    const relatedFilterResult = await this.filterRelatedNotesByUserContentRules(initialRelatedNotes);
    const relatedNotes = relatedFilterResult.notes;
    const prompt = options.withContext
      ? this.buildCurrentNoteAnalysisPromptWithContext(title, path, content, relatedNotes)
      : this.buildCurrentNoteAnalysisPrompt(title, path, content);
    const result = await this.generateTextWithActiveAiProfile(activeProfile, prompt);

    if (analysisRunId !== this.analysisRunId) {
      return;
    }

    const activeFileAfterGeneration = this.app.workspace.getActiveFile();
    if (activeFileAfterGeneration?.path !== path) {
      return;
    }

    this.analysisResultEl.empty();

    if (!result.success) {
      if (result.message.includes("Tempo limite")) {
        this.analysisResultEl.createDiv({
          text: "A análise excedeu o tempo limite. Podes aumentar o tempo nas definições ou tentar novamente.",
          attr: { style: "color: var(--text-error); padding: 8px 0;" }
        });
      } else if (result.message.includes("model")) {
        this.analysisResultEl.createDiv({
          text: `Modelo "${activeProfile.model}" não encontrado. Verifica se o modelo está disponível no perfil ativo.`,
          attr: { style: "color: var(--text-error); padding: 8px 0;" }
        });
      } else {
        this.analysisResultEl.createDiv({
          text: `Erro ao analisar nota: ${result.message}`,
          attr: { style: "color: var(--text-error); padding: 8px 0;" }
        });
      }
      this.analysisResultEl.createDiv({
        text: `Podes tentar novamente clicando em '${options.retryActionLabel}'.`,
        attr: { style: "color: var(--text-muted); font-size: 0.85em; margin-top: 4px;" }
      });
      return;
    }

    if (!result.text || result.text.trim().length === 0) {
      this.analysisResultEl.createDiv({
        text: "A IA devolveu uma resposta vazia. Tenta novamente.",
        attr: { style: "color: var(--text-warning); padding: 8px 0;" }
      });
      return;
    }

    await this.processAIResponse(result.text, path, relatedNotes.map(n => n.path), relatedNotes.length, relatedNotes, currentFile);
    if (relatedFilterResult.excludedCount > 0) {
      this.renderContextExclusionWarning();
    }
  }

  private async analyzeInboxNotes(): Promise<void> {
    this.prepareAnalysisArea();
    this.currentAnalysisScope = "batch";
    const analysisRunId = this.analysisRunId;
    this.ensureAnalysisPanel(this.L.analysisTitleInbox);
    if (!this.analysisResultEl) return;

    this.analysisResultEl.empty();
    this.analysisResultEl.addClass("lina-display-block");
    this.currentAnalysisSourcePath = null;

    const inboxFolderPath = normalizePath((this.plugin.settings.inboxFolderPath ?? "").trim());
    if (!inboxFolderPath) {
      this.analysisResultEl.createDiv({
        text: this.L.inboxConfigMissing,
        attr: { style: "color: var(--text-warning); padding: 8px 0;" }
      });
      return;
    }

    const maxNotes = Math.min(20, Math.max(1, this.plugin.settings.maxInboxNotesToAnalyze ?? 10));
    let collection: FolderMarkdownNotesResult;
    try {
      collection = this.getFolderMarkdownNotes(inboxFolderPath, {
        includeSubfolders: false,
        maxNotes,
        sortBy: "mtime"
      });
    } catch {
      this.analysisResultEl.createDiv({
        text: this.L.inboxFolderMissing,
        attr: { style: "color: var(--text-warning); padding: 8px 0;" }
      });
      return;
    }

    if (collection.notes.length === 0) {
      this.analysisResultEl.createDiv({
        text: this.L.inboxNoNotes,
        attr: { style: "color: var(--text-muted); padding: 8px 0;" }
      });
      return;
    }

    const filesToAnalyze = collection.notes;
    const activeProfile = this.getActiveTextAiProfile();
    const results: InboxNoteAnalysisResult[] = [];

    this.analysisResultEl.createDiv({
      text: this.L.inboxAnalysing,
      attr: { style: "color: var(--text-muted); padding: 8px 0; font-style: italic;" }
    });

    for (let index = 0; index < filesToAnalyze.length; index++) {
      const file = filesToAnalyze[index];
      this.setStatus(`A analisar nota ${index + 1}/${filesToAnalyze.length}: ${file.basename}`);

      try {
        const content = await this.app.vault.read(file);
        if (!content || content.trim().length === 0) {
          results.push({ file, error: "Nota vazia. A análise foi ignorada." });
          continue;
        }

        if (this.contentMatchesUserExclusion(content)) {
          results.push({
            file,
            error: this.L.inboxExcludedByUserRules
          });
          continue;
        }

        const prompt = this.buildInboxNoteAnalysisPrompt(file.basename, file.path, content);
        const response = await this.generateTextWithActiveAiProfile(activeProfile, prompt);
        if (!response.success) {
          results.push({ file, error: response.message });
          continue;
        }

        const { json, error } = extrairJsonDaResposta(response.text ?? "");
        if (!json || error) {
          results.push({ file, error: error ?? "Resposta JSON inválida." });
          continue;
        }

        this.prepareStructuredAnalysisResult(json);
        this.applyFolderSuggestionResolution(json, file.path);
        results.push({
          file,
          result: json,
        });
      } catch (error) {
        results.push({
          file,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (analysisRunId !== this.analysisRunId) {
      return;
    }

    this.renderInboxAnalysisResults(results, filesToAnalyze.length, collection.totalEligible);
    this.setStatus(this.L.statusAnalysisComplete);
  }

  private async confirmRemoteFolderAnalysis(
    profile: { provider: string; model: string; baseUrl: string; isLocal: boolean },
    noteCount: number
  ): Promise<boolean> {
    return new Promise(resolve => {
      const modal = new Modal(this.app);
      modal.titleEl.setText(this.L.folderAnalysisRemoteConfirmTitle);

      modal.contentEl.createDiv({ text: this.L.folderAnalysisRemoteConfirmIntro }).addClass("lina-mb-8");
      const list = modal.contentEl.createEl("ul");
      list.addClass("lina-mt-0");
      list.createEl("li", { text: `Provider: ${profile.provider}` });
      list.createEl("li", { text: `Modelo: ${profile.model}` });
      list.createEl("li", { text: `${this.L.folderAnalysisCountEligible}: ${noteCount}` });

      const warning = modal.contentEl.createDiv({ text: this.L.folderAnalysisRemoteConfirmWarning });
      warning.addClass("lina-mt-12");

      const buttons = modal.contentEl.createDiv();
      buttons.addClass("lina-display-flex");
      buttons.addClass("lina-justify-end");
      buttons.addClass("lina-gap-8");
      buttons.addClass("lina-mt-16");

      const cancelButton = buttons.createEl("button", { text: this.L.confirmCancelButton });
      const continueButton = buttons.createEl("button", { text: this.L.folderAnalysisRemoteConfirmButton });
      continueButton.classList.add("mod-cta");

      let resolved = false;
      const finish = (value: boolean) => {
        if (resolved) return;
        resolved = true;
        modal.close();
        resolve(value);
      };

      cancelButton.addEventListener("click", () => finish(false));
      continueButton.addEventListener("click", () => finish(true));
      modal.onClose = () => finish(false);
      modal.open();
    });
  }

  private async analyzeFolderNotes(folderPath: string, options: { includeSubfolders: boolean }): Promise<void> {
    const normalizedFolderPath = this.normalizeFolderPathForAnalysis(folderPath);
    const maxNotes = this.getFolderAnalysisMaxNotes();

    this.plugin.settings.lastAnalyzedFolderPath = normalizedFolderPath;
    this.plugin.settings.folderAnalysisIncludeSubfolders = options.includeSubfolders;
    this.plugin.settings.folderAnalysisMaxNotes = maxNotes;
    await this.plugin.saveSettings();

    this.prepareAnalysisArea();
    this.currentAnalysisScope = "batch";
    const analysisRunId = this.analysisRunId;
    this.ensureAnalysisPanel(`${this.L.analysisTitleFolder}: ${normalizedFolderPath}`);
    if (!this.analysisResultEl) return;

    this.analysisResultEl.empty();
    this.analysisResultEl.addClass("lina-display-block");
    this.currentAnalysisSourcePath = null;

    let collection: FolderMarkdownNotesResult;
    try {
      collection = this.getFolderMarkdownNotes(normalizedFolderPath, {
        includeSubfolders: options.includeSubfolders,
        maxNotes,
        sortBy: "mtime"
      });
    } catch {
      this.analysisResultEl.createDiv({
        text: this.L.folderAnalysisFolderMissing,
        attr: { style: "color: var(--text-warning); padding: 8px 0;" }
      });
      return;
    }

    if (collection.notes.length === 0) {
      this.analysisResultEl.createDiv({
        text: this.L.folderAnalysisNoNotes,
        attr: { style: "color: var(--text-muted); padding: 8px 0;" }
      });
      return;
    }

    const activeProfile = this.getActiveTextAiProfile();
    if (!activeProfile.isLocal) {
      const confirmed = await this.confirmRemoteFolderAnalysis(activeProfile, collection.notes.length);
      if (!confirmed) {
        new Notice(this.L.operationCancelledNoChange);
        return;
      }
    }

    const results: InboxNoteAnalysisResult[] = [];

    this.analysisResultEl.createDiv({
      text: this.L.analysisAnalysingFolder,
      attr: { style: "color: var(--text-muted); padding: 8px 0; font-style: italic;" }
    });

    for (let index = 0; index < collection.notes.length; index++) {
      const file = collection.notes[index];
      this.setStatus(`A analisar nota ${index + 1}/${collection.notes.length}: ${file.basename}`);

      try {
        const content = await this.app.vault.read(file);
        if (!content || content.trim().length === 0) {
          results.push({ file, error: "Nota vazia. A análise foi ignorada." });
          continue;
        }

        if (this.contentMatchesUserExclusion(content)) {
          results.push({
            file,
            error: this.L.inboxExcludedByUserRules
          });
          continue;
        }

        const prompt = this.buildInboxNoteAnalysisPrompt(file.basename, file.path, content, normalizedFolderPath);
        const response = await this.generateTextWithActiveAiProfile(activeProfile, prompt);
        if (!response.success) {
          results.push({ file, error: response.message });
          continue;
        }

        const { json, error } = extrairJsonDaResposta(response.text ?? "");
        if (!json || error) {
          results.push({ file, error: error ?? "Resposta JSON inválida." });
          continue;
        }

        this.prepareStructuredAnalysisResult(json);
        this.applyFolderSuggestionResolution(json, file.path);
        results.push({
          file,
          result: json,
        });
      } catch (error) {
        results.push({
          file,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (analysisRunId !== this.analysisRunId) {
      return;
    }

    this.renderInboxAnalysisResults(
      results,
      collection.notes.length,
      collection.totalEligible,
      `${this.L.folderAnalysisResultsTitlePrefix} ${normalizedFolderPath}`,
      this.L.folderAnalysisResultsSummary
    );
    this.setStatus(this.L.statusAnalysisComplete);
  }

  private setAnalysisNoteName(noteName?: string): void {
    if (!this.analysisNoteNameEl) return;

    const cleanNoteName = noteName?.trim();
    if (cleanNoteName) {
      this.analysisNoteNameEl.setText(`${this.L.analysisNoteName}: ${cleanNoteName}`);
      this.analysisNoteNameEl.removeClass("lina-hidden");
      this.analysisNoteNameEl.addClass("lina-display-block");
    } else {
      this.analysisNoteNameEl.setText("");
      this.analysisNoteNameEl.addClass("lina-hidden");
    }
  }

  private syncAnalysisSectionState(): void {
    if (!this.analysisSectionEl || !this.analysisSummaryEl || !this.analysisChevronEl) return;

    this.syncCollapsibleSectionState(
      this.analysisSectionEl,
      this.analysisSummaryEl,
      this.analysisChevronEl
    );
  }

  private ensureAnalysisPanel(title: string, noteName?: string): void {
    if (!this.analysisSectionEl) {
      this.analysisSectionEl = this.contentEl.createEl("details");
      this.analysisSectionEl.addClass("lina-mt-16");
      this.analysisSectionEl.addClass("lina-border-top");
      this.analysisSectionEl.addClass("lina-pt-12");
    }
    this.analysisSectionEl.removeClass("lina-hidden");
    this.analysisSectionEl.addClass("lina-display-block");
    this.analysisSectionEl.open = true;

    if (!this.analysisResultEl) {
      this.analysisSummaryEl = this.analysisSectionEl.createEl("summary");
      this.analysisSummaryEl.addClass("lina-accordion-summary");
      this.analysisSummaryEl.setAttribute("title", "Expandir ou recolher análise");
      this.analysisSummaryEl.addClass("lina-display-flex");
      this.analysisSummaryEl.addClass("lina-justify-between");
      this.analysisSummaryEl.addClass("lina-items-center");
      this.analysisSummaryEl.addClass("lina-gap-8");
      this.analysisSummaryEl.addClass("lina-cursor-pointer");
      this.analysisSummaryEl.addClass("lina-mb-8");

      const analysisTitleGroup = this.analysisSummaryEl.createDiv();
      analysisTitleGroup.addClass("lina-display-flex");
      analysisTitleGroup.addClass("lina-items-start");
      analysisTitleGroup.addClass("lina-gap-0");
      analysisTitleGroup.addClass("lina-flex-1");
      analysisTitleGroup.addClass("lina-minw-0");

      this.analysisChevronEl = analysisTitleGroup.createSpan({ text: "▼" });
      this.analysisChevronEl.addClass("lina-accordion-chevron");
      this.analysisChevronEl.setAttribute("aria-hidden", "true");

      const titleBlock = analysisTitleGroup.createDiv();
      titleBlock.addClass("lina-flex-1");
      titleBlock.addClass("lina-minw-0");

      this.analysisTitleEl = titleBlock.createEl("h3", { text: title });
      this.analysisTitleEl.addClass("lina-m-0");

      this.analysisNoteNameEl = titleBlock.createDiv();
      this.analysisNoteNameEl.addClass("lina-color-muted");
      this.analysisNoteNameEl.addClass("lina-fs-085");
      this.analysisNoteNameEl.addClass("lina-mt-2");
      this.setAnalysisNoteName(noteName);

      const closeBtn = this.analysisSummaryEl.createEl("button", { text: "×" });
      closeBtn.setAttribute("aria-label", "Fechar análise");
      closeBtn.setAttribute("title", "Fechar análise");
      closeBtn.addClass("lina-cursor-pointer");
      closeBtn.addClass("lina-flex-shrink-0");
      closeBtn.addClass("lina-lh-1");
      closeBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.hideAnalysisArea(true);
        this.setStatus("");
      });

      this.analysisResultEl = this.analysisSectionEl.createDiv();
      this.analysisSectionEl.addEventListener("toggle", () => {
        this.syncAnalysisSectionState();
      });
    } else if (this.analysisTitleEl) {
      this.analysisTitleEl.setText(title);
      this.setAnalysisNoteName(noteName);
    }
    this.syncAnalysisSectionState();
  }

  private buildInboxNoteAnalysisPrompt(title: string, path: string, content: string, folderPath?: string): string {
    const batchContext = folderPath
      ? `Esta é uma análise em lote de notas da pasta: ${folderPath}. Não apliques alterações, não movas ficheiros e não renomeies notas.`
      : "Esta é uma análise em lote da Inbox. Não apliques alterações, não movas ficheiros e não renomeies notas.";

    const limitedContent = content.length > 4000
      ? `${content.substring(0, 4000)}\n\n(O conteúdo foi truncado para análise em lote.)`
      : content;

    const lang = this.plugin.settings.aiOutputLanguage;
    let languageInstruction = "";
    switch (lang) {
      case "pt-PT":
        languageInstruction = "Responde obrigatoriamente em português europeu.";
        break;
      case "pt-BR":
        languageInstruction = "Responde obrigatoriamente em português do Brasil.";
        break;
      case "en":
        languageInstruction = "Respond in English.";
        break;
      case "es":
        languageInstruction = "Responde obligatoriamente en español.";
        break;
      case "fr":
        languageInstruction = "Réponds obligatoirement en français.";
        break;
      case "auto":
        languageInstruction = "Responde no idioma predominante da nota.";
        break;
      default:
        languageInstruction = "Responde obrigatoriamente em português europeu.";
    }

    const yamlInstruction = this.plugin.settings.yamlSuggestionsEnabled
      ? `* Sugere YAML simples com as propriedades definidas em: ${this.plugin.settings.yamlAllowedProperties}
* Não cries propriedades fora da lista permitida.`
      : "* Não incluas YAML no JSON. O campo \"yaml\" deve ser omitido.";

    const tagsInstruction = this.plugin.settings.yamlIncludeTags
      ? `* Sugere tags no campo "tags", no máximo ${this.plugin.settings.maxSuggestedTags}.`
      : "* Não sugiras tags. O campo \"tags\" deve ser um array vazio [].";
    const existingFoldersSection = this.formatExistingFoldersForPrompt(path, title, content);

    return `${languageInstruction}

Analisa apenas a nota Markdown colocada entre <<<NOTA>>> e <<<FIM_NOTA>>>.

${batchContext}
Não uses Markdown decorativo.
Não uses tabelas.
Não escrevas introduções como "Aqui está...".
Não inventes datas.
Não inventes links internos.

Regras para YAML:
${yamlInstruction}

Regras para tags:
${tagsInstruction}
* Se sugerires tags, usa minúsculas, sem acentos, com espaços convertidos para underscore.

Regras para pasta sugerida:

Pastas existentes no vault que podes escolher preferencialmente:
${existingFoldersSection}

* Escolhe preferencialmente uma das pastas existentes listadas.
* Não inventes pastas na raiz do vault.
* Não sugiras INBOX, Inbox, 01_inbox ou 00_Inbox como destino.
* Se nenhuma pasta existente for adequada, propõe uma nova pasta dentro de uma pasta raiz existente listada.
* Se tiveres pouca confiança, deixa "suggestedFolder" vazio.

Responde APENAS com JSON válido, sem texto extra, sem blocos de código.

Estrutura JSON obrigatória:

{
  "summary": "resumo curto da nota em 1-2 frases",
  "suggestedTitle": "título sugerido curto e claro",
  "noteType": "tipo de nota",
  "mainTopic": "tema principal",
  "suggestedFolder": "pasta sugerida",
  "yaml": {
    "propriedade": "valor"
  },
  "tags": ["tag1", "tag2"],
  "tasks": ["tarefa 1", "tarefa 2"],
  "confidence": "alto | médio | baixo",
  "limitations": "limitações da análise ou 'Nenhuma.'"
}

TÍTULO:
${title}

CAMINHO_COMPLETO:
${path}

<<<NOTA>>>
${limitedContent}
<<<FIM_NOTA>>>`;
  }

  private prepareStructuredAnalysisResult(result: StructuredAnalysisResult): void {
    const yamlTags = result.yaml?.tags;
    if (yamlTags && (!result.tags || result.tags.length === 0)) {
      const recoveredTags = extrairTagsDeValorYaml(yamlTags);
      if (recoveredTags.length > 0) {
        result.tags = recoveredTags;
      }
    }

    if (result.yaml && this.plugin.settings.yamlSuggestionsEnabled) {
      result.yaml = filtrarYamlValido(result.yaml, this.plugin.settings.yamlAllowedProperties);
    }

    if (!this.plugin.settings.yamlSuggestionsEnabled) {
      delete result.yaml;
    }

    if (result.tags) {
      result.tags = normalizarTags(result.tags).slice(0, this.plugin.settings.maxSuggestedTags ?? 8);
    }
  }

  private createInboxCardBlock(container: HTMLElement, title: string): HTMLElement {
    const block = container.createDiv();
    block.addClass("lina-mt-10");

    const titleEl = block.createEl("strong", { text: title });
    titleEl.addClass("lina-display-block");
    titleEl.addClass("lina-fs-085");
    titleEl.addClass("lina-mb-4");

    const body = block.createDiv();
    body.addClass("lina-fs-085");
    body.addClass("lina-lh-145");
    return body;
  }

  private createInboxCardLine(container: HTMLElement, label: string, value: string): HTMLElement {
    const line = container.createDiv();
    const labelEl = line.createSpan({ text: `${label}: ` });
    labelEl.addClass("lina-color-muted");
    line.createSpan({ text: value });
    return line;
  }

  private createInboxCardParagraph(container: HTMLElement, text: string): HTMLElement {
    const paragraph = container.createDiv({ text });
    paragraph.addClass("lina-pre-wrap");
    paragraph.addClass("lina-break-word");
    return paragraph;
  }

  private renderInboxAnalysisResults(
    results: InboxNoteAnalysisResult[],
    analyzedCount: number,
    totalMarkdownCount: number,
    titleText = this.L.inboxResultsTitle,
    summaryText = this.L.inboxResultsSummary
  ): void {
    if (!this.analysisResultEl) return;

    this.analysisResultEl.empty();
    const title = this.analysisResultEl.createEl("h3", { text: titleText });
    title.addClass("lina-mt-0");

    this.renderCopyAiResponseButton(
      this.analysisResultEl,
      this.formatInboxAnalysisResultsForClipboard(results, analyzedCount, totalMarkdownCount, titleText, summaryText)
    );

    this.analysisResultEl.createDiv({
      text: `${summaryText}: ${analyzedCount}/${totalMarkdownCount}.`,
      attr: { style: "color: var(--text-muted); font-size: 0.85em; margin-bottom: 12px;" }
    });

    for (let index = 0; index < results.length; index++) {
      const item = results[index];
      const card = this.analysisResultEl.createDiv();
      card.addClass("lina-border");
      card.addClass("lina-radius-4");
      card.addClass("lina-p-10");
      card.addClass("lina-mb-10");

      const headerRow = card.createDiv();
      headerRow.addClass("lina-display-flex");
      headerRow.addClass("lina-items-center");
      headerRow.addClass("lina-gap-6");

      let isExpanded = false;
      const detailsEl = card.createDiv();
      detailsEl.addClass("lina-hidden");
      detailsEl.addClass("lina-mt-10");
      detailsEl.addClass("lina-border-top");
      detailsEl.addClass("lina-pt-8");

      const chevronButton = headerRow.createEl("button", { text: "▶" });
      chevronButton.setAttribute("aria-label", this.L.detailsShow);
      chevronButton.addClass("lina-border-none");
      chevronButton.addClass("lina-bg-transparent");
      chevronButton.addClass("lina-shadow-none");
      chevronButton.addClass("lina-p-0-4");
      chevronButton.addClass("lina-cursor-pointer");

      const titleButton = headerRow.createEl("button", { text: item.file.name });
      titleButton.addClass("lina-border-none");
      titleButton.addClass("lina-bg-transparent");
      titleButton.addClass("lina-shadow-none");
      titleButton.addClass("lina-p-0");
      titleButton.addClass("lina-color-accent");
      titleButton.addClass("lina-fw-600");
      titleButton.addClass("lina-text-left");
      titleButton.addClass("lina-cursor-pointer");
      titleButton.addClass("lina-break-word");
      titleButton.addEventListener("click", () => {
        void this.openInboxAnalysisFile(item.file);
      });

      const setExpanded = (expanded: boolean) => {
        isExpanded = expanded;
        detailsEl.classList.toggle("lina-hidden", !isExpanded);
        chevronButton.setText(isExpanded ? "▼" : "▶");
        chevronButton.setAttribute("aria-label", isExpanded ? this.L.detailsHide : this.L.detailsShow);
      };

      chevronButton.addEventListener("click", (event) => {
        event.stopPropagation();
        setExpanded(!isExpanded);
      });

      const pathEl = detailsEl.createDiv({
        text: item.file.path,
        attr: { style: "font-size: 0.8em; color: var(--text-muted); margin-top: 4px;" }
      });

      if (item.warning) {
        card.createDiv({
          text: item.warning,
          attr: { style: "color: var(--text-warning); font-size: 0.85em; margin-top: 8px;" }
        });
      }

      if (item.error) {
        card.createDiv({
          text: item.error,
          attr: { style: "color: var(--text-error); font-size: 0.85em; margin-top: 8px;" }
        });
        continue;
      }

      if (!item.result) continue;

      const rawSuggestedFolder = (item.result.suggestedFolder ?? "").trim();
      const folderResolution = rawSuggestedFolder
        ? this.resolveFolderMove(rawSuggestedFolder, this.getExistingVaultFolders(), getFolderPathForFile(item.file), item.file.name, item.file.path)
        : null;

      const compactMeta = card.createDiv();
      compactMeta.addClass("lina-fs-085");
      compactMeta.addClass("lina-color-muted");
      compactMeta.addClass("lina-mt-6");
      compactMeta.addClass("lina-lh-14");

      if (folderResolution) {
        compactMeta.createDiv({ text: `${this.L.inboxDestination}: ${folderResolution.resolvedFolderPath || folderResolution.rawSuggestedFolder}` });
      }
      const folderStatusEl = compactMeta.createDiv({
        text: folderResolution
          ? `${this.L.inboxFolderStatus}: ${folderResolution.reason}`
          : `${this.L.inboxFolderStatus}: ${this.L.inboxNoSuggestedFolder}`
      });
      folderStatusEl.addClass(folderResolution?.canMove ? "lina-color-success" : "lina-color-warning");
      if (item.result.confidence) compactMeta.createDiv({ text: `${this.L.inboxDetailConfidence}: ${item.result.confidence}` });

      const destinationBlock = this.createInboxCardBlock(detailsEl, this.L.inboxDetailDestination);
      if (folderResolution) {
        this.createInboxCardLine(destinationBlock, this.L.inboxSuggestedFolder, folderResolution.resolvedFolderPath || folderResolution.rawSuggestedFolder);
      } else {
        this.createInboxCardLine(destinationBlock, this.L.inboxSuggestedFolder, this.L.inboxNoSuggestedFolder);
      }
      const detailFolderStatusEl = this.createInboxCardLine(
        destinationBlock,
        this.L.inboxFolderStatus,
        folderResolution?.reason ?? this.L.inboxNoSuggestedFolder
      );
      detailFolderStatusEl.addClass(folderResolution?.canMove ? "lina-color-success" : "lina-color-warning");
      if (item.result.confidence) this.createInboxCardLine(destinationBlock, this.L.inboxDetailConfidence, item.result.confidence);

      const detailActions = this.createInboxCardBlock(detailsEl, this.L.inboxDetailActions);
      detailActions.addClass("lina-display-flex");
      detailActions.addClass("lina-flex-wrap");
      detailActions.addClass("lina-gap-8");

      if (folderResolution) {
        this.renderInboxFolderMoveControls(
          detailActions,
          item.file,
          rawSuggestedFolder,
          folderResolution,
          pathEl,
          [folderStatusEl, detailFolderStatusEl]
        );
      }

      const analyzeButton = detailActions.createEl("button", { text: this.L.inboxAnalyse });
      analyzeButton.addClass("lina-fw-600");
      analyzeButton.addEventListener("click", () => {
        void this.analyzeInboxFileIndividually(item.file);
      });

      const analyzeWithContextButton = detailActions.createEl("button", { text: this.L.inboxAnalyseWithContext });
      analyzeWithContextButton.addEventListener("click", () => {
        void this.analyzeInboxFileIndividually(item.file, true);
      });

      if (item.result.suggestedTitle || item.result.noteType || item.result.mainTopic) {
        const synthesisBlock = this.createInboxCardBlock(detailsEl, this.L.inboxDetailSynthesis);
        if (item.result.suggestedTitle) this.createInboxCardLine(synthesisBlock, this.L.inboxDetailSuggestedTitle, item.result.suggestedTitle);
        if (item.result.noteType) this.createInboxCardLine(synthesisBlock, this.L.inboxDetailType, item.result.noteType);
        if (item.result.mainTopic) this.createInboxCardLine(synthesisBlock, this.L.inboxDetailTopic, item.result.mainTopic);
      }

      if (item.result.tags && item.result.tags.length > 0) {
        const tagsBlock = this.createInboxCardBlock(detailsEl, this.L.inboxDetailTags);
        tagsBlock.createDiv({ text: item.result.tags.join(", ") });
      }

      if (item.result.yaml && Object.keys(item.result.yaml).length > 0) {
        const yamlBlock = this.createInboxCardBlock(detailsEl, this.L.inboxDetailYaml);
        for (const [key, value] of Object.entries(item.result.yaml)) {
          yamlBlock.createDiv({ text: `${key}: ${Array.isArray(value) ? value.join(", ") : value}` });
        }
      }

      if (item.result.summary) {
        const summaryBlock = this.createInboxCardBlock(detailsEl, this.L.inboxDetailSummary);
        this.createInboxCardParagraph(summaryBlock, item.result.summary);
      }

      if (item.result.tasks && item.result.tasks.length > 0) {
        const tasksBlock = this.createInboxCardBlock(detailsEl, this.L.inboxDetailTasks);
        const taskList = tasksBlock.createEl("ul");
        taskList.addClass("lina-mt-0");
        taskList.addClass("lina-mb-0");
        for (const task of item.result.tasks) {
          taskList.createEl("li", { text: task });
        }
      }

      if (item.result.limitations && item.result.limitations !== "Nenhuma.") {
        const limitationsBlock = this.createInboxCardBlock(detailsEl, this.L.inboxDetailLimitations);
        this.createInboxCardParagraph(limitationsBlock, item.result.limitations);
      }

      if (item.result.internalLinks && item.result.internalLinks.length > 0) {
        const linksBlock = this.createInboxCardBlock(detailsEl, this.L.inboxDetailLinks);
        linksBlock.createDiv({ text: item.result.internalLinks.map(link => link.path).join(", ") });
      }
    }
  }

  private renderInboxFolderMoveControls(
    actionRow: HTMLElement,
    file: TFile,
    rawSuggestedFolder: string,
    folderResolution: FolderMoveResolution,
    pathEl: HTMLElement | undefined,
    statusEls: HTMLElement[]
  ): void {
    const moveButton = actionRow.createEl("button", { text: this.L.inboxMove });
    moveButton.disabled = !folderResolution.canMove;
    moveButton.addClass(folderResolution.canMove ? "lina-cursor-pointer" : "lina-cursor-not-allowed");
    if (folderResolution.canMove) {
      moveButton.classList.add("mod-cta");
    }

    moveButton.addEventListener("click", () => {
      void this.moveInboxAnalysisFile(file, rawSuggestedFolder, statusEls, moveButton, pathEl);
    });
  }

  private confirmMoveInboxNote(file: TFile, resolution: FolderMoveResolution): Promise<boolean> {
    return new Promise(resolve => {
      const modal = new Modal(this.app);
      modal.titleEl.setText(this.L.confirmMoveTitle);

      const intro = modal.contentEl.createDiv({ text: this.L.confirmMoveIntro });
      intro.addClass("lina-mb-8");

      const list = modal.contentEl.createEl("ul");
      list.addClass("lina-mt-0");
      list.createEl("li", { text: `${this.L.confirmMoveCurrentName}: ${file.name}` });
      list.createEl("li", { text: `${this.L.confirmMoveCurrentFolder}: ${resolution.currentFolderPath || "/"}` });
      list.createEl("li", { text: `${this.L.confirmMoveDestinationFolder}: ${resolution.resolvedFolderPath || resolution.rawSuggestedFolder}` });
      list.createEl("li", { text: `${this.L.confirmMoveFinalPath}: ${resolution.finalTargetPath ?? ""}` });

      const warning = modal.contentEl.createDiv({
        text: this.L.confirmMoveWarning
      });
      warning.addClass("lina-mt-12");

      const buttons = modal.contentEl.createDiv();
      buttons.addClass("lina-display-flex");
      buttons.addClass("lina-justify-end");
      buttons.addClass("lina-gap-8");
      buttons.addClass("lina-mt-16");

      const cancelButton = buttons.createEl("button", { text: this.L.confirmCancelButton });
      const moveButton = buttons.createEl("button", { text: this.L.confirmMoveButton });
      moveButton.classList.add("mod-cta");

      let resolved = false;
      const finish = (value: boolean) => {
        if (resolved) return;
        resolved = true;
        modal.close();
        resolve(value);
      };

      cancelButton.addEventListener("click", () => finish(false));
      moveButton.addEventListener("click", () => finish(true));
      modal.onClose = () => finish(false);
      modal.open();
    });
  }

  private async moveInboxAnalysisFile(
    file: TFile,
    suggestedFolder: string,
    statusEls?: HTMLElement[],
    moveButton?: HTMLButtonElement,
    pathEl?: HTMLElement
  ): Promise<void> {
    const currentFile = this.app.vault.getAbstractFileByPath(file.path);
    if (!(currentFile instanceof TFile)) {
      new Notice(this.L.errorNoteNoLongerExists);
      return;
    }

    if (currentFile.extension !== "md") {
      new Notice(this.L.errorFileNotMarkdown);
      return;
    }

    const resolution = this.resolveFolderMove(
      suggestedFolder,
      this.getExistingVaultFolders(),
      getFolderPathForFile(currentFile),
      currentFile.name,
      currentFile.path
    );

    if (!resolution.canMove || !resolution.finalTargetPath || !resolution.resolvedFolderPath) {
      new Notice(resolution.reason);
      statusEls?.forEach(statusEl => statusEl.setText(`${this.L.inboxFolderStatus}: ${resolution.reason}`));
      if (moveButton) {
        moveButton.disabled = true;
        moveButton.addClass("lina-cursor-not-allowed");
      }
      return;
    }

    const confirmed = await this.confirmMoveInboxNote(currentFile, resolution);
    if (!confirmed) {
      new Notice(this.L.operationCancelledNoMove);
      return;
    }

    const latestFile = this.app.vault.getAbstractFileByPath(currentFile.path);
    if (!(latestFile instanceof TFile)) {
      new Notice(this.L.errorNoteNoLongerExists);
      return;
    }

    const finalResolution = this.resolveFolderMove(
      suggestedFolder,
      this.getExistingVaultFolders(),
      getFolderPathForFile(latestFile),
      latestFile.name,
      latestFile.path
    );

    if (!finalResolution.canMove || !finalResolution.finalTargetPath || !finalResolution.resolvedFolderPath) {
      new Notice(finalResolution.reason);
      statusEls?.forEach(statusEl => statusEl.setText(`${this.L.inboxFolderStatus}: ${finalResolution.reason}`));
      if (moveButton) {
        moveButton.disabled = true;
        moveButton.addClass("lina-cursor-not-allowed");
      }
      return;
    }

    const destinationFolder = this.app.vault.getAbstractFileByPath(finalResolution.resolvedFolderPath);
    if (!(destinationFolder instanceof TFolder)) {
      new Notice(this.L.folderNotExists);
      return;
    }

    const existingTarget = this.app.vault.getAbstractFileByPath(finalResolution.finalTargetPath);
    if (existingTarget) {
      new Notice(this.L.fileAlreadyExistsDestNoMove);
      return;
    }

    try {
      await this.app.fileManager.renameFile(latestFile, finalResolution.finalTargetPath);
      new Notice(this.L.noteMovedSuccess);
      if (pathEl) {
        pathEl.setText(finalResolution.finalTargetPath);
      }
      for (const statusEl of statusEls ?? []) {
        statusEl.setText(`${this.L.inboxFolderStatus}: ${this.L.noteMovedSuccess}`);
        statusEl.addClass("lina-color-success");
      }
      if (moveButton) {
        moveButton.disabled = true;
        moveButton.addClass("lina-cursor-not-allowed");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`${this.L.errorMoveNotePrefix}: ${message}`);
    }
  }

  private async openInboxAnalysisFile(file: TFile): Promise<boolean> {
    const currentFile = this.app.vault.getAbstractFileByPath(file.path);
    if (!(currentFile instanceof TFile)) {
      new Notice(this.L.errorNoteSelectedGone);
      return false;
    }

    if (currentFile.extension !== "md") {
      new Notice(this.L.errorFileNotMarkdown);
      return false;
    }

    try {
      await this.app.workspace.getLeaf(false).openFile(currentFile);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`${this.L.errorOpenNotePrefix}: ${message}`);
      return false;
    }
  }

  private async analyzeInboxFileIndividually(file: TFile, withContext = false): Promise<void> {
    this.prepareAnalysisArea();
    this.setStatus(this.L.statusAnalysingSelected);

    const opened = await this.openInboxAnalysisFile(file);
    if (!opened) return;

    const currentFile = this.app.vault.getAbstractFileByPath(file.path);
    if (!(currentFile instanceof TFile)) {
      new Notice(this.L.errorNoteSelectedGone);
      return;
    }

    await this.analyzeMarkdownFile(currentFile, {
      withContext,
      panelTitle: withContext ? this.L.analysisTitleWithContext : this.L.analysisTitleCurrentNote,
      analyzingMessage: this.L.statusAnalysingSelected,
      noFileMessage: this.L.analysisNoFile,
      nonMarkdownMessage: this.L.errorFileNotMarkdown,
      emptyMessage: this.L.analysisEmptyNote,
      retryActionLabel: withContext ? this.L.actionAnalyseWithContext : this.L.actionAnalyseNote
    });
  }

  // -----------------------------------------------------------------------
  // Renderização de cartões de pesquisa
  // -----------------------------------------------------------------------

  /**
   * Renderiza cartão com destaque seguro de termos no título e no excerto.
   * Para pesquisa semântica, mostra (NN%) Título da nota sem destaque lexical.
   */
  private renderHighlightedCard(card: GroupedNoteCard, searchMode: SearchMode): void {
    const isSemantic = searchMode === "semantica";
    const isHybrid = searchMode === "hibrida";

    const cardEl = this.resultsEl.createDiv();
    cardEl.addClass("lina-mb-8");
    cardEl.addClass("lina-p-10");
    cardEl.addClass("lina-border");
    cardEl.addClass("lina-radius-4");
    cardEl.addClass("lina-cursor-pointer");

    if (isSemantic) {
      // Garantia defensiva: em modo semântico o score deve estar entre 0 e 1.
      // Se não estiver, algo correu mal (ex: fallback textual indevido).
      if (card.score > 1 || card.score < 0) {
        // Score inválido para modo semântico. Não apresentar percentagem.
        const titleEl = cardEl.createEl("strong");
        titleEl.textContent = `(?) ${card.basename}`;
        const pathEl = cardEl.createDiv({ text: card.path });
        pathEl.addClass("lina-fs-085");
        pathEl.addClass("lina-color-muted");
        pathEl.addClass("lina-mt-4");
        const snippetEl = cardEl.createDiv();
        snippetEl.addClass("lina-fs-085");
        snippetEl.addClass("lina-mt-8");
        snippetEl.addClass("lina-p-4-6");
        snippetEl.addClass("lina-bg-primary-alt");
        snippetEl.addClass("lina-radius-3");
        snippetEl.addClass("lina-pre-wrap");
        snippetEl.addClass("lina-break-word");
        snippetEl.textContent = card.snippet;
        cardEl.addEventListener("click", () => this.openNote(card.path));
        return;
      }

      // Formato semântico: (NN%) Título da nota
      const pct = Math.round(card.score * 100);
      const titleEl = cardEl.createEl("strong");
      titleEl.textContent = `(${pct}%) ${card.basename}`;

      const pathEl = cardEl.createDiv({ text: card.path });
      pathEl.addClass("lina-fs-085");
      pathEl.addClass("lina-color-muted");
      pathEl.addClass("lina-mt-4");

      // Excerto sem destaque
      if (card.snippet && card.snippet.length > 0) {
        const snippetEl = cardEl.createDiv();
        snippetEl.addClass("lina-fs-085");
        snippetEl.addClass("lina-mt-8");
        snippetEl.addClass("lina-p-4-6");
        snippetEl.addClass("lina-bg-primary-alt");
        snippetEl.addClass("lina-radius-3");
        snippetEl.addClass("lina-pre-wrap");
        snippetEl.addClass("lina-break-word");
        snippetEl.textContent = card.snippet;
      }
    } else if (isHybrid) {
      // Formato híbrido: (NN%) Título + scores parciais + origem funcional
      const finalPct = Math.round(card.score);
      const titleEl = cardEl.createEl("strong");
      titleEl.textContent = `(${finalPct}%) ${card.basename}`;

      const pathEl = cardEl.createDiv({ text: card.path });
      pathEl.addClass("lina-fs-085");
      pathEl.addClass("lina-color-muted");
      pathEl.addClass("lina-mt-4");

      // Scores parciais
      const textPct = Math.round(card.textScore ?? 0);
      const semPct = Math.round(card.semanticScore ?? 0);
      // Origem funcional: texto, semântica ou texto + semântica
      const hasText = textPct > 0;
      const hasSem = semPct > 0;
      let originLabel = this.L.originHybrid;
      if (hasText && hasSem) originLabel = this.L.originHybrid;
      else if (hasText) originLabel = this.L.originText;
      else if (hasSem) originLabel = this.L.originSemantic;

      const metaEl = cardEl.createDiv();
      metaEl.addClass("lina-fs-085");
      metaEl.addClass("lina-color-muted");
      metaEl.addClass("lina-mt-4");
      metaEl.textContent = `${this.L.originText}: ${textPct}% · ${this.L.originSemantic}: ${semPct}% · ${this.L.originSource}: ${originLabel}`;

      // Excerto com destaque
      const snippetInfo = getSearchSnippetDisplay(card);
      if (snippetInfo && !snippetInfo.isFallback) {
        const snippetEl = cardEl.createDiv();
        snippetEl.addClass("lina-fs-085");
        snippetEl.addClass("lina-mt-8");
        snippetEl.addClass("lina-p-4-6");
        snippetEl.addClass("lina-bg-primary-alt");
        snippetEl.addClass("lina-radius-3");
        snippetEl.addClass("lina-pre-wrap");
        snippetEl.addClass("lina-break-word");

        if (snippetInfo.shouldHighlight) {
          renderHighlightedText(snippetEl, snippetInfo.text, card.termsFound);
        } else {
          snippetEl.setText(snippetInfo.text);
        }
      } else if (card.snippet) {
        const snippetEl = cardEl.createDiv();
        snippetEl.addClass("lina-fs-085");
        snippetEl.addClass("lina-mt-8");
        snippetEl.addClass("lina-p-4-6");
        snippetEl.addClass("lina-bg-primary-alt");
        snippetEl.addClass("lina-radius-3");
        snippetEl.addClass("lina-pre-wrap");
        snippetEl.addClass("lina-break-word");
        snippetEl.textContent = card.snippet;
      }
    } else {
      // Formato textual/híbrido: com destaque de termos
      const snippetInfo = getSearchSnippetDisplay(card);
      const originLabel = snippetInfo?.isFallback
        ? snippetInfo.text
        : getReadableSearchOrigin(card.origin, this.L);

      const titleEl = cardEl.createEl("strong");
      renderHighlightedText(titleEl, card.basename, card.termsFound);

      const pathEl = cardEl.createDiv({ text: card.path });
      pathEl.addClass("lina-fs-085");
      pathEl.addClass("lina-color-muted");
      pathEl.addClass("lina-mt-4");

      const metaEl = cardEl.createDiv();
      metaEl.setText(originLabel);
      metaEl.addClass("lina-fs-085");
      metaEl.addClass("lina-color-muted");
      metaEl.addClass("lina-mt-6");

      if (snippetInfo && !snippetInfo.isFallback) {
        const snippetEl = cardEl.createDiv();
        snippetEl.addClass("lina-fs-085");
        snippetEl.addClass("lina-mt-8");
        snippetEl.addClass("lina-p-4-6");
        snippetEl.addClass("lina-bg-primary-alt");
        snippetEl.addClass("lina-radius-3");
        snippetEl.addClass("lina-pre-wrap");
        snippetEl.addClass("lina-break-word");

        if (snippetInfo.shouldHighlight) {
          renderHighlightedText(snippetEl, snippetInfo.text, card.termsFound);
        } else {
          snippetEl.setText(snippetInfo.text);
        }
      }
    }

    cardEl.addEventListener("click", () => this.openNote(card.path));
  }

  private openNote(path: string): void {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice(this.L.errorNoteNotFound);
      return;
    }

    void this.app.workspace.getLeaf().openFile(file);
  }
}

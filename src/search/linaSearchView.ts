import { ItemView, Modal, Notice, TFile, TFolder, WorkspaceLeaf, normalizePath } from "obsidian";
import LinaPlugin from "../../main";
import { Chunk } from "../index/chunker";
import { EmbeddingRecord, generateSingleEmbedding, readEmbeddingStatus } from "../index/embeddingGenerator";
import { readIndexedChunks, readIndexedNotes, readTextIndexStatus } from "../index/indexStore";
import { runHybridSearch } from "./hybridSearch";
import { searchSemanticIndex, SemanticSearchResult } from "./semanticSearch";
import { SearchResult, searchTextIndex } from "./textSearch";
import { generateOllamaText } from "../ai/ollamaProvider";
import { generateMistralText } from "../ai/mistralProvider";
import {
  getActiveAiProfile,
  getLocalAiProfileApiKey,
  getLocalAnalysisProvider,
  getLocalAnalysisModel,
  getLocalAnalysisBaseUrl,
  getLocalAnalysisApiKey,
  getLocalAnalysisTimeout,
  getLocalEmbeddingsProvider,
  getLocalEmbeddingsModel,
  LinaAiProfile
} from "../settings";
import { getSemanticSearchAvailability } from "./hybridSearch";

export const LINA_SEARCH_VIEW_TYPE = "lina-search-view";

/**
 * Interface para notas relacionadas usadas no contexto de análise.
 */
interface RelatedNote {
  title: string;
  path: string;
  snippet: string;
  score?: number;
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
 * Item selecionável na pré-visualização estruturada.
 */
interface SelectableSuggestion {
  id: string;
  label: string;
  selected: boolean;
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

type SelectableKind = "yaml" | "tag" | "task" | "analysis" | "title" | "rename-file" | "move" | "ai-link" | "related-link";

interface RenderedSelectableItem {
  id: string;
  kind: SelectableKind;
  label: string;
  value: string;
  path?: string;
  title?: string;
  reason?: string;
}

interface SelectableSectionItem {
  id: string;
  label: string;
  kind?: SelectableKind;
  value?: string;
  path?: string;
  title?: string;
  reason?: string;
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

type FolderSuggestionResolutionType = "existing" | "new" | "invalid" | "inbox" | "current";

interface FolderSuggestionResolution {
  type: FolderSuggestionResolutionType;
  originalPath: string;
  resolvedPath: string;
  message: string;
}

interface InboxNoteAnalysisResult {
  file: TFile;
  result?: StructuredAnalysisResult;
  error?: string;
  warning?: string;
}

// ---------------------------------------------------------------------------

type SearchMode = "hibrida" | "textual" | "semantica";

const MAX_NOTES_DISPLAY = 20;
const RAW_REQUEST_MULTIPLIER = 3; // pedir mais resultados brutos para compensar agrupamento

const SECCAO_TAREFAS = "## Tarefas sugeridas pelo Lina";
const SECCAO_ANALISE = "## Análise Lina";
const SENSITIVE_NOTE_TERMS = [
  "senha",
  "password",
  "pass",
  "token",
  "api key",
  "apikey",
  "chave api",
  "credenciais",
  "login",
  "utilizador",
  "username",
  "pin",
  "segredo",
  "secret"
];

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
    // Texto antes do match
    if (match.index > lastIndex) {
      container.createSpan({ text: text.substring(lastIndex, match.index) });
    }
    // Termo destacado
    const mark = container.createEl("mark");
    mark.textContent = match[0];
    mark.style.backgroundColor = "var(--text-highlight-bg)";
    mark.style.color = "inherit";
    mark.style.borderRadius = "2px";
    mark.style.padding = "0 2px";
    lastIndex = regex.lastIndex;
  }

  // Restante do texto
  if (lastIndex < text.length) {
    container.createSpan({ text: text.substring(lastIndex) });
  }
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

function formatTagUsageLabel(count: number): string {
  return count === 1 ? "já usada 1 vez" : `já usada ${count} vezes`;
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
  const sectionEnd = nextSectionMatch ? sectionBodyStart + nextSectionMatch.index : content.length;
  return content.substring(sectionStart, sectionEnd);
}

function noteAppearsSensitive(content: string): boolean {
  const lower = content.toLowerCase();
  return SENSITIVE_NOTE_TERMS.some(term => lower.includes(term));
}

function createSafeMarkdownFileName(title: string): string {
  let base = title.trim().toLowerCase();
  base = base.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  base = base.replace(/['’]/g, "");
  base = base.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-");
  base = base.replace(/[^a-z0-9]+/g, "-");
  base = base.replace(/-+/g, "-").replace(/^-|-$/g, "");

  if (base.length > 80) {
    base = base.substring(0, 80).replace(/-+$/g, "");
  }

  return base ? `${base}.md` : "";
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

  const invalidWindowsChars = /[<>:"|?*\u0000-\u001F]/;
  if (parts.some(part => part === "." || invalidWindowsChars.test(part))) {
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
  private searchButton!: HTMLButtonElement;
  private modeSelect!: HTMLSelectElement;
  private statusEl!: HTMLDivElement;
  private resultsEl!: HTMLDivElement;
  private outputContainer!: HTMLDivElement;
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

  // Mapeamento robusto de itens selecionáveis para recolha correta
  private selectableItemsMap: Map<string, RenderedSelectableItem> = new Map();

  // Resultado estruturado atual (para aplicar à nota)
  private currentStructuredResult?: StructuredAnalysisResult;

  /** Caminho do ficheiro ativo para aplicar alterações */
  private currentActiveFilePath?: string;

  constructor(leaf: WorkspaceLeaf, plugin: LinaPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  private getExistingVaultTags(): Map<string, ExistingVaultTag> {
    const existingTags = new Map<string, ExistingVaultTag>();
    const tags = this.app.metadataCache.getTags() ?? {};

    for (const [original, count] of Object.entries(tags)) {
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

  private resolveSuggestedFolder(suggestedFolder: string | undefined, existingFolders: string[], currentFolder: string): FolderSuggestionResolution {
    const originalPath = (suggestedFolder ?? "").trim();
    const normalized = normalizeSuggestedFolderPath(originalPath);

    if (!normalized.isValid) {
      return {
        type: "invalid",
        originalPath,
        resolvedPath: "",
        message: "A pasta sugerida não é válida."
      };
    }

    const normalizedSuggestion = normalized.path;
    const exactExisting = existingFolders.find(folder => normalizePathForComparison(folder) === normalizePathForComparison(normalizedSuggestion));
    const approximateExisting = exactExisting ?? existingFolders.find(folder => isSameFolderForMatching(folder, normalizedSuggestion));

    if (approximateExisting) {
      if (this.isInboxFolderPath(approximateExisting)) {
        return {
          type: "inbox",
          originalPath,
          resolvedPath: approximateExisting,
          message: "Ignorada: a Inbox não deve ser usada como destino de organização."
        };
      }

      if (normalizePathForComparison(approximateExisting) === normalizePathForComparison(currentFolder)) {
        return {
          type: "current",
          originalPath,
          resolvedPath: approximateExisting,
          message: "A nota já está na pasta sugerida."
        };
      }

      return {
        type: "existing",
        originalPath,
        resolvedPath: approximateExisting,
        message: "Pasta existente."
      };
    }

    if (normalizeFolderSegmentForMatching(normalizedSuggestion) === "inbox") {
      return {
        type: "inbox",
        originalPath,
        resolvedPath: normalizedSuggestion,
        message: "Ignorada: a Inbox não deve ser usada como destino de organização."
      };
    }

    if (!normalizedSuggestion.includes("/")) {
      return {
        type: "new",
        originalPath,
        resolvedPath: normalizedSuggestion,
        message: "Pasta inexistente na raiz do vault. O Lina não cria pastas automaticamente nesta fase."
      };
    }

    const root = normalizedSuggestion.split("/")[0];
    const rootExists = existingFolders.some(folder => normalizePathForComparison(folder) === normalizePathForComparison(root));

    return {
      type: "new",
      originalPath,
      resolvedPath: normalizedSuggestion,
      message: rootExists
        ? "Pasta inexistente. O Lina não cria pastas automaticamente nesta fase."
        : "Pasta inexistente. A nova pasta teria de ficar dentro de uma pasta raiz existente."
    };
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
    const isInbox = this.isInboxFolderPath(resolvedFolderPath) || normalizeFolderSegmentForMatching(resolvedFolderPath) === "inbox";
    const isCurrentFolder = exists && normalizePathForComparison(resolvedFolderPath) === normalizePathForComparison(currentFolderPath);
    const finalTargetPath = currentFileName ? getPathInFolder(resolvedFolderPath, currentFileName) : null;
    const existingDestination = finalTargetPath
      ? this.app.vault.getAbstractFileByPath(finalTargetPath)
      : null;
    const hasCollision = !!(
      existingDestination &&
      currentFilePath &&
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
      modal.titleEl.setText("Aplicar sugestões à nota");

      const intro = modal.contentEl.createDiv({ text: "Vai aplicar à nota atual:" });
      intro.style.marginBottom = "8px";

      const list = modal.contentEl.createEl("ul");
      list.style.marginTop = "0";
      for (const line of summaryLines) {
        list.createEl("li", { text: line });
      }

      const warning = modal.contentEl.createDiv({
        text: includesMove
          ? "Esta ação vai mover o ficheiro Markdown atual dentro do vault. Continuar?"
          : includesRename
          ? "Esta ação vai renomear o ficheiro Markdown atual. Continuar?"
          : "Esta ação vai alterar o ficheiro Markdown atual. Continuar?"
      });
      warning.style.marginTop = "12px";

      const buttons = modal.contentEl.createDiv();
      buttons.style.display = "flex";
      buttons.style.justifyContent = "flex-end";
      buttons.style.gap = "8px";
      buttons.style.marginTop = "16px";

      const cancelButton = buttons.createEl("button", { text: "Cancelar" });
      const applyButton = buttons.createEl("button", { text: "Aplicar" });
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

  private renderSensitiveLocalWarning(): void {
    if (!this.analysisResultEl) return;

    const warning = this.analysisResultEl.createDiv({
      text: "Esta nota parece conter dados sensíveis. A análise está a usar provider local."
    });
    warning.style.color = "var(--text-warning)";
    warning.style.backgroundColor = "var(--background-modifier-hover)";
    warning.style.padding = "8px";
    warning.style.borderRadius = "4px";
    warning.style.marginBottom = "8px";
    warning.style.fontSize = "0.85em";
  }

  private renderSensitiveOnlineBlock(): void {
    if (!this.analysisResultEl) return;

    this.analysisResultEl.createDiv({
      text: "Esta nota parece conter dados sensíveis. A análise com provider remoto está bloqueada por segurança nesta versão.",
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
          message: "Chave API da Mistral em falta. Define uma chave local nas definições do Lina.",
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

    contentEl.createEl("h2", { text: "Lina" });

    const searchSection = contentEl.createDiv();
    searchSection.style.marginBottom = "14px";
    searchSection.createEl("h3", { text: "Pesquisa" });

    this.queryInput = searchSection.createEl("input", {
      type: "text",
      placeholder: "Escreve o que queres procurar...",
    });
    this.queryInput.style.width = "100%";
    this.queryInput.style.marginBottom = "8px";
    this.queryInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        void this.runSearch();
      }
    });

    const controlsRow = searchSection.createDiv();
    controlsRow.style.display = "flex";
    controlsRow.style.flexDirection = "column";
    controlsRow.style.gap = "8px";
    controlsRow.style.marginBottom = "12px";

    // Radio buttons para tipos de pesquisa
    const searchTypeContainer = controlsRow.createDiv();
    searchTypeContainer.style.display = "flex";
    searchTypeContainer.style.gap = "12px";
    searchTypeContainer.style.alignItems = "center";

    // Pesquisa híbrida (selecionada por defeito)
    const hibridaLabel = searchTypeContainer.createSpan({ text: "Híbrida" });
    hibridaLabel.style.fontSize = "0.9em";
    this.searchModeRadioButtons.hibrida = searchTypeContainer.createEl("input");
    this.searchModeRadioButtons.hibrida.type = "radio";
    this.searchModeRadioButtons.hibrida.name = "search-mode";
    this.searchModeRadioButtons.hibrida.checked = true;
    this.searchModeRadioButtons.hibrida.style.marginLeft = "4px";

    // Pesquisa textual
    const textualLabel = searchTypeContainer.createSpan({ text: "Textual" });
    textualLabel.style.fontSize = "0.9em";
    this.searchModeRadioButtons.textual = searchTypeContainer.createEl("input");
    this.searchModeRadioButtons.textual.type = "radio";
    this.searchModeRadioButtons.textual.name = "search-mode";
    this.searchModeRadioButtons.textual.style.marginLeft = "4px";

    // Pesquisa semântica
    const semanticaLabel = searchTypeContainer.createSpan({ text: "Semântica" });
    semanticaLabel.style.fontSize = "0.9em";
    this.searchModeRadioButtons.semantica = searchTypeContainer.createEl("input");
    this.searchModeRadioButtons.semantica.type = "radio";
    this.searchModeRadioButtons.semantica.name = "search-mode";
    this.searchModeRadioButtons.semantica.style.marginLeft = "4px";

    this.searchButtonContainer = controlsRow.createDiv();
    this.searchButtonContainer.style.display = "flex";
    this.searchButtonContainer.style.justifyContent = "flex-end";
    const searchBtn = this.searchButtonContainer.createEl("button", { text: "Pesquisar" });
    searchBtn.addEventListener("click", () => void this.runSearch());

    const quickActionsSection = contentEl.createDiv();
    quickActionsSection.style.marginBottom = "14px";
    quickActionsSection.createEl("h3", { text: "Ações rápidas" });

    this.actionsContainer = quickActionsSection.createDiv();
    this.actionsContainer.style.display = "flex";
    this.actionsContainer.style.flexWrap = "wrap";
    this.actionsContainer.style.gap = "8px";

    const stateSection = contentEl.createDiv();
    stateSection.style.marginBottom = "14px";
    stateSection.createEl("h3", { text: "Estado" });

    this.stateContainer = stateSection.createDiv();
    this.stateContainer.style.fontSize = "0.9em";
    this.stateContainer.style.color = "var(--text-muted)";

    this.detailsContainer = contentEl.createDiv();
    this.detailsContainer.style.marginBottom = "14px";

    this.statusEl = contentEl.createDiv();
    this.statusEl.style.fontSize = "0.9em";
    this.statusEl.style.color = "var(--text-muted)";
    this.statusEl.style.marginBottom = "10px";

    this.resultsEl = contentEl.createDiv();

    await this.refreshState();

    window.setTimeout(() => this.queryInput.focus(), 50);
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  private setStatus(message: string): void {
    this.statusEl.textContent = message;
  }

  private clearResults(): void {
    this.resultsEl.empty();
  }

  private clearOutputArea(): void {
    this.resultsEl.empty();
    if (this.analysisResultEl) {
      this.analysisResultEl.empty();
      this.analysisResultEl.style.display = "none";
    }
  }

  /** Conteúdo da última resposta da IA */
  private analysisSectionEl?: HTMLDivElement;
  private analysisResultEl?: HTMLDivElement;
  private analysisTitleEl?: HTMLHeadingElement;

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
    const embeddingsReady = !!embeddingStatus?.exists && (embeddingStatus.validCount ?? 0) > 0;
    const embeddingsIncomplete = !!embeddingStatus && ((embeddingStatus.missingCount ?? 0) > 0 || (embeddingStatus.staleCount ?? 0) > 0 || (embeddingStatus.obsoleteCount ?? 0) > 0);
    const embeddingStateText = embeddingsReady
      ? (embeddingsIncomplete ? "incompletos" : "prontos")
      : "em falta";

    this.actionsContainer.appendChild(this.createActionButton("Analisar nota", async () => {
      await this.analyzeCurrentNote();
    }));

    this.actionsContainer.appendChild(this.createActionButton("Analisar com contexto", async () => {
      await this.analyzeCurrentNoteWithContext();
    }));

    this.actionsContainer.appendChild(this.createActionButton("Analisar Inbox", async () => {
      await this.analyzeInboxNotes();
    }));

    this.stateContainer.createDiv({ text: `Índice: ${indexReady ? "pronto" : "em falta"} · ${totalNotes} notas · ${totalChunks} blocos` });
    this.stateContainer.createDiv({ text: `Embeddings: ${embeddingStateText} · ${validEmbeddings} válidos · ${missingEmbeddings} em falta` });

    // Estado da semântica
    const deviceEmbeddingProvider = getLocalEmbeddingsProvider() || this.plugin.settings.embeddingProvider || "ollama";
    const deviceEmbeddingModel = getLocalEmbeddingsModel() || this.plugin.settings.embeddingModel || "";
    const semanticCompatibility = await getSemanticSearchAvailability(this.app, deviceEmbeddingProvider, deviceEmbeddingModel);

    if (semanticCompatibility.available) {
      this.stateContainer.createDiv({
        text: `Semântica: disponível · ${semanticCompatibility.indexProvider || "desconhecido"} / ${semanticCompatibility.indexModel || "desconhecido"}`
      });
    } else {
      this.stateContainer.createDiv({
        text: `Semântica: indisponível neste dispositivo · usar pesquisa textual`
      });
    }

    const detailsToggle = this.detailsContainer.createEl("button", {
      text: this.detailsVisible ? "Ocultar detalhes" : "Ver detalhes"
    });
    detailsToggle.addEventListener("click", () => {
      this.detailsVisible = !this.detailsVisible;
      void this.refreshState();
    });

    if (!this.detailsVisible) {
      return;
    }

    const detailsList = this.detailsContainer.createDiv();
    detailsList.style.marginTop = "8px";
    detailsList.style.fontSize = "0.9em";
    detailsList.style.color = "var(--text-muted)";

    detailsList.createDiv({ text: `Atualização automática: ${autoUpdateEnabled ? "ativa" : "inativa"}` });
    detailsList.createDiv({ text: `Índice textual: ${indexReady ? "pronto" : "em falta"}` });
    detailsList.createDiv({ text: `notes.json: ${notesExist ? "disponível" : "em falta"}` });
    detailsList.createDiv({ text: `chunks.jsonl: ${chunksExist ? "disponível" : "em falta"}` });
    detailsList.createDiv({ text: `Notas indexadas: ${totalNotes}` });
    detailsList.createDiv({ text: `Blocos textuais: ${totalChunks}` });
    detailsList.createDiv({ text: `Última atualização do índice: ${manifest?.updatedAt ?? "em falta"}` });
    detailsList.createDiv({ text: `Embeddings: ${embeddingStateText}` });
    detailsList.createDiv({ text: `Embeddings válidos: ${validEmbeddings}` });
    detailsList.createDiv({ text: `Embeddings em falta: ${missingEmbeddings}` });
    detailsList.createDiv({ text: `Embeddings desatualizados: ${(embeddingStatus?.staleCount ?? 0) + (embeddingStatus?.obsoleteCount ?? 0)}` });
    detailsList.createDiv({ text: `Modelo: ${embeddingStatus?.model ?? "em falta"}` });
    detailsList.createDiv({ text: `Provider: ${embeddingStatus?.provider ?? "em falta"}` });
    if (embeddingStatus?.updatedAt) {
      detailsList.createDiv({ text: `Última atualização dos embeddings: ${embeddingStatus.updatedAt}` });
    }

    const technicalActions = this.detailsContainer.createDiv();
    technicalActions.style.display = "flex";
    technicalActions.style.flexWrap = "wrap";
    technicalActions.style.gap = "8px";
    technicalActions.style.marginTop = "10px";

    technicalActions.appendChild(this.createActionButton(indexReady ? "Reconstruir índice textual" : "Construir índice textual", async () => {
      this.setStatus("A construir índice textual...");
      const result = await this.plugin.rebuildTextIndex();
      this.setStatus(result.success ? "Índice textual construído com sucesso." : "Erro ao construir índice textual.");
      await this.refreshState();
    }));

    if (!embeddingsReady) {
      detailsList.createDiv({ text: "A pesquisa híbrida será feita apenas com o índice textual enquanto não existirem embeddings." });
      technicalActions.appendChild(this.createActionButton("Gerar embeddings locais", async () => {
        this.setStatus("A gerar embeddings locais...");
        const result = await this.plugin.generateLocalEmbeddings((message) => this.setStatus(message));
        this.setStatus(result.success ? "Embeddings locais gerados com sucesso." : "Erro ao gerar embeddings locais.");
        await this.refreshState();
      }));
    } else if (embeddingsIncomplete) {
      detailsList.createDiv({ text: "Embeddings locais incompletos ou desatualizados." });
      technicalActions.appendChild(this.createActionButton("Atualizar embeddings locais", async () => {
        this.setStatus("A gerar embeddings locais...");
        const result = await this.plugin.generateLocalEmbeddings((message) => this.setStatus(message));
        this.setStatus(result.success ? "Embeddings locais gerados com sucesso." : "Erro ao gerar embeddings locais.");
        await this.refreshState();
      }));
    }
  }

  private createActionButton(label: string, onClick: () => Promise<void>): HTMLButtonElement {
    const button = document.createElement("button");
    button.textContent = label;
    button.addEventListener("click", () => void onClick());
    return button;
  }

  private async runSearch(): Promise<void> {
    const query = this.queryInput.value.trim();
    this.clearResults();
    this.setStatus("");

    if (!query) {
      return;
    }

    const notes = await readIndexedNotes(this.app);
    const chunks = await readIndexedChunks(this.app);

    if (!notes) {
      this.setStatus("Índice textual ainda não existe.");
      await this.refreshState();
      return;
    }

    if (!chunks) {
      this.setStatus("Índice textual ainda não existe.");
      await this.refreshState();
      return;
    }

    this.setStatus("A pesquisar...");

    try {
      if (this.currentMode === "textual") {
        // Pedir mais resultados brutos para compensar agrupamento
        const rawResults = searchTextIndex(notes, chunks, query, {
          maxResults: MAX_NOTES_DISPLAY * RAW_REQUEST_MULTIPLIER,
          maxChunksPerNote: 5,
        });
        const cards = groupResultsByNote(rawResults).slice(0, MAX_NOTES_DISPLAY);
        this.renderGroupedCards(cards);
        return;
      }

      if (this.currentMode === "semantica") {
        await this.runSemanticSearchGrouped(query, chunks);
        return;
      }

      await this.runHybridModeGrouped(query, notes, chunks);
    } catch (error) {
      this.setStatus(`Erro na pesquisa: ${error instanceof Error ? error.message : String(error)}`);
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

    const result = await runHybridSearch(this.app, notes ?? [], chunks, query, {
      baseUrl,
      model,
      timeoutMs,
      textWeight: normalisedTextWeight,
      semanticWeight: normalisedSemanticWeight,
    });

    if (result.warnings.length > 0) {
      this.setStatus(result.warnings.join(" "));
    } else {
      this.setStatus("");
    }

    if (result.results.length === 0) {
      this.setStatus(this.statusEl.textContent ? `${this.statusEl.textContent} Sem resultados.` : "Sem resultados.");
      return;
    }

    const cards = groupResultsByNote(result.results).slice(0, MAX_NOTES_DISPLAY);
    this.renderGroupedCards(cards);
  }

  private async runSemanticSearchGrouped(query: string, chunks: Chunk[]): Promise<void> {
    const embeddings = await loadEmbeddings(this);
    if (!embeddings || embeddings.length === 0) {
      this.setStatus("Embeddings locais indisponíveis. A pesquisa foi feita apenas no índice textual.");
      const rawResults = searchTextIndex(await readIndexedNotes(this.app) ?? [], chunks, query, {
        maxResults: MAX_NOTES_DISPLAY * RAW_REQUEST_MULTIPLIER,
        maxChunksPerNote: 5,
      });
      const cards = groupResultsByNote(rawResults).slice(0, MAX_NOTES_DISPLAY);
      this.renderGroupedCards(cards);
      return;
    }

    const baseUrl = this.plugin.settings.embeddingBaseUrl || this.plugin.settings.aiBaseUrl || "http://localhost:11434";
    const model = this.plugin.settings.embeddingModel || "nomic-embed-text";
    const timeoutMs = (this.plugin.settings.embeddingRequestTimeoutSeconds || 60) * 1000;

    const queryEmbedding = await generateSingleEmbedding(baseUrl, model, query, timeoutMs);
    if (!queryEmbedding) {
      this.setStatus("Não foi possível usar a pesquisa semântica. Foram apresentados resultados textuais.");
      const rawResults = searchTextIndex(await readIndexedNotes(this.app) ?? [], chunks, query, {
        maxResults: MAX_NOTES_DISPLAY * RAW_REQUEST_MULTIPLIER,
        maxChunksPerNote: 5,
      });
      const cards = groupResultsByNote(rawResults).slice(0, MAX_NOTES_DISPLAY);
      this.renderGroupedCards(cards);
      return;
    }

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
  private renderGroupedCards(cards: GroupedNoteCard[]): void {
    if (cards.length === 0) {
      this.setStatus("Sem resultados.");
      return;
    }
    this.setStatus("");

    for (const card of cards) {
      const meta: string[] = [];
      meta.push(`Origem: ${card.origin}`);
      if (typeof card.textScore === "number") meta.push(`Relevância textual: ${card.textScore}`);
      if (typeof card.semanticScore === "number") meta.push(`Semelhança semântica: ${card.semanticScore}%`);
      meta.push(`Pontuação final: ${typeof card.score === "number" ? Math.round(card.score) : card.score}`);
      if (card.termsFound.length > 0 && card.totalTerms > 0) {
        meta.push(`Termos encontrados: ${card.termsFound.join(", ")}`);
        meta.push(`Cobertura: ${card.termsFound.length}/${card.totalTerms}`);
      }
      if (card.chunkCount > 1) {
        meta.push(`Blocos encontrados: ${card.chunkCount}`);
      }

      this.renderHighlightedCard(card);

      // Excertos adicionais
      if (card.extraSnippets.length > 0) {
        const extrasContainer = this.resultsEl.createDiv();
        extrasContainer.style.marginTop = "2px";
        extrasContainer.style.marginBottom = "8px";
        extrasContainer.style.paddingLeft = "12px";
        extrasContainer.style.borderLeft = "2px solid var(--background-modifier-border)";

        for (const snippetText of card.extraSnippets) {
          const el = document.createElement("div");
          el.style.fontSize = "0.8em";
          el.style.color = "var(--text-muted)";
          el.style.padding = "2px 4px";
          el.style.marginTop = "2px";
          el.style.backgroundColor = "var(--background-primary-alt)";
          el.style.borderRadius = "2px";
          el.style.whiteSpace = "pre-wrap";
          el.style.wordBreak = "break-word";

          const displayText = snippetText.length > 180 ? `${snippetText.substring(0, 180)}...` : snippetText;
          renderHighlightedText(el, displayText, card.termsFound);

          extrasContainer.appendChild(el);
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // IA — Analisar nota atual
  // -----------------------------------------------------------------------

  /** Limite de caracteres do conteúdo enviado ao modelo */
  private static readonly MAX_CONTENT_CHARS = 8000;

  /**
   * Encontra notas relacionadas para a nota atual usando pesquisa híbrida.
   */
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

    const baseUrl = this.plugin.settings.embeddingBaseUrl || this.plugin.settings.aiBaseUrl || "http://localhost:11434";
    const model = this.plugin.settings.embeddingModel || "nomic-embed-text";
    const timeoutMs = (this.plugin.settings.embeddingRequestTimeoutSeconds || 60) * 1000;
    const textWeight = this.plugin.settings.hybridSearchTextWeight ?? 0.7;
    const semanticWeight = this.plugin.settings.hybridSearchSemanticWeight ?? 0.3;
    const totalWeight = textWeight + semanticWeight;
    const normalisedTextWeight = totalWeight > 0 ? textWeight / totalWeight : 0.7;
    const normalisedSemanticWeight = totalWeight > 0 ? semanticWeight / totalWeight : 0.3;

    const result = await runHybridSearch(this.app, notes, chunks, query, {
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
    const relatedNotes: RelatedNote[] = [];
    const currentPathNormalized = normalizeResultPath(path);

    // Score mínimo para considerar uma nota relevante
    const MIN_RELEVANT_SCORE = 30;

    for (const r of result.results) {
      // Excluir a própria nota atual
      if (normalizeResultPath(r.path) === currentPathNormalized) {
        continue;
      }

      // Calcular pontuação ajustada com bónus/penalizações
      const baseScore = r.finalScore ?? 0;

      // Aplicar bónus por proximidade de pasta
      const folderBonus = this.calculateFolderScore(path, r.path);

      // Aplicar penalização por irrelevância
      const irrelevancePenalty = this.applyIrrelevancePenalty(r.basename, r.path);

      // Calcular pontuação ajustada
      const adjustedScore = baseScore * folderBonus * irrelevancePenalty;

      // Aplicar score mínimo
      if (adjustedScore < MIN_RELEVANT_SCORE) {
        continue; // Ignorar notas com pontuação demasiado baixa
      }

      // Adicionar nota relacionada com pontuação ajustada
      relatedNotes.push({
        title: r.basename,
        path: r.path,
        snippet: r.snippet,
        score: adjustedScore,
      });

      // Limitar a 10 notas relacionadas
      if (relatedNotes.length >= 10) {
        break;
      }
    }

    // Ordenar por pontuação ajustada (descendente)
    relatedNotes.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    return relatedNotes;
  }

  /**
   * Calcula pontuação adicional com base na proximidade de pastas.
   * Notas na mesma pasta ou projeto recebem bónus.
   */
  private calculateFolderScore(currentPath: string, relatedPath: string): number {
    const currentNormalized = normalizeResultPath(currentPath);
    const relatedNormalized = normalizeResultPath(relatedPath);

    // Extrair partes do caminho
    const currentParts = currentNormalized.split('/').filter(p => p.length > 0);
    const relatedParts = relatedNormalized.split('/').filter(p => p.length > 0);

    // Mesma pasta exata
    if (currentNormalized === relatedNormalized) {
      return 1.0; // Bónus forte
    }

    // Mesma pasta raiz (ex: ambos em 90_Desenvolvimento/)
    if (currentParts.length > 0 && relatedParts.length > 0 && currentParts[0] === relatedParts[0]) {
      // Mesma pasta raiz + subpasta relacionada
      if (currentParts.length >= 2 && relatedParts.length >= 2) {
        // Se compartilham as duas primeiras partes (ex: 90_Desenvolvimento/APP Sumários)
        if (currentParts[0] === relatedParts[0] && currentParts[1] === relatedParts[1]) {
          return 0.8; // Bónus médio-forte
        }
        // Se compartilham apenas a pasta raiz
        return 0.5; // Bónus médio
      }
      return 0.5; // Bónus médio
    }

    // Pastas totalmente diferentes
    return 0.1; // Ligeira penalização
  }

  /**
   * Aplica penalizações a notas claramente irrelevantes.
   * Penaliza notas que pareçam ser apenas datas, nomes de alunos, etc.
   */
  private applyIrrelevancePenalty(title: string, path: string): number {
    // Normalizar para comparação
    const normalizedTitle = title.toLowerCase();
    const normalizedPath = path.toLowerCase();

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
      relatedNotesSection = "Notas relacionadas encontradas pela pesquisa híbrida:\n\n";
      for (let i = 0; i < relatedNotes.length; i++) {
        const note = relatedNotes[i];
        relatedNotesSection += `${i + 1}. Título: ${note.title}\n`;
        relatedNotesSection += `   Caminho: ${note.path}\n`;
        relatedNotesSection += `   Excerto: ${note.snippet}\n`;
        if (note.score !== undefined) {
          relatedNotesSection += `   Pontuação: ${Math.round(note.score)}\n`;
        }
        relatedNotesSection += "\n";
      }
    } else {
      relatedNotesSection = "Não foram encontradas notas relacionadas suficientes.";
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

Regras para links internos:

* Só usar links com base na lista de notas relacionadas fornecida.
* Não inventar links.
* Nunca sugiras a própria nota atual como link interno.
* Sugere no máximo 5 links.
* Só sugerir se forem claramente úteis.
* Se não houver notas relevantes, põe "internalLinks": [].
* Usar path completo (ex: "90_Desenvolvimento/APP Sumários/EV3.md").
* Priorizar notas com pontuação mais alta (acima de 50).

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
    { "path": "caminho/completo/da/nota.md", "reason": "motivo do link" }
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
    reason?: string
  ): void {
    const item = container.createDiv();
    item.style.display = "flex";
    item.style.alignItems = "flex-start";
    item.style.gap = "6px";
    item.style.padding = "3px 0";
    item.style.cursor = "pointer";
    item.style.userSelect = "none";

    const checkbox = item.createEl("input");
    checkbox.type = "checkbox";
    checkbox.checked = isInitiallySelected;
    checkbox.style.margin = "2px 0 0 0";
    checkbox.style.cursor = "pointer";

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
        reason
      });
    }

    const labelEl = item.createSpan({ text: label });
    labelEl.style.fontSize = "0.85em";
    labelEl.style.color = "var(--text-normal)";
    labelEl.style.flex = "1";
    labelEl.style.wordBreak = "break-word";

    // Clicar no item ou no label alterna o checkbox
    const toggleHandler = () => {
      checkbox.checked = !checkbox.checked;
      this.structuredSelections.set(id, checkbox.checked);
      // Atualizar estilo visual
      if (checkbox.checked) {
        labelEl.style.color = "var(--text-accent)";
        labelEl.style.fontWeight = "500";
      } else {
        labelEl.style.color = "var(--text-normal)";
        labelEl.style.fontWeight = "normal";
      }
    };

    checkbox.addEventListener("change", () => {
      this.structuredSelections.set(id, checkbox.checked);
      if (checkbox.checked) {
        labelEl.style.color = "var(--text-accent)";
        labelEl.style.fontWeight = "500";
      } else {
        labelEl.style.color = "var(--text-normal)";
        labelEl.style.fontWeight = "normal";
      }
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
    section.style.marginTop = "12px";
    section.style.marginBottom = "8px";

    // Título da secção
    const titleEl = section.createEl("strong", { text: title });
    titleEl.style.fontSize = "0.9em";
    titleEl.style.display = "block";
    titleEl.style.marginBottom = "4px";

    if (items.length === 0) {
      const emptyEl = section.createDiv({ text: noItemsMessage });
      emptyEl.style.fontSize = "0.8em";
      emptyEl.style.color = "var(--text-muted)";
      emptyEl.style.fontStyle = "italic";
      return;
    }

    for (const item of items) {
      this.createSelectableItem(section, `${idPrefix}::${item.id}`, item.label, false, item.kind, item.value, item.path, item.title, item.reason);
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
    section.style.marginTop = "12px";
    section.style.marginBottom = "8px";

    // Título da secção
    const titleEl = section.createEl("strong", { text: title });
    titleEl.style.fontSize = "0.9em";
    titleEl.style.display = "block";
    titleEl.style.marginBottom = "4px";

    if (items.length === 0) {
      const emptyEl = section.createDiv({ text: noItemsMessage });
      emptyEl.style.fontSize = "0.8em";
      emptyEl.style.color = "var(--text-muted)";
      emptyEl.style.fontStyle = "italic";
      return;
    }

    for (const item of items) {
      if (item.disabled) {
        // Item desativado (já existe ou conflito)
        const itemDiv = section.createDiv();
        itemDiv.style.display = "flex";
        itemDiv.style.alignItems = "flex-start";
        itemDiv.style.gap = "6px";
        itemDiv.style.padding = "3px 0";
        itemDiv.style.opacity = "0.6";

        // Checkbox desativada
        const checkbox = itemDiv.createEl("input");
        checkbox.type = "checkbox";
        checkbox.checked = false;
        checkbox.disabled = true;
        checkbox.style.margin = "2px 0 0 0";
        checkbox.style.cursor = "not-allowed";

        const labelEl = itemDiv.createSpan({ text: item.label });
        labelEl.style.fontSize = "0.85em";
        labelEl.style.color = "var(--text-muted)";
        labelEl.style.flex = "1";
        labelEl.style.wordBreak = "break-word";

        if (item.reason === "already_exists") {
          labelEl.style.color = "var(--text-accent)";
        } else if (item.reason === "conflict") {
          labelEl.style.color = "var(--text-warning)";
        }
      } else {
        // Item selecionável
        this.createSelectableItem(section, `${idPrefix}::${item.id}`, item.label, false, item.kind, item.value, item.path, item.title, item.reason);
      }
    }
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

    // Clarificação da UI: checkboxes são para seleção, não para estado concluído
    const clarificationContainer = this.analysisResultEl.createDiv();
    clarificationContainer.style.marginBottom = "12px";
    clarificationContainer.style.padding = "8px";
    clarificationContainer.style.backgroundColor = "var(--background-primary-alt)";
    clarificationContainer.style.borderRadius = "4px";
    clarificationContainer.style.fontSize = "0.85em";

    clarificationContainer.createEl("strong", { text: "Seleciona os itens que pretendes aplicar à nota." });
    clarificationContainer.createDiv({ text: "As checkboxes da pré-visualização significam apenas seleção para aplicar, não estado concluído." });

    // Notas relacionadas usadas
    const notesInfoContainer = this.analysisResultEl.createDiv();
    notesInfoContainer.style.marginBottom = "12px";
    notesInfoContainer.style.fontSize = "0.85em";
    notesInfoContainer.style.color = "var(--text-muted)";

    if (relatedNotes.length > 0) {
      notesInfoContainer.createDiv({ text: `Notas relacionadas usadas: ${relatedNotes.length}` });

      const notesList = notesInfoContainer.createDiv();
      notesList.style.marginTop = "4px";
      notesList.style.fontSize = "0.8em";
      notesList.style.maxHeight = "120px";
      notesList.style.overflowY = "auto";
      notesList.style.borderLeft = "2px solid var(--background-modifier-border)";
      notesList.style.paddingLeft = "8px";

      for (const note of relatedNotes.slice(0, 10)) { // Limitar a 10 para não sobrecarregar
        const noteItem = notesList.createDiv();
        noteItem.style.marginBottom = "2px";
        noteItem.style.whiteSpace = "nowrap";
        noteItem.style.overflow = "hidden";
        noteItem.style.textOverflow = "ellipsis";

        const titleEl = noteItem.createSpan({ text: note.title });
        titleEl.style.fontWeight = "500";

        noteItem.createSpan({ text: " — " });

        const pathEl = noteItem.createSpan({ text: note.path });
        pathEl.style.color = "var(--text-muted)";
        pathEl.style.fontSize = "0.85em";

        if (note.score !== undefined) {
          noteItem.createSpan({ text: ` (${Math.round(note.score)})` });
          pathEl.style.marginRight = "4px";
        }
      }
    } else {
      notesInfoContainer.createDiv({ text: `Notas relacionadas usadas: ${relatedNotesCount}` });
    }

    // Título sugerido
    if (result.suggestedTitle) {
      const titleItems: SelectableSectionItem[] = [
        {
          id: "suggested",
          label: `Atualizar H1 da nota: ${result.suggestedTitle}`,
          kind: "title",
          value: result.suggestedTitle,
          title: result.suggestedTitle
        }
      ];

      if (analysisFile) {
        const safeFileName = createSafeMarkdownFileName(result.suggestedTitle);
        if (safeFileName) {
          titleItems.push({
            id: "rename_file",
            label: `Renomear ficheiro: ${safeFileName}`,
            kind: "rename-file",
            value: safeFileName,
            path: getPathInSameFolder(analysisFile, safeFileName),
            title: safeFileName
          });
        }
      }

      this.createStructuredSection(
        this.analysisResultEl,
        "Título sugerido",
        "title",
        titleItems,
        ""
      );
    }

    // Pasta sugerida
    const rawSuggestedFolder = (result.suggestedFolder ?? "").trim();
    if (rawSuggestedFolder.length > 0) {
      const folderSection = this.analysisResultEl.createDiv();
      folderSection.style.marginTop = "12px";
      folderSection.style.marginBottom = "8px";

      const titleEl = folderSection.createEl("strong", { text: "Pasta sugerida" });
      titleEl.style.fontSize = "0.9em";
      titleEl.style.display = "block";
      titleEl.style.marginBottom = "4px";

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
      folderValue.style.fontSize = "0.85em";
      folderValue.style.color = "var(--text-muted)";
      folderValue.style.marginBottom = "4px";

      const statusEl = folderSection.createDiv({ text: `Estado da pasta sugerida: ${folderResolution.reason}` });
      statusEl.style.fontSize = "0.85em";
      statusEl.style.marginBottom = "4px";

      const resolvedFolder = folderResolution.resolvedFolderPath ?? folderResolution.rawSuggestedFolder;
      const destinationPath = folderResolution.finalTargetPath ?? undefined;
      const canMove = folderResolution.canMove;

      if (canMove) {
        statusEl.setText(`Estado da pasta sugerida: ${folderResolution.reason}`);
        statusEl.style.color = "var(--text-success)";
        this.createSelectableItem(
          folderSection,
          "folder::move_suggested",
          "Mover nota para a pasta sugerida",
          false,
          "move",
          resolvedFolder,
          destinationPath,
          resolvedFolder,
          folderResolution.reason
        );
      } else if (!analysisFile) {
        statusEl.setText(`Estado da pasta sugerida: ${folderResolution.reason}`);
        statusEl.style.color = "var(--text-warning)";
      } else if (folderResolution.hasCollision) {
        statusEl.setText(`Estado da pasta sugerida: ${folderResolution.reason}`);
        statusEl.style.color = "var(--text-warning)";
      } else {
        statusEl.style.color = folderResolution.isCurrentFolder ? "var(--text-muted)" : "var(--text-warning)";
      }

      if (!canMove) {
        const disabledItem = folderSection.createDiv();
        disabledItem.style.display = "flex";
        disabledItem.style.alignItems = "flex-start";
        disabledItem.style.gap = "6px";
        disabledItem.style.padding = "3px 0";
        disabledItem.style.opacity = "0.65";

        const checkbox = disabledItem.createEl("input");
        checkbox.type = "checkbox";
        checkbox.checked = false;
        checkbox.disabled = true;
        checkbox.style.margin = "2px 0 0 0";
        checkbox.style.cursor = "not-allowed";

        const labelEl = disabledItem.createSpan({ text: "Mover nota para a pasta sugerida" });
        labelEl.style.fontSize = "0.85em";
        labelEl.style.color = "var(--text-muted)";
        labelEl.style.flex = "1";
        labelEl.style.wordBreak = "break-word";
      }
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
              label: `${key}: ${valueStr} — já existe`,
              kind: "yaml",
              value: key,
              disabled: true,
              reason: "already_exists"
            });
          } else {
            // Conflito: valor diferente
            yamlItems.push({
              id: `yaml_${key}`,
              label: `${key}: ${valueStr} — conflito: valor existente diferente ("${existingValue}")`,
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
            label: `${key}: ${valueStr} — novo`,
            kind: "yaml",
            value: key,
            disabled: false,
            reason: "new"
          });
        }
      }

      this.createStructuredSectionWithStatus(
        this.analysisResultEl,
        "YAML sugerido",
        "yaml",
        yamlItems,
        "YAML não ativado nas definições do Lina."
      );
    }

    // Tags sugeridas
    const validTags = result.tags ? normalizarTags(result.tags) : [];
    if (validTags.length > 0) {
      const existingVaultTags = this.getExistingVaultTags();
      const tagItems = validTags.map(tag => {
        const existingTag = existingVaultTags.get(tag);
        const value = existingTag?.normalized ?? tag;
        const statusLabel = existingTag ? formatTagUsageLabel(existingTag.count) : "nova tag";

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
        "Tags sugeridas",
        "tags",
        tagItems,
        "Nenhuma tag sugerida."
      );
    }

    // Links internos sugeridos
    if (result.internalLinks && result.internalLinks.length > 0) {
      const linkItems = result.internalLinks.map(link => ({
        id: `ai-link_${link.path}`,
        label: `${link.path} ${link.reason ? `— ${link.reason}` : ""}`,
        kind: "ai-link" as const,
        value: link.path,
        path: link.path,
        title: getBasenameWithoutExtension(link.path),
        reason: link.reason
      }));
      this.createStructuredSection(
        this.analysisResultEl,
        "Links internos sugeridos",
        "ai-links",
        linkItems,
        "Não foram encontradas notas relacionadas suficientemente relevantes."
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
          label: `${note.title} — ${note.path}${note.score !== undefined ? ` — ${Math.round(note.score)}` : ""}`,
          kind: "related-link" as const,
          value: note.path,
          path: note.path,
          title: note.title
        }));

        this.createStructuredSection(
          this.analysisResultEl,
          "Outras notas relacionadas",
          "related-links",
          relatedItems,
          "Não há outras notas relacionadas além das sugeridas pela IA."
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
        "Tarefas detetadas",
        "tasks",
        taskItems,
        "Nenhuma tarefa detetada."
      );
    }

    // Análise
    if (result.analysis) {
      this.createStructuredSection(
        this.analysisResultEl,
        "Análise",
        "analysis",
        [{ id: "analysis_text", label: result.analysis, kind: "analysis", value: result.analysis }],
        ""
      );
    }

    // Informações adicionais
    const infoContainer = this.analysisResultEl.createDiv();
    infoContainer.style.marginTop = "12px";
    infoContainer.style.paddingTop = "8px";
    infoContainer.style.borderTop = "1px solid var(--background-modifier-border)";
    infoContainer.style.fontSize = "0.8em";
    infoContainer.style.color = "var(--text-muted)";

    if (result.summary) {
      infoContainer.createDiv({ text: `Resumo: ${result.summary}` });
    }
    if (result.confidence) {
      infoContainer.createDiv({ text: `Grau de confiança: ${result.confidence}` });
    }
    if (result.limitations) {
      infoContainer.createDiv({ text: `Limitações: ${result.limitations}` });
    }

    // Botão "Aplicar selecionados à nota"
    const applyBtnContainer = this.analysisResultEl.createDiv();
    applyBtnContainer.style.marginTop = "16px";
    applyBtnContainer.style.textAlign = "center";

    const applyBtn = applyBtnContainer.createEl("button", { text: "Aplicar selecionados à nota" });
    applyBtn.style.padding = "8px 16px";
    applyBtn.style.cursor = "pointer";
    applyBtn.addEventListener("click", () => void this.applySelectedChanges());
  }

  /**
   * Processa a resposta da IA e tenta apresentá-la como pré-visualização estruturada.
   */
  private processAIResponse(aiText: string, currentPath: string, allowedPaths: string[], relatedNotesCount: number, relatedNotes: RelatedNote[] = [], targetFile?: TFile): void {
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
      this.renderStructuredPreview(json, relatedNotesCount, relatedNotes, targetFile);
    } else {
      // Fallback textual
      this.analysisResultEl.empty();

      if (relatedNotes.length > 0) {
        const notesInfoContainer = this.analysisResultEl.createDiv();
        notesInfoContainer.style.marginBottom = "12px";
        notesInfoContainer.style.fontSize = "0.85em";
        notesInfoContainer.style.color = "var(--text-muted)";

        notesInfoContainer.createDiv({ text: `Notas relacionadas usadas: ${relatedNotes.length}` });

        const notesList = this.analysisResultEl.createDiv();
        notesList.style.marginTop = "4px";
        notesList.style.fontSize = "0.8em";
        notesList.style.maxHeight = "120px";
        notesList.style.overflowY = "auto";
        notesList.style.borderLeft = "2px solid var(--background-modifier-border)";
        notesList.style.paddingLeft = "8px";

        for (const note of relatedNotes.slice(0, 10)) {
          const noteItem = notesList.createDiv();
          noteItem.style.marginBottom = "2px";
          noteItem.style.whiteSpace = "nowrap";
          noteItem.style.overflow = "hidden";
          noteItem.style.textOverflow = "ellipsis";

          const titleEl = noteItem.createSpan({ text: note.title });
          titleEl.style.fontWeight = "500";

          noteItem.createSpan({ text: " — " });

          const pathEl = noteItem.createSpan({ text: note.path });
          pathEl.style.color = "var(--text-muted)";
          pathEl.style.fontSize = "0.85em";

          if (note.score !== undefined) {
            noteItem.createSpan({ text: ` (${Math.round(note.score)})` });
            pathEl.style.marginRight = "4px";
          }
        }
      } else if (relatedNotesCount > 0) {
        this.analysisResultEl.createDiv({
          text: `Notas relacionadas usadas: ${relatedNotesCount}`,
          attr: { style: "color: var(--text-muted); font-size: 0.85em; margin-bottom: 8px;" }
        });
      }

      const warning = this.analysisResultEl.createDiv();
      warning.style.fontSize = "0.8em";
      warning.style.color = "var(--text-warning)";
      warning.style.marginBottom = "8px";
      warning.style.padding = "4px 8px";
      warning.style.backgroundColor = "var(--background-modifier-hover)";
      warning.style.borderRadius = "4px";
      warning.textContent = "Não foi possível estruturar automaticamente a resposta. A resposta textual foi apresentada sem seleção interativa.";

      const responseEl = this.analysisResultEl.createDiv();
      responseEl.style.fontSize = "0.85em";
      responseEl.style.whiteSpace = "pre-wrap";
      responseEl.style.wordBreak = "break-word";
      responseEl.style.padding = "8px";
      responseEl.style.backgroundColor = "var(--background-primary-alt)";
      responseEl.style.borderRadius = "4px";
      responseEl.style.lineHeight = "1.5";
      responseEl.textContent = aiText;
    }
  }

  // -----------------------------------------------------------------------
  // Aplicar selecionados à nota (Fase 5B)
  // -----------------------------------------------------------------------

  /**
   * Aplica os itens selecionados na pré-visualização estruturada à nota Markdown atual.
   */
  private async applySelectedChanges(): Promise<void> {
    const result = this.currentStructuredResult;
    if (!result) {
      new Notice("Nenhuma análise disponível para aplicar.");
      return;
    }

    const targetFile = this.currentActiveFilePath
      ? this.app.vault.getAbstractFileByPath(this.currentActiveFilePath)
      : this.app.workspace.getActiveFile();

    if (!(targetFile instanceof TFile)) {
      new Notice("A nota alvo já não existe ou não está disponível.");
      return;
    }

    if (targetFile.extension !== "md") {
      new Notice("O ficheiro alvo não é Markdown. Abre uma nota .md para aplicar sugestões.");
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
      new Notice("Nenhum item selecionado. Seleciona pelo menos um item antes de aplicar.");
      return;
    }

    if (renameFileSelected) {
      if (!result.suggestedTitle || result.suggestedTitle.trim().length === 0) {
        new Notice("O título sugerido está vazio. O ficheiro não foi renomeado.");
        return;
      }

      if (!renameTargetName || !renameTargetPath) {
        new Notice("Não foi possível gerar um nome seguro para o ficheiro.");
        return;
      }

      if (!moveFolderSelected && normalizePath(targetFile.path).toLowerCase() === normalizePath(renameTargetPath).toLowerCase()) {
        new Notice("O nome sugerido é igual ao nome atual.");
        return;
      }

      if (!moveFolderSelected) {
        const existingTarget = this.app.vault.getAbstractFileByPath(renameTargetPath);
        if (existingTarget) {
          new Notice("Já existe um ficheiro com esse nome nesta pasta. O ficheiro não foi renomeado.");
          return;
        }
      }
    }

    if (moveFolderSelected) {
      const suggestedFolder = normalizeSuggestedFolderPath(moveFolderPath);
      if (!suggestedFolder.isValid) {
        new Notice("A pasta sugerida não é válida.");
        return;
      }

      moveFolderPath = suggestedFolder.path;
      const destinationFolder = this.app.vault.getAbstractFileByPath(moveFolderPath);
      if (!(destinationFolder instanceof TFolder)) {
        new Notice("A pasta sugerida não existe.");
        new Notice("O Lina não cria pastas automaticamente nesta fase.");
        return;
      }

      const currentFolderForMove = getFolderPathForFile(targetFile);
      if (normalizePathForComparison(currentFolderForMove) === normalizePathForComparison(moveFolderPath)) {
        new Notice("A nota já está na pasta sugerida.");
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
          new Notice("Já existe um ficheiro com esse nome na pasta de destino. A nota não foi movida.");
        } else {
          new Notice("Já existe um ficheiro com esse nome nesta pasta. O ficheiro não foi renomeado.");
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
      new Notice("Operação cancelada. A nota não foi alterada.");
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
            new Notice("Já existe um ficheiro com esse nome na pasta de destino. A nota não foi movida.");
            return;
          }
          new Notice("Já existe um ficheiro com esse nome nesta pasta. O ficheiro não foi renomeado.");
        } else {
          await this.app.fileManager.renameFile(targetFile, finalPath);
          this.currentActiveFilePath = finalPath;
          if (moveFolderSelected) {
            new Notice("Nota movida com sucesso.");
          } else if (renameFileSelected) {
            new Notice("Ficheiro renomeado com sucesso.");
          }
        }
      }

      if (content !== originalContent) {
        new Notice("Sugestões aplicadas à nota.");
      }

      if (selectedYamlKeys.length > 0) {
        // Verificar se houve conflitos (propriedades não substituídas)
        // (A lógica de merge já preserva existentes, só avisar se aplicável)
      }

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      new Notice(`Erro ao aplicar sugestões: ${msg}`);
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
      if (result.noteType) analysisDetailLines.push(`\nTipo: ${result.noteType}`);
      if (result.mainTopic) analysisDetailLines.push(`Tema: ${result.mainTopic}`);
      if (result.suggestedFolder) analysisDetailLines.push(`Pasta sugerida: ${result.suggestedFolder}`);
      if (result.confidence) analysisDetailLines.push(`\nConfiança: ${result.confidence}`);
      if (result.limitations && result.limitations !== "Nenhuma.") analysisDetailLines.push(`Limitações: ${result.limitations}`);
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
      const sectionEnd = nextSectionMatch ? sectionBodyStart + nextSectionMatch.index : content.length;
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
    this.clearOutputArea();
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
    this.clearOutputArea();
    const activeFile = this.app.workspace.getActiveFile();
    await this.analyzeMarkdownFile(activeFile, {
      withContext: true,
      panelTitle: "IA — nota atual com contexto",
      analyzingMessage: "A analisar nota atual com contexto...",
      noFileMessage: "Nenhuma nota aberta. Abre uma nota Markdown primeiro.",
      nonMarkdownMessage: "O ficheiro ativo não é Markdown. Abre uma nota .md para analisar.",
      emptyMessage: "A nota atual está vazia. Não há conteúdo para analisar.",
      retryActionLabel: "Analisar nota atual com contexto"
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
    this.ensureAnalysisPanel(options.panelTitle);
    if (!this.analysisResultEl) return;

    this.analysisResultEl.empty();
    this.analysisResultEl.style.display = "block";
    this.currentActiveFilePath = undefined;

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

    const activeProfile = this.getActiveTextAiProfile();
    const isSensitiveNote = noteAppearsSensitive(content);
    if (isSensitiveNote && !activeProfile.isLocal) {
      this.renderSensitiveOnlineBlock();
      return;
    }

    if (isSensitiveNote) {
      this.renderSensitiveLocalWarning();
    }

    this.analysisResultEl.createDiv({
      text: options.analyzingMessage,
      attr: { style: "color: var(--text-muted); padding: 8px 0; font-style: italic;" }
    });

    const title = currentFile.basename;
    const path = currentFile.path;
    const relatedNotes = options.withContext
      ? await this.findRelatedNotesForCurrentNote(title, path, content)
      : [];
    const prompt = options.withContext
      ? this.buildCurrentNoteAnalysisPromptWithContext(title, path, content, relatedNotes)
      : this.buildCurrentNoteAnalysisPrompt(title, path, content);
    const result = await this.generateTextWithActiveAiProfile(activeProfile, prompt);

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

    this.processAIResponse(result.text, path, relatedNotes.map(n => n.path), relatedNotes.length, relatedNotes, currentFile);
    if (isSensitiveNote) {
      this.renderSensitiveLocalWarning();
    }
  }

  private async analyzeInboxNotes(): Promise<void> {
    this.clearOutputArea();
    this.ensureAnalysisPanel("IA — análise da Inbox");
    if (!this.analysisResultEl) return;

    this.analysisResultEl.empty();
    this.analysisResultEl.style.display = "block";

    const inboxFolderPath = normalizePath((this.plugin.settings.inboxFolderPath ?? "").trim());
    if (!inboxFolderPath) {
      this.analysisResultEl.createDiv({
        text: "Pasta Inbox não configurada.",
        attr: { style: "color: var(--text-warning); padding: 8px 0;" }
      });
      return;
    }

    const inboxFolder = this.app.vault.getAbstractFileByPath(inboxFolderPath);
    if (!(inboxFolder instanceof TFolder)) {
      this.analysisResultEl.createDiv({
        text: "A pasta Inbox configurada não existe.",
        attr: { style: "color: var(--text-warning); padding: 8px 0;" }
      });
      return;
    }

    const markdownFiles = inboxFolder.children
      .filter((child): child is TFile => child instanceof TFile && child.extension === "md")
      .sort((a, b) => a.path.localeCompare(b.path));

    if (markdownFiles.length === 0) {
      this.analysisResultEl.createDiv({
        text: "Não foram encontradas notas Markdown na Inbox.",
        attr: { style: "color: var(--text-muted); padding: 8px 0;" }
      });
      return;
    }

    const maxNotes = Math.min(20, Math.max(1, this.plugin.settings.maxInboxNotesToAnalyze ?? 10));
    const filesToAnalyze = markdownFiles.slice(0, maxNotes);
    const activeProfile = this.getActiveTextAiProfile();
    const results: InboxNoteAnalysisResult[] = [];

    this.analysisResultEl.createDiv({
      text: "A analisar notas da Inbox...",
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

        const sensitive = noteAppearsSensitive(content);
        if (sensitive && !activeProfile.isLocal) {
          results.push({
            file,
            error: "Esta nota parece conter dados sensíveis. A análise com provider remoto está bloqueada por segurança nesta versão."
          });
          continue;
        }

        const prompt = this.buildInboxNoteAnalysisPrompt(file.basename, file.path, content);
        const response = await this.generateTextWithActiveAiProfile(activeProfile, prompt);
        if (!response.success) {
          results.push({ file, error: response.message });
          continue;
        }

        const { json, error } = extrairJsonDaResposta(response.text);
        if (!json || error) {
          results.push({ file, error: error ?? "Resposta JSON inválida." });
          continue;
        }

        this.prepareStructuredAnalysisResult(json);
        this.applyFolderSuggestionResolution(json, file.path);
        results.push({
          file,
          result: json,
          warning: sensitive ? "Esta nota parece conter dados sensíveis. A análise está a usar provider local." : undefined
        });
      } catch (error) {
        results.push({
          file,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    this.renderInboxAnalysisResults(results, filesToAnalyze.length, markdownFiles.length);
    this.setStatus("Análise concluída.");
  }

  private ensureAnalysisPanel(title: string): void {
    if (!this.analysisSectionEl) {
      this.analysisSectionEl = this.contentEl.createDiv();
      this.analysisSectionEl.style.marginTop = "16px";
      this.analysisSectionEl.style.borderTop = "1px solid var(--background-modifier-border)";
      this.analysisSectionEl.style.paddingTop = "12px";
    }

    if (!this.analysisResultEl) {
      const header = this.analysisSectionEl.createDiv();
      header.style.display = "flex";
      header.style.justifyContent = "space-between";
      header.style.alignItems = "center";
      header.style.marginBottom = "8px";
      this.analysisTitleEl = header.createEl("h3", { text: title });

      const closeBtn = header.createEl("button", { text: "Fechar" });
      closeBtn.style.cursor = "pointer";
      closeBtn.addEventListener("click", () => {
        if (this.analysisResultEl) {
          this.analysisResultEl.empty();
          this.analysisResultEl.style.display = "none";
        }
      });

      this.analysisResultEl = this.analysisSectionEl.createDiv();
    } else if (this.analysisTitleEl) {
      this.analysisTitleEl.setText(title);
    }
  }

  private buildInboxNoteAnalysisPrompt(title: string, path: string, content: string): string {
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

Esta é uma análise em lote da Inbox. Não apliques alterações, não movas ficheiros e não renomeies notas.
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
    block.style.marginTop = "10px";

    const titleEl = block.createEl("strong", { text: title });
    titleEl.style.display = "block";
    titleEl.style.fontSize = "0.85em";
    titleEl.style.marginBottom = "4px";

    const body = block.createDiv();
    body.style.fontSize = "0.85em";
    body.style.lineHeight = "1.45";
    return body;
  }

  private createInboxCardLine(container: HTMLElement, label: string, value: string): HTMLElement {
    const line = container.createDiv();
    const labelEl = line.createSpan({ text: `${label}: ` });
    labelEl.style.color = "var(--text-muted)";
    line.createSpan({ text: value });
    return line;
  }

  private createInboxCardParagraph(container: HTMLElement, text: string): HTMLElement {
    const paragraph = container.createDiv({ text });
    paragraph.style.whiteSpace = "pre-wrap";
    paragraph.style.wordBreak = "break-word";
    return paragraph;
  }

  private renderInboxAnalysisResults(results: InboxNoteAnalysisResult[], analyzedCount: number, totalMarkdownCount: number): void {
    if (!this.analysisResultEl) return;

    this.analysisResultEl.empty();
    const title = this.analysisResultEl.createEl("h3", { text: "Análise da Inbox" });
    title.style.marginTop = "0";

    this.analysisResultEl.createDiv({
      text: `Análise concluída. Notas analisadas: ${analyzedCount}/${totalMarkdownCount}.`,
      attr: { style: "color: var(--text-muted); font-size: 0.85em; margin-bottom: 12px;" }
    });

    for (let index = 0; index < results.length; index++) {
      const item = results[index];
      const card = this.analysisResultEl.createDiv();
      card.style.border = "1px solid var(--background-modifier-border)";
      card.style.borderRadius = "4px";
      card.style.padding = "10px";
      card.style.marginBottom = "10px";

      const headerRow = card.createDiv();
      headerRow.style.display = "flex";
      headerRow.style.alignItems = "center";
      headerRow.style.gap = "6px";

      let isExpanded = false;
      const detailsEl = card.createDiv();
      detailsEl.style.display = "none";
      detailsEl.style.marginTop = "10px";
      detailsEl.style.borderTop = "1px solid var(--background-modifier-border)";
      detailsEl.style.paddingTop = "8px";

      const chevronButton = headerRow.createEl("button", { text: "▶" });
      chevronButton.setAttribute("aria-label", "Mostrar detalhes");
      chevronButton.style.border = "none";
      chevronButton.style.background = "transparent";
      chevronButton.style.boxShadow = "none";
      chevronButton.style.padding = "0 4px";
      chevronButton.style.cursor = "pointer";

      const titleButton = headerRow.createEl("button", { text: item.file.name });
      titleButton.style.border = "none";
      titleButton.style.background = "transparent";
      titleButton.style.boxShadow = "none";
      titleButton.style.padding = "0";
      titleButton.style.color = "var(--text-accent)";
      titleButton.style.fontWeight = "600";
      titleButton.style.textAlign = "left";
      titleButton.style.cursor = "pointer";
      titleButton.style.wordBreak = "break-word";
      titleButton.addEventListener("click", () => {
        void this.openInboxAnalysisFile(item.file);
      });

      const setExpanded = (expanded: boolean) => {
        isExpanded = expanded;
        detailsEl.style.display = isExpanded ? "block" : "none";
        chevronButton.setText(isExpanded ? "▼" : "▶");
        chevronButton.setAttribute("aria-label", isExpanded ? "Ocultar detalhes" : "Mostrar detalhes");
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
      compactMeta.style.fontSize = "0.85em";
      compactMeta.style.color = "var(--text-muted)";
      compactMeta.style.marginTop = "6px";
      compactMeta.style.lineHeight = "1.4";

      if (folderResolution) {
        compactMeta.createDiv({ text: `Destino: ${folderResolution.resolvedFolderPath || folderResolution.rawSuggestedFolder}` });
      }
      const folderStatusEl = compactMeta.createDiv({
        text: folderResolution
          ? `Estado da pasta sugerida: ${folderResolution.reason}`
          : "Estado da pasta sugerida: sem pasta sugerida."
      });
      folderStatusEl.style.color = folderResolution?.canMove ? "var(--text-success)" : "var(--text-warning)";
      if (item.result.confidence) compactMeta.createDiv({ text: `Confiança: ${item.result.confidence}` });

      const destinationBlock = this.createInboxCardBlock(detailsEl, "Destino");
      if (folderResolution) {
        this.createInboxCardLine(destinationBlock, "Pasta sugerida", folderResolution.resolvedFolderPath || folderResolution.rawSuggestedFolder);
      } else {
        this.createInboxCardLine(destinationBlock, "Pasta sugerida", "sem pasta sugerida");
      }
      const detailFolderStatusEl = this.createInboxCardLine(
        destinationBlock,
        "Estado da pasta sugerida",
        folderResolution?.reason ?? "sem pasta sugerida."
      );
      detailFolderStatusEl.style.color = folderResolution?.canMove ? "var(--text-success)" : "var(--text-warning)";
      if (item.result.confidence) this.createInboxCardLine(destinationBlock, "Confiança", item.result.confidence);

      const detailActions = this.createInboxCardBlock(detailsEl, "Ações");
      detailActions.style.display = "flex";
      detailActions.style.flexWrap = "wrap";
      detailActions.style.gap = "8px";

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

      const analyzeButton = detailActions.createEl("button", { text: "Analisar" });
      analyzeButton.style.fontWeight = "600";
      analyzeButton.addEventListener("click", () => {
        void this.analyzeInboxFileIndividually(item.file);
      });

      const analyzeWithContextButton = detailActions.createEl("button", { text: "Analisar com contexto" });
      analyzeWithContextButton.addEventListener("click", () => {
        void this.analyzeInboxFileIndividually(item.file, true);
      });

      if (item.result.suggestedTitle || item.result.noteType || item.result.mainTopic) {
        const synthesisBlock = this.createInboxCardBlock(detailsEl, "Síntese");
        if (item.result.suggestedTitle) this.createInboxCardLine(synthesisBlock, "Título sugerido", item.result.suggestedTitle);
        if (item.result.noteType) this.createInboxCardLine(synthesisBlock, "Tipo", item.result.noteType);
        if (item.result.mainTopic) this.createInboxCardLine(synthesisBlock, "Tema", item.result.mainTopic);
      }

      if (item.result.tags && item.result.tags.length > 0) {
        const tagsBlock = this.createInboxCardBlock(detailsEl, "Tags");
        tagsBlock.createDiv({ text: item.result.tags.join(", ") });
      }

      if (item.result.yaml && Object.keys(item.result.yaml).length > 0) {
        const yamlBlock = this.createInboxCardBlock(detailsEl, "YAML sugerido");
        for (const [key, value] of Object.entries(item.result.yaml)) {
          yamlBlock.createDiv({ text: `${key}: ${Array.isArray(value) ? value.join(", ") : value}` });
        }
      }

      if (item.result.summary) {
        const summaryBlock = this.createInboxCardBlock(detailsEl, "Resumo");
        this.createInboxCardParagraph(summaryBlock, item.result.summary);
      }

      if (item.result.tasks && item.result.tasks.length > 0) {
        const tasksBlock = this.createInboxCardBlock(detailsEl, "Tarefas");
        const taskList = tasksBlock.createEl("ul");
        taskList.style.marginTop = "0";
        taskList.style.marginBottom = "0";
        for (const task of item.result.tasks) {
          taskList.createEl("li", { text: task });
        }
      }

      if (item.result.limitations && item.result.limitations !== "Nenhuma.") {
        const limitationsBlock = this.createInboxCardBlock(detailsEl, "Limitações");
        this.createInboxCardParagraph(limitationsBlock, item.result.limitations);
      }

      if (item.result.internalLinks && item.result.internalLinks.length > 0) {
        const linksBlock = this.createInboxCardBlock(detailsEl, "Links sugeridos");
        linksBlock.createDiv({ text: item.result.internalLinks.map(link => link.path).join(", ") });
      }
    }
  }

  private renderInboxFolderMoveControls(
    actionRow: HTMLElement,
    file: TFile,
    rawSuggestedFolder: string,
    folderResolution: FolderMoveResolution,
    pathEl: HTMLElement,
    statusEls: HTMLElement[]
  ): void {
    const moveButton = actionRow.createEl("button", { text: "Mover" });
    moveButton.disabled = !folderResolution.canMove;
    moveButton.style.cursor = folderResolution.canMove ? "pointer" : "not-allowed";
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
      modal.titleEl.setText("Mover nota");

      const intro = modal.contentEl.createDiv({ text: "Vai mover esta nota:" });
      intro.style.marginBottom = "8px";

      const list = modal.contentEl.createEl("ul");
      list.style.marginTop = "0";
      list.createEl("li", { text: `nome atual: ${file.name}` });
      list.createEl("li", { text: `pasta atual: ${resolution.currentFolderPath || "/"}` });
      list.createEl("li", { text: `pasta destino: ${resolution.resolvedFolderPath || resolution.rawSuggestedFolder}` });
      list.createEl("li", { text: `caminho final: ${resolution.finalTargetPath ?? ""}` });

      const warning = modal.contentEl.createDiv({
        text: "Esta ação vai mover o ficheiro Markdown dentro do vault. Continuar?"
      });
      warning.style.marginTop = "12px";

      const buttons = modal.contentEl.createDiv();
      buttons.style.display = "flex";
      buttons.style.justifyContent = "flex-end";
      buttons.style.gap = "8px";
      buttons.style.marginTop = "16px";

      const cancelButton = buttons.createEl("button", { text: "Cancelar" });
      const moveButton = buttons.createEl("button", { text: "Mover" });
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
      new Notice("A nota já não existe.");
      return;
    }

    if (currentFile.extension !== "md") {
      new Notice("O ficheiro selecionado não é Markdown.");
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
      statusEls?.forEach(statusEl => statusEl.setText(`Estado da pasta sugerida: ${resolution.reason}`));
      if (moveButton) {
        moveButton.disabled = true;
        moveButton.style.cursor = "not-allowed";
      }
      return;
    }

    const confirmed = await this.confirmMoveInboxNote(currentFile, resolution);
    if (!confirmed) {
      new Notice("Operação cancelada. A nota não foi movida.");
      return;
    }

    const latestFile = this.app.vault.getAbstractFileByPath(currentFile.path);
    if (!(latestFile instanceof TFile)) {
      new Notice("A nota já não existe.");
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
      statusEls?.forEach(statusEl => statusEl.setText(`Estado da pasta sugerida: ${finalResolution.reason}`));
      if (moveButton) {
        moveButton.disabled = true;
        moveButton.style.cursor = "not-allowed";
      }
      return;
    }

    const destinationFolder = this.app.vault.getAbstractFileByPath(finalResolution.resolvedFolderPath);
    if (!(destinationFolder instanceof TFolder)) {
      new Notice("A pasta sugerida não existe.");
      return;
    }

    const existingTarget = this.app.vault.getAbstractFileByPath(finalResolution.finalTargetPath);
    if (existingTarget) {
      new Notice("Já existe um ficheiro com este nome na pasta de destino.");
      return;
    }

    try {
      await this.app.fileManager.renameFile(latestFile, finalResolution.finalTargetPath);
      new Notice("Nota movida com sucesso.");
      if (pathEl) {
        pathEl.setText(finalResolution.finalTargetPath);
      }
      for (const statusEl of statusEls ?? []) {
        statusEl.setText(`Estado da pasta sugerida: Nota movida para ${finalResolution.resolvedFolderPath}.`);
        statusEl.style.color = "var(--text-success)";
      }
      if (moveButton) {
        moveButton.disabled = true;
        moveButton.style.cursor = "not-allowed";
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Erro ao mover nota: ${message}`);
    }
  }

  private async openInboxAnalysisFile(file: TFile): Promise<boolean> {
    const currentFile = this.app.vault.getAbstractFileByPath(file.path);
    if (!(currentFile instanceof TFile)) {
      new Notice("A nota já não existe no vault.");
      return false;
    }

    if (currentFile.extension !== "md") {
      new Notice("O ficheiro selecionado não é Markdown.");
      return false;
    }

    try {
      await this.app.workspace.getLeaf(false).openFile(currentFile);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Erro ao abrir nota: ${message}`);
      return false;
    }
  }

  private async analyzeInboxFileIndividually(file: TFile, withContext = false): Promise<void> {
    this.clearOutputArea();
    this.setStatus("A analisar nota selecionada...");

    const opened = await this.openInboxAnalysisFile(file);
    if (!opened) return;

    const currentFile = this.app.vault.getAbstractFileByPath(file.path);
    if (!(currentFile instanceof TFile)) {
      new Notice("A nota selecionada já não existe no vault.");
      return;
    }

    await this.analyzeMarkdownFile(currentFile, {
      withContext,
      panelTitle: withContext ? "IA — nota selecionada com contexto" : "IA — nota selecionada",
      analyzingMessage: "A analisar nota selecionada...",
      noFileMessage: "Nenhuma nota selecionada para analisar.",
      nonMarkdownMessage: "O ficheiro selecionado não é Markdown.",
      emptyMessage: "A nota selecionada está vazia. Não há conteúdo para analisar.",
      retryActionLabel: withContext ? "Analisar individualmente com contexto" : "Analisar individualmente"
    });
  }

  // -----------------------------------------------------------------------
  // Renderização de cartões de pesquisa
  // -----------------------------------------------------------------------

  /**
   * Renderiza cartão com destaque seguro de termos no título e no excerto.
   */
  private renderHighlightedCard(card: GroupedNoteCard): void {
    const cardEl = this.resultsEl.createDiv();
    cardEl.style.marginBottom = "8px";
    cardEl.style.padding = "10px";
    cardEl.style.border = "1px solid var(--background-modifier-border)";
    cardEl.style.borderRadius = "4px";
    cardEl.style.cursor = "pointer";

    const titleEl = cardEl.createEl("strong");
    renderHighlightedText(titleEl, card.basename, card.termsFound);

    const pathEl = cardEl.createDiv({ text: card.path });
    pathEl.style.fontSize = "0.85em";
    pathEl.style.color = "var(--text-muted)";
    pathEl.style.marginTop = "4px";

    const metaEl = cardEl.createDiv();
    metaEl.style.fontSize = "0.85em";
    metaEl.style.color = "var(--text-muted)";
    metaEl.style.marginTop = "6px";

    metaEl.createDiv({ text: `Origem: ${card.origin}` });
    if (typeof card.textScore === "number") metaEl.createDiv({ text: `Relevância textual: ${card.textScore}` });
    if (typeof card.semanticScore === "number") metaEl.createDiv({ text: `Semelhança semântica: ${card.semanticScore}%` });
    metaEl.createDiv({ text: `Pontuação final: ${typeof card.score === "number" ? Math.round(card.score) : card.score}` });
    if (card.termsFound.length > 0 && card.totalTerms > 0) {
      metaEl.createDiv({ text: `Termos encontrados: ${card.termsFound.join(", ")}` });
      metaEl.createDiv({ text: `Cobertura: ${card.termsFound.length}/${card.totalTerms}` });
    }
    if (card.chunkCount > 1) {
      metaEl.createDiv({ text: `Blocos encontrados: ${card.chunkCount}` });
    }

    const snippetEl = cardEl.createDiv();
    snippetEl.style.fontSize = "0.85em";
    snippetEl.style.marginTop = "8px";
    snippetEl.style.padding = "4px 6px";
    snippetEl.style.backgroundColor = "var(--background-primary-alt)";
    snippetEl.style.borderRadius = "3px";
    snippetEl.style.whiteSpace = "pre-wrap";
    snippetEl.style.wordBreak = "break-word";

    const displaySnippet = card.snippet.length > 280 ? `${card.snippet.substring(0, 280)}...` : card.snippet;
    renderHighlightedText(snippetEl, displaySnippet, card.termsFound);

    cardEl.addEventListener("click", () => this.openNote(card.path));
  }

  private openNote(path: string): void {
    const file = this.app.vault.getAbstractFileByPath(path) as TFile | null;
    if (!file) {
      new Notice("Nota não encontrada no vault.");
      return;
    }

    void this.app.workspace.getLeaf().openFile(file);
  }
}

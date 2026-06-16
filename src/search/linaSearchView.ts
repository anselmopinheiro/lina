import { ItemView, Notice, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import LinaPlugin from "../../main";
import { Chunk } from "../index/chunker";
import { EmbeddingRecord, generateSingleEmbedding, readEmbeddingStatus } from "../index/embeddingGenerator";
import { readIndexedChunks, readIndexedNotes, readTextIndexStatus } from "../index/indexStore";
import { runHybridSearch } from "./hybridSearch";
import { searchSemanticIndex, SemanticSearchResult } from "./semanticSearch";
import { SearchResult, searchTextIndex } from "./textSearch";
import { generateOllamaText } from "../ai/ollamaProvider";

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

type SelectableKind = "yaml" | "tag" | "task" | "analysis" | "title" | "ai-link" | "related-link";

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
  const sectionStart = content.indexOf(SECCAO_ANALISE);
  if (sectionStart < 0) return existing;

  const analysisSection = content.substring(sectionStart);
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
      if (afterColon.length > 0 && !afterColon.startsWith("[")) {
        // Formato "tags: valor1, valor2"
        tags.push(...afterColon.split(",").map(t => t.trim()).filter(t => t.length > 0));
      }
      continue;
    }
    if (inTags) {
      if (trimmed.startsWith("- ")) {
        tags.push(trimmed.substring(2).trim());
      } else if (trimmed.includes(":")) {
        inTags = false;
      } else if (trimmed.length === 0) {
        inTags = false;
      }
    }
  }
  return tags;
}

// ---------------------------------------------------------------------------
// View principal
// ---------------------------------------------------------------------------
export class LinaSearchView extends ItemView {
  private plugin: LinaPlugin;
  private stateContainer!: HTMLDivElement;
  private actionsContainer!: HTMLDivElement;
  private queryInput!: HTMLInputElement;
  private searchButton!: HTMLButtonElement;
  private modeSelect!: HTMLSelectElement;
  private statusEl!: HTMLDivElement;
  private resultsEl!: HTMLDivElement;
  private currentMode: SearchMode = "hibrida";

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

    this.stateContainer = contentEl.createDiv();
    this.stateContainer.style.marginBottom = "12px";

    this.actionsContainer = contentEl.createDiv();
    this.actionsContainer.style.display = "flex";
    this.actionsContainer.style.flexWrap = "wrap";
    this.actionsContainer.style.gap = "8px";
    this.actionsContainer.style.marginBottom = "12px";

    this.queryInput = contentEl.createEl("input", {
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

    const controlsRow = contentEl.createDiv();
    controlsRow.style.display = "flex";
    controlsRow.style.gap = "8px";
    controlsRow.style.marginBottom = "12px";

    this.modeSelect = controlsRow.createEl("select");
    this.modeSelect.createEl("option", { text: "Híbrida", value: "hibrida" });
    this.modeSelect.createEl("option", { text: "Textual", value: "textual" });
    this.modeSelect.createEl("option", { text: "Semântica", value: "semantica" });
    this.modeSelect.value = this.currentMode;
    this.modeSelect.addEventListener("change", () => {
      this.currentMode = this.modeSelect.value as SearchMode;
    });

    this.searchButton = controlsRow.createEl("button", { text: "Pesquisar" });
    this.searchButton.addEventListener("click", () => void this.runSearch());

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

  /** Conteúdo da última resposta da IA */
  private analysisSectionEl?: HTMLDivElement;
  private analysisResultEl?: HTMLDivElement;

  private async refreshState(): Promise<void> {
    const indexStatus = await readTextIndexStatus(this.app);
    const embeddingStatus = await readEmbeddingStatus(this.app);

    this.stateContainer.empty();
    this.actionsContainer.empty();

    this.stateContainer.createEl("h3", { text: "Estado do Lina" });

    const stateList = this.stateContainer.createDiv();
    stateList.style.fontSize = "0.9em";
    stateList.style.color = "var(--text-muted)";

    const autoUpdateEnabled = this.plugin.settings.autoUpdateIndexOnFileChanges ?? false;
    stateList.createDiv({ text: `Atualização automática: ${autoUpdateEnabled ? "ativa" : "inativa"}` });

    const manifest = indexStatus.manifest;
    const notesExist = indexStatus.exists && typeof indexStatus.totalNotes === "number";
    const chunksExist = indexStatus.exists && typeof indexStatus.totalChunks === "number";
    const indexReady = indexStatus.exists && notesExist && chunksExist;

    stateList.createDiv({ text: `Índice textual: ${indexReady ? "pronto" : "em falta"}` });
    stateList.createDiv({ text: `notes.json: ${notesExist ? "disponível" : "em falta"}` });
    stateList.createDiv({ text: `chunks.jsonl: ${chunksExist ? "disponível" : "em falta"}` });

    if (indexReady) {
      stateList.createDiv({ text: `Notas indexadas: ${indexStatus.totalNotes ?? 0}` });
      stateList.createDiv({ text: `Blocos textuais: ${indexStatus.totalChunks ?? 0}` });
      if (manifest?.updatedAt) {
        stateList.createDiv({ text: `Última atualização do índice: ${manifest.updatedAt}` });
      }
    } else {
      stateList.createDiv({ text: "Índice textual ainda não existe." });
    }

    const embeddingsReady = !!embeddingStatus?.exists && (embeddingStatus.validCount ?? 0) > 0;
    const embeddingsIncomplete = !!embeddingStatus && ((embeddingStatus.missingCount ?? 0) > 0 || (embeddingStatus.staleCount ?? 0) > 0 || (embeddingStatus.obsoleteCount ?? 0) > 0);

    stateList.createDiv({ text: `Embeddings: ${embeddingsReady ? (embeddingsIncomplete ? "incompletos" : "prontos") : "indisponíveis"}` });

    if (embeddingStatus) {
      stateList.createDiv({ text: `Embeddings válidos: ${embeddingStatus.validCount}` });
      stateList.createDiv({ text: `Embeddings em falta: ${embeddingStatus.missingCount}` });
      stateList.createDiv({ text: `Embeddings desatualizados: ${embeddingStatus.staleCount + embeddingStatus.obsoleteCount}` });
      if (embeddingStatus.model) {
        stateList.createDiv({ text: `Modelo: ${embeddingStatus.model}` });
      }
      if (embeddingStatus.provider) {
        stateList.createDiv({ text: `Provider: ${embeddingStatus.provider}` });
      }
      if (embeddingStatus.updatedAt) {
        stateList.createDiv({ text: `Última atualização dos embeddings: ${embeddingStatus.updatedAt}` });
      }
    }

    if (!indexReady) {
      this.actionsContainer.appendChild(this.createActionButton("Construir índice textual", async () => {
        this.setStatus("A construir índice textual...");
        const result = await this.plugin.rebuildTextIndex();
        this.setStatus(result.success ? "Índice textual construído com sucesso." : "Erro ao construir índice textual.");
        await this.refreshState();
      }));
      return;
    }

    this.actionsContainer.appendChild(this.createActionButton("Reconstruir índice textual", async () => {
      this.setStatus("A construir índice textual...");
      const result = await this.plugin.rebuildTextIndex();
      this.setStatus(result.success ? "Índice textual construído com sucesso." : "Erro ao construir índice textual.");
      await this.refreshState();
    }));

    if (!embeddingsReady) {
      stateList.createDiv({ text: "A pesquisa híbrida será feita apenas com o índice textual enquanto não existirem embeddings." });
      this.actionsContainer.appendChild(this.createActionButton("Gerar embeddings locais", async () => {
        this.setStatus("A gerar embeddings locais...");
        const result = await this.plugin.generateLocalEmbeddings((message) => this.setStatus(message));
        this.setStatus(result.success ? "Embeddings locais gerados com sucesso." : "Erro ao gerar embeddings locais.");
        await this.refreshState();
      }));
    } else if (embeddingsIncomplete) {
      stateList.createDiv({ text: "Embeddings locais incompletos ou desatualizados." });
      this.actionsContainer.appendChild(this.createActionButton("Atualizar embeddings locais", async () => {
        this.setStatus("A gerar embeddings locais...");
        const result = await this.plugin.generateLocalEmbeddings((message) => this.setStatus(message));
        this.setStatus(result.success ? "Embeddings locais gerados com sucesso." : "Erro ao gerar embeddings locais.");
        await this.refreshState();
      }));
    }

    // Botão de análise IA
    this.actionsContainer.appendChild(this.createActionButton("Analisar nota atual", async () => {
      await this.analyzeCurrentNote();
    }));

    // Botão de análise IA com contexto
    this.actionsContainer.appendChild(this.createActionButton("Analisar nota atual com contexto", async () => {
      await this.analyzeCurrentNoteWithContext();
    }));
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

* Se a pasta atual parecer adequada, usa: "${currentFolder}"
* Se a pasta for incerta, usa: "Indefinida."

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

* Se a pasta atual parecer adequada, usa: "${currentFolder}"
* Se a pasta for incerta, usa: "Indefinida."

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
        value: label,
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
      this.createSelectableItem(section, `${idPrefix}::${item.id}`, item.label, false, item.kind, item.path, item.title, item.reason);
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
        this.createSelectableItem(section, `${idPrefix}::${item.id}`, item.label, false, item.kind, item.path, item.title, item.reason);
      }
    }
  }

  /**
   * Renderiza a pré-visualização estruturada na vista lateral.
   */
  private async renderStructuredPreview(result: StructuredAnalysisResult, relatedNotesCount: number, relatedNotes: RelatedNote[] = []): Promise<void> {
    if (!this.analysisResultEl) return;

    this.analysisResultEl.empty();
    this.structuredSelections.clear();
    this.selectableItemsMap.clear();
    this.currentStructuredResult = result;

    // Guardar o caminho do ficheiro ativo para aplicar alterações
    const activeFile = this.app.workspace.getActiveFile();
    this.currentActiveFilePath = activeFile?.path;

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
      this.createStructuredSection(
        this.analysisResultEl,
        "Título sugerido",
        "title",
        [{ id: "suggested", label: result.suggestedTitle, kind: "title", value: result.suggestedTitle, title: result.suggestedTitle }],
        ""
      );
    }

    // YAML sugerido - comparar com frontmatter existente
    if (result.yaml && Object.keys(result.yaml).length > 0) {
      const yamlItems: Array<SelectableSectionItem & { disabled?: boolean }> = [];
      let existingFrontmatter: Map<string, string> = new Map();

      // Ler frontmatter atual se existir
      if (activeFile) {
        try {
          const content = await this.app.vault.read(activeFile);
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
      const tagItems = validTags.map(tag => ({ id: `tag_${tag}`, label: tag, kind: "tag" as const, value: tag }));
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
      const currentPathNormalized = activeFile ? normalizePathSafe(activeFile.path) : "";

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
  private processAIResponse(aiText: string, currentPath: string, allowedPaths: string[], relatedNotesCount: number, relatedNotes: RelatedNote[] = []): void {
    if (!this.analysisResultEl) return;

    const { json, error } = extrairJsonDaResposta(aiText);

    if (json && !error) {
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

      this.renderStructuredPreview(json, relatedNotesCount, relatedNotes);
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

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("Nenhuma nota aberta. Abre uma nota Markdown primeiro.");
      return;
    }

    if (activeFile.extension !== "md") {
      new Notice("O ficheiro ativo não é Markdown. Abre uma nota .md para aplicar sugestões.");
      return;
    }

    // Recolher itens selecionados
    const selectedYamlKeys: string[] = [];
    const selectedTags: string[] = [];
    const selectedTasks: string[] = [];
    const selectedAiLinks: SelectedAnalysisLink[] = [];
    const selectedRelatedLinks: SelectedAnalysisLink[] = [];
    const selectedDiagnostics: string[] = [];
    let titleSelected = false;
    let analysisSelected = false;

    for (const [id, selected] of this.structuredSelections.entries()) {
      if (!selected) continue;

      const item = this.selectableItemsMap.get(id);
      selectedDiagnostics.push(`- id=${id}, kind=${item?.kind ?? "sem-metadados"}, path=${item?.path ?? ""}, label=${item?.label ?? ""}`);

      if (!item) {
        continue;
      }

      switch (item.kind) {
        case "yaml":
          selectedYamlKeys.push(item.value);
          break;
        case "tag":
          selectedTags.push(item.value);
          break;
        case "task":
          selectedTasks.push(item.value);
          break;
        case "title":
          titleSelected = true;
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
        const content = await this.app.vault.read(activeFile);
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
    const totalSelected = selectedDiagnostics.length;

    if (totalSelected === 0) {
      new Notice("Nenhum item selecionado. Seleciona pelo menos um item antes de aplicar.");
      return;
    }

    // Construir resumo para confirmação
    const summaryParts: string[] = [];
    if (newYamlCount > 0) summaryParts.push(`${newYamlCount} campos YAML novos`);
    if (selectedTags.length > 0) summaryParts.push(`${selectedTags.length} tags`);
    if (titleSelected) summaryParts.push("título H1");
    if (selectedTasks.length > 0) summaryParts.push(`${selectedTasks.length} tarefas`);
    if (analysisSelected) summaryParts.push("análise");
    if (existingYamlCount > 0) summaryParts.push(`${existingYamlCount} campos YAML ignorados (já existem)`);
    if (conflictYamlCount > 0) summaryParts.push(`${conflictYamlCount} campos YAML ignorados (conflito)`);

    const summary = summaryParts.join(", ");

    // Confirmação explícita
    const confirmMessage = `Vai aplicar à nota atual:\n\n${summary}\n\nEsta ação vai alterar o ficheiro Markdown atual. Continuar?`;

    if (!confirm(confirmMessage)) {
      new Notice("Operação cancelada. A nota não foi alterada.");
      return;
    }

    // Aplicar alterações
    try {
      let content = await this.app.vault.read(activeFile);

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
        content = this.applyAnalysisToNote(content, result, selectedTags, selectedAiLinks, selectedRelatedLinks);
      } else if (hasLinksToApply) {
        // Aplicar apenas links se não houver análise selecionada
        content = this.applyAnalysisToNote(content, result, [], selectedAiLinks, selectedRelatedLinks);
      }

      // Escrever nota
      await this.app.vault.modify(activeFile, content);

      new Notice("Sugestões aplicadas à nota.");

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

    // Construir novas linhas YAML
    const newLines: string[] = [];
    let conflictWarning = false;

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
            conflictWarning = true;
            continue;
          }
        }

        newLines.push(`${originalKey}: ${valueStr}`);
      }
    }

    // Adicionar tags selecionadas
    if (selectedTags.length > 0) {
      const allTags = [...new Set([...existingTags, ...selectedTags])];
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
      // Encontrar onde inserir (antes de tags existentes ou no fim)
      const insertIndex = frontmatterLines.findIndex(line => line.trim().startsWith("tags:"));
      if (insertIndex >= 0 && selectedTags.length > 0) {
        // Substituir a linha de tags existente pelas novas tags
        frontmatterLines.splice(insertIndex, frontmatterLines.length - insertIndex);
      }

      // Adicionar novas linhas
      frontmatterLines.push(...newLines);
      const newFrontmatter = frontmatterLines.join("\n");
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
          .map(line => line.trim().substring(5).trim());

        const newTasks = selectedTasks.filter(t => !existingTasks.includes(t));
        if (newTasks.length === 0) return content;

        // Garantir que entram como por concluir: `- [ ]`
        const tasksToAdd = newTasks.map(t => `- [ ] ${t}`).join("\n");
        return content + "\n" + tasksToAdd;
      }
    }

    // Criar nova secção - garantir que entram como por concluir: `- [ ]`
    const tasksBlock = selectedTasks.map(t => `- [ ] ${t}`).join("\n");
    return `${content}\n\n${SECCAO_TAREFAS}\n${tasksBlock}\n`;
  }

  /**
   * Aplica a análise no fim da nota.
   */
  private applyAnalysisToNote(
    content: string,
    result: StructuredAnalysisResult,
    selectedTags: string[],
    selectedAiLinks: string[] = [],
    selectedRelatedLinks: string[] = []
  ): string {
    const analysisLines: string[] = [];

    if (result.summary) analysisLines.push(result.summary);
    if (result.noteType) analysisLines.push(`\nTipo: ${result.noteType}`);
    if (result.mainTopic) analysisLines.push(`Tema: ${result.mainTopic}`);
    if (result.suggestedFolder) analysisLines.push(`Pasta sugerida: ${result.suggestedFolder}`);
    if (selectedTags.length > 0) analysisLines.push(`Tags: ${selectedTags.join(", ")}`);

    // Links internos sugeridos pela IA
    if (selectedAiLinks.length > 0) {
      analysisLines.push("\nLinks internos sugeridos:");
      for (const linkPath of selectedAiLinks) {
        analysisLines.push(`* [[${linkPath}]]`);
      }
    }

    // Outras notas relacionadas selecionadas manualmente
    if (selectedRelatedLinks.length > 0) {
      analysisLines.push("\nOutras notas relacionadas selecionadas:");
      for (const linkPath of selectedRelatedLinks) {
        analysisLines.push(`* [[${linkPath}]]`);
      }
    }

    if (result.confidence) analysisLines.push(`\nConfiança: ${result.confidence}`);
    if (result.limitations && result.limitations !== "Nenhuma.") analysisLines.push(`Limitações: ${result.limitations}`);

    const analysisText = analysisLines.join("\n");

    if (secaoExiste(content, SECCAO_ANALISE)) {
      // Já existe secção de análise, adicionar com separador
      return `${content}\n\n---\n${analysisText}\n`;
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
      header.createEl("h3", { text: "IA — nota atual" });

      const closeBtn = header.createEl("button", { text: "✕" });
      closeBtn.style.background = "none";
      closeBtn.style.border = "none";
      closeBtn.style.cursor = "pointer";
      closeBtn.style.color = "var(--text-muted)";
      closeBtn.style.fontSize = "1.1em";
      closeBtn.addEventListener("click", () => {
        if (this.analysisResultEl) {
          this.analysisResultEl.empty();
          this.analysisResultEl.style.display = "none";
        }
      });

      this.analysisResultEl = this.analysisSectionEl.createDiv();
    }

    this.analysisResultEl.empty();
    this.analysisResultEl.style.display = "block";

    const activeView = this.app.workspace.getActiveViewOfType(ItemView);
    const activeFile = this.app.workspace.getActiveFile();

    if (!activeFile) {
      this.analysisResultEl.createDiv({
        text: "Nenhuma nota aberta. Abre uma nota Markdown primeiro.",
        attr: { style: "color: var(--text-warning); padding: 8px 0;" }
      });
      return;
    }

    if (activeFile.extension !== "md") {
      this.analysisResultEl.createDiv({
        text: "O ficheiro ativo não é Markdown. Abre uma nota .md para analisar.",
        attr: { style: "color: var(--text-warning); padding: 8px 0;" }
      });
      return;
    }

    let content: string;
    try {
      content = await this.app.vault.read(activeFile);
    } catch (error) {
      this.analysisResultEl.createDiv({
        text: `Erro ao ler a nota: ${error instanceof Error ? error.message : String(error)}`,
        attr: { style: "color: var(--text-error); padding: 8px 0;" }
      });
      return;
    }

    if (!content || content.trim().length === 0) {
      this.analysisResultEl.createDiv({
        text: "A nota atual está vazia. Não há conteúdo para analisar.",
        attr: { style: "color: var(--text-warning); padding: 8px 0;" }
      });
      return;
    }

    const aiProvider = this.plugin.settings.aiProvider;
    if (aiProvider !== "ollama") {
      this.analysisResultEl.createDiv({
        text: "Este provider ainda não está implementado nesta versão. Usa Ollama local para analisar notas.",
        attr: { style: "color: var(--text-warning); padding: 8px 0;" }
      });
      return;
    }

    this.analysisResultEl.createDiv({
      text: "A analisar nota atual...",
      attr: { style: "color: var(--text-muted); padding: 8px 0; font-style: italic;" }
    });

    const title = activeFile.basename;
    const path = activeFile.path;
    const prompt = this.buildCurrentNoteAnalysisPrompt(title, path, content);
    const baseUrl = this.plugin.settings.aiBaseUrl || "http://localhost:11434";
    const model = this.plugin.settings.aiAnalysisModel || "gemma4:12b";
    const timeoutMs = (this.plugin.settings.aiRequestTimeoutSeconds || 60) * 1000;

    const result = await generateOllamaText(baseUrl, model, prompt, timeoutMs);

    this.analysisResultEl.empty();

    if (!result.success) {
      if (result.message.includes("Tempo limite")) {
        this.analysisResultEl.createDiv({
          text: "A análise excedeu o tempo limite. Podes aumentar o tempo nas definições ou tentar novamente.",
          attr: { style: "color: var(--text-error); padding: 8px 0;" }
        });
      } else if (result.message.includes("model")) {
        this.analysisResultEl.createDiv({
          text: `Modelo "${model}" não encontrado no Ollama. Verifica se o modelo está disponível.`,
          attr: { style: "color: var(--text-error); padding: 8px 0;" }
        });
      } else {
        this.analysisResultEl.createDiv({
          text: `Erro ao analisar nota: ${result.message}`,
          attr: { style: "color: var(--text-error); padding: 8px 0;" }
        });
      }
      this.analysisResultEl.createDiv({
        text: "Podes tentar novamente clicando em 'Analisar nota atual'.",
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

    this.processAIResponse(result.text, path, [], 0, []);
  }

  /**
   * Analisa a nota atualmente aberta com contexto de notas relacionadas.
   */
  private async analyzeCurrentNoteWithContext(): Promise<void> {
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
      header.createEl("h3", { text: "IA — nota atual com contexto" });

      const closeBtn = header.createEl("button", { text: "✕" });
      closeBtn.style.background = "none";
      closeBtn.style.border = "none";
      closeBtn.style.cursor = "pointer";
      closeBtn.style.color = "var(--text-muted)";
      closeBtn.style.fontSize = "1.1em";
      closeBtn.addEventListener("click", () => {
        if (this.analysisResultEl) {
          this.analysisResultEl.empty();
          this.analysisResultEl.style.display = "none";
        }
      });

      this.analysisResultEl = this.analysisSectionEl.createDiv();
    }

    this.analysisResultEl.empty();
    this.analysisResultEl.style.display = "block";

    const activeView = this.app.workspace.getActiveViewOfType(ItemView);
    const activeFile = this.app.workspace.getActiveFile();

    if (!activeFile) {
      this.analysisResultEl.createDiv({
        text: "Nenhuma nota aberta. Abre uma nota Markdown primeiro.",
        attr: { style: "color: var(--text-warning); padding: 8px 0;" }
      });
      return;
    }

    if (activeFile.extension !== "md") {
      this.analysisResultEl.createDiv({
        text: "O ficheiro ativo não é Markdown. Abre uma nota .md para analisar.",
        attr: { style: "color: var(--text-warning); padding: 8px 0;" }
      });
      return;
    }

    let content: string;
    try {
      content = await this.app.vault.read(activeFile);
    } catch (error) {
      this.analysisResultEl.createDiv({
        text: `Erro ao ler a nota: ${error instanceof Error ? error.message : String(error)}`,
        attr: { style: "color: var(--text-error); padding: 8px 0;" }
      });
      return;
    }

    if (!content || content.trim().length === 0) {
      this.analysisResultEl.createDiv({
        text: "A nota atual está vazia. Não há conteúdo para analisar.",
        attr: { style: "color: var(--text-warning); padding: 8px 0;" }
      });
      return;
    }

    const aiProvider = this.plugin.settings.aiProvider;
    if (aiProvider !== "ollama") {
      this.analysisResultEl.createDiv({
        text: "Este provider ainda não está implementado nesta versão. Usa Ollama local para analisar notas.",
        attr: { style: "color: var(--text-warning); padding: 8px 0;" }
      });
      return;
    }

    this.analysisResultEl.createDiv({
      text: "A analisar nota atual com contexto...",
      attr: { style: "color: var(--text-muted); padding: 8px 0; font-style: italic;" }
    });

    const title = activeFile.basename;
    const path = activeFile.path;
    const relatedNotes = await this.findRelatedNotesForCurrentNote(title, path, content);

    const prompt = this.buildCurrentNoteAnalysisPromptWithContext(title, path, content, relatedNotes);
    const baseUrl = this.plugin.settings.aiBaseUrl || "http://localhost:11434";
    const model = this.plugin.settings.aiAnalysisModel || "gemma4:12b";
    const timeoutMs = (this.plugin.settings.aiRequestTimeoutSeconds || 60) * 1000;

    const result = await generateOllamaText(baseUrl, model, prompt, timeoutMs);

    this.analysisResultEl.empty();

    if (!result.success) {
      if (result.message.includes("Tempo limite")) {
        this.analysisResultEl.createDiv({
          text: "A análise excedeu o tempo limite. Podes aumentar o tempo nas definições ou tentar novamente.",
          attr: { style: "color: var(--text-error); padding: 8px 0;" }
        });
      } else if (result.message.includes("model")) {
        this.analysisResultEl.createDiv({
          text: `Modelo "${model}" não encontrado no Ollama. Verifica se o modelo está disponível.`,
          attr: { style: "color: var(--text-error); padding: 8px 0;" }
        });
      } else {
        this.analysisResultEl.createDiv({
          text: `Erro ao analisar nota: ${result.message}`,
          attr: { style: "color: var(--text-error); padding: 8px 0;" }
        });
      }
      this.analysisResultEl.createDiv({
        text: "Podes tentar novamente clicando em 'Analisar nota atual com contexto'.",
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

    this.processAIResponse(result.text, path, relatedNotes.map(n => n.path), relatedNotes.length, relatedNotes);
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
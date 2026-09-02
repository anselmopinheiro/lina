/**
 * Companion Architecture Foundation (Phases 0.4.x & 0.4.1)
 *
 * Central export for Companion Delta Search capability, consumption state, and query layers.
 */

export {
  type CompanionCapability,
  type EvaluateCompanionCapabilityOptions,
  evaluateCompanionCapability,
  isCompanionRole,
} from "./companionCapability";

export {
  type ArtifactFreshness,
  type CompanionConsumptionMode,
  type CompanionArtifactAvailability,
  type CompanionEmbeddingState,
  type CompanionArtifactConsumptionState,
  type BuildCompanionConsumptionInput,
  evaluateCompanionConsumptionState,
  readCompanionConsumptionState,
} from "./companionConsumptionState";

export {
  type CompanionSearchMode,
  type CompanionSearchOptions,
  type CompanionSearchInput,
  type CompanionQueryResult,
  type CompanionSearchResult,
  executeCompanionTextSearch,
  executeCompanionSemanticSearch,
  executeCompanionSearch,
} from "./companionSearch";

export {
  type LocalDeltaType,
  type LocalDeltaNote,
  type LocalDeltaScanResult,
  type LocalDeltaSearchState,
  type FusedSearchResultItem,
  type FusedSearchRunResult,
  type DetectLocalDeltaInput,
  type BuildLocalDeltaSearchStateOptions,
  type SearchOptions as DeltaSearchOptions,
  type CompanionSearchWithDeltaInput,
  detectLocalDelta,
  buildLocalDeltaSearchState,
  executeLocalDeltaSearch,
  fuseSearchResults,
  executeCompanionSearchWithDelta,
} from "./companionDeltaSearch";


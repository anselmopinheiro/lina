/**
 * Infraestrutura simples de internacionalização (i18n) para o Lina.
 *
 * - Português europeu (pt-PT) é o idioma por defeito e fallback.
 * - Inglês (en) é o segundo idioma suportado.
 * - As notas, títulos, H1 e nomes de ficheiro NUNCA são traduzidos.
 * - Chaves técnicas (providers, modelos, prefixos) NUNCA são traduzidos.
 */

import { InterfaceLanguage } from "../settings";

// -----------------------------------------------------------------------
// Interface de tipagem para as chaves de strings
// -----------------------------------------------------------------------

export interface UiStrings {
  // Geral
  pluginName: string;
  pluginDescription: string;
  mainRibbonOpenLina: string;
  mainCommandSearch: string;
  mainCommandRebuildTextIndex: string;
  mainCommandShowIndexState: string;
  mainCommandSearchTextIndex: string;
  mainCommandGenerateLocalEmbeddings: string;
  mainCommandShowEmbeddingsState: string;
  mainCommandSemanticSearch: string;
  mainCommandShowIndexDiagnostic: string;
  mainNoticeLinaLoaded: string;
  mainNoticeTextIndexLoadErrorPrefix: string;
  mainNoticeOpenLinaErrorPrefix: string;
  mainNoticeOpenSideSearchErrorPrefix: string;
  mainNoticeRebuildingTextIndex: string;
  mainNoticeRebuildTextIndexErrorPrefix: string;
  mainNoticeReadTextIndexStateErrorPrefix: string;
  mainNoticeTextIndexEmpty: string;
  mainNoticeSearchTextIndexErrorPrefix: string;
  mainNoticeGenerateEmbeddingsErrorPrefix: string;
  mainNoticeNoLocalEmbeddings: string;
  mainNoticeReadEmbeddingsStateErrorPrefix: string;
  mainNoticeOllamaUrlMissing: string;
  mainNoticeOpenSemanticSearchErrorPrefix: string;
  mainNoticeOpenIndexDiagnosticErrorPrefix: string;

  // Secções principais
  sectionSearch: string;
  sectionQuickActions: string;
  sectionState: string;
  sectionResults: string;

  // Pesquisa
  searchPlaceholder: string;
  searchButton: string;
  searchTextual: string;
  searchSemantic: string;
  searchHybrid: string;
  searchNoResults: string;
  searchSelectMode: string;
  searchInProgress: string;

  // Resultados
  resultsTitle: string;
  resultsClose: string;
  resultsNoResults: string;

  // Ações rápidas
  actionAnalyseNote: string;
  actionAnalyseWithContext: string;
  actionAnalyseInbox: string;

  // Painel Estado — resumo
  stateIndexReady: string;
  stateIndexMissing: string;
  stateEmbeddingsReady: string;
  stateEmbeddingsMissing: string;
  stateEmbeddingsOutdated: string;
  stateEmbeddingsIncompatible: string;
  stateEmbeddingsAttention: string;
  stateEmbeddingsValid: string;
  stateEmbeddingsMissingCount: string;
  stateEmbeddingsOutdatedCount: string;
  stateSemanticAvailable: string;
  stateSemanticUnavailable: string;
  stateNotesLabel: string;
  stateChunksLabel: string;
  stateUnknown: string;
  stateNotDefined: string;
  stateSemanticReasonNoEmbeddings: string;
  stateSemanticReasonIncompleteMetadata: string;
  stateSemanticReasonDeviceMismatch: string;
  stateSemanticReasonCompatibilityError: string;

  // Painel Estado — detalhes
  detailsShow: string;
  detailsHide: string;
  detailsAutoUpdate: string;
  detailsAutoUpdateActive: string;
  detailsAutoUpdateInactive: string;
  detailsTextIndex: string;
  detailsTextIndexReady: string;
  detailsTextIndexMissing: string;
  detailsIndexedNotes: string;
  detailsTextChunks: string;
  detailsLastIndexUpdate: string;
  detailsEmbeddings: string;
  detailsEmbeddingsValid: string;
  detailsEmbeddingsMissing: string;
  detailsEmbeddingsOutdated: string;
  detailsProvider: string;
  detailsModel: string;
  detailsDimension: string;
  detailsPrefixMode: string;
  detailsQueryPrefix: string;
  detailsDocumentPrefix: string;
  detailsManifestPrefixMode: string;
  detailsLastEmbeddingUpdate: string;
  detailsPrefixNone: string;
  detailsPrefixNomic: string;
  detailsDeviceProvider: string;
  detailsDeviceModel: string;
  detailsEmbeddingOnlyTextual: string;

  // Avisos de compatibilidade
  warnProviderMismatch: string;
  warnModelMismatch: string;
  warnPrefixMismatch: string;
  warnEmbeddingsMissing: string;
  warnEmbeddingsOutdated: string;
  warnEmbeddingsCompatible: string;

  // Botões de índice
  btnRebuildIndex: string;
  btnBuildIndex: string;
  btnGenerateEmbeddings: string;
  btnUpdateEmbeddings: string;

  // Toasts e mensagens de embeddings
  toastGeneratingEmbeddings: string;
  toastEmbeddingsSuccess: string;
  toastEmbeddingsError: string;
  toastEmbeddingsAlreadyRunning: string;
  statusGeneratingEmbeddings: string;
  statusEmbeddingsSuccess: string;
  statusEmbeddingsError: string;
  statusEmbeddingsPartial: string;
  statusEmbeddingsErrorPrefix: string;
  statusBuildingIndex: string;
  statusIndexBuilt: string;
  statusIndexError: string;

  // Pesquisa semântica — mensagens
  semanticNoEmbeddings: string;
  semanticProviderMismatch: string;
  semanticModelMismatch: string;
  semanticPrefixMismatch: string;
  semanticDimensionMismatch: string;
  semanticEmbeddingError: string;
  semanticLoadingEmbeddings: string;
  semanticNoChunks: string;
  semanticGeneratingQuery: string;
  semanticComparing: string;

  // Pesquisa híbrida — mensagens
  hybridSemanticUnavailable: string;
  hybridSemanticUnavailableReason: string;
  hybridTextOnly: string;

  // Origens de resultados
  originText: string;
  originSemantic: string;
  originHybrid: string;
  originSource: string;
  originFoundIn: string;
  originFileName: string;
  originFilePath: string;
  originFileContent: string;
  originNote: string;
  originMetadataMatch: string;
  originNameMatch: string;

  // Análise IA
  analysisTitleCurrentNote: string;
  analysisTitleWithContext: string;
  analysisTitleInbox: string;
  analysisAnalysingNote: string;
  analysisAnalysingWithContext: string;
  analysisAnalysingInbox: string;
  analysisNoFile: string;
  analysisNonMarkdown: string;
  analysisEmptyNote: string;
  analysisRetryLabel: string;
  analysisExcludedByUserRules: string;
  analysisContextExcludedByUserRules: string;
  analysisTimeout: string;
  analysisModelError: string;
  analysisGenericError: string;
  analysisEmptyResponse: string;
  analysisNoteNoLongerExists: string;
  analysisErrorReading: string;
  analysisTimeoutMessage: string;
  analysisModelNotFound: string;
  analysisErrorPrefix: string;
  analysisRetryInstruction: string;
  analysisNoteName: string;
  analysisClosePanel: string;
  analysisStructuralWarning: string;
  analysisCopyResponse: string;
  analysisCopySuccess: string;
  analysisCopyError: string;
  analysisSuggestedMetadata: string;
  analysisCopySuggestedMetadata: string;
  analysisCopyYaml: string;
  analysisCopyTags: string;
  analysisCopyMetadataSuccess: string;
  analysisApplyMetadataToActiveNote: string;
  analysisPreservedMetadataNotice: string;
  analysisConfirmApplyPreservedMetadata: string;
  analysisPreservedMetadataApplied: string;
  analysisNoPreservedMetadataChanges: string;

  // Multilingue — definições
  settingsMultilingual: string;
  settingsMultilingualDescription: string;
  settingsInterfaceLanguage: string;
  settingsInterfaceLanguageDescription: string;
  settingsEmbeddingLanguage: string;
  settingsEmbeddingLanguageDescription: string;
  langPtPT: string;
  langEn: string;
  langEs: string;
  langFr: string;
  langMulti: string;
  langAuto: string;

  // Confirmar aplicação
  confirmApplyTitle: string;
  confirmApplyIntro: string;
  confirmApplyWarning: string;
  confirmApplyWarningRename: string;
  confirmApplyWarningMove: string;
  confirmApplyButton: string;
  confirmCancelButton: string;

  // Confirmar reinserção de conteúdo IA
  confirmReinsertAiTitle: string;
  confirmReinsertAiIntro: string;
  confirmReinsertAiWarning: string;
  confirmReinsertAiButton: string;

  // Confirmar mover nota
  confirmMoveTitle: string;
  confirmMoveIntro: string;
  confirmMoveWarning: string;
  confirmMoveButton: string;
  confirmMoveCurrentName: string;
  confirmMoveCurrentFolder: string;
  confirmMoveDestinationFolder: string;
  confirmMoveFinalPath: string;

  // Inbox
  inboxAnalysing: string;
  inboxAnalyseButton: string;
  inboxAnalyseWithContextButton: string;
  inboxMoveButton: string;
  inboxConfigMissing: string;
  inboxFolderMissing: string;
  inboxNoNotes: string;
  inboxResultsTitle: string;
  inboxResultsSummary: string;
  inboxDestination: string;
  inboxSuggestedFolder: string;
  inboxFolderStatus: string;
  inboxFolderCanMove: string;
  inboxSynthesis: string;
  inboxSuggestedTitle: string;
  inboxType: string;
  inboxTopic: string;
  inboxTags: string;
  inboxYaml: string;
  inboxSummary: string;
  inboxTasks: string;
  inboxLimitations: string;
  inboxSuggestedLinks: string;
  inboxAnalyse: string;
  inboxAnalyseWithContext: string;
  inboxMove: string;
  inboxNoSuggestedFolder: string;

  // Erros gerais
  errorNoteNotFound: string;
  errorFileNotMarkdown: string;
  errorIndexNotReady: string;
  errorNoteNoLongerExists: string;
  errorTargetNotMarkdown: string;
  errorNoAnalysisAvailable: string;
  errorTargetNoteGone: string;
  errorNoteSelectedGone: string;
  errorCouldNotStructureResponse: string;
  errorOpenNotePrefix: string;
  errorMoveNotePrefix: string;
  operationCancelledNoMove: string;

  // Embeddings — botões e estados
  btnGenerateEmbeddingsLabel: string;
  btnUpdateEmbeddingsLabel: string;
  statusGeneratingLabel: string;
  statusAnalysisComplete: string;
  statusAnalysingSelected: string;
  warnHybridTextOnly: string;

  // Pasta sugerida
  folderSuggested: string;
  folderStatusPrefix: string;
  folderMoveToSuggested: string;

  // Aplicar sugestões
  suggestionsApplied: string;
  noAnalysisToApply: string;
  noItemSelected: string;
  titleEmptyNoRename: string;
  noSafeNameGenerated: string;
  suggestedNameSameAsCurrent: string;
  fileAlreadyExistsInFolder: string;
  folderNotValid: string;
  folderNotExists: string;
  folderAutoCreateNotAllowed: string;
  noteAlreadyInFolder: string;
  fileAlreadyExistsDestNoRename: string;
  fileAlreadyExistsFolderNoRename: string;
  operationCancelledNoChange: string;
  fileAlreadyExistsDestNoMove: string;
  fileRenamedSuccess: string;
  noteMovedSuccess: string;
  applySuggestionsErrorPrefix: string;

  // Avisos sensíveis
  inboxExcludedByUserRules: string;

  // Análise Inbox — detalhes
  inboxDetailDestination: string;
  inboxDetailFolderStatus: string;
  inboxDetailConfidence: string;
  inboxDetailActions: string;
  inboxDetailSynthesis: string;
  inboxDetailSuggestedTitle: string;
  inboxDetailType: string;
  inboxDetailTopic: string;
  inboxDetailTags: string;
  inboxDetailYaml: string;
  inboxDetailSummary: string;
  inboxDetailTasks: string;
  inboxDetailLimitations: string;
  inboxDetailLinks: string;

  // Definições — secções e opções
  settingsTitle: string;
  settingsDescription: string;
  settingsSupportText: string;
  settingsDeviceSection: string;
  settingsDeviceDescription: string;
  settingsDeviceName: string;
  settingsDeviceNamePlaceholder: string;
  settingsAnalysisSection: string;
  settingsProvider: string;
  settingsProviderNotImplemented: string;
  settingsModel: string;
  settingsBaseUrl: string;
  settingsApiKey: string;
  settingsApiKeyDescription: string;
  settingsApiKeyPlaceholder: string;
  settingsApiKeyLocalSaved: string;
  settingsTimeout: string;
  settingsTimeoutDesc: string;
  settingsTestConnection: string;
  settingsTestingConnection: string;
  settingsConnectionSuccess: string;
  settingsConnectionFailed: string;
  settingsConnectionEmptyResponse: string;
  settingsApiKeyMissing: string;
  settingsBaseUrlMissing: string;
  settingsModelMissing: string;
  settingsConnectionErrorPrefix: string;
  settingsProviderNotImplementedTest: string;
  settingsEmbeddingsSection: string;
  settingsEnableEmbeddings: string;
  settingsEnableEmbeddingsDesc: string;
  settingsBatchSize: string;
  settingsBatchSizeDesc: string;
  settingsInboxSection: string;
  settingsInboxFolder: string;
  settingsInboxFolderDesc: string;
  settingsInboxMaxNotes: string;
  settingsInboxMaxNotesDesc: string;
  settingsIndexSection: string;
  settingsCheckSyncOnStartup: string;
  settingsCheckSyncOnStartupDesc: string;
  settingsUpdateIndexOnStartup: string;
  settingsUpdateIndexOnStartupDesc: string;
  settingsAutoUpdateIndex: string;
  settingsAutoUpdateIndexDesc: string;
  settingsDebugIndex: string;
  settingsDebugIndexDesc: string;
  settingsExclusionsSection: string;
  settingsExcludedFolders: string;
  settingsExcludedFoldersDesc: string;
  settingsExcludedTerms: string;
  settingsExcludedTermsDesc: string;
  settingsExcludedContentTerms: string;
  settingsExcludedContentTermsDesc: string;
  settingsExclusionsNote: string;
  settingsHybridSection: string;
  settingsTextWeight: string;
  settingsTextWeightDesc: string;
  settingsSemanticWeight: string;
  settingsSemanticWeightDesc: string;
  settingsYamlSection: string;
  settingsYamlEnabled: string;
  settingsYamlEnabledDesc: string;
  settingsYamlProperties: string;
  settingsYamlPropertiesDesc: string;
  settingsYamlIncludeTags: string;
  settingsYamlIncludeTagsDesc: string;
  settingsMaxTags: string;
  settingsMaxTagsDesc: string;
  settingsSupportSection: string;
  settingsSupportDescription: string;
  settingsSupportLink: string;

  // Pesquisa semântica (modal antiga/diagnóstico)
  semanticModalTitle: string;
  semanticModalPlaceholder: string;
  semanticStatusLoadingEmbeddingState: string;
  semanticEmbeddingsUnavailableGenerate: string;
  semanticEmbeddingsMissingGenerate: string;
  semanticConfiguredFor: string;
  semanticUpdateBeforeUse: string;
  semanticQueryDimensionMismatch: string;

  // Diagnóstico semântico (modal)
  diagnosticTitle: string;
  diagnosticQueryLabel: string;
  diagnosticProviderLabel: string;
  diagnosticModelLabel: string;
  diagnosticDimensionLabel: string;
  diagnosticPrefixModeLabel: string;
  diagnosticQueryPrefixLabel: string;
  diagnosticDocPrefixLabel: string;
  diagnosticPrefixModeValue: string;
  diagnosticPrefixNone: string;
  diagnosticPrefixNomic: string;
  diagnosticTotalEvaluated: string;
  diagnosticValidEmbeddings: string;
  diagnosticFinalResults: string;
  diagnosticThresholdLabel: string;
  diagnosticScoreLabel: string;
  diagnosticRawTop10: string;
  diagnosticPassedThreshold: string;
  diagnosticDidNotPassThreshold: string;
  diagnosticYes: string;
  diagnosticNo: string;
  diagnosticNoRawResults: string;
  diagnosticNonePassedThreshold: string;

  // Renomeação
  renameFile: string;
  renameSuggestedTitle: string;
  renameUpdateH1: string;
  renameRenameFile: string;
  renameMoveNote: string;
  renameApplySelected: string;
  renameNoSelection: string;
  renameEmptyTitle: string;
  renameInvalidFileName: string;
  renameSameName: string;
  renameAlreadyExists: string;
  renameFolderInvalid: string;
  renameFolderNotExists: string;
  renameAlreadyInFolder: string;
  renameSuccess: string;
  renameMoveSuccess: string;
  renameCancelled: string;

  // Estruturado — pré-visualização
  previewSelectItems: string;
  previewCheckboxExplanation: string;
  previewRelatedNotesUsed: string;
  previewSuggestedTitle: string;
  previewSuggestedFolder: string;
  previewYamlSuggested: string;
  previewYamlDisabled: string;
  previewTagsSuggested: string;
  previewInternalLinks: string;
  previewOtherRelatedNotes: string;
  previewTasksDetected: string;
  previewAnalysis: string;
  previewSummary: string;
  previewConfidence: string;
  previewLimitations: string;
  previewApplyButton: string;
  previewNoItems: string;
  previewNoTags: string;
  previewNoLinks: string;
  previewNoRelated: string;
  previewNoTasks: string;
  previewYamlAlreadyExists: string;
  previewYamlConflict: string;
  previewYamlNew: string;
  previewTagNew: string;
  previewTagExisting: string;
  previewFolderStatus: string;
  previewFolderExisting: string;
  previewFolderNew: string;
  previewFolderInbox: string;
  previewFolderCurrent: string;
  relatedOriginLabel: string;
  relatedScoreLabel: string;
  relatedReasonLabel: string;
  relatedSourceTextual: string;
  relatedSourceSemantic: string;
  relatedSourceHybrid: string;
  relatedReasonTitle: string;
  relatedReasonPath: string;
  relatedReasonContent: string;
  relatedReasonSimilarContent: string;
  relatedReasonSameFolder: string;
  relatedReasonSameArea: string;
}

// -----------------------------------------------------------------------
// Português europeu (idioma por defeito)
// -----------------------------------------------------------------------

const PT_PT: UiStrings = {
  pluginName: "Lina",
  pluginDescription: "Assistente para Obsidian focado em pesquisa, organização e enriquecimento de notas Markdown.",
  mainRibbonOpenLina: "Abrir Lina",
  mainCommandSearch: "Pesquisar",
  mainCommandRebuildTextIndex: "Reconstruir índice textual",
  mainCommandShowIndexState: "Mostrar estado do índice",
  mainCommandSearchTextIndex: "Pesquisar no índice textual",
  mainCommandGenerateLocalEmbeddings: "Gerar embeddings locais",
  mainCommandShowEmbeddingsState: "Mostrar estado dos embeddings",
  mainCommandSemanticSearch: "Pesquisar semanticamente",
  mainCommandShowIndexDiagnostic: "Mostrar diagnóstico do índice",
  mainNoticeLinaLoaded: "Lina carregado.",
  mainNoticeTextIndexLoadErrorPrefix: "Erro ao carregar índice textual",
  mainNoticeOpenLinaErrorPrefix: "Erro ao abrir Lina",
  mainNoticeOpenSideSearchErrorPrefix: "Erro ao abrir pesquisa lateral",
  mainNoticeRebuildingTextIndex: "A reconstruir índice textual e blocos...",
  mainNoticeRebuildTextIndexErrorPrefix: "Erro ao reconstruir índice textual",
  mainNoticeReadTextIndexStateErrorPrefix: "Erro ao ler estado do índice textual",
  mainNoticeTextIndexEmpty: "Índice textual ainda não carregado ou vazio. Tenta reconstruir o índice se for a primeira vez.",
  mainNoticeSearchTextIndexErrorPrefix: "Erro ao pesquisar no índice textual",
  mainNoticeGenerateEmbeddingsErrorPrefix: "Erro ao gerar embeddings locais",
  mainNoticeNoLocalEmbeddings: "Ainda não existem embeddings locais. Gera primeiro com 'Gerar embeddings locais'.",
  mainNoticeReadEmbeddingsStateErrorPrefix: "Erro ao ler estado dos embeddings",
  mainNoticeOllamaUrlMissing: "URL do Ollama não configurada. Define nas definições do plugin.",
  mainNoticeOpenSemanticSearchErrorPrefix: "Erro ao abrir pesquisa semântica",
  mainNoticeOpenIndexDiagnosticErrorPrefix: "Erro ao abrir diagnóstico do índice",

  sectionSearch: "Pesquisa",
  sectionQuickActions: "Ações rápidas",
  sectionState: "Estado",
  sectionResults: "Resultados",

  searchPlaceholder: "Escreve o que queres procurar...",
  searchButton: "Pesquisar",
  searchTextual: "Pesquisa textual",
  searchSemantic: "Pesquisa semântica",
  searchHybrid: "Pesquisa híbrida",
  searchNoResults: "Sem resultados.",
  searchSelectMode: "Seleciona um tipo de pesquisa.",
  searchInProgress: "A pesquisar...",

  resultsTitle: "Resultados da pesquisa",
  resultsClose: "Fechar resultados",
  resultsNoResults: "Sem resultados.",

  actionAnalyseNote: "Analisar nota atual",
  actionAnalyseWithContext: "Analisar com notas relacionadas",
  actionAnalyseInbox: "Analisar inbox",

  stateIndexReady: "Índice: pronto",
  stateIndexMissing: "Índice: em falta",
  stateEmbeddingsReady: "prontos",
  stateEmbeddingsMissing: "em falta",
  stateEmbeddingsOutdated: "desatualizados",
  stateEmbeddingsIncompatible: "desatualizados ou incompatíveis",
  stateEmbeddingsAttention: "atenção necessária",
  stateEmbeddingsValid: "válidos",
  stateEmbeddingsMissingCount: "em falta",
  stateEmbeddingsOutdatedCount: "desatualizados",
  stateSemanticAvailable: "Semântica: disponível",
  stateSemanticUnavailable: "Semântica: indisponível",
  stateNotesLabel: "notas",
  stateChunksLabel: "blocos",
  stateUnknown: "desconhecido",
  stateNotDefined: "não definido",
  stateSemanticReasonNoEmbeddings: "Embeddings não existem ou estão vazios.",
  stateSemanticReasonIncompleteMetadata: "Metadados dos embeddings do índice estão incompletos.",
  stateSemanticReasonDeviceMismatch: "Provider ou modelo do dispositivo não é compatível com o índice.",
  stateSemanticReasonCompatibilityError: "Erro ao verificar compatibilidade",

  detailsShow: "Ver detalhes",
  detailsHide: "Ocultar detalhes",
  detailsAutoUpdate: "Atualização automática",
  detailsAutoUpdateActive: "ativa",
  detailsAutoUpdateInactive: "inativa",
  detailsTextIndex: "Índice textual",
  detailsTextIndexReady: "pronto",
  detailsTextIndexMissing: "em falta",
  detailsIndexedNotes: "Notas indexadas",
  detailsTextChunks: "Blocos textuais",
  detailsLastIndexUpdate: "Última atualização do índice",
  detailsEmbeddings: "Embeddings:",
  detailsEmbeddingsValid: "Válidos",
  detailsEmbeddingsMissing: "Em falta",
  detailsEmbeddingsOutdated: "Desatualizados",
  detailsProvider: "Provider",
  detailsModel: "Modelo",
  detailsDimension: "Dimensão",
  detailsPrefixMode: "Modo de prefixo",
  detailsQueryPrefix: "Prefixo da query",
  detailsDocumentPrefix: "Prefixo dos documentos",
  detailsManifestPrefixMode: "Modo guardado no manifesto",
  detailsLastEmbeddingUpdate: "Última atualização",
  detailsPrefixNone: "Nenhum",
  detailsPrefixNomic: "Nomic search_query/search_document",
  detailsDeviceProvider: "Provider configurado no dispositivo",
  detailsDeviceModel: "Modelo configurado no dispositivo",
  detailsEmbeddingOnlyTextual: "A pesquisa híbrida será feita apenas com o índice textual enquanto não existirem embeddings.",

  warnProviderMismatch: "Atenção: os embeddings foram gerados com outro provider. Atualize os embeddings antes de usar a pesquisa semântica.",
  warnModelMismatch: "Atenção: os embeddings foram gerados com outro modelo. Atualize os embeddings antes de usar a pesquisa semântica.",
  warnPrefixMismatch: "Atenção: os embeddings foram gerados com outro modo de prefixo. Atualize os embeddings.",
  warnEmbeddingsMissing: "Existem embeddings em falta. Algumas notas recentes podem não aparecer na pesquisa semântica ou híbrida.",
  warnEmbeddingsOutdated: "Existem embeddings desatualizados. Atualize os embeddings para garantir resultados corretos.",
  warnEmbeddingsCompatible: "Embeddings compatíveis com a configuração atual.",

  btnRebuildIndex: "Reconstruir índice textual",
  btnBuildIndex: "Construir índice textual",
  btnGenerateEmbeddings: "Gerar embeddings locais",
  btnUpdateEmbeddings: "Atualizar embeddings locais",

  toastGeneratingEmbeddings: "A gerar embeddings locais...",
  toastEmbeddingsSuccess: "Embeddings locais gerados com sucesso.",
  toastEmbeddingsError: "Não foi possível gerar os embeddings locais. Verifique o provider de embeddings.",
  toastEmbeddingsAlreadyRunning: "A geração de embeddings já está em curso.",
  statusGeneratingEmbeddings: "A gerar embeddings locais...",
  statusEmbeddingsSuccess: "Embeddings locais gerados com sucesso.",
  statusEmbeddingsError: "Não foi possível gerar os embeddings locais. Verifique o provider de embeddings.",
  statusEmbeddingsPartial: "A geração de embeddings terminou, mas ainda existem embeddings em falta ou desatualizados.",
  statusEmbeddingsErrorPrefix: "Erro ao gerar embeddings",
  statusBuildingIndex: "A construir índice textual...",
  statusIndexBuilt: "Índice textual construído com sucesso.",
  statusIndexError: "Erro ao construir índice textual.",

  semanticNoEmbeddings: "Embeddings locais indisponíveis ou inválidos. Gera embeddings primeiro nas definições do Lina.",
  semanticProviderMismatch: "Os embeddings foram gerados com o provider",
  semanticModelMismatch: "Os embeddings foram gerados com o modelo",
  semanticPrefixMismatch: "Os embeddings foram gerados com modo de prefixo diferente. Atualiza os embeddings antes de usar a pesquisa semântica.",
  semanticDimensionMismatch: "Incompatibilidade de dimensão nos embeddings. Atualiza os embeddings antes de usar a pesquisa semântica.",
  semanticEmbeddingError: "Erro na pesquisa semântica: a geração do embedding falhou. Verifica o provider de embeddings",
  semanticLoadingEmbeddings: "A carregar embeddings locais...",
  semanticNoChunks: "Chunks não encontrados. Reconstrói o índice textual primeiro.",
  semanticGeneratingQuery: "A gerar embedding da pesquisa...",
  semanticComparing: "A comparar com os embeddings locais...",

  hybridSemanticUnavailable: "A componente semântica da pesquisa híbrida não está disponível.",
  hybridSemanticUnavailableReason: "Foram usados apenas resultados textuais.",
  hybridTextOnly: "Foram usados apenas resultados textuais.",

  originText: "texto",
  originSemantic: "semântica",
  originHybrid: "texto + semântica",
  originSource: "Origem",
  originFoundIn: "Encontrado em:",
  originFileName: "nome da nota",
  originFilePath: "caminho da nota",
  originFileContent: "conteúdo da nota",
  originNote: "Encontrado na nota",
  originMetadataMatch: "Correspondência encontrada nos metadados da nota.",
  originNameMatch: "Correspondência encontrada no nome da nota.",

  analysisTitleCurrentNote: "IA — nota atual",
  analysisTitleWithContext: "IA — nota atual com contexto",
  analysisTitleInbox: "IA — análise da Inbox",
  analysisAnalysingNote: "A analisar nota atual...",
  analysisAnalysingWithContext: "A analisar nota atual com contexto...",
  analysisAnalysingInbox: "A analisar notas da Inbox...",
  analysisNoFile: "Nenhuma nota aberta. Abre uma nota Markdown primeiro.",
  analysisNonMarkdown: "O ficheiro ativo não é Markdown. Abre uma nota .md para analisar.",
  analysisEmptyNote: "A nota atual está vazia. Não há conteúdo para analisar.",
  analysisRetryLabel: "Analisar nota atual",
  analysisExcludedByUserRules: "Esta nota contém termos excluídos configurados pelo utilizador. A análise foi bloqueada e nada foi enviado para IA.",
  analysisContextExcludedByUserRules: "Algumas notas relacionadas foram omitidas por regras de exclusão configuradas pelo utilizador.",
  analysisTimeout: "A análise excedeu o tempo limite. Podes aumentar o tempo nas definições ou tentar novamente.",
  analysisModelError: "Modelo não encontrado. Verifica se o modelo está disponível no perfil ativo.",
  analysisGenericError: "Erro ao analisar nota",
  analysisEmptyResponse: "A IA devolveu uma resposta vazia. Tenta novamente.",
  analysisNoteNoLongerExists: "A nota selecionada já não existe no vault.",
  analysisErrorReading: "Erro ao ler a nota",
  analysisTimeoutMessage: "A análise excedeu o tempo limite. Podes aumentar o tempo nas definições ou tentar novamente.",
  analysisModelNotFound: "Modelo não encontrado. Verifica se o modelo está disponível no perfil ativo.",
  analysisErrorPrefix: "Erro ao analisar nota",
  analysisRetryInstruction: "Podes tentar novamente clicando em",
  analysisNoteName: "Nota analisada",
  analysisClosePanel: "Fechar análise",
  analysisStructuralWarning: "Não foi possível estruturar automaticamente a resposta. A resposta textual foi apresentada sem seleção interativa.",
  analysisCopyResponse: "Copiar resposta",
  analysisCopySuccess: "Resposta copiada para a área de transferência.",
  analysisCopyError: "Não foi possível copiar a resposta.",
  analysisSuggestedMetadata: "Metadados sugeridos",
  analysisCopySuggestedMetadata: "Copiar metadados",
  analysisCopyYaml: "Copiar YAML",
  analysisCopyTags: "Copiar tags",
  analysisCopyMetadataSuccess: "Metadados copiados para a área de transferência.",
  analysisApplyMetadataToActiveNote: "Aplicar metadados",
  analysisPreservedMetadataNotice: "Estes metadados foram preservados de uma análise anterior.",
  analysisConfirmApplyPreservedMetadata: "Estes metadados foram preservados de uma análise anterior. Pretende aplicar os YAML/tags selecionados à nota atualmente aberta?",
  analysisPreservedMetadataApplied: "Metadados aplicados à nota ativa.",
  analysisNoPreservedMetadataChanges: "Não havia novos metadados para aplicar.",

  settingsMultilingual: "Multilingue",
  settingsMultilingualDescription: "Estas opções não traduzem notas, títulos ou nomes de ficheiro. As notas mantêm o idioma em que foram escritas.",
  settingsInterfaceLanguage: "Idioma da interface",
  settingsInterfaceLanguageDescription: "Define o idioma dos textos do Lina. Esta opção não traduz notas, títulos ou nomes de ficheiro.",
  settingsEmbeddingLanguage: "Idioma predefinido dos embeddings",
  settingsEmbeddingLanguageDescription: "Indica o idioma principal esperado para os embeddings. Esta opção não traduz notas nem altera o conteúdo; serve para orientar a configuração e futura validação dos modelos.",
  langPtPT: "Português europeu",
  langEn: "English",
  langEs: "Espanhol",
  langFr: "Francês",
  langMulti: "Multilingue",
  langAuto: "Automático",

  confirmApplyTitle: "Aplicar sugestões à nota",
  confirmApplyIntro: "Vai aplicar à nota atual:",
  confirmApplyWarning: "Esta ação vai alterar o ficheiro Markdown atual. Continuar?",
  confirmApplyWarningRename: "Esta ação vai renomear o ficheiro Markdown atual. Continuar?",
  confirmApplyWarningMove: "Esta ação vai mover o ficheiro Markdown atual dentro do vault. Continuar?",
  confirmApplyButton: "Aplicar",
  confirmCancelButton: "Cancelar",

  confirmReinsertAiTitle: "Confirmar reinserção de conteúdo IA",
  confirmReinsertAiIntro: "Esta nota já contém conteúdo gerado pelo Lina.",
  confirmReinsertAiWarning: "Inserir novamente pode duplicar ou acumular informação (análise, tarefas, tags, YAML). Queres continuar?",
  confirmReinsertAiButton: "Continuar e inserir",

  confirmMoveTitle: "Mover nota",
  confirmMoveIntro: "Vai mover esta nota:",
  confirmMoveWarning: "Esta ação vai mover o ficheiro Markdown dentro do vault. Continuar?",
  confirmMoveButton: "Mover",
  confirmMoveCurrentName: "nome atual",
  confirmMoveCurrentFolder: "pasta atual",
  confirmMoveDestinationFolder: "pasta destino",
  confirmMoveFinalPath: "caminho final",

  inboxAnalysing: "A analisar notas da Inbox...",
  inboxAnalyseButton: "Analisar",
  inboxAnalyseWithContextButton: "Analisar com contexto",
  inboxMoveButton: "Mover",
  inboxConfigMissing: "Pasta Inbox não configurada.",
  inboxFolderMissing: "A pasta Inbox configurada não existe.",
  inboxNoNotes: "Não foram encontradas notas Markdown na Inbox.",
  inboxResultsTitle: "Análise da Inbox",
  inboxResultsSummary: "Análise concluída. Notas analisadas",
  inboxDestination: "Destino",
  inboxSuggestedFolder: "Pasta sugerida",
  inboxFolderStatus: "Estado da pasta sugerida",
  inboxFolderCanMove: "Pasta existente. Pode mover a nota.",
  inboxSynthesis: "Síntese",
  inboxSuggestedTitle: "Título sugerido",
  inboxType: "Tipo",
  inboxTopic: "Tema",
  inboxTags: "Tags",
  inboxYaml: "YAML sugerido",
  inboxSummary: "Resumo",
  inboxTasks: "Tarefas",
  inboxLimitations: "Limitações",
  inboxSuggestedLinks: "Links sugeridos",
  inboxAnalyse: "Analisar",
  inboxAnalyseWithContext: "Analisar com contexto",
  inboxMove: "Mover",
  inboxNoSuggestedFolder: "sem pasta sugerida",

  errorNoteNotFound: "Nota não encontrada no vault.",
  errorFileNotMarkdown: "O ficheiro alvo não é Markdown.",
  errorIndexNotReady: "Índice textual ainda não existe.",
  errorNoteNoLongerExists: "A nota alvo já não existe ou não está disponível.",
  errorTargetNotMarkdown: "O ficheiro alvo não é Markdown. Abre uma nota .md para aplicar sugestões.",
  errorNoAnalysisAvailable: "Nenhuma análise disponível para aplicar.",
  errorTargetNoteGone: "A nota alvo já não existe ou não está disponível.",
  errorNoteSelectedGone: "A nota selecionada já não existe no vault.",
  errorCouldNotStructureResponse: "Não foi possível estruturar automaticamente a resposta. A resposta textual foi apresentada sem seleção interativa.",
  errorOpenNotePrefix: "Erro ao abrir nota",
  errorMoveNotePrefix: "Erro ao mover nota",
  operationCancelledNoMove: "Operação cancelada. A nota não foi movida.",

  btnGenerateEmbeddingsLabel: "Gerar embeddings locais",
  btnUpdateEmbeddingsLabel: "Atualizar embeddings locais",
  statusGeneratingLabel: "A gerar...",
  statusAnalysisComplete: "Análise concluída.",
  statusAnalysingSelected: "A analisar nota selecionada...",
  warnHybridTextOnly: "A pesquisa híbrida será feita apenas com o índice textual enquanto não existirem embeddings.",

  folderSuggested: "Pasta sugerida",
  folderStatusPrefix: "Estado da pasta sugerida",
  folderMoveToSuggested: "Mover nota para a pasta sugerida",

  suggestionsApplied: "Sugestões aplicadas à nota.",
  noAnalysisToApply: "Nenhuma análise disponível para aplicar.",
  noItemSelected: "Nenhum item selecionado. Seleciona pelo menos um item antes de aplicar.",
  titleEmptyNoRename: "O título sugerido está vazio. O ficheiro não foi renomeado.",
  noSafeNameGenerated: "Não foi possível gerar um nome seguro para o ficheiro.",
  suggestedNameSameAsCurrent: "O nome sugerido é igual ao nome atual.",
  fileAlreadyExistsInFolder: "Já existe um ficheiro com esse nome nesta pasta.",
  folderNotValid: "A pasta sugerida não é válida.",
  folderNotExists: "A pasta sugerida não existe.",
  folderAutoCreateNotAllowed: "O Lina não cria pastas automaticamente nesta fase.",
  noteAlreadyInFolder: "A nota já está na pasta sugerida.",
  fileAlreadyExistsDestNoRename: "Já existe um ficheiro com esse nome nesta pasta. O ficheiro não foi renomeado.",
  fileAlreadyExistsFolderNoRename: "Já existe um ficheiro com esse nome na pasta de destino. A nota não foi movida.",
  operationCancelledNoChange: "Operação cancelada. A nota não foi alterada.",
  fileAlreadyExistsDestNoMove: "Já existe um ficheiro com este nome na pasta de destino.",
  fileRenamedSuccess: "Ficheiro renomeado com sucesso.",
  noteMovedSuccess: "Nota movida com sucesso.",
  applySuggestionsErrorPrefix: "Não foi possível aplicar as alterações",

  inboxExcludedByUserRules: "Nota ignorada por regras de exclusão configuradas pelo utilizador.",

  inboxDetailDestination: "Destino",
  inboxDetailFolderStatus: "Estado da pasta sugerida",
  inboxDetailConfidence: "Confiança",
  inboxDetailActions: "Ações",
  inboxDetailSynthesis: "Síntese",
  inboxDetailSuggestedTitle: "Título sugerido",
  inboxDetailType: "Tipo",
  inboxDetailTopic: "Tema",
  inboxDetailTags: "Tags",
  inboxDetailYaml: "YAML sugerido",
  inboxDetailSummary: "Resumo",
  inboxDetailTasks: "Tarefas",
  inboxDetailLimitations: "Limitações",
  inboxDetailLinks: "Links sugeridos",

  // Definições — secções e opções
  settingsTitle: "Lina",
  settingsDescription: "Assistente para Obsidian focado em pesquisa, organização e enriquecimento de notas Markdown.",
  settingsSupportText: "Se o Lina lhe for útil, pode apoiar o desenvolvimento através de Buy Me a Coffee.",
  settingsDeviceSection: "Dispositivo atual",
  settingsDeviceDescription: "Estas opções de IA são guardadas apenas neste dispositivo.",
  settingsDeviceName: "Nome deste dispositivo",
  settingsDeviceNamePlaceholder: "PC Ryzen, Surface antigo, Telemóvel...",
  settingsAnalysisSection: "Análise IA",
  settingsProvider: "Provider",
  settingsProviderNotImplemented: "Provider ainda não implementado nesta versão.",
  settingsModel: "Modelo",
  settingsBaseUrl: "URL base",
  settingsApiKey: "Chave API",
  settingsApiKeyDescription: "A chave API é guardada apenas neste dispositivo.",
  settingsApiKeyPlaceholder: "Introduzir chave API",
  settingsApiKeyLocalSaved: "Chave local guardada",
  settingsTimeout: "Tempo limite",
  settingsTimeoutDesc: "Segundos.",
  settingsTestConnection: "Testar ligação",
  settingsTestingConnection: "A testar ligação...",
  settingsConnectionSuccess: "Ligação testada com sucesso.",
  settingsConnectionFailed: "Não foi possível contactar o provider.",
  settingsConnectionEmptyResponse: "Resposta vazia do provider.",
  settingsApiKeyMissing: "Chave API em falta para este provider.",
  settingsBaseUrlMissing: "URL base em falta.",
  settingsModelMissing: "Modelo em falta.",
  settingsConnectionErrorPrefix: "Erro ao testar ligação",
  settingsProviderNotImplementedTest: "Provider ainda não implementado nesta versão.",
  settingsEmbeddingsSection: "Embeddings",
  settingsEnableEmbeddings: "Ativar embeddings",
  settingsEnableEmbeddingsDesc: "Permite gerar embeddings dos chunks para pesquisa semântica e híbrida.",
  settingsBatchSize: "Tamanho do lote",
  settingsBatchSizeDesc: "Número máximo de chunks a processar em cada execução.",
  settingsInboxSection: "Pasta Inbox",
  settingsInboxFolder: "Pasta Inbox",
  settingsInboxFolderDesc: "Pasta onde o Lina deve procurar notas para análise em lote. A pasta não é criada automaticamente.",
  settingsInboxMaxNotes: "Número máximo de notas da Inbox a analisar",
  settingsInboxMaxNotesDesc: "Limite de notas Markdown analisadas em cada execução. Valor entre 1 e 20.",
  settingsIndexSection: "Índice",
  settingsCheckSyncOnStartup: "Verificar sincronização ao iniciar",
  settingsCheckSyncOnStartupDesc: "Verifica se o índice está desatualizado quando o plugin é carregado, sem alterar o índice.",
  settingsUpdateIndexOnStartup: "Atualizar índice ao iniciar",
  settingsUpdateIndexOnStartupDesc: "Atualiza o índice de forma incremental quando o plugin é carregado, sem gerar embeddings.",
  settingsAutoUpdateIndex: "Atualizar índice automaticamente",
  settingsAutoUpdateIndexDesc: "Atualiza o índice textual quando notas Markdown são criadas, modificadas, apagadas ou renomeadas.",
  settingsDebugIndex: "Modo de diagnóstico do índice",
  settingsDebugIndexDesc: "Mostra informação de diagnóstico sobre eventos do vault e atualização automática do índice.",
  settingsExclusionsSection: "Exclusões do índice",
  settingsExcludedFolders: "Pastas excluídas",
  settingsExcludedFoldersDesc: "Uma pasta por linha. As notas dentro destas pastas não entram no índice do Lina.",
  settingsExcludedTerms: "Termos excluídos no caminho",
  settingsExcludedTermsDesc: "Um termo por linha. Se o caminho da nota contiver algum destes termos, a nota não entra no índice do Lina.",
  settingsExcludedContentTerms: "Termos excluídos no conteúdo",
  settingsExcludedContentTermsDesc: "Um termo por linha. Se o conteúdo da nota contiver algum destes termos, a nota não entra no índice, na pesquisa, nos embeddings nem nas análises por IA.",
  settingsExclusionsNote: "As pastas .lina/ e .obsidian/ são sempre excluídas automaticamente.",
  settingsHybridSection: "Pesquisa híbrida",
  settingsTextWeight: "Peso da pesquisa textual",
  settingsTextWeightDesc: "Peso usado na pontuação final da pesquisa híbrida. Valor entre 0 e 1.",
  settingsSemanticWeight: "Peso da pesquisa semântica",
  settingsSemanticWeightDesc: "Peso usado na pontuação final da pesquisa híbrida. Valor entre 0 e 1.",
  settingsYamlSection: "YAML / propriedades das notas",
  settingsYamlEnabled: "Ativar sugestão de YAML",
  settingsYamlEnabledDesc: "Permite que o Lina sugira YAML na análise de notas. Não altera notas; apenas mostra sugestões.",
  settingsYamlProperties: "Propriedades YAML permitidas",
  settingsYamlPropertiesDesc: "Lista de propriedades que o Lina pode sugerir no YAML. Separar por vírgulas.",
  settingsYamlIncludeTags: "Incluir tags dentro do YAML",
  settingsYamlIncludeTagsDesc: "Se ativo, o YAML sugerido inclui uma lista de tags. Não altera notas; apenas mostra sugestões.",
  settingsMaxTags: "Máximo de tags sugeridas",
  settingsMaxTagsDesc: "Número máximo de tags a sugerir no YAML e na lista de tags.",
  settingsSupportSection: "Apoiar o projeto",
  settingsSupportDescription: "O Lina é desenvolvido de forma independente. O apoio através de Buy Me a Coffee ajuda a manter o desenvolvimento do projeto.",
  settingsSupportLink: "Apoiar o projeto",

  semanticModalTitle: "Pesquisar semanticamente",
  semanticModalPlaceholder: "Escreve uma ideia, tema ou pergunta...",
  semanticStatusLoadingEmbeddingState: "A carregar estado dos embeddings...",
  semanticEmbeddingsUnavailableGenerate: "Embeddings locais indisponíveis ou inválidos. Gera embeddings antes de usar a pesquisa semântica.",
  semanticEmbeddingsMissingGenerate: "Embeddings locais ainda não existem. Gera embeddings primeiro.",
  semanticConfiguredFor: "mas a pesquisa está configurada para",
  semanticUpdateBeforeUse: "Atualiza os embeddings antes de usar a pesquisa semântica.",
  semanticQueryDimensionMismatch: "A dimensão do embedding da query não coincide com a dos embeddings locais. Os embeddings parecem desatualizados. Gera embeddings novamente.",

  diagnosticTitle: "Informação de diagnóstico",
  diagnosticQueryLabel: "Query pesquisada",
  diagnosticProviderLabel: "Provider de embeddings",
  diagnosticModelLabel: "Modelo de embeddings",
  diagnosticDimensionLabel: "Dimensão do embedding",
  diagnosticPrefixModeLabel: "Modo de prefixo",
  diagnosticQueryPrefixLabel: "Prefixo da query",
  diagnosticDocPrefixLabel: "Prefixo dos documentos",
  diagnosticPrefixModeValue: "Nomic search_query/search_document",
  diagnosticPrefixNone: "Nenhum",
  diagnosticPrefixNomic: "Nomic search_query/search_document",
  diagnosticTotalEvaluated: "Total de embeddings avaliados",
  diagnosticValidEmbeddings: "Embeddings válidos (dimensão correta)",
  diagnosticFinalResults: "Número de resultados finais apresentados",
  diagnosticThresholdLabel: "Limiar mínimo de similaridade",
  diagnosticScoreLabel: "Score",
  diagnosticRawTop10: "Top 10 resultados brutos (antes de aplicar threshold)",
  diagnosticPassedThreshold: "Passou o limiar",
  diagnosticDidNotPassThreshold: "Não passou o limiar",
  diagnosticYes: "Sim",
  diagnosticNo: "Não",
  diagnosticNoRawResults: "Nenhum resultado bruto disponível.",
  diagnosticNonePassedThreshold: "Nenhum resultado passou o threshold mínimo. Todos os resultados brutos foram filtrados.",

  renameFile: "Renomear ficheiro",
  renameSuggestedTitle: "Título sugerido",
  renameUpdateH1: "Atualizar H1 da nota",
  renameRenameFile: "Renomear ficheiro",
  renameMoveNote: "Mover nota para a pasta sugerida",
  renameApplySelected: "Aplicar selecionados à nota",
  renameNoSelection: "Nenhum item selecionado. Seleciona pelo menos um item antes de aplicar.",
  renameEmptyTitle: "O título sugerido está vazio. O ficheiro não foi renomeado.",
  renameInvalidFileName: "Não foi possível gerar um nome seguro para o ficheiro.",
  renameSameName: "O nome sugerido é igual ao nome atual.",
  renameAlreadyExists: "Já existe um ficheiro com esse nome nesta pasta.",
  renameFolderInvalid: "A pasta sugerida não é válida.",
  renameFolderNotExists: "A pasta sugerida não existe.",
  renameAlreadyInFolder: "A nota já está na pasta sugerida.",
  renameSuccess: "Ficheiro renomeado com sucesso.",
  renameMoveSuccess: "Nota movida com sucesso.",
  renameCancelled: "Operação cancelada. A nota não foi alterada.",

  previewSelectItems: "Seleciona os itens que pretendes aplicar à nota.",
  previewCheckboxExplanation: "As checkboxes da pré-visualização significam apenas seleção para aplicar, não estado concluído.",
  previewRelatedNotesUsed: "Notas relacionadas usadas",
  previewSuggestedTitle: "Título sugerido",
  previewSuggestedFolder: "Pasta sugerida",
  previewYamlSuggested: "YAML sugerido",
  previewYamlDisabled: "YAML não ativado nas definições do Lina.",
  previewTagsSuggested: "Tags sugeridas",
  previewInternalLinks: "Links internos sugeridos",
  previewOtherRelatedNotes: "Outras notas relacionadas",
  previewTasksDetected: "Tarefas detetadas",
  previewAnalysis: "Análise",
  previewSummary: "Resumo",
  previewConfidence: "Grau de confiança",
  previewLimitations: "Limitações",
  previewApplyButton: "Aplicar selecionados à nota",
  previewNoItems: "Nenhuma tag sugerida.",
  previewNoTags: "Nenhuma tag sugerida.",
  previewNoLinks: "Não foram encontradas notas relacionadas suficientemente relevantes.",
  previewNoRelated: "Não há outras notas relacionadas além das sugeridas pela IA.",
  previewNoTasks: "Nenhuma tarefa detetada.",
  previewYamlAlreadyExists: "já existe",
  previewYamlConflict: "conflito",
  previewYamlNew: "novo",
  previewTagNew: "nova tag",
  previewTagExisting: "já usada",
  previewFolderStatus: "Estado da pasta sugerida",
  previewFolderExisting: "Pasta existente.",
  previewFolderNew: "Pasta inexistente na raiz do vault. O Lina não cria pastas automaticamente nesta fase.",
  previewFolderInbox: "Ignorada: a Inbox não deve ser usada como destino de organização.",
  previewFolderCurrent: "A nota já está na pasta sugerida.",
  relatedOriginLabel: "Origem",
  relatedScoreLabel: "Score",
  relatedReasonLabel: "Motivo",
  relatedSourceTextual: "textual",
  relatedSourceSemantic: "semântica",
  relatedSourceHybrid: "híbrida",
  relatedReasonTitle: "título",
  relatedReasonPath: "caminho",
  relatedReasonContent: "conteúdo",
  relatedReasonSimilarContent: "conteúdo semelhante",
  relatedReasonSameFolder: "mesma pasta",
  relatedReasonSameArea: "mesma área",
};

// -----------------------------------------------------------------------
// Inglês
// -----------------------------------------------------------------------

const EN: UiStrings = {
  pluginName: "Lina",
  pluginDescription: "Obsidian assistant focused on search, organisation and enrichment of Markdown notes.",
  mainRibbonOpenLina: "Open Lina",
  mainCommandSearch: "Search",
  mainCommandRebuildTextIndex: "Rebuild text index",
  mainCommandShowIndexState: "Show index state",
  mainCommandSearchTextIndex: "Search text index",
  mainCommandGenerateLocalEmbeddings: "Generate local embeddings",
  mainCommandShowEmbeddingsState: "Show embeddings state",
  mainCommandSemanticSearch: "Search semantically",
  mainCommandShowIndexDiagnostic: "Show index diagnostic",
  mainNoticeLinaLoaded: "Lina loaded.",
  mainNoticeTextIndexLoadErrorPrefix: "Error loading text index",
  mainNoticeOpenLinaErrorPrefix: "Error opening Lina",
  mainNoticeOpenSideSearchErrorPrefix: "Error opening side search",
  mainNoticeRebuildingTextIndex: "Rebuilding text index and chunks...",
  mainNoticeRebuildTextIndexErrorPrefix: "Error rebuilding text index",
  mainNoticeReadTextIndexStateErrorPrefix: "Error reading text index state",
  mainNoticeTextIndexEmpty: "Text index is not loaded yet or is empty. Try rebuilding the index if this is the first time.",
  mainNoticeSearchTextIndexErrorPrefix: "Error searching text index",
  mainNoticeGenerateEmbeddingsErrorPrefix: "Error generating local embeddings",
  mainNoticeNoLocalEmbeddings: "There are no local embeddings yet. Generate them first with 'Generate local embeddings'.",
  mainNoticeReadEmbeddingsStateErrorPrefix: "Error reading embeddings state",
  mainNoticeOllamaUrlMissing: "Ollama URL is not configured. Set it in plugin settings.",
  mainNoticeOpenSemanticSearchErrorPrefix: "Error opening semantic search",
  mainNoticeOpenIndexDiagnosticErrorPrefix: "Error opening index diagnostic",

  sectionSearch: "Search",
  sectionQuickActions: "Quick actions",
  sectionState: "Status",
  sectionResults: "Results",

  searchPlaceholder: "Write what you want to search for...",
  searchButton: "Search",
  searchTextual: "Text search",
  searchSemantic: "Semantic search",
  searchHybrid: "Hybrid search",
  searchNoResults: "No results.",
  searchSelectMode: "Select a search type.",
  searchInProgress: "Searching...",

  resultsTitle: "Search results",
  resultsClose: "Close results",
  resultsNoResults: "No results.",

  actionAnalyseNote: "Analyse current note",
  actionAnalyseWithContext: "Analyse with related notes",
  actionAnalyseInbox: "Analyse inbox",

  stateIndexReady: "Index: ready",
  stateIndexMissing: "Index: missing",
  stateEmbeddingsReady: "ready",
  stateEmbeddingsMissing: "missing",
  stateEmbeddingsOutdated: "outdated",
  stateEmbeddingsIncompatible: "outdated or incompatible",
  stateEmbeddingsAttention: "attention needed",
  stateEmbeddingsValid: "valid",
  stateEmbeddingsMissingCount: "missing",
  stateEmbeddingsOutdatedCount: "outdated",
  stateSemanticAvailable: "Semantic: available",
  stateSemanticUnavailable: "Semantic: unavailable",
  stateNotesLabel: "notes",
  stateChunksLabel: "chunks",
  stateUnknown: "unknown",
  stateNotDefined: "not defined",
  stateSemanticReasonNoEmbeddings: "Embeddings do not exist or are empty.",
  stateSemanticReasonIncompleteMetadata: "Index embedding metadata is incomplete.",
  stateSemanticReasonDeviceMismatch: "Device provider or model is not compatible with the index.",
  stateSemanticReasonCompatibilityError: "Error checking compatibility",

  detailsShow: "Show details",
  detailsHide: "Hide details",
  detailsAutoUpdate: "Auto-update",
  detailsAutoUpdateActive: "active",
  detailsAutoUpdateInactive: "inactive",
  detailsTextIndex: "Text index",
  detailsTextIndexReady: "ready",
  detailsTextIndexMissing: "missing",
  detailsIndexedNotes: "Indexed notes",
  detailsTextChunks: "Text chunks",
  detailsLastIndexUpdate: "Last index update",
  detailsEmbeddings: "Embeddings:",
  detailsEmbeddingsValid: "Valid",
  detailsEmbeddingsMissing: "Missing",
  detailsEmbeddingsOutdated: "Outdated",
  detailsProvider: "Provider",
  detailsModel: "Model",
  detailsDimension: "Dimension",
  detailsPrefixMode: "Prefix mode",
  detailsQueryPrefix: "Query prefix",
  detailsDocumentPrefix: "Document prefix",
  detailsManifestPrefixMode: "Saved prefix mode",
  detailsLastEmbeddingUpdate: "Last update",
  detailsPrefixNone: "None",
  detailsPrefixNomic: "Nomic search_query/search_document",
  detailsDeviceProvider: "Device provider",
  detailsDeviceModel: "Device model",
  detailsEmbeddingOnlyTextual: "Hybrid search will use only the text index while no embeddings exist.",

  warnProviderMismatch: "Warning: embeddings were generated with a different provider. Update embeddings before using semantic search.",
  warnModelMismatch: "Warning: embeddings were generated with a different model. Update embeddings before using semantic search.",
  warnPrefixMismatch: "Warning: embeddings were generated with a different prefix mode. Update embeddings.",
  warnEmbeddingsMissing: "Some embeddings are missing. Recent notes may not appear in semantic or hybrid search.",
  warnEmbeddingsOutdated: "Some embeddings are outdated. Update embeddings to ensure correct results.",
  warnEmbeddingsCompatible: "Embeddings compatible with current configuration.",

  btnRebuildIndex: "Rebuild text index",
  btnBuildIndex: "Build text index",
  btnGenerateEmbeddings: "Generate local embeddings",
  btnUpdateEmbeddings: "Update local embeddings",

  toastGeneratingEmbeddings: "Generating local embeddings...",
  toastEmbeddingsSuccess: "Local embeddings generated successfully.",
  toastEmbeddingsError: "Could not generate local embeddings. Check the embeddings provider.",
  toastEmbeddingsAlreadyRunning: "Embedding generation is already in progress.",
  statusGeneratingEmbeddings: "Generating local embeddings...",
  statusEmbeddingsSuccess: "Local embeddings generated successfully.",
  statusEmbeddingsError: "Could not generate local embeddings. Check the embeddings provider.",
  statusEmbeddingsPartial: "Embedding generation finished, but some embeddings are still missing or outdated.",
  statusEmbeddingsErrorPrefix: "Error generating embeddings",
  statusBuildingIndex: "Building text index...",
  statusIndexBuilt: "Text index built successfully.",
  statusIndexError: "Error building text index.",

  semanticNoEmbeddings: "Local embeddings unavailable or invalid. Generate embeddings first in Lina settings.",
  semanticProviderMismatch: "Embeddings were generated with provider",
  semanticModelMismatch: "Embeddings were generated with model",
  semanticPrefixMismatch: "Embeddings were generated with a different prefix mode. Update embeddings before using semantic search.",
  semanticDimensionMismatch: "Embedding dimension mismatch. Update embeddings before using semantic search.",
  semanticEmbeddingError: "Semantic search error: embedding generation failed. Check the embeddings provider",
  semanticLoadingEmbeddings: "Loading local embeddings...",
  semanticNoChunks: "Chunks not found. Rebuild the text index first.",
  semanticGeneratingQuery: "Generating search embedding...",
  semanticComparing: "Comparing with local embeddings...",

  hybridSemanticUnavailable: "The semantic component of hybrid search is not available.",
  hybridSemanticUnavailableReason: "Only text results were used.",
  hybridTextOnly: "Only text results were used.",

  originText: "text",
  originSemantic: "semantic",
  originHybrid: "text + semantic",
  originSource: "Source",
  originFoundIn: "Found in:",
  originFileName: "note name",
  originFilePath: "note path",
  originFileContent: "note content",
  originNote: "Found in note",
  originMetadataMatch: "Match found in note metadata.",
  originNameMatch: "Match found in note name.",

  analysisTitleCurrentNote: "AI — current note",
  analysisTitleWithContext: "AI — current note with context",
  analysisTitleInbox: "AI — inbox analysis",
  analysisAnalysingNote: "Analysing current note...",
  analysisAnalysingWithContext: "Analysing current note with context...",
  analysisAnalysingInbox: "Analysing inbox notes...",
  analysisNoFile: "No note open. Open a Markdown note first.",
  analysisNonMarkdown: "The active file is not Markdown. Open a .md note to analyse.",
  analysisEmptyNote: "The current note is empty. There is no content to analyse.",
  analysisRetryLabel: "Analyse current note",
  analysisExcludedByUserRules: "This note contains user-configured excluded terms. Analysis was blocked and nothing was sent to AI.",
  analysisContextExcludedByUserRules: "Some related notes were omitted by user-configured exclusion rules.",
  analysisTimeout: "Analysis exceeded the time limit. You can increase the timeout in settings or try again.",
  analysisModelError: "Model not found. Check if the model is available in the active profile.",
  analysisGenericError: "Error analysing note",
  analysisEmptyResponse: "The AI returned an empty response. Try again.",
  analysisNoteNoLongerExists: "The selected note no longer exists in the vault.",
  analysisErrorReading: "Error reading note",
  analysisTimeoutMessage: "Analysis exceeded the time limit. You can increase the timeout in settings or try again.",
  analysisModelNotFound: "Model not found. Check if the model is available in the active profile.",
  analysisErrorPrefix: "Error analysing note",
  analysisRetryInstruction: "You can try again by clicking",
  analysisNoteName: "Analysed note",
  analysisClosePanel: "Close analysis",
  analysisStructuralWarning: "Could not structure the response automatically. The text response was shown without interactive selection.",
  analysisCopyResponse: "Copy response",
  analysisCopySuccess: "Response copied to the clipboard.",
  analysisCopyError: "Could not copy the response.",
  analysisSuggestedMetadata: "Suggested metadata",
  analysisCopySuggestedMetadata: "Copy metadata",
  analysisCopyYaml: "Copy YAML",
  analysisCopyTags: "Copy tags",
  analysisCopyMetadataSuccess: "Metadata copied to the clipboard.",
  analysisApplyMetadataToActiveNote: "Apply metadata",
  analysisPreservedMetadataNotice: "This metadata was preserved from an earlier analysis.",
  analysisConfirmApplyPreservedMetadata: "This metadata was preserved from an earlier analysis. Apply the selected YAML/tags to the currently open note?",
  analysisPreservedMetadataApplied: "Metadata applied to the active note.",
  analysisNoPreservedMetadataChanges: "There was no new metadata to apply.",

  settingsMultilingual: "Multilingual",
  settingsMultilingualDescription: "These options do not translate notes, titles or file names. Notes keep the language they were written in.",
  settingsInterfaceLanguage: "Interface language",
  settingsInterfaceLanguageDescription: "Sets the language of Lina texts. This option does not translate notes, titles or file names.",
  settingsEmbeddingLanguage: "Default embedding language",
  settingsEmbeddingLanguageDescription: "Indicates the expected primary language for embeddings. This option does not translate notes or change content; it serves to guide configuration and future model validation.",
  langPtPT: "Português europeu",
  langEn: "English",
  langEs: "Spanish",
  langFr: "French",
  langMulti: "Multilingual",
  langAuto: "Automatic",

  confirmApplyTitle: "Apply suggestions to note",
  confirmApplyIntro: "You are about to apply to the current note:",
  confirmApplyWarning: "This action will modify the current Markdown file. Continue?",
  confirmApplyWarningRename: "This action will rename the current Markdown file. Continue?",
  confirmApplyWarningMove: "This action will move the current Markdown file within the vault. Continue?",
  confirmApplyButton: "Apply",
  confirmCancelButton: "Cancel",

  confirmReinsertAiTitle: "Confirm reinserting AI content",
  confirmReinsertAiIntro: "This note already contains content generated by Lina.",
  confirmReinsertAiWarning: "Reinserting may duplicate or accumulate information (analysis, tasks, tags, YAML). Do you want to continue?",
  confirmReinsertAiButton: "Continue and insert",

  confirmMoveTitle: "Move note",
  confirmMoveIntro: "You are about to move this note:",
  confirmMoveWarning: "This action will move the Markdown file within the vault. Continue?",
  confirmMoveButton: "Move",
  confirmMoveCurrentName: "current name",
  confirmMoveCurrentFolder: "current folder",
  confirmMoveDestinationFolder: "destination folder",
  confirmMoveFinalPath: "final path",

  inboxAnalysing: "Analysing inbox notes...",
  inboxAnalyseButton: "Analyse",
  inboxAnalyseWithContextButton: "Analyse with context",
  inboxMoveButton: "Move",
  inboxConfigMissing: "Inbox folder not configured.",
  inboxFolderMissing: "The configured Inbox folder does not exist.",
  inboxNoNotes: "No Markdown notes found in the Inbox.",
  inboxResultsTitle: "Inbox analysis",
  inboxResultsSummary: "Analysis complete. Notes analysed",
  inboxDestination: "Destination",
  inboxSuggestedFolder: "Suggested folder",
  inboxFolderStatus: "Suggested folder status",
  inboxFolderCanMove: "Existing folder. You can move the note.",
  inboxSynthesis: "Summary",
  inboxSuggestedTitle: "Suggested title",
  inboxType: "Type",
  inboxTopic: "Topic",
  inboxTags: "Tags",
  inboxYaml: "Suggested YAML",
  inboxSummary: "Summary",
  inboxTasks: "Tasks",
  inboxLimitations: "Limitations",
  inboxSuggestedLinks: "Suggested links",
  inboxAnalyse: "Analyse",
  inboxAnalyseWithContext: "Analyse with context",
  inboxMove: "Move",
  inboxNoSuggestedFolder: "no suggested folder",

  errorNoteNotFound: "Note not found in vault.",
  errorFileNotMarkdown: "The target file is not Markdown.",
  errorIndexNotReady: "Text index does not exist yet.",
  errorNoteNoLongerExists: "The target note no longer exists or is not available.",
  errorTargetNotMarkdown: "The target file is not Markdown. Open a .md note to apply suggestions.",
  errorNoAnalysisAvailable: "No analysis available to apply.",
  errorTargetNoteGone: "The target note no longer exists or is not available.",
  errorNoteSelectedGone: "The selected note no longer exists in the vault.",
  errorCouldNotStructureResponse: "Could not structure the response automatically. The text response was shown without interactive selection.",
  errorOpenNotePrefix: "Error opening note",
  errorMoveNotePrefix: "Error moving note",
  operationCancelledNoMove: "Operation cancelled. The note was not moved.",

  btnGenerateEmbeddingsLabel: "Generate local embeddings",
  btnUpdateEmbeddingsLabel: "Update local embeddings",
  statusGeneratingLabel: "Generating...",
  statusAnalysisComplete: "Analysis complete.",
  statusAnalysingSelected: "Analysing selected note...",
  warnHybridTextOnly: "Hybrid search will use only the text index while no embeddings exist.",

  folderSuggested: "Suggested folder",
  folderStatusPrefix: "Suggested folder status",
  folderMoveToSuggested: "Move note to suggested folder",

  suggestionsApplied: "Suggestions applied to note.",
  noAnalysisToApply: "No analysis available to apply.",
  noItemSelected: "No items selected. Select at least one item before applying.",
  titleEmptyNoRename: "The suggested title is empty. The file was not renamed.",
  noSafeNameGenerated: "Could not generate a safe file name.",
  suggestedNameSameAsCurrent: "The suggested name is the same as the current name.",
  fileAlreadyExistsInFolder: "A file with this name already exists in this folder.",
  folderNotValid: "The suggested folder is not valid.",
  folderNotExists: "The suggested folder does not exist.",
  folderAutoCreateNotAllowed: "Lina does not create folders automatically at this stage.",
  noteAlreadyInFolder: "The note is already in the suggested folder.",
  fileAlreadyExistsDestNoRename: "A file with this name already exists in this folder. The file was not renamed.",
  fileAlreadyExistsFolderNoRename: "A file with this name already exists in the destination folder. The note was not moved.",
  operationCancelledNoChange: "Operation cancelled. The note was not changed.",
  fileAlreadyExistsDestNoMove: "A file with this name already exists in the destination folder.",
  fileRenamedSuccess: "File renamed successfully.",
  noteMovedSuccess: "Note moved successfully.",
  applySuggestionsErrorPrefix: "Could not apply the changes",

  inboxExcludedByUserRules: "Note skipped by user-configured exclusion rules.",

  inboxDetailDestination: "Destination",
  inboxDetailFolderStatus: "Suggested folder status",
  inboxDetailConfidence: "Confidence",
  inboxDetailActions: "Actions",
  inboxDetailSynthesis: "Summary",
  inboxDetailSuggestedTitle: "Suggested title",
  inboxDetailType: "Type",
  inboxDetailTopic: "Topic",
  inboxDetailTags: "Tags",
  inboxDetailYaml: "Suggested YAML",
  inboxDetailSummary: "Summary",
  inboxDetailTasks: "Tasks",
  inboxDetailLimitations: "Limitations",
  inboxDetailLinks: "Suggested links",

  // Definições — secções e opções
  settingsTitle: "Lina",
  settingsDescription: "Obsidian assistant focused on search, organisation and enrichment of Markdown notes.",
  settingsSupportText: "If you find Lina useful, you can support its development through Buy Me a Coffee.",
  settingsDeviceSection: "Current device",
  settingsDeviceDescription: "These AI options are saved only on this device.",
  settingsDeviceName: "Device name",
  settingsDeviceNamePlaceholder: "PC Ryzen, old Surface, Phone...",
  settingsAnalysisSection: "AI analysis",
  settingsProvider: "Provider",
  settingsProviderNotImplemented: "Provider not yet implemented in this version.",
  settingsModel: "Model",
  settingsBaseUrl: "Base URL",
  settingsApiKey: "API key",
  settingsApiKeyDescription: "The API key is saved only on this device.",
  settingsApiKeyPlaceholder: "Enter API key",
  settingsApiKeyLocalSaved: "Local key saved",
  settingsTimeout: "Timeout",
  settingsTimeoutDesc: "Seconds.",
  settingsTestConnection: "Test connection",
  settingsTestingConnection: "Testing connection...",
  settingsConnectionSuccess: "Connection tested successfully.",
  settingsConnectionFailed: "Could not contact the provider.",
  settingsConnectionEmptyResponse: "Empty response from provider.",
  settingsApiKeyMissing: "API key missing for this provider.",
  settingsBaseUrlMissing: "Base URL missing.",
  settingsModelMissing: "Model missing.",
  settingsConnectionErrorPrefix: "Error testing connection",
  settingsProviderNotImplementedTest: "Provider not yet implemented in this version.",
  settingsEmbeddingsSection: "Embeddings",
  settingsEnableEmbeddings: "Enable embeddings",
  settingsEnableEmbeddingsDesc: "Allows generating chunk embeddings for semantic and hybrid search.",
  settingsBatchSize: "Batch size",
  settingsBatchSizeDesc: "Maximum number of chunks to process in each run.",
  settingsInboxSection: "Inbox folder",
  settingsInboxFolder: "Inbox folder",
  settingsInboxFolderDesc: "Folder where Lina should look for notes for batch analysis. The folder is not created automatically.",
  settingsInboxMaxNotes: "Maximum inbox notes to analyse",
  settingsInboxMaxNotesDesc: "Limit of Markdown notes analysed in each run. Value between 1 and 20.",
  settingsIndexSection: "Index",
  settingsCheckSyncOnStartup: "Check synchronisation on startup",
  settingsCheckSyncOnStartupDesc: "Checks if the index is outdated when the plugin is loaded, without modifying the index.",
  settingsUpdateIndexOnStartup: "Update index on startup",
  settingsUpdateIndexOnStartupDesc: "Updates the index incrementally when the plugin is loaded, without generating embeddings.",
  settingsAutoUpdateIndex: "Update index automatically",
  settingsAutoUpdateIndexDesc: "Updates the text index when Markdown notes are created, modified, deleted or renamed.",
  settingsDebugIndex: "Index diagnostic mode",
  settingsDebugIndexDesc: "Shows diagnostic information about vault events and automatic index updates.",
  settingsExclusionsSection: "Index exclusions",
  settingsExcludedFolders: "Excluded folders",
  settingsExcludedFoldersDesc: "One folder per line. Notes inside these folders are not included in the Lina index.",
  settingsExcludedTerms: "Excluded path terms",
  settingsExcludedTermsDesc: "One term per line. If the note path contains any of these terms, the note is not included in the Lina index.",
  settingsExcludedContentTerms: "Excluded content terms",
  settingsExcludedContentTermsDesc: "One term per line. If the note content contains any of these terms, the note is not included in the index, search, embeddings, or AI analysis.",
  settingsExclusionsNote: "The .lina/ and .obsidian/ folders are always excluded automatically.",
  settingsHybridSection: "Hybrid search",
  settingsTextWeight: "Text search weight",
  settingsTextWeightDesc: "Weight used in the hybrid search final score. Value between 0 and 1.",
  settingsSemanticWeight: "Semantic search weight",
  settingsSemanticWeightDesc: "Weight used in the hybrid search final score. Value between 0 and 1.",
  settingsYamlSection: "YAML / note properties",
  settingsYamlEnabled: "Enable YAML suggestions",
  settingsYamlEnabledDesc: "Allows Lina to suggest YAML when analysing notes. Does not modify notes; only shows suggestions.",
  settingsYamlProperties: "Allowed YAML properties",
  settingsYamlPropertiesDesc: "List of properties Lina can suggest in YAML. Separate with commas.",
  settingsYamlIncludeTags: "Include tags in YAML",
  settingsYamlIncludeTagsDesc: "If enabled, the suggested YAML includes a tag list. Does not modify notes; only shows suggestions.",
  settingsMaxTags: "Maximum suggested tags",
  settingsMaxTagsDesc: "Maximum number of tags to suggest in YAML and the tag list.",
  settingsSupportSection: "Support the project",
  settingsSupportDescription: "Lina is independently developed. Supporting through Buy Me a Coffee helps maintain the project.",
  settingsSupportLink: "Support the project",

  semanticModalTitle: "Search semantically",
  semanticModalPlaceholder: "Write an idea, topic or question...",
  semanticStatusLoadingEmbeddingState: "Loading embedding status...",
  semanticEmbeddingsUnavailableGenerate: "Local embeddings are unavailable or invalid. Generate embeddings before using semantic search.",
  semanticEmbeddingsMissingGenerate: "Local embeddings do not exist yet. Generate embeddings first.",
  semanticConfiguredFor: "but search is configured for",
  semanticUpdateBeforeUse: "Update embeddings before using semantic search.",
  semanticQueryDimensionMismatch: "The query embedding dimension does not match the local embeddings. The embeddings appear outdated. Generate embeddings again.",

  diagnosticTitle: "Diagnostic information",
  diagnosticQueryLabel: "Query searched",
  diagnosticProviderLabel: "Embeddings provider",
  diagnosticModelLabel: "Embeddings model",
  diagnosticDimensionLabel: "Embedding dimension",
  diagnosticPrefixModeLabel: "Prefix mode",
  diagnosticQueryPrefixLabel: "Query prefix",
  diagnosticDocPrefixLabel: "Document prefix",
  diagnosticPrefixModeValue: "Nomic search_query/search_document",
  diagnosticPrefixNone: "None",
  diagnosticPrefixNomic: "Nomic search_query/search_document",
  diagnosticTotalEvaluated: "Total embeddings evaluated",
  diagnosticValidEmbeddings: "Valid embeddings (correct dimension)",
  diagnosticFinalResults: "Number of final results shown",
  diagnosticThresholdLabel: "Minimum similarity threshold",
  diagnosticScoreLabel: "Score",
  diagnosticRawTop10: "Top 10 raw results (before applying threshold)",
  diagnosticPassedThreshold: "Passed threshold",
  diagnosticDidNotPassThreshold: "Did not pass threshold",
  diagnosticYes: "Yes",
  diagnosticNo: "No",
  diagnosticNoRawResults: "No raw results available.",
  diagnosticNonePassedThreshold: "No results passed the minimum threshold. All raw results were filtered.",

  renameFile: "Rename file",
  renameSuggestedTitle: "Suggested title",
  renameUpdateH1: "Update note H1",
  renameRenameFile: "Rename file",
  renameMoveNote: "Move note to suggested folder",
  renameApplySelected: "Apply selected to note",
  renameNoSelection: "No items selected. Select at least one item before applying.",
  renameEmptyTitle: "The suggested title is empty. The file was not renamed.",
  renameInvalidFileName: "Could not generate a safe file name.",
  renameSameName: "The suggested name is the same as the current name.",
  renameAlreadyExists: "A file with this name already exists in this folder.",
  renameFolderInvalid: "The suggested folder is not valid.",
  renameFolderNotExists: "The suggested folder does not exist.",
  renameAlreadyInFolder: "The note is already in the suggested folder.",
  renameSuccess: "File renamed successfully.",
  renameMoveSuccess: "Note moved successfully.",
  renameCancelled: "Operation cancelled. The note was not changed.",

  previewSelectItems: "Select the items you want to apply to the note.",
  previewCheckboxExplanation: "The preview checkboxes only mean selection for application, not completed state.",
  previewRelatedNotesUsed: "Related notes used",
  previewSuggestedTitle: "Suggested title",
  previewSuggestedFolder: "Suggested folder",
  previewYamlSuggested: "Suggested YAML",
  previewYamlDisabled: "YAML is not enabled in Lina settings.",
  previewTagsSuggested: "Suggested tags",
  previewInternalLinks: "Suggested internal links",
  previewOtherRelatedNotes: "Other related notes",
  previewTasksDetected: "Detected tasks",
  previewAnalysis: "Analysis",
  previewSummary: "Summary",
  previewConfidence: "Confidence level",
  previewLimitations: "Limitations",
  previewApplyButton: "Apply selected to note",
  previewNoItems: "No items suggested.",
  previewNoTags: "No tags suggested.",
  previewNoLinks: "No sufficiently relevant related notes found.",
  previewNoRelated: "No other related notes besides those suggested by the AI.",
  previewNoTasks: "No tasks detected.",
  previewYamlAlreadyExists: "already exists",
  previewYamlConflict: "conflict",
  previewYamlNew: "new",
  previewTagNew: "new tag",
  previewTagExisting: "already used",
  previewFolderStatus: "Suggested folder status",
  previewFolderExisting: "Existing folder.",
  previewFolderNew: "Folder does not exist at vault root. Lina does not create folders automatically at this stage.",
  previewFolderInbox: "Ignored: Inbox should not be used as an organisation destination.",
  previewFolderCurrent: "The note is already in the suggested folder.",
  relatedOriginLabel: "Origin",
  relatedScoreLabel: "Score",
  relatedReasonLabel: "Reason",
  relatedSourceTextual: "textual",
  relatedSourceSemantic: "semantic",
  relatedSourceHybrid: "hybrid",
  relatedReasonTitle: "title",
  relatedReasonPath: "path",
  relatedReasonContent: "content",
  relatedReasonSimilarContent: "similar content",
  relatedReasonSameFolder: "same folder",
  relatedReasonSameArea: "same area",
};

// -----------------------------------------------------------------------
// Mapa de idiomas disponíveis
// -----------------------------------------------------------------------

const ALL_STRINGS: Record<InterfaceLanguage, UiStrings> = {
  "pt-PT": PT_PT,
  "en": EN,
};

// -----------------------------------------------------------------------
// Função principal de tradução
// -----------------------------------------------------------------------

/**
 * Obtém o texto traduzido para uma chave e idioma.
 * Fallback para pt-PT se o idioma ou a chave não existirem.
 */
export function t(key: keyof UiStrings, lang?: InterfaceLanguage): string {
  const language = lang ?? "pt-PT";
  const strings = ALL_STRINGS[language] ?? ALL_STRINGS["pt-PT"];
  return strings[key] ?? PT_PT[key] ?? key;
}

/**
 * Obtém o objeto completo de strings para um idioma.
 * Útil para desestruturação: const { searchButton, searchPlaceholder } = getStrings(lang);
 */
export function getStrings(lang?: InterfaceLanguage): UiStrings {
  const language = lang ?? "pt-PT";
  return ALL_STRINGS[language] ?? ALL_STRINGS["pt-PT"];
}

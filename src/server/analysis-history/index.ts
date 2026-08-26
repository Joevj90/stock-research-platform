export { saveAnalysis } from "./save-service";
export { getAnalysisHistory, compareTwoAnalyses, getSavedAnalysisReport } from "./history-service";
export type {
  SavedAnalysisRecord,
  SavedAnalysisWithReport,
  ComparisonResult,
  ComparisonDeltas,
  WhatChangedItem,
  AnalysisHistoryResult,
  ThesisChangeLevel,
  ChangeDirection,
} from "@/lib/analysis-history-types";

export {
  recordPredictionsFromForecast,
  evaluatePendingPredictions,
  getPredictionHistory,
  getAccuracyDashboard,
  exportAllPredictions,
} from "./service";
export type {
  PredictionRecord,
  PredictionHistoryResult,
  AccuracyDashboard,
  HorizonAccuracy,
  RangeAccuracy,
  RatingPerformance,
  ConfidenceCalibration,
  SimulatedPerformance,
  FiveWayRating,
  RangeOutcome,
  CalibrationVerdict,
} from "@/lib/prediction-types";

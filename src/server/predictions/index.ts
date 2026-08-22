export {
  recordPredictionsFromForecast,
  evaluatePendingPredictions,
  getPredictionHistory,
  getAccuracyDashboard,
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

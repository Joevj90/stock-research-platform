import { prisma } from "@/server/db/client";
import { getQuote } from "@/server/market-data";
import { logger } from "@/server/logger";
import type { Result } from "@/lib/types";
import type { ForecastResult } from "@/lib/forecast-types";
import type { AccuracyDashboard, PredictionHistoryResult, PredictionRecord, RangeOutcome, FiveWayRating } from "@/lib/prediction-types";
import {
  computeActualReturnPct,
  computeEvaluationDueDate,
  computePredictionErrorAbs,
  computePredictionErrorPct,
  deriveFiveWayRating,
  determineDirectionCorrect,
  determineRangeOutcome,
  isReadyForEvaluation,
  buildAccuracyDashboard,
} from "./calculations";

const log = logger.child("predictions:service");

const PREDICTION_VERSION = "v1";
/** Don't record a near-duplicate prediction for the same ticker+horizon
 * within this window -- prevents the table from filling with redundant
 * rows every time a user re-runs the Forecasting Agent in quick
 * succession, without ever touching a record that's already there. */
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * ⚠️ DATA-INTEGRITY BOUNDARY ⚠️ Every field written by
 * `recordPredictionsFromForecast` is written exactly once, at creation,
 * and this file NEVER updates those fields afterward. `evaluatePending`
 * only ever fills the initially-null evaluation columns on a row that
 * hasn't been evaluated yet -- it is structurally incapable of rewriting
 * an existing prediction's original values, satisfying "historical
 * prediction records must be immutable."
 *
 * Hooked into `@/app/api/forecast/[ticker]/route.ts` (not into
 * Forecasting Agent's own service.ts) so Step 14's tested, deployed
 * module is never touched by this step -- "whenever a completed stock
 * analysis produces a forecast" is satisfied at the API boundary, the
 * most direct point where a forecast is actually delivered to a caller.
 */
export async function recordPredictionsFromForecast(ticker: string, forecast: ForecastResult): Promise<void> {
  try {
    const stock = await prisma.stock.upsert({
      where: { ticker },
      update: {},
      create: { ticker },
    });

    for (const horizon of forecast.interpretation.horizons) {
      if (!horizon.dataSupportsThisHorizon) continue; // don't record a prediction the app itself said wasn't reliable

      const recentDuplicate = await prisma.prediction.findFirst({
        where: {
          stockId: stock.id,
          horizon: horizon.horizon,
          predictionDate: { gte: new Date(Date.now() - DEDUP_WINDOW_MS) },
        },
      });
      if (recentDuplicate) {
        log.debug("skipping duplicate prediction within dedup window", { ticker, horizon: horizon.horizon });
        continue;
      }

      const predictionDate = new Date();
      const evaluationDueDate = computeEvaluationDueDate(predictionDate, horizon.horizon);
      const aiRating: FiveWayRating = deriveFiveWayRating(
        horizon.expectedReturnPct,
        forecast.interpretation.confidenceScore
      );

      await prisma.prediction.create({
        data: {
          stockId: stock.id,
          ticker,
          companyName: forecast.companyName,
          horizon: horizon.horizon,
          predictionDate,
          evaluationDueDate,
          priceAtPrediction: forecast.currentPrice,
          bearPrice: horizon.bear.priceTarget,
          basePrice: horizon.base.priceTarget,
          bullPrice: horizon.bull.priceTarget,
          expectedPrice: horizon.expectedPrice,
          expectedReturnPct: horizon.expectedReturnPct,
          bearProbabilityPct: horizon.bear.probabilityPct,
          baseProbabilityPct: horizon.base.probabilityPct,
          bullProbabilityPct: horizon.bull.probabilityPct,
          aiRating,
          confidenceScore: forecast.interpretation.confidenceScore,
          keyAssumptions: JSON.stringify(forecast.interpretation.assumptions.map((a) => a.assumption)),
          majorRisks: JSON.stringify(horizon.bear.keyRisks),
          predictionVersion: PREDICTION_VERSION,
          provider: forecast.interpretation.model,
        },
      });
    }
  } catch (err) {
    // Recording a prediction must never break the user-facing forecast
    // response -- log and move on.
    log.error("failed to record prediction", { ticker, error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Evaluates every prediction (across all tickers) whose horizon has
 * genuinely elapsed and hasn't been evaluated yet. Fetches the real
 * current price via `getQuote` (Step 1's public barrel -- never a
 * provider directly) and fills in ONLY the previously-null evaluation
 * columns; every original field is left untouched.
 */
export async function evaluatePendingPredictions(): Promise<void> {
  const due = await prisma.prediction.findMany({
    where: { evaluatedAt: null, evaluationDueDate: { lte: new Date() } },
  });

  for (const p of due) {
    if (!isReadyForEvaluation(p.evaluationDueDate)) continue; // defensive re-check

    const quoteResult = await getQuote(p.ticker);
    if (!quoteResult.ok) {
      log.warn("could not evaluate prediction -- price unavailable", { ticker: p.ticker, id: p.id });
      continue;
    }

    const actualPrice = quoteResult.data.price;
    const actualReturnPct = computeActualReturnPct(actualPrice, p.priceAtPrediction);
    const predictionErrorAbs = computePredictionErrorAbs(actualPrice, p.expectedPrice);
    const predictionErrorPct = computePredictionErrorPct(actualPrice, p.expectedPrice);
    const directionCorrect = determineDirectionCorrect(p.expectedReturnPct, actualReturnPct);
    const rangeOutcome: RangeOutcome = determineRangeOutcome(actualPrice, p.bearPrice, p.basePrice, p.bullPrice);

    await prisma.prediction.update({
      where: { id: p.id },
      data: {
        actualPrice,
        evaluatedAt: new Date(),
        actualReturnPct,
        predictionErrorAbs,
        predictionErrorPct,
        directionCorrect,
        rangeOutcome,
      },
    });
  }
}

export async function getPredictionHistory(rawTicker: string): Promise<Result<PredictionHistoryResult>> {
  const ticker = rawTicker.trim().toUpperCase();
  if (!ticker) {
    return { ok: false, error: { code: "MISSING_TICKER", message: "Ticker symbol is required." } };
  }

  await evaluatePendingPredictions();

  const rows = await prisma.prediction.findMany({
    where: { ticker },
    orderBy: { predictionDate: "asc" },
  });

  return { ok: true, data: { ticker, predictions: rows.map(rowToRecord) } };
}

export async function getAccuracyDashboard(): Promise<AccuracyDashboard> {
  await evaluatePendingPredictions();
  const rows = await prisma.prediction.findMany();
  return buildAccuracyDashboard(rows.map(rowToRecord));
}

interface PredictionRow {
  id: string;
  ticker: string;
  companyName: string | null;
  horizon: string;
  predictionDate: Date;
  evaluationDueDate: Date;
  priceAtPrediction: number;
  bearPrice: number;
  basePrice: number;
  bullPrice: number;
  expectedPrice: number;
  expectedReturnPct: number;
  bearProbabilityPct: number;
  baseProbabilityPct: number;
  bullProbabilityPct: number;
  aiRating: string;
  confidenceScore: number;
  keyAssumptions: string;
  majorRisks: string;
  predictionVersion: string;
  actualPrice: number | null;
  evaluatedAt: Date | null;
  actualReturnPct: number | null;
  predictionErrorAbs: number | null;
  predictionErrorPct: number | null;
  directionCorrect: boolean | null;
  rangeOutcome: string | null;
}

function rowToRecord(row: PredictionRow): PredictionRecord {
  return {
    id: row.id,
    ticker: row.ticker,
    companyName: row.companyName,
    horizon: row.horizon as PredictionRecord["horizon"],
    predictionDate: row.predictionDate.toISOString(),
    evaluationDueDate: row.evaluationDueDate.toISOString(),
    priceAtPrediction: row.priceAtPrediction,
    bearPrice: row.bearPrice,
    basePrice: row.basePrice,
    bullPrice: row.bullPrice,
    expectedPrice: row.expectedPrice,
    expectedReturnPct: row.expectedReturnPct,
    bearProbabilityPct: row.bearProbabilityPct,
    baseProbabilityPct: row.baseProbabilityPct,
    bullProbabilityPct: row.bullProbabilityPct,
    aiRating: row.aiRating as PredictionRecord["aiRating"],
    confidenceScore: row.confidenceScore,
    keyAssumptions: JSON.parse(row.keyAssumptions),
    majorRisks: JSON.parse(row.majorRisks),
    predictionVersion: row.predictionVersion,
    actualPrice: row.actualPrice,
    evaluatedAt: row.evaluatedAt ? row.evaluatedAt.toISOString() : null,
    actualReturnPct: row.actualReturnPct,
    predictionErrorAbs: row.predictionErrorAbs,
    predictionErrorPct: row.predictionErrorPct,
    directionCorrect: row.directionCorrect,
    rangeOutcome: row.rangeOutcome as PredictionRecord["rangeOutcome"],
  };
}

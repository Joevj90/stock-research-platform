/**
 * Shared "gather all 8 analysis agents' outputs" utility.
 *
 * Both the Forecasting Agent (Step 14) and the Investment Committee
 * (Step 15) need the exact same thing: real, compact summaries of every
 * other analysis agent's actual output, with independent graceful
 * degradation per module. Extracting this here means there is exactly
 * ONE place in the app that calls all 8 agents and builds these
 * summaries -- "integrate with the existing architecture rather than
 * creating duplicate systems" applies to this app's own synthesis agents
 * just as much as it applies to reusing Steps 1-13's data layers.
 */

import { getStockSnapshot } from "@/server/market-data";
import { runTechnicalAnalysis } from "@/server/agents/technical-analysis";
import { runFundamentalAnalysis } from "@/server/agents/fundamental-analyst";
import { runValuationAnalysis } from "@/server/agents/valuation-engine";
import { runSentimentAnalysis } from "@/server/agents/sentiment-analysis";
import { runMacroAnalysis } from "@/server/agents/macro-analysis";
import { runCompetitorAnalysis } from "@/server/agents/competitor-analysis";
import { runManagementAnalysis } from "@/server/agents/management-analysis";
import { runRiskAnalysis } from "@/server/agents/risk-analyst";
import { logger } from "@/server/logger";

const log = logger.child("agents:shared:analysis-summaries");

/** Which of the 8 analysis modules actually contributed real data --
 * since any of them can fail independently (e.g. an FMP plan limit)
 * without failing the whole synthesis. */
export interface AnalysisInputsAvailability {
  technical: boolean;
  fundamental: boolean;
  valuation: boolean;
  sentiment: boolean;
  macro: boolean;
  competitor: boolean;
  management: boolean;
  risk: boolean;
}

export interface AnalysisSummaries {
  valuationDcfEstimates: { bearFairValue: number | null; baseFairValue: number | null; bullFairValue: number | null } | null;
  technicalSummary: { trend: string; momentum: string; technicalScore: number; explanation: string } | null;
  fundamentalSummary: { overallFundamentalScore: number; overallConclusion: string } | null;
  sentimentSummary: { sentimentScore: number; sentimentDirection: string; sentimentTrend: string; overallConclusion: string } | null;
  macroSummary: { macroScore: number; overallMacroEnvironment: string; overallConclusion: string } | null;
  competitorSummary: { competitiveScore: number; whoIsWinning: string; biggestCompetitiveThreat: string } | null;
  managementSummary: { managementScore: number; overallAssessment: string; overallConclusion: string } | null;
  riskSummary: { riskScore: number; riskLevel: string; numberOneRisk: string; overallConclusion: string } | null;
}

export interface GatheredAnalysisInputs {
  companyName: string | null;
  currentPrice: number | null;
  inputsUsed: AnalysisInputsAvailability;
  summaries: AnalysisSummaries;
}

/**
 * Calls all 8 analysis agents' real `run*` functions in parallel, via
 * their public barrels only -- never a provider, never duplicated logic.
 * Each call is handled independently, so one failing (e.g. an FMP plan
 * limitation) never prevents the others from contributing.
 */
export async function gatherAnalysisSummaries(ticker: string): Promise<GatheredAnalysisInputs> {
  const [snapshot, technical, fundamental, valuation, sentiment, macro, competitor, management, risk] =
    await Promise.all([
      getStockSnapshot(ticker, "1M").catch(() => null),
      runTechnicalAnalysis(ticker).catch(() => null),
      runFundamentalAnalysis(ticker).catch(() => null),
      runValuationAnalysis(ticker).catch(() => null),
      runSentimentAnalysis(ticker).catch(() => null),
      runMacroAnalysis(ticker).catch(() => null),
      runCompetitorAnalysis(ticker).catch(() => null),
      runManagementAnalysis(ticker).catch(() => null),
      runRiskAnalysis(ticker).catch(() => null),
    ]);

  const inputsUsed: AnalysisInputsAvailability = {
    technical: technical?.ok === true,
    fundamental: fundamental?.ok === true,
    valuation: valuation?.ok === true,
    sentiment: sentiment?.ok === true,
    macro: macro?.ok === true,
    competitor: competitor?.ok === true,
    management: management?.ok === true,
    risk: risk?.ok === true,
  };

  log.info("analysis inputs gathered", { ticker, inputsUsed });

  return {
    companyName: snapshot?.ok === true ? snapshot.data.companyName : null,
    currentPrice: snapshot?.ok === true ? snapshot.data.quote.price : null,
    inputsUsed,
    summaries: {
      valuationDcfEstimates:
        valuation?.ok === true
          ? {
              bearFairValue: valuation.data.dcf.bear.fairValuePerShare,
              baseFairValue: valuation.data.dcf.base.fairValuePerShare,
              bullFairValue: valuation.data.dcf.bull.fairValuePerShare,
            }
          : null,
      technicalSummary:
        technical?.ok === true
          ? {
              trend: technical.data.interpretation.trend,
              momentum: technical.data.interpretation.momentum,
              technicalScore: technical.data.interpretation.technicalScore,
              explanation: technical.data.interpretation.explanation,
            }
          : null,
      fundamentalSummary:
        fundamental?.ok === true
          ? {
              overallFundamentalScore: fundamental.data.interpretation.overallFundamentalScore,
              overallConclusion: fundamental.data.interpretation.overallConclusion,
            }
          : null,
      sentimentSummary:
        sentiment?.ok === true
          ? {
              sentimentScore: sentiment.data.interpretation.sentimentScore,
              sentimentDirection: sentiment.data.interpretation.sentimentDirection,
              sentimentTrend: sentiment.data.interpretation.sentimentTrend,
              overallConclusion: sentiment.data.interpretation.overallConclusion,
            }
          : null,
      macroSummary:
        macro?.ok === true
          ? {
              macroScore: macro.data.interpretation.macroScore,
              overallMacroEnvironment: macro.data.interpretation.overallMacroEnvironment,
              overallConclusion: macro.data.interpretation.overallConclusion,
            }
          : null,
      competitorSummary:
        competitor?.ok === true
          ? {
              competitiveScore: competitor.data.interpretation.competitiveScore,
              whoIsWinning: competitor.data.interpretation.whoIsWinning,
              biggestCompetitiveThreat: competitor.data.interpretation.biggestCompetitiveThreat,
            }
          : null,
      managementSummary:
        management?.ok === true
          ? {
              managementScore: management.data.interpretation.managementScore,
              overallAssessment: management.data.interpretation.overallAssessment,
              overallConclusion: management.data.interpretation.overallConclusion,
            }
          : null,
      riskSummary:
        risk?.ok === true
          ? {
              riskScore: risk.data.interpretation.riskScore,
              riskLevel: risk.data.interpretation.riskLevel,
              numberOneRisk: risk.data.interpretation.numberOneRisk.risk,
              overallConclusion: risk.data.interpretation.overallConclusion,
            }
          : null,
    },
  };
}

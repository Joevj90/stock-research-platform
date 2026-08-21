import type { NewsArticle } from "@/lib/news-types";
import type { Result } from "@/lib/types";

/**
 * Contract every news provider must satisfy. Mirrors
 * src/server/market-data/provider.interface.ts and
 * src/server/fundamentals/provider.interface.ts: nothing outside this
 * module should know or care which concrete implementation is in use,
 * and only service.ts is allowed to call it directly.
 */
export interface NewsProvider {
  readonly id: "mock" | "fmp";
  readonly isMock: boolean;

  /** Returns up to `limit` recent articles for a ticker, most recent
   * first, already normalized to this app's NewsArticle shape. */
  getCompanyNews(ticker: string, limit: number): Promise<Result<NewsArticle[]>>;
}

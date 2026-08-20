export type ValuationPoint = {
  date: string;
  valueMinor: number;
  externalFlowMinor: number;
};

export type PerformanceSeriesPoint = ValuationPoint & {
  gainMinor: number | null;
  dailyReturn: number | null;
  cumulativeReturn: number | null;
};

export type PerformanceSummary = {
  startDate: string | null;
  endDate: string | null;
  startValueMinor: number | null;
  endValueMinor: number | null;
  gainMinor: number | null;
  netFlowMinor: number;
  twr: number | null;
  lastCloseGainMinor: number | null;
  lastCloseReturn: number | null;
  series: PerformanceSeriesPoint[];
};

export type AccountValuationSeries = {
  accountId: string;
  points: ValuationPoint[];
};

export type PositionPoint = {
  symbol: string;
  quantity: number;
  displayValueMinor: number;
};

export type PositionContribution = {
  symbol: string;
  contributionMinor: number | null;
  eligible: boolean;
  reason: "position-changed" | null;
  excludedIntervals: number;
};

function assertSafeMinor(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer`);
  }
}

function safeAdd(left: number, right: number, label: string): number {
  const result = left + right;
  assertSafeMinor(result, label);
  return result;
}

function safeSubtract(left: number, right: number, label: string): number {
  const result = left - right;
  assertSafeMinor(result, label);
  return result;
}

function sortedValuationPoints(points: ValuationPoint[]): ValuationPoint[] {
  const sorted = [...points].sort((left, right) => left.date.localeCompare(right.date));

  sorted.forEach((point, index) => {
    if (!point.date) throw new RangeError("valuation date is required");
    assertSafeMinor(point.valueMinor, `valueMinor for ${point.date}`);
    assertSafeMinor(point.externalFlowMinor, `externalFlowMinor for ${point.date}`);
    if (index > 0 && sorted[index - 1].date === point.date) {
      throw new RangeError(`duplicate valuation date: ${point.date}`);
    }
  });

  return sorted;
}

export function calculatePerformance(points: ValuationPoint[]): PerformanceSummary {
  const sorted = sortedValuationPoints(points);
  if (sorted.length === 0) {
    return {
      startDate: null,
      endDate: null,
      startValueMinor: null,
      endValueMinor: null,
      gainMinor: null,
      netFlowMinor: 0,
      twr: null,
      lastCloseGainMinor: null,
      lastCloseReturn: null,
      series: [],
    };
  }

  const start = sorted[0];
  let netFlowMinor = 0;
  let cumulativeFactor: number | null = null;

  const series: PerformanceSeriesPoint[] = sorted.map((point, index) => {
    if (index === 0) {
      return { ...point, gainMinor: 0, dailyReturn: null, cumulativeReturn: null };
    }

    const previous = sorted[index - 1];
    netFlowMinor = safeAdd(netFlowMinor, point.externalFlowMinor, "net external flow");
    const valueLessFlow = safeSubtract(point.valueMinor, point.externalFlowMinor, "flow-adjusted value");
    const gainMinor = safeSubtract(
      safeSubtract(point.valueMinor, start.valueMinor, "period value change"),
      netFlowMinor,
      "period investment gain",
    );

    if (previous.valueMinor <= 0) {
      cumulativeFactor = null;
      return { ...point, gainMinor, dailyReturn: null, cumulativeReturn: null };
    }

    const dailyReturn = valueLessFlow / previous.valueMinor - 1;
    if (!Number.isFinite(dailyReturn)) throw new RangeError(`non-finite return for ${point.date}`);

    cumulativeFactor = (cumulativeFactor ?? 1) * (1 + dailyReturn);
    if (!Number.isFinite(cumulativeFactor)) {
      throw new RangeError(`non-finite cumulative return for ${point.date}`);
    }

    return {
      ...point,
      gainMinor,
      dailyReturn,
      cumulativeReturn: cumulativeFactor - 1,
    };
  });

  const end = sorted.at(-1)!;
  if (sorted.length === 1) {
    return {
      startDate: start.date,
      endDate: end.date,
      startValueMinor: start.valueMinor,
      endValueMinor: end.valueMinor,
      gainMinor: null,
      netFlowMinor: 0,
      twr: null,
      lastCloseGainMinor: null,
      lastCloseReturn: null,
      series,
    };
  }

  const previous = sorted.at(-2)!;
  const lastCloseGainMinor = safeSubtract(
    safeSubtract(end.valueMinor, previous.valueMinor, "last-close value change"),
    end.externalFlowMinor,
    "last-close investment gain",
  );
  const gainMinor = safeSubtract(
    safeSubtract(end.valueMinor, start.valueMinor, "period value change"),
    netFlowMinor,
    "period investment gain",
  );

  return {
    startDate: start.date,
    endDate: end.date,
    startValueMinor: start.valueMinor,
    endValueMinor: end.valueMinor,
    gainMinor,
    netFlowMinor,
    twr: cumulativeFactor === null ? null : cumulativeFactor - 1,
    lastCloseGainMinor,
    lastCloseReturn: previous.valueMinor > 0 ? lastCloseGainMinor / previous.valueMinor : null,
    series,
  };
}

export function aggregatePortfolioPoints(accounts: AccountValuationSeries[]): ValuationPoint[] {
  const seenAccountIds = new Set<string>();
  const normalized = accounts
    .map((account) => {
      if (seenAccountIds.has(account.accountId)) {
        throw new RangeError(`duplicate account series: ${account.accountId}`);
      }
      seenAccountIds.add(account.accountId);
      const points = sortedValuationPoints(account.points);
      return {
        accountId: account.accountId,
        points,
        firstDate: points[0]?.date ?? null,
        byDate: new Map(points.map((point) => [point.date, point])),
      };
    })
    .filter((account) => account.firstDate !== null);

  const dates = [...new Set(normalized.flatMap((account) => account.points.map((point) => point.date)))].sort();
  const portfolioStart = dates[0];
  if (!portfolioStart) return [];

  const result: ValuationPoint[] = [];
  const lastIncludedDateByAccount = new Map<string, string>();
  for (const date of dates) {
    const activeAccounts = normalized.filter((account) => account.firstDate! <= date);
    const points = activeAccounts.map((account) => account.byDate.get(date));

    // Once an account has started tracking, a missing complete observation
    // makes the portfolio observation incomplete too. Never forward-fill it.
    if (points.some((point) => point === undefined)) continue;

    let valueMinor = 0;
    let externalFlowMinor = 0;
    points.forEach((point, index) => {
      const completePoint = point!;
      const account = activeAccounts[index];
      valueMinor = safeAdd(valueMinor, completePoint.valueMinor, `portfolio value for ${date}`);

      const lastIncludedDate = lastIncludedDateByAccount.get(account.accountId);
      const intervalPoints = account.points.filter(
        (candidate) =>
          (lastIncludedDate === undefined || candidate.date > lastIncludedDate) && candidate.date <= date,
      );
      let flow = 0;
      if (result.length > 0 && lastIncludedDate === undefined) {
        // Adding an account is an external portfolio flow at its actual opening
        // value. Any appreciation before the next common portfolio date remains
        // performance instead of being reclassified as a contribution.
        flow = intervalPoints[0].valueMinor;
        for (const candidate of intervalPoints.slice(1)) {
          flow = safeAdd(flow, candidate.externalFlowMinor, `opening portfolio flow for ${date}`);
        }
      } else if (lastIncludedDate !== undefined) {
        // A complete account point can be absent from the aggregate because a
        // different account was incomplete. Carry every intervening ledger flow
        // forward to the next common date so it cannot turn into investment gain.
        for (const candidate of intervalPoints) {
          flow = safeAdd(flow, candidate.externalFlowMinor, `portfolio interval flow for ${date}`);
        }
      }
      externalFlowMinor = safeAdd(externalFlowMinor, flow, `portfolio flow for ${date}`);
    });

    result.push({ date, valueMinor, externalFlowMinor });
    activeAccounts.forEach((account) => lastIncludedDateByAccount.set(account.accountId, date));
  }

  return result;
}

function positionsBySymbol(points: PositionPoint[], label: string): Map<string, PositionPoint> {
  const result = new Map<string, PositionPoint>();
  for (const point of points) {
    if (!point.symbol) throw new RangeError(`${label} position symbol is required`);
    if (result.has(point.symbol)) throw new RangeError(`duplicate ${label} position: ${point.symbol}`);
    if (!Number.isFinite(point.quantity)) throw new RangeError(`${point.symbol} quantity must be finite`);
    assertSafeMinor(point.displayValueMinor, `${point.symbol} display value`);
    result.set(point.symbol, point);
  }
  return result;
}

export function attributePositionChanges(
  start: PositionPoint[],
  end: PositionPoint[],
): PositionContribution[] {
  const startBySymbol = positionsBySymbol(start, "start");
  const endBySymbol = positionsBySymbol(end, "end");
  const symbols = [...new Set([...startBySymbol.keys(), ...endBySymbol.keys()])].sort();

  return symbols.map((symbol) => {
    const startPoint = startBySymbol.get(symbol);
    const endPoint = endBySymbol.get(symbol);
    if (!startPoint || !endPoint || startPoint.quantity !== endPoint.quantity) {
      return {
        symbol,
        contributionMinor: null,
        eligible: false,
        reason: "position-changed" as const,
        excludedIntervals: 1,
      };
    }

    return {
      symbol,
      contributionMinor: safeSubtract(
        endPoint.displayValueMinor,
        startPoint.displayValueMinor,
        `${symbol} contribution`,
      ),
      eligible: true,
      reason: null,
      excludedIntervals: 0,
    };
  });
}

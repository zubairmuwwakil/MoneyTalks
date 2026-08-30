import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "e2e/**",
    ],
  },
  {
    settings: {
      react: {
        version: "19.0.0",
      },
    },
    rules: {
      // These components load remote data after mount; the rule cannot see
      // that their setters run after an awaited fetch rather than synchronously.
      "react-hooks/set-state-in-effect": "off",
      // E3/E4: market-data ingestion belongs to MarketLens. Consuming its HTTP
      // API is correct; pulling a provider SDK into this repo is not.
      "no-restricted-imports": ["error", {
        paths: [
          { name: "alphavantage", message: "Market data belongs to MarketLens (E3). Use src/lib/services/marketlens.ts." },
          { name: "yahoo-finance2", message: "Market data belongs to MarketLens (E3). Use src/lib/services/marketlens.ts." },
          { name: "@polygon.io/client-js", message: "Market data belongs to MarketLens (E3). Use src/lib/services/marketlens.ts." },
          { name: "finnhub", message: "Market data belongs to MarketLens (E3). Use src/lib/services/marketlens.ts." },
        ],
      }],
    },
  },
];

export default eslintConfig;

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
    ],
    rules: {
      // These components load remote data after mount; the rule cannot see
      // that their setters run after an awaited fetch rather than synchronously.
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfig;

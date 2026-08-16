import type { Rule } from "./types";
import { fbarRule, form8938Rule } from "./us-reporting";
import { pficRule, rothFreezeRule, t1135Rule, tfsaDragRule, tfsaWithholdingRule } from "./cross-border";
import { fhsaRoomRule, rdspLifetimeRule, rrspRoomRule, staleDataRule, tfsaRoomRule } from "./rooms";
import { cdsbRule, cdsgRule } from "./rdsp";
import { cwbRule, dtcRule, employmentAmountRule, incomeSupportRule, nhtRule } from "./ca-benefits";
import { dangerMonthRule, digitalNewsRule, mortgagePrepaymentRule, studentLoanInterestRule } from "./bill-rules";
import { taxSeasonRule } from "./season";

export const ALL_RULES: Rule[] = [
  fbarRule,
  form8938Rule,
  pficRule,
  rothFreezeRule,
  tfsaDragRule,
  tfsaWithholdingRule,
  t1135Rule,
  tfsaRoomRule,
  rrspRoomRule,
  fhsaRoomRule,
  rdspLifetimeRule,
  staleDataRule,
  cdsgRule,
  cdsbRule,
  dtcRule,
  cwbRule,
  employmentAmountRule,
  incomeSupportRule,
  nhtRule,
  digitalNewsRule,
  studentLoanInterestRule,
  mortgagePrepaymentRule,
  dangerMonthRule,
  taxSeasonRule,
];

export { evaluateRules, applyDismissals } from "./registry";

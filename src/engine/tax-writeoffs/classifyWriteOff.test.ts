import { describe, expect, it } from "vitest";
import { classifyWriteOff } from "./classifyWriteOff";

describe("classifyWriteOff", () => {
  it("classifies AI and developer SaaS as T2125 Line 8810 Office/Software", () => {
    const claudeResult = classifyWriteOff({ merchant: "Anthropic Claude Pro" });
    expect(claudeResult.isCandidate).toBe(true);
    expect(claudeResult.taxLine?.form).toBe("T2125");
    expect(claudeResult.taxLine?.line).toBe("8810");
    expect(claudeResult.suggestedBusinessPct).toBe(100);
    expect(claudeResult.confidence).toBe("VERIFIED");

    const githubResult = classifyWriteOff({ merchant: "GitHub Copilot" });
    expect(githubResult.isCandidate).toBe(true);
    expect(githubResult.taxLine?.line).toBe("8810");

    const awsResult = classifyWriteOff({ merchant: "Amazon Web Services AWS" });
    expect(awsResult.isCandidate).toBe(true);
    expect(awsResult.taxLine?.line).toBe("8810");
  });

  it("classifies telecom and mobile plans as T2125/T777 with default 50% split", () => {
    const rogersResult = classifyWriteOff({ merchant: "Rogers Wireless" });
    expect(rogersResult.isCandidate).toBe(true);
    expect(rogersResult.taxLine?.form).toBe("T2125");
    expect(rogersResult.taxLine?.line).toBe("9281");
    expect(rogersResult.suggestedBusinessPct).toBe(50);
  });

  it("classifies home electricity and gas utilities as T2125/T777 utilities with 15% ratio", () => {
    const hydroResult = classifyWriteOff({ merchant: "Toronto Hydro" });
    expect(hydroResult.isCandidate).toBe(true);
    expect(hydroResult.taxLine?.line).toBe("9281");
    expect(hydroResult.suggestedBusinessPct).toBe(15);
  });

  it("classifies pharmacies and medical clinics as Personal T1 Line 33099", () => {
    const shoppersResult = classifyWriteOff({ merchant: "Shoppers Drug Mart Rx" });
    expect(shoppersResult.isCandidate).toBe(true);
    expect(shoppersResult.taxLine?.form).toBe("PERSONAL_T1");
    expect(shoppersResult.taxLine?.line).toBe("33099");

    const dentalResult = classifyWriteOff({ merchant: "Downtown Dental Clinic" });
    expect(dentalResult.isCandidate).toBe(true);
    expect(dentalResult.taxLine?.line).toBe("33099");
  });

  it("classifies recognized Canadian charities as Personal T1 Line 34900", () => {
    const charityResult = classifyWriteOff({ merchant: "SickKids Foundation" });
    expect(charityResult.isCandidate).toBe(true);
    expect(charityResult.taxLine?.form).toBe("PERSONAL_T1");
    expect(charityResult.taxLine?.line).toBe("34900");
  });

  it("classifies professional union/licensing dues as Personal T1 Line 21200", () => {
    const duesResult = classifyWriteOff({ merchant: "CPA Ontario Annual Dues" });
    expect(duesResult.isCandidate).toBe(true);
    expect(duesResult.taxLine?.line).toBe("21200");
  });

  it("returns non-candidate for ordinary personal shopping", () => {
    const groceryResult = classifyWriteOff({ merchant: "Loblaws Supermarket" });
    expect(groceryResult.isCandidate).toBe(false);
    expect(groceryResult.taxLine).toBeNull();
  });
});

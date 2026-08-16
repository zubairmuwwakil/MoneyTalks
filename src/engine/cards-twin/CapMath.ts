export const CapMath = {
  /**
   * Splits a purchase into the portion still earning the accelerated rate and the post-cap portion.
   */
  split(amount: number, capLimit: number, usage: number): { inCap: number; overCap: number } {
    const room = Math.max(0, capLimit - usage);
    const inCap = Math.min(amount, room);
    return {
      inCap,
      overCap: amount - inCap,
    };
  }
};

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
  },

  /** The meter with the least remaining room constrains the accelerated portion. */
  splitMulti(
    amount: number,
    caps: Array<{ limit: number; usage: number }>,
  ): { inCap: number; overCap: number } {
    const minRoom = caps.length > 0
      ? Math.min(...caps.map(cap => Math.max(0, cap.limit - cap.usage)))
      : Number.POSITIVE_INFINITY;
    const inCap = Math.min(amount, minRoom);
    return {
      inCap,
      overCap: amount - inCap,
    };
  }
};

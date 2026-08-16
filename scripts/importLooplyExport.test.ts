import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processExport } from './importLooplyExport';

const mockPrisma = {
  returnItem: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  valueEvent: {
    findFirst: vi.fn(),
    create: vi.fn(),
  }
};

describe('processExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const fixture = {
    returnItems: [
      {
        store: "Amazon",
        purchaseDate: "2023-01-01T00:00:00.000Z",
        amountCents: 1500,
        currency: "CAD",
        returnBy: "2023-01-31T00:00:00.000Z",
        status: "DELIVERED",
        shipmentEvents: [
          { statusCode: "DELIVERED", statusText: "Delivered", occurredAt: "2023-01-15T12:00:00.000Z" }
        ],
        refundCase: {
          expectedAt: "2023-01-20T00:00:00.000Z",
          refundType: "ORIGINAL"
        }
      }
    ],
    valueEvents: [
      {
        type: "REFUND_RECEIVED",
        amountCents: 1500,
        currency: "CAD",
        occurredAt: "2023-01-20T12:00:00.000Z",
        isEstimated: false
      }
    ],
    purchases: [
      { id: "ignore-me" }
    ]
  };

  it('creates new items when not existing (apply = true)', async () => {
    mockPrisma.returnItem.findFirst.mockResolvedValue(null);
    mockPrisma.valueEvent.findFirst.mockResolvedValue(null);

    const stats = await processExport(mockPrisma as any, 'user123', fixture, true);

    expect(stats.returnItems.created).toBe(1);
    expect(stats.returnItems.skipped).toBe(0);
    expect(stats.valueEvents.created).toBe(1);
    expect(stats.valueEvents.skipped).toBe(0);

    expect(mockPrisma.returnItem.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.valueEvent.create).toHaveBeenCalledTimes(1);

    const createCall = mockPrisma.returnItem.create.mock.calls[0][0];
    expect(createCall.data.store).toBe("Amazon");
    expect(createCall.data.shipmentEvents.create).toHaveLength(1);
    expect(createCall.data.refundCase.create.expectedAt).toEqual(new Date("2023-01-20T00:00:00.000Z"));
  });

  it('skips existing items (apply = true)', async () => {
    mockPrisma.returnItem.findFirst.mockResolvedValue({ id: 'existing-ret' });
    mockPrisma.valueEvent.findFirst.mockResolvedValue({ id: 'existing-val' });

    const stats = await processExport(mockPrisma as any, 'user123', fixture, true);

    expect(stats.returnItems.created).toBe(0);
    expect(stats.returnItems.skipped).toBe(1);
    expect(stats.valueEvents.created).toBe(0);
    expect(stats.valueEvents.skipped).toBe(1);

    expect(mockPrisma.returnItem.create).not.toHaveBeenCalled();
    expect(mockPrisma.valueEvent.create).not.toHaveBeenCalled();
  });

  it('does not create when apply = false', async () => {
    mockPrisma.returnItem.findFirst.mockResolvedValue(null);
    mockPrisma.valueEvent.findFirst.mockResolvedValue(null);

    const stats = await processExport(mockPrisma as any, 'user123', fixture, false);

    expect(stats.returnItems.created).toBe(1);
    expect(stats.returnItems.skipped).toBe(0);
    
    expect(mockPrisma.returnItem.create).not.toHaveBeenCalled();
    expect(mockPrisma.valueEvent.create).not.toHaveBeenCalled();
  });

  it('validates schema and ignores extra root keys', async () => {
    mockPrisma.returnItem.findFirst.mockResolvedValue(null);
    mockPrisma.valueEvent.findFirst.mockResolvedValue(null);

    // It should strip "purchases" and process successfully
    await expect(processExport(mockPrisma as any, 'user123', fixture, false)).resolves.toBeDefined();
  });

  it('fails on invalid returnItem schema', async () => {
    const badFixture = {
      returnItems: [
        { store: 123 } // store must be string
      ]
    };
    await expect(processExport(mockPrisma as any, 'user123', badFixture, false)).rejects.toThrow();
  });
});

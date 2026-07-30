import { describe, it, expect } from "vitest";
import {
  assertCanCreateCampaign,
  assertFeature,
  remainingLeadQuota,
  serializeAccount,
  monthStart,
  type AccountState,
} from "@/lib/billing/account";
import { PLANS } from "@/lib/billing/plans";
import { AppError } from "@/lib/errors";

const state = (over: Partial<AccountState> = {}): AccountState => ({
  effective: { planId: "pro", isTrial: false, trialDaysLeft: 0, limits: PLANS.pro.limits },
  usage: { campaigns: 0, leadsThisMonth: 0 },
  stripeCustomerId: null,
  eligibleForTrial: true,
  ...over,
});

describe("assertCanCreateCampaign", () => {
  it("permite crear por debajo del límite", () => {
    expect(() => assertCanCreateCampaign(state({ usage: { campaigns: 4, leadsThisMonth: 0 } }))).not.toThrow();
  });

  it("bloquea al alcanzar el límite con un 402", () => {
    try {
      assertCanCreateCampaign(state({ usage: { campaigns: 5, leadsThisMonth: 0 } }));
      expect.unreachable("debería haber lanzado");
    } catch (error) {
      expect((error as AppError).status).toBe(402);
      expect((error as AppError).code).toBe("plan_limit");
    }
  });

  it("nunca bloquea en agency (campañas ilimitadas)", () => {
    const agency = state({
      effective: { planId: "agency", isTrial: false, trialDaysLeft: 0, limits: PLANS.agency.limits },
      usage: { campaigns: 9999, leadsThisMonth: 0 },
    });
    expect(() => assertCanCreateCampaign(agency)).not.toThrow();
  });
});

describe("assertFeature", () => {
  it("deja pasar una función incluida en el plan", () => {
    expect(() => assertFeature(PLANS.pro.limits, "csvExport", "La exportación")).not.toThrow();
  });

  it("bloquea una función no incluida con mensaje accionable", () => {
    try {
      assertFeature(PLANS.free.limits, "followUps", "Los follow-ups");
      expect.unreachable("debería haber lanzado");
    } catch (error) {
      expect((error as AppError).status).toBe(402);
      expect((error as AppError).message).toContain("Los follow-ups");
      expect((error as AppError).message).toMatch(/Pro/);
    }
  });
});

describe("remainingLeadQuota", () => {
  it("resta el consumo del mes al límite del plan", () => {
    expect(remainingLeadQuota(state({ usage: { campaigns: 0, leadsThisMonth: 400 } }))).toBe(600);
  });

  it("nunca devuelve negativo aunque se haya excedido el cupo", () => {
    expect(remainingLeadQuota(state({ usage: { campaigns: 0, leadsThisMonth: 5000 } }))).toBe(0);
  });
});

describe("serializeAccount", () => {
  it("convierte Infinity en null para que sobreviva a JSON", () => {
    const agency = state({
      effective: { planId: "agency", isTrial: false, trialDaysLeft: 0, limits: PLANS.agency.limits },
    });
    const json = JSON.parse(JSON.stringify(serializeAccount(agency)));
    // JSON.stringify(Infinity) es null: si no lo mapeáramos, el cliente
    // interpretaría "sin límite" de forma accidental y frágil
    expect(json.limits.campaigns).toBeNull();
  });

  it("expone los límites numéricos tal cual", () => {
    expect(serializeAccount(state()).limits.leadsPerMonth).toBe(1000);
  });
});

describe("monthStart", () => {
  it("devuelve el día 1 a medianoche UTC", () => {
    const start = monthStart(new Date("2026-07-22T15:30:00Z"));
    expect(start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("es estable ante zonas horarias con desfase negativo", () => {
    // Un cálculo con getMonth() local haría que a última hora del día 31 el
    // "inicio de mes" saltara al mes siguiente en algunas zonas
    const start = monthStart(new Date("2026-07-01T00:30:00Z"));
    expect(start.getUTCMonth()).toBe(6);
    expect(start.getUTCDate()).toBe(1);
  });
});

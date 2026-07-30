import { describe, it, expect, afterEach } from "vitest";
import { resolvePlan, PLANS, planFromPriceId, priceIdFor, TRIAL_DAYS } from "@/lib/billing/plans";

const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

describe("resolvePlan", () => {
  it("da límites de Pro durante el trial", () => {
    const plan = resolvePlan({ plan: "trial", trial_ends_at: daysFromNow(7) });
    expect(plan.planId).toBe("pro");
    expect(plan.isTrial).toBe(true);
    expect(plan.trialDaysLeft).toBe(7);
    expect(plan.limits.followUps).toBe(true);
  });

  it("degrada a Free cuando el trial caduca", () => {
    const plan = resolvePlan({ plan: "trial", trial_ends_at: daysFromNow(-1) });
    expect(plan.planId).toBe("free");
    expect(plan.isTrial).toBe(false);
    expect(plan.limits.followUps).toBe(false);
    expect(plan.limits.csvExport).toBe(false);
  });

  it("trata el último día del trial como activo", () => {
    const plan = resolvePlan({ plan: "trial", trial_ends_at: daysFromNow(0.5) });
    expect(plan.isTrial).toBe(true);
    expect(plan.trialDaysLeft).toBe(1);
  });

  it("un plan de pago manda sobre un trial caducado", () => {
    const plan = resolvePlan({ plan: "pro", trial_ends_at: daysFromNow(-30) });
    expect(plan.planId).toBe("pro");
    expect(plan.isTrial).toBe(false);
    expect(plan.limits.leadsPerMonth).toBe(1000);
  });

  it("agency tiene campañas ilimitadas", () => {
    const plan = resolvePlan({ plan: "agency", trial_ends_at: daysFromNow(-1) });
    expect(plan.limits.campaigns).toBe(Infinity);
  });

  it("cae a Free ante un plan desconocido en BD", () => {
    const plan = resolvePlan({ plan: "enterprise" as never, trial_ends_at: daysFromNow(-1) });
    expect(plan.planId).toBe("free");
  });

  it("cae a Free si trial_ends_at no es una fecha válida", () => {
    const plan = resolvePlan({ plan: "trial", trial_ends_at: "no-es-fecha" });
    expect(plan.planId).toBe("free");
  });
});

describe("catálogo de planes", () => {
  it("Free no incluye funciones de pago", () => {
    expect(PLANS.free.limits.followUps).toBe(false);
    expect(PLANS.free.limits.csvExport).toBe(false);
  });

  it("los límites crecen de forma monótona con el precio", () => {
    expect(PLANS.pro.limits.leadsPerMonth).toBeGreaterThan(PLANS.free.limits.leadsPerMonth);
    expect(PLANS.agency.limits.leadsPerMonth).toBeGreaterThan(PLANS.pro.limits.leadsPerMonth);
    expect(PLANS.agency.monthlyPrice).toBeGreaterThan(PLANS.pro.monthlyPrice);
  });

  it("el precio anual supone un descuento real", () => {
    for (const plan of [PLANS.pro, PLANS.agency]) {
      expect(plan.annualMonthlyPrice).toBeLessThan(plan.monthlyPrice);
    }
  });

  it("el trial dura 14 días", () => {
    expect(TRIAL_DAYS).toBe(14);
  });
});

describe("mapeo de precios de Stripe", () => {
  const KEYS = [
    "STRIPE_PRICE_PRO_MONTHLY",
    "STRIPE_PRICE_PRO_ANNUAL",
    "STRIPE_PRICE_AGENCY_MONTHLY",
    "STRIPE_PRICE_AGENCY_ANNUAL",
  ];

  afterEach(() => {
    KEYS.forEach((k) => delete process.env[k]);
  });

  it("resuelve el price id desde el entorno", () => {
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_m";
    expect(priceIdFor("pro", "monthly")).toBe("price_pro_m");
  });

  it("devuelve undefined si el precio no está configurado", () => {
    expect(priceIdFor("agency", "annual")).toBeUndefined();
  });

  it("hace el viaje de vuelta price id → plan y ciclo", () => {
    process.env.STRIPE_PRICE_AGENCY_ANNUAL = "price_agency_a";
    expect(planFromPriceId("price_agency_a")).toEqual({ plan: "agency", cycle: "annual" });
  });

  it("devuelve null ante un price id desconocido", () => {
    // Evita que un precio creado a mano en Stripe conceda un plan por accidente
    expect(planFromPriceId("price_desconocido")).toBeNull();
  });
});

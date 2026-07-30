import { describe, it, expect } from "vitest";
import {
  buildTasks,
  progressOf,
  resumeAt,
  shouldRedirectToGuide,
  isComplete,
  GUIDED_STEPS,
  SUGGESTED_COMPANIES,
  TIPS,
  type OnboardingSnapshot,
} from "@/lib/onboarding/steps";

// ============================================================================
// El estado del onboarding se DERIVA de los datos reales, no se guarda como
// booleanos. Estos tests fijan esa propiedad: si alguien introduce un flag
// persistido, la lista de tareas empezará a mentir cuando el usuario borre
// datos, y estos casos lo detectan.
// ============================================================================

const snapshot = (over: Partial<OnboardingSnapshot> = {}): OnboardingSnapshot => ({
  welcomedAt: null,
  dismissedAt: null,
  completedAt: null,
  valueProposition: null,
  dismissedTips: [],
  firstCampaignAt: null,
  firstLeadAt: null,
  firstResearchAt: null,
  firstDraftAt: null,
  firstSendAt: null,
  hasRealCampaign: false,
  hasDemoCampaign: false,
  leadCount: 0,
  researchedCount: 0,
  draftCount: 0,
  sentCount: 0,
  hasSenderDomain: false,
  ...over,
});

describe("buildTasks", () => {
  it("marca la cuenta como hecha desde el principio", () => {
    const tasks = buildTasks(snapshot());
    expect(tasks.find((t) => t.id === "account")?.done).toBe(true);
  });

  it("con un usuario recién registrado sólo la cuenta está hecha", () => {
    const done = buildTasks(snapshot()).filter((t) => t.done);
    expect(done.map((t) => t.id)).toEqual(["account"]);
  });

  it("completa «offer» en cuanto hay propuesta de valor", () => {
    const tasks = buildTasks(snapshot({ valueProposition: "Reuniones cualificadas para agencias" }));
    expect(tasks.find((t) => t.id === "offer")?.done).toBe(true);
  });

  it("no acepta una propuesta de valor en blanco", () => {
    const tasks = buildTasks(snapshot({ valueProposition: "   " }));
    expect(tasks.find((t) => t.id === "offer")?.done).toBe(false);
  });

  it("completa «first_research» con un borrador, aunque no haya investigados", () => {
    const tasks = buildTasks(snapshot({ draftCount: 1 }));
    expect(tasks.find((t) => t.id === "first_research")?.done).toBe(true);
  });

  it("exige al menos 2 leads para dar por hecha la importación real", () => {
    // Con 1 lead sólo se ha probado el recorrido guiado, no importado de verdad
    expect(buildTasks(snapshot({ leadCount: 1 })).find((t) => t.id === "real_leads")?.done).toBe(false);
    expect(buildTasks(snapshot({ leadCount: 2 })).find((t) => t.id === "real_leads")?.done).toBe(true);
  });

  it("el envío es opcional: no bloquea completar el onboarding", () => {
    expect(buildTasks(snapshot()).find((t) => t.id === "first_send")?.optional).toBe(true);
  });

  it("toda tarea pendiente explica por qué importa", () => {
    // Una lista sin motivos es burocracia que el usuario descarta sin leer
    for (const task of buildTasks(snapshot())) {
      expect(task.reason.length, `${task.id} sin motivo`).toBeGreaterThan(30);
    }
  });

  it("toda tarea pendiente ofrece una acción concreta", () => {
    for (const task of buildTasks(snapshot()).filter((t) => !t.done)) {
      expect(task.action, `${task.id} sin acción`).not.toBeNull();
      expect(task.action?.label.length).toBeGreaterThan(0);
    }
  });

  it("revierte a pendiente si el usuario borra sus datos", () => {
    // El caso que justifica derivar en vez de persistir booleanos
    const conDatos = buildTasks(snapshot({ leadCount: 5, draftCount: 2 }));
    expect(conDatos.find((t) => t.id === "real_leads")?.done).toBe(true);

    const traBorrar = buildTasks(snapshot({ leadCount: 0, draftCount: 0 }));
    expect(traBorrar.find((t) => t.id === "real_leads")?.done).toBe(false);
    expect(traBorrar.find((t) => t.id === "first_research")?.done).toBe(false);
  });
});

describe("progressOf", () => {
  it("ignora las tareas opcionales en el porcentaje", () => {
    const tasks = buildTasks(snapshot());
    const progress = progressOf(tasks);
    // 5 obligatorias: account, offer, first_research, sender, real_leads
    expect(progress.total).toBe(5);
    expect(progress.done).toBe(1);
    expect(progress.percent).toBe(20);
  });

  it("llega al 100% sin necesidad de haber enviado", () => {
    const progress = progressOf(
      buildTasks(
        snapshot({
          valueProposition: "algo",
          draftCount: 1,
          hasSenderDomain: true,
          leadCount: 10,
          sentCount: 0,
        })
      )
    );
    expect(progress.percent).toBe(100);
  });
});

describe("resumeAt", () => {
  it("empieza por la bienvenida", () => {
    expect(resumeAt(snapshot())).toBe("welcome");
  });

  it("salta a la oferta si ya vio la bienvenida", () => {
    expect(resumeAt(snapshot({ welcomedAt: "2026-01-01T00:00:00Z" }))).toBe("offer");
  });

  it("salta a la empresa si ya definió su oferta", () => {
    expect(
      resumeAt(snapshot({ welcomedAt: "2026-01-01T00:00:00Z", valueProposition: "algo" }))
    ).toBe("company");
  });

  it("va al resultado cuando ya hay una investigación hecha", () => {
    expect(
      resumeAt(
        snapshot({ welcomedAt: "2026-01-01T00:00:00Z", valueProposition: "algo", draftCount: 1 })
      )
    ).toBe("result");
  });

  it("retoma exactamente donde se abandonó", () => {
    // Quien cierra la pestaña tras definir su oferta vuelve al paso de empresa
    const abandonado = snapshot({ welcomedAt: "2026-01-01T00:00:00Z", valueProposition: "mi oferta" });
    expect(resumeAt(abandonado)).toBe("company");
  });
});

describe("shouldRedirectToGuide", () => {
  it("lleva al recorrido a un usuario nuevo", () => {
    expect(shouldRedirectToGuide(snapshot())).toBe(true);
  });

  it("respeta el descarte del usuario", () => {
    expect(shouldRedirectToGuide(snapshot({ dismissedAt: "2026-01-01T00:00:00Z" }))).toBe(false);
  });

  it("no insiste tras completarlo", () => {
    expect(shouldRedirectToGuide(snapshot({ completedAt: "2026-01-01T00:00:00Z" }))).toBe(false);
  });

  it("no redirige a quien ya tiene un borrador aunque no lo marcara", () => {
    expect(
      shouldRedirectToGuide(
        snapshot({ welcomedAt: "2026-01-01T00:00:00Z", valueProposition: "algo", draftCount: 1 })
      )
    ).toBe(false);
  });
});

describe("isComplete", () => {
  it("se considera completo al ver el primer borrador", () => {
    expect(isComplete(snapshot({ draftCount: 1 }))).toBe(true);
  });

  it("respeta la marca explícita de completado", () => {
    expect(isComplete(snapshot({ completedAt: "2026-01-01T00:00:00Z" }))).toBe(true);
  });

  it("no está completo sin ningún borrador", () => {
    expect(isComplete(snapshot({ valueProposition: "algo", leadCount: 3 }))).toBe(false);
  });
});

describe("contenido del recorrido", () => {
  it("son exactamente cuatro pasos", () => {
    // Cada paso añadido es una oportunidad más de abandonar
    expect(GUIDED_STEPS).toHaveLength(4);
    expect(GUIDED_STEPS).toEqual(["welcome", "offer", "company", "result"]);
  });

  it("las empresas sugeridas tienen dominio válido", () => {
    for (const company of SUGGESTED_COMPANIES) {
      expect(company.url).toMatch(/^[a-z0-9-]+\.[a-z]{2,}$/);
      expect(company.name.length).toBeGreaterThan(0);
    }
  });

  it("cada consejo tiene título y cuerpo con contenido", () => {
    for (const tip of Object.values(TIPS)) {
      expect(tip.title.length).toBeGreaterThan(5);
      expect(tip.body.length).toBeGreaterThan(30);
    }
  });

  it("el consejo del fallo de investigación explica la diferencia del producto", () => {
    // Es el momento clave: el usuario debe entender que la ausencia de email
    // es una garantía, no un error
    expect(TIPS.research_failed.body).toMatch(/genérico|verificable/i);
  });
});

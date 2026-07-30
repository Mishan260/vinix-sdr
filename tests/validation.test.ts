import { describe, it, expect } from "vitest";
import {
  companyUrlSchema,
  createCampaignSchema,
  updateLeadSchema,
  checkoutSchema,
  signUpSchema,
  emailSchema,
  firstIssueMessage,
} from "@/lib/validation/schemas";

describe("emailSchema", () => {
  it.each(["a@b.com", "nombre.apellido@empresa.co.uk"])("acepta %s", (email) => {
    expect(emailSchema.safeParse(email).success).toBe(true);
  });

  it.each(["sin-arroba", "a@", "@b.com", "a b@c.com", ""])("rechaza %s", (email) => {
    expect(emailSchema.safeParse(email).success).toBe(false);
  });

  it("recorta espacios alrededor", () => {
    expect(emailSchema.parse("  a@b.com  ")).toBe("a@b.com");
  });
});

describe("companyUrlSchema", () => {
  it("añade https:// a un dominio sin protocolo", () => {
    expect(companyUrlSchema.parse("acme.com")).toBe("https://acme.com");
  });

  it("respeta un protocolo ya presente", () => {
    expect(companyUrlSchema.parse("http://acme.com")).toBe("http://acme.com");
  });

  it("permite cadena vacía para limpiar el campo", () => {
    expect(companyUrlSchema.parse("")).toBe("");
  });

  it("rechaza una URL sin dominio válido", () => {
    expect(companyUrlSchema.safeParse("no es una url").success).toBe(false);
  });
});

describe("signUpSchema", () => {
  it("exige contraseña de al menos 8 caracteres", () => {
    const result = signUpSchema.safeParse({ email: "a@b.com", password: "corta" });
    expect(result.success).toBe(false);
    if (!result.success) expect(firstIssueMessage(result.error)).toMatch(/8 caracteres/);
  });

  it("acepta credenciales válidas", () => {
    expect(signUpSchema.safeParse({ email: "a@b.com", password: "unaClaveLarga" }).success).toBe(true);
  });
});

describe("createCampaignSchema", () => {
  const valid = {
    name: "Agencias BCN",
    value_proposition: "Reuniones cualificadas",
    sender_name: "Jorge",
    sender_email: "jorge@vinix.com",
  };

  it("acepta una campaña completa", () => {
    expect(createCampaignSchema.safeParse(valid).success).toBe(true);
  });

  it("exige propuesta de valor: sin ella el agente no puede redactar", () => {
    const result = createCampaignSchema.safeParse({ ...valid, value_proposition: "  " });
    expect(result.success).toBe(false);
  });

  it("rechaza un email de remitente inválido", () => {
    expect(createCampaignSchema.safeParse({ ...valid, sender_email: "no-valido" }).success).toBe(false);
  });

  it("limita la longitud del nombre para evitar payloads gigantes", () => {
    expect(createCampaignSchema.safeParse({ ...valid, name: "x".repeat(201) }).success).toBe(false);
  });

  it("recorta espacios de los campos", () => {
    const parsed = createCampaignSchema.parse({ ...valid, name: "  Agencias BCN  " });
    expect(parsed.name).toBe("Agencias BCN");
  });
});

describe("updateLeadSchema", () => {
  it("acepta una actualización parcial", () => {
    expect(updateLeadSchema.safeParse({ company_url: "acme.com" }).success).toBe(true);
  });

  it("permite vaciar el email con cadena vacía", () => {
    expect(updateLeadSchema.safeParse({ contact_email: "" }).success).toBe(true);
  });

  it("rechaza un email con formato inválido", () => {
    expect(updateLeadSchema.safeParse({ contact_email: "roto@" }).success).toBe(false);
  });

  it("rechaza un objeto vacío", () => {
    expect(updateLeadSchema.safeParse({}).success).toBe(false);
  });

  it("rechaza vaciar el nombre de empresa", () => {
    expect(updateLeadSchema.safeParse({ company_name: "   " }).success).toBe(false);
  });
});

describe("checkoutSchema", () => {
  it("acepta pro mensual", () => {
    expect(checkoutSchema.parse({ plan: "pro", cycle: "monthly" })).toEqual({ plan: "pro", cycle: "monthly" });
  });

  it("usa ciclo mensual por defecto", () => {
    expect(checkoutSchema.parse({ plan: "agency" }).cycle).toBe("monthly");
  });

  it("rechaza el plan free: no requiere pago", () => {
    // Sin esto se abriría un Checkout de 0 € que Stripe rechaza con un error feo
    expect(checkoutSchema.safeParse({ plan: "free", cycle: "monthly" }).success).toBe(false);
  });

  it("rechaza un plan inexistente", () => {
    expect(checkoutSchema.safeParse({ plan: "enterprise" }).success).toBe(false);
  });
});

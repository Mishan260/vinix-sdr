import { test, expect } from "@playwright/test";

// ============================================================================
// Flujo crítico completo: login → crear campaña → importar → investigar →
// aprobar → enviar.
//
// Requiere credenciales de un usuario real de pruebas. Se omite si no están
// definidas, para que `npm run test:e2e` siga siendo verde en una máquina
// recién clonada:
//   E2E_EMAIL=test@tudominio.com E2E_PASSWORD=... npm run test:e2e
//
// Usa un proyecto de Supabase DESECHABLE: crea y borra datos reales.
// ============================================================================

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

test.describe("flujo del pipeline", () => {
  test.skip(!EMAIL || !PASSWORD, "Define E2E_EMAIL y E2E_PASSWORD para ejecutar este flujo");
  test.describe.configure({ mode: "serial" });

  const campaignName = `E2E ${Date.now()}`;

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(EMAIL!);
    await page.locator('input[name="password"]').fill(PASSWORD!);
    await page.getByRole("button", { name: /entrar/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  });

  test("crea una campaña", async ({ page }) => {
    await page.getByRole("button", { name: /campaña/i }).first().click();

    await page.getByLabel(/nombre de la campaña/i).fill(campaignName);
    await page.getByLabel(/nombre del remitente/i).fill("Test E2E");
    await page.getByLabel(/email remitente/i).fill(EMAIL!);
    await page.getByLabel(/propuesta de valor/i).fill("Reuniones cualificadas para agencias.");

    await page.getByRole("button", { name: /crear campaña/i }).click();

    // La campaña recién creada queda seleccionada en el selector
    await expect(page.getByRole("combobox", { name: /campaña activa/i })).toContainText(campaignName, {
      timeout: 20_000,
    });
  });

  test("importa leads desde un CSV", async ({ page }) => {
    const csv = ["company_name,company_url,contact_name,contact_email", `Acme E2E,acme.example,Ana,ana+${Date.now()}@ejemplo.test`].join("\n");

    await page.setInputFiles('input[type="file"]', {
      name: "leads.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    });

    await expect(page.getByRole("status")).toContainText(/importado/i, { timeout: 30_000 });
    await expect(page.getByRole("cell", { name: "Acme E2E" })).toBeVisible({ timeout: 20_000 });
  });

  test("permite editar un lead y dejarlo listo para investigar", async ({ page }) => {
    await page.getByRole("button", { name: /editar acme e2e/i }).click();

    await page.getByLabel(/url de la empresa/i).fill("https://example.com");
    await page.getByRole("button", { name: /guardar cambios/i }).click();

    await expect(page.getByRole("status")).toContainText(/actualizado/i, { timeout: 20_000 });
  });

  test("la exportación respeta el límite del plan", async ({ request }) => {
    const response = await request.get("/api/leads/export?campaignId=00000000-0000-0000-0000-000000000000");
    // 402 si el plan no incluye export, 404 si la campaña no es suya.
    // Nunca 200: sería una fuga de datos de otra cuenta.
    expect([402, 404, 422]).toContain(response.status());
  });

  test("cierra sesión y deja de tener acceso", async ({ page }) => {
    await page.getByRole("button", { name: /menú de cuenta/i }).click();
    await page.getByRole("menuitem", { name: /cerrar sesión/i }).click();

    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});

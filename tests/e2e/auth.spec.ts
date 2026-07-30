import { test, expect } from "@playwright/test";

// ============================================================================
// Protección de rutas y validación de formularios.
// No necesitan credenciales: verifican que un visitante anónimo no llega a
// ninguna pantalla ni endpoint privado.
// ============================================================================

test.describe("protección de rutas", () => {
  test("la raíz redirige a login sin sesión", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });

  test("el panel redirige a login y recuerda el destino", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    // Tras autenticarse debe volver a donde iba
    expect(new URL(page.url()).searchParams.get("next")).toBe("/dashboard");
  });

  test("las rutas de API privadas responden 401 sin sesión", async ({ request }) => {
    for (const path of ["/api/account", "/api/campaigns", "/api/leads?campaignId=x"]) {
      const response = await request.get(path);
      expect(response.status(), `${path} debería exigir sesión`).toBe(401);
    }
  });

  test("/api/health es público: la pantalla de setup lo necesita", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(await response.json()).toHaveProperty("ok");
  });

  test("el webhook de Stripe rechaza peticiones sin firma", async ({ request }) => {
    const response = await request.post("/api/billing/webhook", {
      data: { type: "checkout.session.completed" },
    });
    // 400 (sin firma) o 503 (sin configurar), nunca 200
    expect([400, 503]).toContain(response.status());
  });

  test("el webhook de respuestas rechaza peticiones sin firma Svix", async ({ request }) => {
    const response = await request.post("/api/agent/webhook/inbound", {
      data: { type: "email.received", data: { text: "hola" } },
    });
    expect([400, 401]).toContain(response.status());
  });
});

test.describe("formulario de acceso", () => {
  test("muestra los campos y enlaces esperados", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /inicia sesión/i })).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.getByRole("link", { name: /crear cuenta/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /olvidaste tu contraseña/i })).toBeVisible();
  });

  // Los errores de campo se localizan por id (#campo-error) y no por
  // role="alert": Next inyecta su propio anunciador de rutas con ese rol,
  // lo que haría ambiguo el selector.
  test("valida el email en cliente antes de llamar a la API", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[name="email"]').fill("no-es-un-email");
    await page.locator('input[name="password"]').fill("cualquiera");
    await page.getByRole("button", { name: /entrar/i }).click();

    await expect(page.locator("#email-error")).toContainText(/email/i);
    await expect(page).toHaveURL(/\/login/);
    // El input queda marcado como inválido para lectores de pantalla
    await expect(page.locator('input[name="email"]')).toHaveAttribute("aria-invalid", "true");
  });

  test("no revela si una cuenta existe al fallar el acceso", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[name="email"]').fill("no-existe@ejemplo.test");
    await page.locator('input[name="password"]').fill("contraseñaCualquiera");
    await page.getByRole("button", { name: /entrar/i }).click();

    // Mensaje genérico: distinguir "no existe" de "contraseña incorrecta"
    // permitiría enumerar las cuentas registradas
    const alert = page.locator('[role="alert"]').filter({ hasText: /./ }).first();
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await expect(alert).not.toContainText(/no existe|no encontrad|no registrad/i);
  });

  test("el registro exige contraseñas de 8 caracteres o más", async ({ page }) => {
    await page.goto("/signup");
    await page.locator('input[name="email"]').fill("nuevo@ejemplo.test");
    await page.locator('input[name="password"]').fill("corta");
    await page.getByRole("button", { name: /crear cuenta/i }).click();

    await expect(page.locator("#password-error")).toContainText(/8 caracteres/i);
  });

  test("la recuperación responde igual exista o no la cuenta", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.locator('input[name="email"]').fill("quiza-no-existe@ejemplo.test");
    await page.getByRole("button", { name: /enviar enlace/i }).click();

    await expect(page.getByRole("heading", { name: /revisa tu correo/i })).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("accesibilidad y responsive", () => {
  test("el formulario de acceso es usable en móvil", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/login");

    await expect(page.locator('input[name="email"]')).toBeVisible();

    // El cuerpo nunca debe desbordar horizontalmente
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflows).toBe(false);
  });

  test("los campos tienen etiqueta asociada", async ({ page }) => {
    await page.goto("/login");
    for (const name of ["email", "password"]) {
      const id = await page.locator(`input[name="${name}"]`).getAttribute("id");
      await expect(page.locator(`label[for="${id}"]`)).toBeVisible();
    }
  });

  test("una ruta inexistente no revela nada a un visitante anónimo", async ({ page }) => {
    await page.goto("/ruta-que-no-existe-jamas");
    // El middleware redirige antes de renderizar el 404: así un anónimo no
    // puede sondear qué rutas privadas existen comparando 404 contra redirect.
    await expect(page).toHaveURL(/\/login/);
  });
});

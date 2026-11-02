// @ts-check
const { test, expect } = require("@playwright/test");

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "admin@dsv.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "Blacko2026$$$";

async function login(page) {
  await page.goto("/admin/login");
  await expect(page.locator("#login-form")).toBeVisible();
  await page.fill("#login-email", ADMIN_EMAIL);
  await page.fill("#login-password", ADMIN_PASSWORD);
  await page.click("#login-submit");
  await page.waitForURL(/\/admin\/app\/?$/);
  await expect(page.locator("#view-root")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Welcome Back/i })).toBeVisible({ timeout: 20_000 });
}

async function goNav(page, label) {
  await page.locator("#side-nav").getByRole("button", { name: label, exact: true }).click();
}

async function pickAddress(page, inputSelector, query) {
  const field = page.locator(`[data-address-field]`).filter({ has: page.locator(inputSelector) });
  const input = field.locator(inputSelector);
  await input.click();
  await input.fill("");
  await input.pressSequentially(query, { delay: 40 });
  const suggest = field.locator(".address-suggest__item").first();
  await expect(suggest).toBeVisible({ timeout: 30_000 });
  await suggest.click();
  await expect(field).toHaveClass(/is-mapped/, { timeout: 10_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("Admin dashboard E2E (Chromium)", () => {
  test("rejects bad login credentials", async ({ page }) => {
    await page.goto("/admin/login");
    await page.fill("#login-email", "wrong@dsv.com");
    await page.fill("#login-password", "not-the-password");
    await page.click("#login-submit");
    await expect(page.locator("#login-error")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("create → edit → hold → release → cancel with toasts + nav smoke + logout", async ({ page, request }) => {
    const stamp = Date.now().toString().slice(-6);

    await login(page);
    await expect(page.locator("#admin-name")).toContainText(/Admin/i);
    await expect(page.getByRole("heading", { name: /Live shipment map/i })).toBeVisible();

    // Notifications modal
    await page.locator("#btn-notifications").click();
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
    await page.getByRole("button", { name: /Close notifications/i }).click();

    // Create a fresh shipment so actions never depend on demo/seed data
    await goNav(page, "Shipments");
    await page.getByRole("button", { name: "Create shipment" }).first().click();
    await expect(page.locator("#create-shipment-form")).toBeVisible();
    await page.fill("#sender", `PW Sender ${stamp}`);
    await page.fill("#receiver", `PW Receiver ${stamp}`);
    await page.fill("#package-content", `Playwright parcel ${stamp}`);
    await pickAddress(page, "#from-location", "Washington DC");
    await pickAddress(page, "#to-location", "Baltimore MD");
    await page.locator("#btn-preview-route").click();
    await expect(page.locator("#route-preview")).toBeVisible({ timeout: 45_000 });
    await page.locator("#btn-save-shipment").click();
    await expect(page.locator(".admin-toast--success").filter({ hasText: /Shipment created/i })).toBeVisible({
      timeout: 45_000
    });
    await expect(page.locator("#view-root")).toContainText(new RegExp(`PW Sender ${stamp}|PW Receiver ${stamp}`), {
      timeout: 20_000
    });

    const newRow = page.locator("table.shipments-table tbody tr").filter({
      hasText: new RegExp(`PW Sender ${stamp}|PW Receiver ${stamp}`)
    }).first();
    await expect(newRow).toBeVisible();
    const idMatch = (await newRow.innerText()).match(/[A-Z0-9]{6,24}/);
    expect(idMatch).toBeTruthy();
    const trackingId = idMatch[0];

    if (await page.locator("#drawer.is-open").count()) {
      await page.locator("#drawer-close").click();
    }
    await newRow.getByRole("button", { name: "View" }).click();
    await expect(page.locator("#drawer.is-open")).toBeVisible();
    await expect(page.locator("#drawer-public")).toHaveAttribute("href", /shipment-details-public/);

    // Edit details
    await page.getByRole("button", { name: "Edit details" }).click();
    await expect(page.locator("#edit-shipment-form")).toBeVisible();
    await page.fill("#edit-package", `PW edited ${stamp}`);
    await page.locator("#edit-save").click();
    await expect(page.locator(".admin-toast--success").filter({ hasText: /Changes saved/i })).toBeVisible({
      timeout: 20_000
    });
    await expect(page.locator("#drawer-body")).toContainText(`PW edited ${stamp}`);

    // Hold
    await page.locator('[data-shipment-action="hold"]').click();
    await expect(page.locator("#reason-modal")).toBeVisible();
    await page.fill("#reason-modal-input", `PW hold ${stamp}`);
    await page.click("#reason-modal-confirm");
    await expect(page.locator(".admin-toast--success").filter({ hasText: /on hold/i })).toBeVisible({
      timeout: 20_000
    });
    await expect(page.locator("#drawer-status")).toContainText(/On Hold|Hold/i, { timeout: 20_000 });
    await expect(page.locator("#drawer-body")).toContainText(`PW hold ${stamp}`);

    // Release
    await page.locator('[data-shipment-action="release-hold"]').click();
    await expect(page.locator("#reason-modal")).toBeVisible();
    await page.fill("#reason-modal-input", `PW release ${stamp}`);
    await page.click("#reason-modal-confirm");
    await expect(page.locator(".admin-toast--success").filter({ hasText: /Hold released/i })).toBeVisible({
      timeout: 20_000
    });
    await expect(page.locator("#drawer-status")).toContainText(/In Transit|Out For Delivery|Pending|Label Created/i, {
      timeout: 20_000
    });

    // Cancel
    await page.locator('[data-shipment-action="cancel"]').click();
    await expect(page.locator("#reason-modal")).toBeVisible();
    await page.fill("#reason-modal-input", `PW cancel ${stamp}`);
    await page.click("#reason-modal-confirm");
    await expect(page.locator(".admin-toast--success").filter({ hasText: /cancelled/i })).toBeVisible({
      timeout: 20_000
    });
    await expect(page.locator("#drawer-status")).toContainText(/Cancelled/i, { timeout: 20_000 });
    await expect(page.locator("#drawer-body")).toContainText(`PW cancel ${stamp}`);
    await page.locator("#drawer-close").click();

    // API confirms cancelled state (no silent UI-only update)
    const loginRes = await request.post("/api/admin/login", {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
    });
    expect(loginRes.ok()).toBeTruthy();
    const list = await (await request.get("/api/admin/shipments")).json();
    const row = (list.shipments || []).find((s) => s.id === trackingId);
    expect(row).toBeTruthy();
    expect(row.status).toBe("cancelled");
    expect(row.cancelReason).toBe(`PW cancel ${stamp}`);
    expect(row.packageContent).toBe(`PW edited ${stamp}`);

    // Nav smoke
    for (const label of ["Live Tracking", "Customers", "Fleet Management", "Reports & Analytics", "Help & Support"]) {
      await goNav(page, label);
      await expect(page.locator("#view-root")).toBeVisible();
    }

    // Search finds the created id
    await goNav(page, "Shipments");
    await page.fill("#global-search", trackingId);
    await expect(page.locator("#view-root")).toContainText(trackingId, { timeout: 10_000 });

    // Logout + guard
    await page.locator("#btn-logout").click();
    await page.waitForURL(/\/admin\/login/);
    await expect(page.locator("#login-form")).toBeVisible();
    await page.goto("/admin/app");
    await page.waitForURL(/\/admin\/login/);
  });
});

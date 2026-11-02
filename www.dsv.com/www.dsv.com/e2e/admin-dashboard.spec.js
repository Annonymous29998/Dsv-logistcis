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

  test("logs in and exercises dashboard + shipments + create + hold + support + logout", async ({ page }) => {
    const stamp = Date.now().toString().slice(-6);
    const createdIds = [];

    // --- Login ---
    await login(page);
    await expect(page.locator("#admin-name")).toContainText(/Admin/i);

    // --- Dashboard map controls ---
    await expect(page.getByRole("heading", { name: /Live shipment map/i })).toBeVisible();
    const zoomIn = page.getByRole("button", { name: /Zoom in/i });
    if (await zoomIn.isVisible()) {
      await zoomIn.click();
      await page.getByRole("button", { name: /Zoom out/i }).click();
    }
    const nextRoute = page.getByRole("button", { name: /Next active shipment/i });
    if (await nextRoute.isVisible()) {
      await nextRoute.click();
      await page.getByRole("button", { name: /Previous active shipment/i }).click();
    }

    // --- Notifications modal ---
    await page.locator("#btn-notifications").click();
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
    await page.getByRole("button", { name: /Close notifications/i }).click();
    await expect(page.getByRole("heading", { name: "Notifications" })).toHaveCount(0);

    // --- Shipments list ---
    await goNav(page, "Shipments");
    await expect(page.getByRole("heading", { name: "Shipments", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create shipment" }).first()).toBeVisible();

    // Open first shipment drawer
    const firstView = page.getByRole("button", { name: "View" }).first();
    await expect(firstView).toBeVisible();
    await firstView.click();
    await expect(page.locator("#drawer")).toBeVisible();
    await expect(page.locator("#drawer-title")).not.toHaveText("—");
    await expect(page.locator("#drawer-body")).toContainText(/Scan timeline|Sender|Receiver|From|To/i);
    await expect(page.locator("#drawer-public")).toHaveAttribute("href", /shipment-details-public/);

    // Edit details modal open/cancel
    await page.getByRole("button", { name: "Edit details" }).click();
    await expect(page.locator("#edit-shipment-form")).toBeVisible();
    await page.locator('.create-modal [data-edit-dismiss="1"].btn').click();
    await expect(page.locator("#edit-shipment-form")).toHaveCount(0);

    // Prefer an in-transit row for hold/release
    await page.locator("#drawer-close").click();
    const inTransitView = page.locator("tbody tr, .shipments-table tr, tr").filter({ hasText: /In Transit/i }).first().getByRole("button", { name: "View" });
    if (await inTransitView.count()) {
      await inTransitView.click();
    } else {
      await firstView.click();
    }
    await expect(page.locator("#drawer.is-open")).toBeVisible();

    const holdBtn = page.locator('[data-shipment-action="hold"]');
    await expect(holdBtn).toBeVisible({ timeout: 10_000 });
    await holdBtn.click();
    await expect(page.locator("#reason-modal")).toBeVisible();
    await page.fill("#reason-modal-input", `Playwright hold ${stamp}`);
    await page.click("#reason-modal-confirm");
    await expect(page.locator("#drawer-status")).toContainText(/On Hold|Hold/i, { timeout: 20_000 });

    const releaseBtn = page.locator('[data-shipment-action="release-hold"]');
    await expect(releaseBtn).toBeVisible({ timeout: 10_000 });
    await releaseBtn.click();
    await expect(page.locator("#reason-modal")).toBeVisible();
    await page.fill("#reason-modal-input", `Playwright release ${stamp}`);
    await page.click("#reason-modal-confirm");
    await expect(page.locator("#drawer-status")).toContainText(/In Transit|Out For Delivery|Pending/i, { timeout: 20_000 });

    await page.locator("#drawer-close").click();

    // --- Create shipment via UI ---
    await page.getByRole("button", { name: "Create shipment" }).first().click();
    await expect(page.locator("#create-shipment-form")).toBeVisible();
    await page.fill("#sender", `PW Sender ${stamp}`);
    await page.fill("#receiver", `PW Receiver ${stamp}`);
    await page.fill("#package-content", `Playwright parcel ${stamp}`);

    await pickAddress(page, "#from-location", "Washington DC");
    await pickAddress(page, "#to-location", "Baltimore MD");

    // Preview route (optional but exercises geo)
    await page.locator("#btn-preview-route").click();
    await expect(page.locator("#route-preview")).toBeVisible({ timeout: 45_000 });
    await expect(page.locator("#route-preview")).toContainText(/Route travel history|km|LABEL CREATED|IN TRANSIT/i);

    await page.locator("#btn-save-shipment").click();
    await expect(page.locator("#create-shipment-form")).toHaveCount(0, { timeout: 45_000 });

    // New row should appear (sender or tracking id visible)
    await expect(page.locator("#view-root")).toContainText(new RegExp(`PW Sender ${stamp}|PW Receiver ${stamp}`), {
      timeout: 20_000
    });

    // Close any leftover drawer/modal before opening the new row
    if (await page.locator("#drawer.is-open").count()) {
      await page.locator("#drawer-close").click();
      await expect(page.locator("#drawer.is-open")).toHaveCount(0);
    }

    const newRow = page.locator("table.shipments-table tbody tr").filter({
      hasText: new RegExp(`PW Sender ${stamp}|PW Receiver ${stamp}`)
    }).first();
    await expect(newRow).toBeVisible();
    const idText = (await newRow.innerText()).match(/[A-Z0-9]{6,24}/);
    if (idText) createdIds.push(idText[0]);
    await newRow.getByRole("button", { name: "View" }).click();
    await expect(page.locator("#drawer.is-open")).toBeVisible();
    await expect(page.locator("#drawer-body")).toContainText(/Scan timeline|LABEL CREATED|IN TRANSIT/i);
    await page.locator("#drawer-close").click();
    await expect(page.locator("#drawer.is-open")).toHaveCount(0);

    // --- Live Tracking ---
    await goNav(page, "Live Tracking");
    await expect(page.locator("#view-root")).toContainText(/Live|Map|Tracking|shipment/i);

    // --- Customers / Fleet / Reports smoke ---
    for (const label of ["Customers", "Fleet Management", "Reports & Analytics"]) {
      await goNav(page, label);
      await expect(page.locator("#view-root")).not.toBeEmpty();
      await expect(page.locator("#view-root")).toBeVisible();
    }

    // --- Help & Support ---
    await goNav(page, "Help & Support");
    await expect(page.getByRole("heading", { name: /Help & Support/i })).toBeVisible();

    // Seed a visitor chat in same browser storage, then open it
    await page.evaluate(() => {
      const key = "dsv-live-support-chats";
      const now = new Date().toISOString();
      const chats = [
        {
          id: "pw-chat-" + Date.now(),
          name: "Playwright Visitor",
          status: "open",
          updatedAt: now,
          createdAt: now,
          ip: "127.0.0.1",
          country: "Local",
          countryCode: "LO",
          geoLabel: "Localhost",
          messages: [
            { from: "customer", text: "Playwright: need tracking help", at: Date.now() }
          ]
        }
      ];
      try {
        const existing = JSON.parse(localStorage.getItem(key) || "[]");
        localStorage.setItem(key, JSON.stringify(chats.concat(Array.isArray(existing) ? existing : [])));
        new BroadcastChannel("dsv-live-support").postMessage({ type: "chats-updated" });
      } catch (e) {
        localStorage.setItem(key, JSON.stringify(chats));
      }
    });
    await page.reload();
    await page.waitForURL(/\/admin\/app/);
    // May bounce to login if session cookie missing after reload — re-login if needed
    if (page.url().includes("/admin/login")) {
      await login(page);
    }
    await goNav(page, "Help & Support");
    const thread = page.getByRole("button").filter({ hasText: /Playwright Visitor|Playwright: need tracking help/i }).first();
    await expect(thread).toBeVisible({ timeout: 15_000 });
    await thread.click();
    await expect(page.locator("#chat-drawer")).toBeVisible();
    await expect(page.locator("#chat-drawer-title")).toContainText(/Playwright Visitor|Conversation/i);
    await page.fill("#chat-drawer-input", `Agent reply ${stamp}`);
    await page.locator("#chat-drawer-form button[type='submit']").click();
    await expect(page.locator("#chat-drawer-msgs")).toContainText(`Agent reply ${stamp}`);
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("#chat-drawer-end").click();
    await expect(page.locator("#chat-drawer-end")).toBeDisabled({ timeout: 10_000 });
    await expect(page.locator("#chat-drawer-end")).toHaveText(/Conversation ended/i);
    await page.locator("#chat-drawer-close").click();

    // --- Global search ---
    await goNav(page, "Shipments");
    await page.fill("#global-search", "DEMO100000001");
    await page.waitForTimeout(400);
    await expect(page.locator("#view-root")).toContainText(/DEMO100000001|Jordan|Washington/i);

    // --- Logout ---
    await page.locator("#btn-logout").click();
    await page.waitForURL(/\/admin\/login/);
    await expect(page.locator("#login-form")).toBeVisible();

    // Guard: app should bounce guests
    await page.goto("/admin/app");
    await page.waitForURL(/\/admin\/login/);
  });
});

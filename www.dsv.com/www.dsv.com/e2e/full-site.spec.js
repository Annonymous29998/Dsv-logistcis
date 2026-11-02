// @ts-check
const { test, expect } = require("@playwright/test");

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "admin@dsv.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "Blacko2026$$$";
const BASE = process.env.E2E_BASE_URL || "http://127.0.0.1:8080";

async function apiLogin(request) {
  const res = await request.post(`${BASE}/api/admin/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
  });
  expect(res.ok()).toBeTruthy();
  return res;
}

async function clearShipments(request) {
  await apiLogin(request);
  const list = await request.get(`${BASE}/api/admin/shipments`);
  const body = await list.json();
  const ids = (body.shipments || []).map((s) => s.id);
  for (const id of ids) {
    const del = await request.delete(`${BASE}/api/admin/shipments/${id}`);
    expect(del.ok(), `delete ${id}`).toBeTruthy();
  }
  const after = await (await request.get(`${BASE}/api/admin/shipments`)).json();
  expect((after.shipments || []).length).toBe(0);
}

async function adminUiLogin(page) {
  await page.goto("/admin/login");
  await page.fill("#login-email", ADMIN_EMAIL);
  await page.fill("#login-password", ADMIN_PASSWORD);
  await page.click("#login-submit");
  await page.waitForURL(/\/admin\/app\/?$/);
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
  await input.pressSequentially(query, { delay: 35 });
  const suggest = field.locator(".address-suggest__item").first();
  await expect(suggest).toBeVisible({ timeout: 30_000 });
  await suggest.click();
  await expect(field).toHaveClass(/is-mapped/, { timeout: 10_000 });
}

async function clearVisitorChat(page) {
  await page.goto("/");
  await page.evaluate(() => {
    try {
      localStorage.removeItem("dsv-support-session-id");
      Object.keys(localStorage)
        .filter((k) => k.indexOf("dsv") === 0)
        .forEach((k) => localStorage.removeItem(k));
    } catch (e) {}
  });
}

async function clearSupportInbox(request) {
  const login = await request.post("/api/admin/login", {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
  });
  expect(login.ok()).toBeTruthy();
  const wipe = await request.delete("/api/admin/support");
  expect(wipe.ok()).toBeTruthy();
}

test.describe.configure({ mode: "serial" });

test.describe("Full site E2E after DB clear (Chromium)", () => {
  /** @type {string} */
  let createdId = "";
  const stamp = Date.now().toString().slice(-6);

  test("clears shipment database", async ({ request }) => {
    await clearShipments(request);
  });

  test("admin login, dashboard empty state, create shipment, hold/release, map", async ({ page }) => {
    await adminUiLogin(page);

    // Dashboard loads with empty book
    await expect(page.getByRole("heading", { name: /Welcome Back/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Live shipment map/i })).toBeVisible();

    // Notifications open/close
    await page.locator("#btn-notifications").click();
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
    await page.getByRole("button", { name: /Close notifications/i }).click();

    // Shipments empty
    await goNav(page, "Shipments");
    await expect(page.getByRole("heading", { name: "Shipments", exact: true })).toBeVisible();
    await expect(page.locator("#view-root")).toContainText(/No shipments match your filters|Create shipment/i);

    // Create shipment
    await page.getByRole("button", { name: "Create shipment" }).first().click();
    await expect(page.locator("#create-shipment-form")).toBeVisible();
    await page.fill("#sender", `E2E Sender ${stamp}`);
    await page.fill("#receiver", `E2E Receiver ${stamp}`);
    await page.fill("#package-content", `E2E parcel ${stamp}`);
    await pickAddress(page, "#from-location", "Washington DC");
    await pickAddress(page, "#to-location", "Baltimore MD");
    await page.locator("#btn-preview-route").click();
    await expect(page.locator("#route-preview")).toBeVisible({ timeout: 45_000 });
    await expect(page.locator("#route-preview")).toContainText(/LABEL CREATED|IN TRANSIT|km/i);
    await page.locator("#btn-save-shipment").click();
    await expect(page.locator(".admin-toast--success").filter({ hasText: /Shipment created/i })).toBeVisible({
      timeout: 45_000
    });
    await expect(page.locator("#create-shipment-form")).toHaveCount(0, { timeout: 45_000 });
    await expect(page.locator("#view-root")).toContainText(new RegExp(`E2E Sender ${stamp}|E2E Receiver ${stamp}`), {
      timeout: 20_000
    });

    const row = page.locator("table.shipments-table tbody tr").filter({
      hasText: new RegExp(`E2E Sender ${stamp}|E2E Receiver ${stamp}`)
    }).first();
    await expect(row).toBeVisible();
    const idMatch = (await row.innerText()).match(/[A-Z0-9]{6,24}/);
    expect(idMatch).toBeTruthy();
    createdId = idMatch[0];

    if (await page.locator("#drawer.is-open").count()) {
      await page.locator("#drawer-close").click();
    }

    await row.getByRole("button", { name: "View" }).click();
    await expect(page.locator("#drawer.is-open")).toBeVisible();
    await expect(page.locator("#drawer-body")).toContainText(/Scan timeline|LABEL CREATED|IN TRANSIT/i);

    // Edit details + toast
    await page.locator('[data-shipment-action="edit"]').click();
    await expect(page.locator("#edit-shipment-form")).toBeVisible();
    await page.fill("#edit-package", `E2E edited parcel ${stamp}`);
    await page.locator("#edit-save").click();
    await expect(page.locator(".admin-toast--success").filter({ hasText: /Changes saved/i })).toBeVisible({
      timeout: 20_000
    });
    await expect(page.locator("#edit-shipment-form")).toHaveCount(0);
    await expect(page.locator("#drawer-body")).toContainText(`E2E edited parcel ${stamp}`);

    // Hold + toast + reason visible
    await page.locator('[data-shipment-action="hold"]').click();
    await expect(page.locator("#reason-modal")).toBeVisible();
    await page.fill("#reason-modal-input", `E2E hold ${stamp}`);
    await page.click("#reason-modal-confirm");
    await expect(page.locator(".admin-toast--success").filter({ hasText: /on hold/i })).toBeVisible({
      timeout: 20_000
    });
    await expect(page.locator("#drawer-status")).toContainText(/On Hold|Hold/i, { timeout: 20_000 });
    await expect(page.locator("#drawer-body")).toContainText(`E2E hold ${stamp}`);

    // Release hold
    await page.locator('[data-shipment-action="release-hold"]').click();
    await expect(page.locator("#reason-modal")).toBeVisible();
    await page.fill("#reason-modal-input", `E2E release ${stamp}`);
    await page.click("#reason-modal-confirm");
    await expect(page.locator(".admin-toast--success").filter({ hasText: /Hold released/i })).toBeVisible({
      timeout: 20_000
    });
    await expect(page.locator("#drawer-status")).toContainText(/In Transit|Out For Delivery|Pending|Label Created/i, {
      timeout: 20_000
    });

    // Cancel shipment + toast
    await page.locator('[data-shipment-action="cancel"]').click();
    await expect(page.locator("#reason-modal")).toBeVisible();
    await page.fill("#reason-modal-input", `E2E cancel ${stamp}`);
    await page.click("#reason-modal-confirm");
    await expect(page.locator(".admin-toast--success").filter({ hasText: /cancelled/i })).toBeVisible({
      timeout: 20_000
    });
    await expect(page.locator("#drawer-status")).toContainText(/Cancelled/i, { timeout: 20_000 });
    await expect(page.locator("#drawer-body")).toContainText(`E2E cancel ${stamp}`);
    await expect(page.locator('[data-shipment-action="hold"]')).toHaveCount(0);
    await expect(page.locator('[data-shipment-action="cancel"]')).toHaveCount(0);
    await page.locator("#drawer-close").click();

    // Live Tracking + other nav sections
    await goNav(page, "Live Tracking");
    await expect(page.locator("#view-root")).toContainText(/Live|Moving|Tracking|Map/i);
    for (const label of ["Customers", "Fleet Management", "Reports & Analytics", "Help & Support"]) {
      await goNav(page, label);
      await expect(page.locator("#view-root")).toBeVisible();
    }

    // Dashboard map with the new shipment
    await goNav(page, "Dashboard");
    await expect(page.getByRole("heading", { name: /Welcome Back/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /Live shipment map/i })).toBeVisible();
    // Close any leftover toast/overlay that can intercept Leaflet controls.
    await page.evaluate(() => {
      document.querySelectorAll(".admin-toast-host, .admin-toast").forEach((el) => el.remove());
      document.body.classList.remove("nav-open", "create-modal-open");
      const overlay = document.getElementById("nav-overlay");
      if (overlay) overlay.hidden = true;
    });
    const zoomIn = page.locator("#dashboard-live-map").getByRole("button", { name: /Zoom in/i });
    if (await zoomIn.isVisible().catch(() => false)) {
      await zoomIn.click({ force: true });
      await page.locator("#dashboard-live-map").getByRole("button", { name: /Zoom out/i }).click({ force: true });
    }
  });

  test("API integration: create → edit → hold → release → cancel", async ({ request }) => {
    await apiLogin(request);
    const stampApi = Date.now().toString().slice(-6);
    const create = await request.post("/api/admin/shipments", {
      data: {
        sender: `API Sender ${stampApi}`,
        receiver: `API Receiver ${stampApi}`,
        fromLocation: "Washington, District of Columbia, United States",
        toLocation: "Baltimore, Maryland, United States",
        fromLat: 38.9072,
        fromLon: -77.0369,
        toLat: 39.2904,
        toLon: -76.6122,
        packageContent: `API parcel ${stampApi}`,
        serviceType: "DSV Road",
        status: "in-transit",
        transitHours: 72
      }
    });
    expect(create.ok(), await create.text()).toBeTruthy();
    const created = await create.json();
    const id = created.id;
    expect(id).toBeTruthy();

    const edited = await request.patch(`/api/admin/shipments/${id}`, {
      data: { action: "edit", packageContent: `API edited ${stampApi}`, reason: "api edit" }
    });
    expect(edited.ok(), await edited.text()).toBeTruthy();
    expect((await edited.json()).shipment.packageContent).toContain(`API edited ${stampApi}`);

    const held = await request.patch(`/api/admin/shipments/${id}`, {
      data: { action: "hold", reason: `API hold ${stampApi}` }
    });
    expect(held.ok(), await held.text()).toBeTruthy();
    const heldBody = await held.json();
    expect(heldBody.shipment.status).toBe("on-hold");
    expect(heldBody.shipment.holdReason).toBe(`API hold ${stampApi}`);

    const released = await request.patch(`/api/admin/shipments/${id}`, {
      data: { action: "release-hold", note: `API release ${stampApi}` }
    });
    expect(released.ok(), await released.text()).toBeTruthy();
    expect((await released.json()).shipment.status).not.toBe("on-hold");

    const cancelled = await request.patch(`/api/admin/shipments/${id}`, {
      data: { action: "cancel", reason: `API cancel ${stampApi}` }
    });
    expect(cancelled.ok(), await cancelled.text()).toBeTruthy();
    const cancelledBody = await cancelled.json();
    expect(cancelledBody.shipment.status).toBe("cancelled");
    expect(cancelledBody.shipment.cancelReason).toBe(`API cancel ${stampApi}`);

    const listed = await (await request.get("/api/admin/shipments")).json();
    const row = (listed.shipments || []).find((s) => s.id === id);
    expect(row).toBeTruthy();
    expect(row.status).toBe("cancelled");
    expect(row.cancelReason).toBe(`API cancel ${stampApi}`);
  });

  test("homepage track form + public details for created shipment", async ({ page }) => {
    test.skip(!createdId, "No shipment created");
    await clearVisitorChat(page);

    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Track your package|Track your shipment/i }).first()).toBeVisible({
      timeout: 15_000
    });

    const trackInput = page.locator("#track-shipment input[name='id'], form.js-tracking-form input[name='id']").first();
    await trackInput.fill(createdId);
    await page.locator("#track-shipment button[type='submit'], form.js-tracking-form button[type='submit']").first().click();
    await page.waitForURL(new RegExp(`shipment-details-public\\?id=${createdId}`), { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: new RegExp(`Shipment ${createdId}`) })).toBeVisible();
    await expect(page.locator("body")).toContainText(/E2E Sender|E2E Receiver|Sender|Receiver/i);
  });

  test("homepage chat FAQ + live desk status + admin reply + typing + end", async ({ browser, request }) => {
    await clearSupportInbox(request);

    const visitor = await browser.newContext();
    const admin = await browser.newContext();
    const vPage = await visitor.newPage();
    const aPage = await admin.newPage();

    try {
      await clearVisitorChat(vPage);

      // Visitor: FAQ chip (persisted via backend)
      await vPage.goto("/");
      await vPage.getByRole("button", { name: "Open DSV Support chat" }).click();
      await expect(vPage.locator("#dialog-id-stage-chatbot")).toBeVisible();
      await vPage.getByRole("button", { name: "How do I track a shipment?" }).click();
      await expect(vPage.locator("#dsv-chat-messages")).toContainText(/tracking|Track/i, { timeout: 10_000 });

      // Visitor: free-text → centered live-desk status (not a bubble)
      await vPage.fill("#dsv-chat-name", `Visitor ${stamp}`);
      await vPage.fill("#dsv-chat-input", `E2E live help please ${stamp}`);
      await vPage.locator("#dsv-chat-form").locator('button[type="submit"]').click();
      await expect(vPage.locator("#dsv-chat-status")).toBeVisible({ timeout: 10_000 });
      await expect(vPage.locator("#dsv-chat-status")).toContainText(/live support desk|agent will reply soon/i);

      // Separate admin browser context — no localStorage copy; server inbox only.
      await adminUiLogin(aPage);
      await goNav(aPage, "Help & Support");
      await expect(aPage.getByRole("heading", { name: /Help & Support/i })).toBeVisible();
      const thread = aPage.getByRole("button").filter({ hasText: new RegExp(`Visitor ${stamp}|E2E live help please ${stamp}`) }).first();
      await expect(thread).toBeVisible({ timeout: 20_000 });
      await thread.click();
      await expect(aPage.locator("#chat-drawer.is-open, #chat-drawer")).toBeVisible();

      // First open → visitor poll sees agent connected
      await expect(vPage.locator("#dsv-chat-status")).toContainText(/agent has been connected/i, { timeout: 15_000 });

      // Admin typing → visitor typing dots via server typingAgentAt
      await aPage.locator("#chat-drawer-input").click();
      await aPage.locator("#chat-drawer-input").pressSequentially("Typing now…", { delay: 40 });
      await expect(vPage.locator(".dsv-support-chat__msg--typing")).toBeVisible({ timeout: 15_000 });

      // Admin reply → visitor poll sees Support: reply
      await aPage.fill("#chat-drawer-input", `Support reply ${stamp}`);
      await aPage.locator("#chat-drawer-form button[type='submit']").click();
      await expect(aPage.locator("#chat-drawer-msgs")).toContainText(`Support reply ${stamp}`);
      await expect(vPage.locator("#dsv-chat-messages")).toContainText(`Support reply ${stamp}`, { timeout: 15_000 });

      // End conversation → visitor ended panel via poll
      aPage.once("dialog", (d) => d.accept());
      await aPage.locator("#chat-drawer-end").click();
      await expect(aPage.locator("#chat-drawer-end")).toBeDisabled({ timeout: 10_000 });
      await expect(vPage.locator("#dsv-chat-ended")).toBeVisible({ timeout: 15_000 });
      await expect(vPage.getByRole("button", { name: /Open a new conversation/i })).toBeVisible();
    } finally {
      await visitor.close();
      await admin.close();
    }
  });

  test("admin logout guards the app", async ({ page }) => {
    await adminUiLogin(page);
    await page.locator("#btn-logout").click();
    await page.waitForURL(/\/admin\/login/);
    await page.goto("/admin/app");
    await page.waitForURL(/\/admin\/login/);
  });
});

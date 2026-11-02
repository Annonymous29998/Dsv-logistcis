#!/usr/bin/env node
/**
 * One-time import of resource/data/shipments.json into Supabase.
 *
 * Usage (from www.dsv.com/www.dsv.com):
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-supabase.js
 */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { shipmentToRow } = require("../api/_lib/supabase");

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const file = path.join(__dirname, "..", "resource", "data", "shipments.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const rows = Object.entries(raw).map(([id, item]) =>
    shipmentToRow(id, {
      ...item,
      deliveryStatus: item.deliveryStatus,
      serviceType: item.serviceType,
      estimatedDelivery: item.estimatedDelivery,
      deliveryTime: item.deliveryTime,
      packageContent: item.packageContent,
      signatureRequired: item.signatureRequired,
      fromLocation: item.fromLocation,
      toLocation: item.toLocation,
      statusNearPlace: item.statusNearPlace,
      labelCreatedDate: item.labelCreatedDate,
      outForDeliveryToday: item.outForDeliveryToday,
      routeStops: item.routeStops || [],
      plannedEvents: item.plannedEvents || [],
      createdAt: item.createdAt || new Date().toISOString()
    })
  );

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await supabase.from("shipments").upsert(rows);
  if (error) {
    console.error(error);
    process.exit(1);
  }
  console.log(`Seeded ${rows.length} shipments into Supabase.`);
}

main();

# Supabase + Vercel setup

Trackings are stored in **Supabase PostgreSQL**. Admin APIs are **Vercel serverless Node functions** under `www.dsv.com/www.dsv.com/api` — you do **not** need to deploy Python to Vercel.

## 1. Create the database table

In Supabase → SQL Editor, run:

`supabase/schema.sql`

That single table covers:

- **Create** tracking (admin)
- **Public track by ID** (`/api/tracking/:id`)
- **Edit** shipment details
- **Hold** + required reason (shown on tracking page)
- **Release hold**
- **Cancel** + required reason
- **Delete** shipment

If you already ran an older schema, also run `supabase/schema_patch_if_already_created.sql`.

## 2. Configure environment variables

In Vercel project settings (and locally in `www.dsv.com/www.dsv.com/.env`):

```
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=your-anon-public-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ADMIN_EMAIL=admin@dsv.com
ADMIN_PASSWORD=choose-a-strong-password
ADMIN_SESSION_SECRET=long-random-secret
```

Use the **service role** key only on the server (Vercel env).  
The **anon** key is safe for the browser and powers **live updates** (no refresh) when admin changes a shipment.

Also in Supabase → Database → Replication, confirm `shipments` is enabled for Realtime (the schema SQL adds it).

## 3. Deploy on Vercel

- Set the Vercel **Root Directory** to `www.dsv.com/www.dsv.com`
- Install/build uses `package.json` in that folder
- Deploy

## 4. Local development

Prefer the Python server (Supabase-backed APIs):

```bash
python3 serve.py
```

Or Vercel-style local APIs:

```bash
cd www.dsv.com/www.dsv.com
npm install
npx vercel dev
```

Both serve the static site and `/api/*` against Supabase. Do not use a static-only “Go Live” / Live Server for admin or tracking.

`serve.py` can still be used for static browsing, but create-tracking + address search + DB persistence are meant to run through the Node `/api` routes with Supabase.

# Copi-Yum prototype — Vercel + Supabase

This is the phone-first version for a Vercel website and a Supabase database. The computer can be off after deployment. Customers save a private card link and show a fresh QR for each purchase. Every successful paid scan adds one stamp; five stamps unlock one free coffee. Both phones show scan feedback. Staff sign in with an email link and do not create a password.

The database schema has been applied to Supabase. The Vercel and Supabase projects have been connected. Upload the latest changed files to GitHub before testing staff sign-in.

## What to set up

1. **Supabase:** Create a project. Open **SQL Editor**, paste all of [`supabase/setup.sql`](supabase/setup.sql), and run it once. The tables use Row Level Security with no browser policies; the Vercel server function is the database client.
2. **Supabase email sign-in:** Keep email sign-in enabled. The default email template sends a clickable link; no template edit is needed. In **Authentication → URL Configuration**, set **Site URL** to the Vercel production URL and add `https://copi-yummm-copi-yum-vercel.vercel.app/staff/` to **Redirect URLs**. Supabase's default email service sends only to addresses on your Supabase project team and is limited to about two emails per hour. It is suitable for a small demo using your own team email. For Che and Seal's separate addresses or wider testing, configure custom SMTP first. Do not add people to the Supabase project team just to receive login email: team membership can grant access to the project dashboard.
3. **GitHub:** Upload changed files to `Copi-Yum-logger/copi-yum-vercel` in the `silz298/Copi-Yummm` repository, preserving their subfolders. Do not upload `.env`, passwords, or database exports. The `node_modules` folder is omitted by `.gitignore`.
4. **Vercel:** The GitHub repository is connected to the Vercel project with root directory `Copi-Yum-logger/copi-yum-vercel`. The `vercel.json` selects the Other framework, runs `npm run build`, serves `public`, and routes `/api/*` to the server function. Vercel will rebuild on later GitHub pushes.
5. **Vercel environment variables:** The Supabase integration supplies the database URL, Supabase URL, and publishable key. In project **Settings → Environment Variables**, add `STAFF_EMAILS` for Production and Preview as needed. Redeploy after adding it.

| Name | Where to get it |
| --- | --- |
| `DATABASE_URL` | Optional when the Vercel integration supplies `POSTGRES_URL` or `POSTGRES_URI`. Otherwise use the Supabase **Connect → Transaction pooler** URI. Keep it private. |
| `SUPABASE_URL` | Optional when the integration supplies `NEXT_PUBLIC_SUPABASE_URL`. |
| `SUPABASE_ANON_KEY` | Optional when the integration supplies `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY`. |
| `STAFF_EMAILS` | Exact allowed emails and display names, e.g. `che@example.com=Che,seal@example.com=Seal`. |

If the database password includes special characters, use the URL-encoded password in `DATABASE_URL`. The transaction pooler uses port `6543`. Copy the actual URI from the Supabase dashboard rather than the example in `.env.example`.

## Test after deployment

1. Open the Vercel URL on a phone. Create a card and save its private link.
2. Open the same URL with `/staff/` at the end. Enter an allowed email and tap the link sent to its inbox.
3. Make a new customer QR, scan it from the staff phone, and confirm both screens report one stamp.
4. Scan the same QR again. It must say **Already scanned** and add no stamp.
5. Add four more paid stamps, then redeem a free coffee with a fresh QR. Check the log and CSV exports.

Customer card links act as access keys: anyone with a link can view that card and request its QR. Customers should keep the link private. The hosted database starts empty; it does not import cards from the earlier local SQLite app.

## Cost and prototype limits

Vercel's free **Hobby** plan is restricted to non-commercial personal use. A commissioned prototype may count as commercial work under Vercel's terms; use a suitable Vercel plan before deploying paid/client work. Supabase's free plan has database and email limits. This repository is a prototype, not a promise that these services will remain free or sufficient at a larger scale.

## Local checks

```powershell
npm ci
npm run build
npm test
```

The SQL test uses an in-memory Postgres engine to check old QR invalidation, repeated scans, five stacked stamps, and reward redemption. It does not replace the final two-phone check on your deployed Vercel site.

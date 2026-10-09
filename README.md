# S-CUBUS Operations Control System

One place for S-Cubus Career Pvt Ltd day-to-day operations:

**Capture once → connect data → summarise automatically → alert the right person → take action.**

## What it does

- **Registers & logs**: 18 built-in digital registers (security/guard shift log, visitor register with Parent / Student / Other, inward/outward with inventory link, delivery, courier, keys, vehicle, housekeeping, maintenance, incidents, lost & found, opening/closing checklists, staff movement, reception, utility, equipment handover, meeting room) plus a **Register Builder** to create new ones without code: 21 field types, required/optional, drag to reorder, deadlines.
- **Accountability**: every entry stores who and when; edits need a reason and keep the original vs edited values; Submitted → Reviewed → Verified / Returned for correction.
- **Purchases & vouchers**: purchases and expenses paid by petty cash, cash, UPI, bank transfer, cheque, card or credit (pay later). Each one automatically creates a numbered voucher (PCV / CPV / BPV / CCV / JV, numbered per financial year), goes through approval (branch-manager limit), then posts to stock, the petty cash book, expenses and the vendor ledger. Credit purchases are paid later with payment vouchers. Every voucher can be printed or saved as PDF, with the amount in words.
- **Petty cash**: balance per branch, top-ups (PCR vouchers), petty cash book with running balance.
- **Inventory**: stock per branch, issue/return/adjust/loss, low-stock and high-consumption alerts.
- **Tasks** (office boy errands etc.), **Documents & compliance** with expiry alerts, **Vendors** with ledger.
- **Dashboards with charts**: Management Control Centre, Registers Control Centre (missing-register alerts), Weekly & Monthly summary with comparisons, Branch Comparison, Daily Digest, and a plain-language management summary.
- **Global search** across all registers and records; **Report Builder** with filters, chart, Excel and PDF export.
- **Mobile staff mode**: guards, office boys, housekeeping, drivers and maintenance staff see a simple phone screen with only their work; photo-first issue reporting and voice input.

## Run locally

```
npm install
DATABASE_URL=postgres://user:pass@localhost:5432/scubus_ops npm run dev
```

`npm run dev` loads 60 days of demo data; demo staff log in with password `Demo@123`.

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. Several candidates may be given separated by spaces; the first that connects is used. |
| `JWT_SECRET` | Long random string used to sign logins. |
| `OWNER_EMAIL` / `OWNER_PASSWORD` | Owner account created on first start. |
| `SEED_DEMO` | `true` loads demo data once (clear it from Settings → Clear transaction data). |
| `DEMO_LOGINS` | `true` lets demo staff accounts sign in (keep off in production). |

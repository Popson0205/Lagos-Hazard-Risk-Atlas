# Risk Atlas redesign (Visily mock-up)

The frontend now follows the Visily mock-up: a dark navy app shell with a navigation rail,
a top bar, and five screens. The public map still works without an account; signing in
unlocks the Data Portal and account features.

## Screens (hash routes)

| Route | Screen | Needs sign-in |
|---|---|---|
| `#/login` | Login / Sign Up (with "Remember this device for 30 days") | — |
| `#/map` | Map Workspace: Risk Atlas Explorer panel, map, status bar | No |
| `#/analysis` | Same workspace, opened on the area + analysis sections | No |
| `#/library` | Layer Library: every published layer, "Open in map" | No |
| `#/portal` | Data Management Portal: stats, records table, submissions, review, CSV export | Yes |
| `#/reports` | Reporting: analyses you've run, kept in this browser | No |
| `#/settings` | Account Settings: Profile, Saved Maps, Areas of Interest, Alerts, Security | Yes |

## What's real behind each part of the mock-up

- **Top bar search** finds both places (state, 20 LGAs, 377 wards) and layers. Picking a
  place zooms to it and sets it as the area of interest; picking a layer turns it on.
- **Bell** shows your submissions' status changes, newly published datasets and, for
  reviewers, the review queue.
- **Status bar**: system status and version come from `GET /api/v1/status`; wind,
  humidity and temperature are live for central Lagos from Open-Meteo (no key needed).
- **Satellite Imagery** is the existing scene browser (date range, cloud-cover slider,
  scene list), enabled when a live satellite layer is on.
- **Data Layers** are the catalogue layers for the chosen hazard, with an info panel and
  opacity slider per layer.
- **Administrative Boundaries** is the State → LGA → Ward picker plus draw-your-own-area.
  Areas can be saved to your account.
- **Bookmark button** in the explorer header saves the whole map view (hazard, layers,
  area, zoom) to Saved Maps.
- **Data Portal** records move draft → submitted → published (or "changes requested").
  Contributors submit; reviewers publish or return them with a note.
- **Access Level**: contributors can request expanded permissions; the request is stored
  on the account for an administrator.

## Backend additions (`backend/app/accounts/`)

- Tables `atlas_users`, `atlas_dataset_records`, `atlas_saved_items`, created on startup
  if missing (DDL also appended to `db_init.sql`). The hazard catalogue is untouched.
- Endpoints under `/api/v1`: `/auth/*` (signup, login, me, password, request-access),
  `/records/*` (list, stats, create, update, status, delete, `export.csv`),
  `/me/items/*` (saved maps and areas), and `/status`.
- Passwords are PBKDF2-SHA256 hashed; sign-in tokens are HMAC-signed. Both use the
  Python standard library, so no new dependencies were added.

### New environment variables

| Variable | Purpose |
|---|---|
| `SECRET_KEY` | Signs sign-in tokens. Set a long random string in production. If unset, a key derived from `DATABASE_URL` is used. |
| `ADMIN_EMAILS` | Comma-separated emails that get the **Reviewer** role (can publish/return submissions). Takes effect at sign-up or next sign-in. |
| `APP_VERSION` | Optional; shown in the status bar (default `4.3.0`). |

## Known limits

- Password reset is manual (the form tells people to contact the technical desk); there's
  no email service in the stack yet.
- Published portal records are catalogue entries; they don't automatically become map
  layers. Promoting one to a layer is still the existing `layers` table / catalogue step.
- Reports live in the browser that ran them.
- The profile shows initials rather than an uploaded photo.

# UI redesign: what changed and how to demo it

## Files (all under `frontend/`)
| File | Change |
|---|---|
| `index.html` | New layout: brand header, 5 collapsible steps, sticky action bar, welcome card, toast area. All original element IDs kept, so `main.ts` logic still works. |
| `src/style.css` | Full rewrite: design tokens, light and dark themes, mobile bottom sheet, states, print stylesheet. |
| `src/ui.ts` | **New.** Toasts, empty/error/loading states, layer cards, theme, mobile sheet, a11y, search keyboard, modal focus trap. |
| `src/main.ts` | Wired to `ui.ts`: loading and error states, escaped HTML, tile-pause banner, retry, coming-soon hazards, chart and PDF/copy in the analysis modal. |
| `src/map/identify.ts` | Click-a-point result now opens as a popup at the click location. |
| `src/map/legend.ts` | Legend shows the unit. |
| `src/map/layerControl.ts` | Per-layer opacity (remembered when layers rebuild). |

No backend or database changes. Run `npm install && npm run dev` (or redeploy as usual).

## Demo flow (about 3 minutes)
1. Open the page: the welcome card explains the 3 steps. Close it with "Start exploring".
2. Step 1: hazards without data show "(coming soon)", and the first hazard with data is selected automatically.
3. Step 2: switch on a layer. Open its **i** button to show source, resolution and methodology. Move the opacity slider.
4. Step 3: search "Ikeja", pick it, and watch the step headers fill in with a tick and a summary.
5. Click the map: the value pops up at the click point.
6. **Analyse this area**: spinner, then a banner explaining why the imagery pauses, then the summary modal. Show **Save as PDF** and **Copy summary**.
7. Toggle the dark theme (top right). Resize the browser below 760px (or open it on a phone) to show the bottom sheet.

## Known limits (be upfront if asked)
- Not yet visually tested in a browser from the build environment. Do one full click-through before the demo.
- Fonts (Figtree, Fraunces) load from Google Fonts. Offline they fall back to system fonts.
- Layer data is open-satellite proxies, not official risk ratings. The welcome card and layer info say so.
- Not done yet: shareable URL state, compare two areas, vector tiles for wards.

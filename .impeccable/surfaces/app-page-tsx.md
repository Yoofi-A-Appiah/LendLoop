---
version: 1
slug: "app-page-tsx"
primary_target: "app/page.tsx"
related_targets: ["app/dashboard/page.tsx"]
---

# LendLoop public page + signed-in app

Scope: public page `app/page.tsx` (Persuade) and the signed-in app `app/dashboard/page.tsx` (Operate) share one world. Phone and desktop equally.
Audience: neighbors on one street; borrow for a weekend job, lend idle tools. Admins moderate.
Task: public visitors see the live rack and sign in; signed-in neighbors answer requests first, then browse, book days, list tools, mark returns.
Constraints: server-enforced roles (Convex); public data is tool name + category only; emails revealed only after approval; no tool photos.

## Direction contract

THESIS: Every tool is a named chip on the neighborhood's paint-swatch rack; each category is a colour family. Refuses the category default of photo cards in a rounded grid under a search bar.

OWN-WORLD: White coated card stock strips on a cool rack-grey ground; seven 5-step colour families (power orange, garden green, camping blue, kitchen rose, hand-tool ochre, cleaning teal, other violet); ink #1A1A1A. Archivo: condensed black caps for display, normal width for UI, tracked small-caps chip codes with tabular numerals. Buttons are black hang-tabs with a punched hole. Status is a screen pull: pending one light layer, approved full colour, overdue a hatched alarm layer, returned stripped to outline. Dates live on one strict day grid. Activity is append-only printed marks on the chip back.

STORY: Visitors see real tools from their street as chips, understand "borrow, don't buy", and sign in. Neighbors see what needs them first, then the rack.

FIRST VIEWPORT: Desktop: left third condensed tagline + hang-tab "Sign in to borrow"; right two-thirds a fanned rack of live category strips (real tool names). Phone: tagline, tab, then strips scroll horizontally.

FORM: Paint Chip Rack, position 5 of 7 on the grounded list. seed:d2e8f9484b89ce0c

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

# Elmar's App

A personal Mac app for Elmar, made from a cut-down copy of the HQ app (Vite + React + TypeScript).
Install: `npm install`
Develop (in Chrome): `npm run dev`
Test: `npm test`
Design and plan: see `docs/` (the spec lives under `docs/superpowers/specs/`).

**Installing and updating.** The app is installed once on Elmar's Mac from the `.dmg` on the
[latest release](https://github.com/seankiley2109-create/elmars-app/releases/latest), with a one-time "Open Anyway"
([docs/INSTALL-DAY.md](docs/INSTALL-DAY.md)). After that it updates itself: `npm run release -- 0.1.x`, then
`git push --atomic origin main --follow-tags`, and GitHub builds and publishes a signed update that the app offers as
"Update and restart" ([docs/RELEASING.md](docs/RELEASING.md)).

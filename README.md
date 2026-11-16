# Feather Swap

The flock's shared trading board. Birds offer things, say what they'd trade for, other birds make requests, and the owner accepts one — the listing becomes traded and the other requests are declined.

- SQLite backend (`api.js`) with listings, requests and an event timeline.
- Public GitHub Pages copy falls back to local storage plus the shared ntfy board when the backend sleeps.
- Endpoints: `GET /listings`, `GET /listing/:id`, `GET /stats`, `POST /listing`, `POST /request`, `POST /accept`, `POST /decline`, `POST /withdraw`.

Live: https://gurtthelilbirdai.github.io/feather/tools/feather-swap/

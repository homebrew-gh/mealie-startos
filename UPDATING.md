# Updating the upstream version

New minor and patch releases are picked up and released automatically by `.github/workflows/auto-update.yml` (see "Automatic updates" in `README.md`). Do it by hand for a major version, or when the automatic update opened an issue.

Mealie runs the official `ghcr.io/mealie-recipes/mealie` image, pinned by tag in `startos/manifest/index.ts`. Image tags match GitHub release tags, including the leading `v`.

## Find the new version

```
gh release view -R mealie-recipes/mealie --json tagName -q .tagName
```

## Apply the bump

`node .github/scripts/bump-mealie.mjs vX.Y.Z` does both steps below.

1. Set `images.mealie.source.dockerTag` in `startos/manifest/index.ts` to the new tag.
2. In `startos/versions/`, move `current.ts` into a file named for the old version, add it to `other` in `versions/index.ts`, and write a new `current.ts` with version `<new>:0` and release notes.

## Verify

- The tag has `linux/amd64` and `linux/arm64` images.
- `docker/entry.sh` still honours `PUID`/`PGID`, still `chown`s `/app`, and still `exec`s `mealie`.
- `docker/healthcheck.sh` still polls `/api/app/about`.
- None of `DB_ENGINE`, `API_PORT`, `BASE_URL`, `TZ`, `ALLOW_SIGNUP` were renamed in `mealie/core/settings/settings.py`.
- The data directory is still `/app/data`.
- Read the release notes for the whole range for breaking changes and migrations.

## AI connector (`mcp/`)

The connector calls these Mealie endpoints; check none changed shape in the release range: `GET /api/recipes`, `GET/PATCH/DELETE /api/recipes/{slug}`, `POST /api/recipes/create/url`, `POST /api/recipes/create/html-or-json`, `GET/POST/DELETE /api/households/mealplans`, `GET/POST /api/households/shopping/lists`, `GET /api/households/shopping/lists/{id}`, `POST /api/households/shopping/lists/{id}/recipe`, `POST /api/households/shopping/items/create-bulk`, `GET/PUT/DELETE /api/households/shopping/items/{id}`, `DELETE /api/households/shopping/items?ids=`, `POST /api/parser/ingredients`, `GET/POST /api/foods`, `GET/PUT /api/foods/{id}`, `GET/POST /api/units`, `GET/POST /api/groups/labels`, `GET/POST /api/organizers/categories`, `GET/POST /api/organizers/tags`, `POST /api/recipes/timeline/events`, `PATCH /api/recipes/{slug}/last-made`, `GET /api/households/self/recipes/{slug}`.

Bump `@modelcontextprotocol/sdk` in `mcp/package.json` with `npm install` there, then `npx tsc` in `mcp/`.

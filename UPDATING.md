# Updating the upstream version

Mealie runs the official `ghcr.io/mealie-recipes/mealie` image, pinned by tag in `startos/manifest/index.ts`. Image tags match GitHub release tags, including the leading `v`.

## Find the new version

```
gh release view -R mealie-recipes/mealie --json tagName -q .tagName
```

## Apply the bump

1. Set `images.mealie.source.dockerTag` in `startos/manifest/index.ts` to the new tag.
2. In `startos/versions/`, move `current.ts` into a file named for the old version, add it to `other` in `versions/index.ts`, and write a new `current.ts` with version `<new>:0` and release notes.

## Verify

- The tag has `linux/amd64` and `linux/arm64` images.
- `docker/entry.sh` still honours `PUID`/`PGID`, still `chown`s `/app`, and still `exec`s `mealie`.
- `docker/healthcheck.sh` still polls `/api/app/about`.
- None of `DB_ENGINE`, `API_PORT`, `BASE_URL`, `TZ`, `ALLOW_SIGNUP` were renamed in `mealie/core/settings/settings.py`.
- The data directory is still `/app/data`.
- Read the release notes for the whole range for breaking changes and migrations.

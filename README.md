<p align="center">
  <img src="icon.svg" alt="Mealie Logo" width="21%">
</p>

# Mealie on StartOS

> **Upstream docs:** <https://docs.mealie.io/>
>
> Everything not listed in this document should behave the same as upstream
> Mealie. If a feature, setting, or behavior is not mentioned here, the upstream
> documentation is accurate and fully applicable.

[Mealie](https://github.com/mealie-recipes/mealie) is a self-hosted recipe manager, meal planner and shopping list with a REST API. This repository packages the stock upstream image for [StartOS](https://github.com/Start9Labs/start-os) 0.4. It does not fork or patch Mealie.

## Installing

This is a community package. It is not in the Start9 marketplace and is not made or endorsed by Start9 or by the Mealie project.

1. Download the `.s9pk` for your server from the [latest release](https://github.com/homebrew-gh/mealie-startos/releases/latest): `mealie_x86_64.s9pk` for most PCs and mini PCs, `mealie_aarch64.s9pk` for ARM boards such as a Raspberry Pi. Check its SHA-256 against the one in the release notes if you like.
2. In StartOS, go to **System → Sideload** and upload it.
3. Start Mealie and follow its **Instructions** tab, which is the same as [`instructions.md`](instructions.md): first login, AI provider setup, and the optional AI connector for Claude and other assistants.

To update, sideload the newer release over the installed one. Your data stays. StartOS doesn't check this repository for updates, so watch its releases on GitHub.

Requires StartOS 0.4. Mealie's first start takes a minute or two while it sets up its database.

## Image and container runtime

| Property      | Value                                                                                   |
| ------------- | --------------------------------------------------------------------------------------- |
| Image         | `ghcr.io/mealie-recipes/mealie` (upstream, unmodified)                                  |
| Architectures | x86_64, aarch64                                                                         |
| Entrypoint    | upstream `/app/run.sh` (starts as root, `chown -R 911:911 /app`, drops to 911 via gosu) |
| Port          | 9000 (HTTP; web UI and API)                                                             |

## Volumes

| Volume    | Mount point              | Contents                                                                                                               |
| --------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `main`    | `/app/data`              | SQLite `mealie.db`, recipe images, user files, Mealie's own backup zips, generated `.secret` / `.session_secret`       |
| `startos` | (not mounted)            | `store.json`: primary URL, time zone, sign-up toggle, AI connector settings (enabled, Mealie API token, password, URL) |
| `mcp`     | `/data` (connector only) | `oauth-state.json`: the connector's registered OAuth clients and hashed tokens                                         |

The `main` volume is mounted at its root, not a subpath, so the entrypoint's `chown` works inside the subcontainer.

## Configuration

Mealie is configured only through environment variables built in `startos/main.ts`:

| Variable       | Source                                                                              |
| -------------- | ----------------------------------------------------------------------------------- |
| `DB_ENGINE`    | always `sqlite`                                                                     |
| `API_PORT`     | always `9000`                                                                       |
| `BASE_URL`     | **Set Primary URL** action, else the best usable interface address; omitted if none |
| `TZ`           | **Set Time Zone** action, default `UTC`                                             |
| `ALLOW_SIGNUP` | **Enable / Disable Open Sign-up** action, default `false`                           |

AI providers (OpenAI-compatible key, base URL, model) are **not** package config. Mealie moved them from `OPENAI_*` env vars into per-group database settings (Group Settings → AI), so the package does not expose them. They are backed up with the database.

## Network interfaces

`webui` on host `main`, type `ui`, port 9000, serves the web app at `/`, the API at `/api` and OpenAPI docs at `/docs`. StartOS publishes it on LAN (including the WireGuard VPN), and on Tor or a domain if the user adds them. API clients over HTTPS must trust the StartOS Root CA. The AI connector has its own interface, described below.

## AI connector (MCP)

Optional second daemon, started only when **Configure AI Connector** has it enabled with a Mealie API token and password **and** a public HTTPS URL is set (**Set AI Connector URL**, limited to public domains with TLS on the `mcp` interface). Source in `mcp/`.

- Interface `mcp` on host `mcp` (type `api`, port 8000, path `/mcp`), separate from Mealie's host so it can be public alone.
- Streamable HTTP, stateless, at `POST /mcp`.
- Its own OAuth 2.1 authorization server (via the SDK's `mcpAuthRouter`): RFC 8414 + RFC 9728 metadata, Dynamic Client Registration, PKCE S256, rotating refresh tokens (90 days), 1-hour access tokens bound to the `/mcp` resource. Approval is a password page; 5 failures in 15 minutes locks it. Built for claude.ai custom connectors, which need DCR (or CIMD) and call from Anthropic's cloud.
- Calls Mealie at `http://127.0.0.1:9000/api` with the configured API token.
- Tools: `search_recipes`, `get_recipe`, `import_recipe_from_url`, `create_recipe`, `update_recipe`, `parse_recipe_ingredients`, `parse_ingredients`, `list_meal_plan`, `add_meal_plan_entry`, `remove_meal_plan_entry`, `list_shopping_lists`, `get_shopping_list`, `create_shopping_list`, `add_shopping_list_items`, `add_recipe_to_shopping_list`, `set_shopping_item_checked`, `set_shopping_item_store_section`, `remove_shopping_item`, `list_store_sections`, `set_food_store_section`.
- Ingredient parsing: recipes created, imported or given new ingredients through the connector are run through Mealie's parser (`POST /api/parser/ingredients`, `openai` first, falling back to `nlp`) and linked to foods and units, creating missing ones. Store sections are Mealie labels on foods; shopping items inherit them, which is what sorts a list by aisle.
- Health check: `GET /healthz`.

## Actions

| Action                        | Purpose                                                |
| ----------------------------- | ------------------------------------------------------ |
| Set Primary URL               | `BASE_URL` for generated links; sets Open UI target    |
| Set Time Zone                 | `TZ`                                                   |
| Enable / Disable Open Sign-up | `ALLOW_SIGNUP`                                         |
| Configure AI Connector        | Connector on/off, Mealie API token, connector password |
| Set AI Connector URL          | Public HTTPS URL of the connector (`PUBLIC_URL`)       |

## Health checks

| Check         | Method                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Web Interface | HTTP GET `http://127.0.0.1:9000/api/app/about` (same as upstream `HEALTHCHECK`), 120 s grace period for first-start migrations |
| AI Connector  | HTTP GET `http://127.0.0.1:8000/healthz` (only when the connector runs)                                                        |

## Backups

`main`, `startos` and `mcp` volumes, excluding `.temp` and SQLite `-shm` files.

## First run

Upstream creates `changeme@example.com` / `MyPassword` as the first admin when the user table is empty, then shows its setup wizard on first login. The package does not change this; `instructions.md` tells the user to change it immediately.

## Building

```
npm ci
make            # x86 and arm .s9pk files
make x86        # one architecture
```

Requires `start-cli`, Docker with buildx, and Node 22. Sideload the resulting `.s9pk` from StartOS (System → Sideload).

CI: `.github/workflows/build.yml` builds both architectures on every pull request and on a manual run, and keeps the files as workflow artifacts for 14 days.

## Releasing

`.github/workflows/release.yml` runs when a tag starting with `v` is pushed. It checks that the tag matches the version in `startos/versions/current.ts` (`3.31.0:2` must be tagged `v3.31.0_2`), builds both architectures with Start9's shared release workflow, signs them with the `DEV_KEY` secret and attaches them to a GitHub Release with the release notes and SHA-256 hashes. It does not publish to any StartOS registry.

One-time setup: create a developer signing key and save it as the repository secret `DEV_KEY` (Settings → Secrets and variables → Actions). Either `start-cli init-key` (writes `~/.startos/developer.key.pem`) or `openssl genpkey -algorithm ed25519 -out dev-key.pem` makes one. Paste the whole PEM file, including the `BEGIN` and `END` lines. Keep a copy offline: every release should be signed with the same key.

To release: bump the version as in `UPDATING.md`, merge, then tag `main` and push the tag:

```
git checkout main && git pull
git tag v3.31.0_2
git push origin v3.31.0_2
```

## License

The packaging code in this repository is AGPL-3.0, the same license as Mealie. Mealie itself is © the Mealie contributors and is pulled unmodified from `ghcr.io/mealie-recipes/mealie`. See the [Mealie repository](https://github.com/mealie-recipes/mealie) for its license and authors.

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

## Image and container runtime

| Property      | Value                                                                                   |
| ------------- | --------------------------------------------------------------------------------------- |
| Image         | `ghcr.io/mealie-recipes/mealie` (upstream, unmodified)                                  |
| Architectures | x86_64, aarch64                                                                         |
| Entrypoint    | upstream `/app/run.sh` (starts as root, `chown -R 911:911 /app`, drops to 911 via gosu) |
| Port          | 9000 (HTTP; web UI and API)                                                             |

## Volumes

| Volume    | Mount point   | Contents                                                                                                         |
| --------- | ------------- | ---------------------------------------------------------------------------------------------------------------- |
| `main`    | `/app/data`   | SQLite `mealie.db`, recipe images, user files, Mealie's own backup zips, generated `.secret` / `.session_secret` |
| `startos` | (not mounted) | `store.json`: primary URL, time zone, sign-up toggle                                                             |

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

One interface, `webui` on host `main`, type `ui`, port 9000. It serves the web app at `/`, the API at `/api` and OpenAPI docs at `/docs`. StartOS publishes it on LAN (including the WireGuard VPN), and on Tor or a domain if the user adds them. API clients over HTTPS must trust the StartOS Root CA.

## Actions

| Action                        | Purpose                                             |
| ----------------------------- | --------------------------------------------------- |
| Set Primary URL               | `BASE_URL` for generated links; sets Open UI target |
| Set Time Zone                 | `TZ`                                                |
| Enable / Disable Open Sign-up | `ALLOW_SIGNUP`                                      |

## Health checks

| Check         | Method                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Web Interface | HTTP GET `http://127.0.0.1:9000/api/app/about` (same as upstream `HEALTHCHECK`), 120 s grace period for first-start migrations |

## Backups

`main` and `startos` volumes, excluding `.temp` and SQLite `-shm` files.

## First run

Upstream creates `changeme@example.com` / `MyPassword` as the first admin when the user table is empty, then shows its setup wizard on first login. The package does not change this; `instructions.md` tells the user to change it immediately.

## Building

```
npm ci
make            # x86 and arm .s9pk files
make x86        # one architecture
```

Requires `start-cli`, Docker with buildx, and Node 22. Sideload the resulting `.s9pk` from StartOS (System → Sideload).

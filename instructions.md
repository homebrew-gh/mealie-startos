# Mealie

## Documentation

- [Mealie documentation](https://docs.mealie.io/) covers day-to-day use, the admin pages and the API.
- The API reference for this install is at `/docs` on any of Mealie's addresses.

## What you get on StartOS

- One **Web UI and API** interface. The web app is at `/`, the REST API at `/api`, and interactive API docs at `/docs`.
- A built-in SQLite database. There is nothing else to set up.
- You stay logged in across restarts, updates and restores.
- Open sign-up is off. Add people with invitations from Mealie's admin page.

## Getting set up

1. Open the **Web UI and API** interface.
2. Log in with Mealie's default account: email `changeme@example.com`, password `MyPassword`.
3. Mealie walks you through a short setup. **Change that email and password straight away**, because the default is the same on every Mealie install.
4. Run **Set Time Zone** so the meal planner agrees with you about what day it is.

Mealie works at every address you expose it at: your `.local` address, a LAN IP, Tor, or a custom domain. **Set Primary URL** only chooses which one goes into links Mealie generates (invitations, password resets, shared recipes) and which one **Open UI** opens.

## AI features

Mealie can parse ingredients, rescue imports from sites its scraper can't read, and build recipes from pasted text, photos or video, using any OpenAI-compatible provider (OpenAI, OpenRouter, a local Ollama, and so on).

Current Mealie versions set this up inside Mealie, not with the old `OPENAI_*` environment variables: as an admin or group manager, open **Group Settings → AI** and add a provider with its API key, base URL and model. The key is stored in Mealie's database, so it is included in StartOS backups.

## Using the API from other apps and agents

1. In Mealie, open your profile, go to **API Tokens**, and create a token. Copy it; it is shown once.
2. Point the app or agent at the **Web UI and API** address and send `Authorization: Bearer <token>`.

Any address StartOS lists for the interface works, including your box's LAN address when you are connected over the StartOS WireGuard VPN. HTTPS addresses use your server's own certificate authority, so a device or program that talks to Mealie over HTTPS must trust your **Root CA**: download it from StartOS and install it on the device, as described in the StartOS guide to trusting your Root CA (on Android it goes in **Settings → Security → Encryption & credentials → Install a certificate → CA certificate**). Plain-HTTP LAN addresses don't need it, but send your token unencrypted.

## Actions

- **Set Primary URL** chooses the address used in links Mealie generates.
- **Set Time Zone** sets the server time zone, for example `America/New_York`.
- **Enable / Disable Open Sign-up** lets anyone who can reach Mealie create an account without an invitation. Leave it off unless you are letting a few people sign up, then turn it off again.

## Backups

StartOS backups include everything: recipes, images, meal plans, shopping lists, users, API tokens and AI provider settings. Mealie also makes its own backup zips from its admin page. Those are saved in its data folder and so are inside StartOS backups too, but they are not a copy kept somewhere else.

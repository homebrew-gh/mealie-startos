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

## AI connector (Claude and other cloud assistants)

The package includes an optional MCP server that lets AI assistants search and read your recipes, add new ones, and manage meal plans and shopping lists. It has its own **AI Connector (MCP)** interface, so you can put just the connector on the internet and keep Mealie private.

1. In Mealie, create an API token (profile → **API Tokens**). The connector acts as that user.
2. Give the **AI Connector (MCP)** interface a public domain: on its interface page, in your StartTunnel gateway's address table, choose **Add Domain → Public Domain**, enter a domain such as `mealie-mcp.example.com`, and pick **Let's Encrypt** so cloud services trust the certificate. Point the domain's DNS at your StartTunnel server's public IP. See the StartOS guide to [clearnet access](https://docs.start9.com/start-os/0.4.0.x/user-manual/public-access/clearnet.html).
3. Run **Set AI Connector URL** and choose that domain.
4. Run **Configure AI Connector**: turn it on, paste the Mealie API token, and set (or generate) a connector password. Save the password somewhere safe.
5. In Claude on the web, go to **Settings → Connectors → Add custom connector** and enter `https://<your domain>/mcp`. Claude opens an approval page on your box: enter the connector password and click **Allow access**. The connector then also works in the Claude mobile apps.

When an assistant creates or imports a recipe through the connector, the connector runs Mealie's ingredient parser on it (using your AI provider if one is set up) so each ingredient is linked to a food. Assistants can also set a food's store section, such as Produce or Dairy, so shopping lists come out sorted by aisle. Sorting works best if Mealie has a starter set of foods and store sections, which Mealie can seed for you from its data management settings.

Only someone who knows the connector password can connect an assistant. Five wrong passwords lock the approval page for 15 minutes. To cut off every connected assistant, change the connector password and also revoke the Mealie API token if you think it leaked.

## Actions

- **Set Primary URL** chooses the address used in links Mealie generates.
- **Set Time Zone** sets the server time zone, for example `America/New_York`.
- **Enable / Disable Open Sign-up** lets anyone who can reach Mealie create an account without an invitation. Leave it off unless you are letting a few people sign up, then turn it off again.
- **Configure AI Connector** turns the MCP server on or off and sets its Mealie API token and connector password.
- **Set AI Connector URL** chooses the public HTTPS address the connector answers on.

## Backups

StartOS backups include everything: recipes, images, meal plans, shopping lists, users, API tokens, AI provider settings, and the AI connector's settings and sign-ins. Mealie also makes its own backup zips from its admin page. Those are saved in its data folder and so are inside StartOS backups too, but they are not a copy kept somewhere else.

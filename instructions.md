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

Mealie can parse ingredients, rescue imports from sites its scraper can't read, and build recipes from pasted text, photos or video, using any OpenAI-compatible provider.

Current Mealie versions set this up inside Mealie, not with the old `OPENAI_*` environment variables: as an admin or group manager, open **Group Settings → AI** and add a provider with its API key, base URL and model. Make it the default provider (and the image provider if you want photo imports). The key is stored in Mealie's database, so it is included in StartOS backups.

Some providers that work:

| Provider           | Base URL                            | Model                    |
| ------------------ | ----------------------------------- | ------------------------ |
| OpenAI             | `https://api.openai.com/v1/`        | any chat model it offers |
| Claude (Anthropic) | `https://api.anthropic.com/v1/`     | `claude-sonnet-5-5`      |
| OpenRouter         | `https://openrouter.ai/api/v1/`     | any model it lists       |
| Ollama on your LAN | `http://<ollama address>:11434/v1/` | a model you pulled       |

Every request from a provider goes to the model you set on it. Anthropic's endpoint is its OpenAI-compatible layer and uses Claude Console API credits, not a Claude.ai subscription. It has no speech-to-text, so importing from video needs a separate audio provider, such as OpenAI.

## Using the API from other apps and agents

1. In Mealie, open your profile, go to **API Tokens**, and create a token. Copy it; it is shown once.
2. Point the app or agent at the **Web UI and API** address and send `Authorization: Bearer <token>`.

Any address StartOS lists for the interface works, including your box's LAN address when you are connected over the StartOS WireGuard VPN. HTTPS addresses use your server's own certificate authority, so a device or program that talks to Mealie over HTTPS must trust your **Root CA**: download it from StartOS and install it on the device, as described in the StartOS guide to trusting your Root CA (on Android it goes in **Settings → Security → Encryption & credentials → Install a certificate → CA certificate**). Plain-HTTP LAN addresses don't need it, but send your token unencrypted.

For an Android phone or tablet, [YesChef](https://github.com/homebrew-gh/yeschef) is a companion app for Mealie with offline shopping lists sorted by aisle, cook mode with timers, and a cookbook view. Set it up with the address and token from the steps above.

## AI connector (Claude and other cloud assistants)

The package includes an optional MCP server that lets AI assistants search and read your recipes, add new ones, and manage meal plans and shopping lists. It has its own **AI Connector (MCP)** interface, so you can put just the connector on the internet and keep Mealie itself private on your LAN and VPN.

Cloud assistants such as Claude call the connector from their own servers, not from your phone, so the connector needs a public address with a certificate they trust. On StartOS that means a public domain through a gateway such as StartTunnel, with a Let's Encrypt certificate. A `.local` address, a Tor address or your box's own Root CA certificate won't work for them.

### What you need

- A domain name you control, for example `example.com`. You'll use a subdomain of it, such as `mealie-mcp.example.com`.
- A StartTunnel server (or another public gateway) connected to your box. See the StartOS guide to [clearnet access](https://docs.start9.com/start-os/0.4.0.x/user-manual/public-access/clearnet.html).

### Setting it up

1. **Mealie API token.** In Mealie, open your profile, go to **API Tokens**, and create a token, for example "AI connector". Copy it. The connector acts as that Mealie user.
2. **DNS record.** Where your domain's DNS is hosted, add an **A** record for the subdomain (for example `mealie-mcp`) pointing to your StartTunnel server's public IPv4 address. If your DNS is on Cloudflare, set it to **DNS only**, not proxied.
3. **Public domain.** In StartOS, open Mealie's **AI Connector (MCP)** interface. In your StartTunnel gateway's row, choose **Add Domain → Public Domain**, enter `mealie-mcp.example.com`, and pick **Let's Encrypt**. StartOS checks the DNS record and the port forward and tells you what to fix if either fails. Leave Mealie's own **Web UI and API** interface private.
4. **Set AI Connector URL.** Run this action and choose the domain.
5. **Configure AI Connector.** Run this action: turn it on, paste the Mealie API token, and set or generate a connector password. Save the password somewhere safe. The **AI Connector** health check turns green when it is running.
6. **Check it from outside.** Open `https://mealie-mcp.example.com/healthz` on your phone with Wi-Fi and VPN off. It should show `{"ok":true}`.
7. **Connect an assistant.** The connector address is `https://mealie-mcp.example.com/mcp`.
   - **Claude:** on the web, go to **Settings → Connectors → Add custom connector** and enter the address. Claude opens an approval page on your box: enter the connector password and click **Allow access**. The connector then also works in the Claude mobile and desktop apps.
   - **Other assistants:** any assistant or MCP client that can add a remote MCP server over HTTP with OAuth sign-in works the same way: give it the address, and approve it with the connector password.

### Ingredients and store sections

When an assistant creates or imports a recipe through the connector, the connector runs Mealie's ingredient parser on it, using your AI provider if one is set up and Mealie's built-in parser otherwise, so each ingredient is linked to a food. A line that lists several foods, such as "salt and pepper, to taste", is split into one ingredient per food first. Assistants can also set a food's store section, such as Produce or Dairy, so shopping lists come out sorted by aisle, and each recipe import or save highlights any linked foods that still need a store section. If Mealie's parser links an ingredient to a different food that merely looks similar (for example "simple syrup" to "maple syrup"), the connector uses the food with the ingredient's exact name instead. They can read back which food each ingredient is linked to and each food's section, and list your foods to find duplicates such as "onion" and "onions". They can also merge duplicates into one food, which moves every recipe and shopping list item over to it. They can find the recipes that use a food, and delete a food once nothing uses it. They can also group ingredients under subheadings, such as a "Marinade" section, and add step titles, short step summaries (for timers and cook notes), and exact step-to-ingredient links so cook mode's "You'll need" box knows exactly which ingredients each step uses.

This works best if Mealie has a starter set of foods, units and store sections (Mealie calls them labels). In Mealie's **Data Management** pages for foods, units and labels, use **Seed** to load Mealie's defaults.

### Organizing recipes

Assistants can file recipes into categories and tags and record when you cooked something. By default they use one category per recipe as its cookbook chapter (Mains, Sides, Soups & Salads, Breakfast, Desserts, Baking, Starters & Snacks, Drinks, Sauces & Basics), and tags for the main protein (Chicken, Beef, Pork, Lamb, Turkey, Seafood, Vegetarian, Vegan) and cooking style (Quick, Slow cooker, Grill, One pot, Make ahead, Weeknight, Freezer friendly). Missing categories and tags are created. You can ask for something like "sort all my recipes into chapters and tag them by protein" or "I made the chili last night".

### Mains and sides

Assistants are asked to save a main and each side as separate recipes, and to plan them on the same day under the same meal (for example both under dinner), so the YesChef app can cook the whole meal on one timeline. They also set each recipe's prep and cook times, which that timeline is built from. If older recipes have a side merged into the main, you can ask an assistant to split them: it creates the side as its own recipe, trims the main, updates the meal plan and deletes any leftover combined recipe.

### Cooking notes

Assistants can read the notes you take while cooking: the cooking notes the [YesChef](https://github.com/homebrew-gh/yeschef) app saves from cook mode (spoken with its mic button, each tagged with the time and step), and comments left with Mealie's **I made this**. Ask something like "review today's cooking notes and suggest fixes for next time". The assistant points out what was hard and proposes changes to the recipe, and only saves the ones you agree to. The notes themselves stay on the recipe's timeline in Mealie.

### Recipe photos

Assistants can set or replace a recipe's photo, from a link to an image or by uploading the image itself. They can do many recipes in one go; photos that take a while to download keep saving in the background.

### Nutrition

Assistants can add nutrition facts per serving to a recipe (calories, protein, carbs, fat, fiber, sugar, sodium and more), for example "add macros to this week's recipes". If the recipe has no label they estimate from the ingredients and say so. Adding nutrition also turns on the nutrition panel for that recipe in Mealie.

### A shopping list for your assistant

An assistant can keep its own shopping list, for example "Weekly meals", without touching your other lists. It can empty that one list in a single step and refill it from every recipe on the meal plan for a date range.

### Security

Only someone who knows the connector password can connect an assistant. Five wrong passwords lock the approval page for 15 minutes. A connected assistant can do anything the connector's tools allow, as the Mealie user whose token you gave it, but it can't reach Mealie's admin pages or anything else on your box.

To cut off every connected assistant, change the connector password in **Configure AI Connector**. If you think the Mealie API token leaked, delete it in Mealie and enter a new one.

### Troubleshooting

- **No AI Connector health check, or the connector isn't running:** it only starts when it is turned on, has both a token and a password, and **Set AI Connector URL** points at a public HTTPS domain. Run both actions again.
- **The domain won't verify in StartOS:** check that the A record points at the StartTunnel server's public IP (`nslookup mealie-mcp.example.com`) and isn't proxied. DNS changes can take a few minutes.
- **The assistant can't connect, or step 6 fails:** the domain must use **Let's Encrypt**, not your box's own certificate, and must be on the **AI Connector (MCP)** interface, not Mealie's.
- **"Too many attempts" on the approval page:** wait 15 minutes, then try again with the right password.
- **Tools fail with HTTP 401:** the Mealie API token was deleted or is wrong. Create a new one and enter it in **Configure AI Connector**.
- **You changed the connector's domain:** remove the connector from your assistant and add it again with the new address.
- **The assistant doesn't see new tools after an update:** disconnect and reconnect the connector in the assistant, or start a new chat.

## Actions

- **Set Primary URL** chooses the address used in links Mealie generates.
- **Set Time Zone** sets the server time zone, for example `America/New_York`.
- **Enable / Disable Open Sign-up** lets anyone who can reach Mealie create an account without an invitation. Leave it off unless you are letting a few people sign up, then turn it off again.
- **Configure AI Connector** turns the MCP server on or off and sets its Mealie API token and connector password.
- **Set AI Connector URL** chooses the public HTTPS address the connector answers on.

## Backups

StartOS backups include everything: recipes, images, meal plans, shopping lists, users, API tokens, AI provider settings, and the AI connector's settings and sign-ins. Mealie also makes its own backup zips from its admin page. Those are saved in its data folder and so are inside StartOS backups too, but they are not a copy kept somewhere else.

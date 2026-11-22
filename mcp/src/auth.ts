/**
 * A single-user OAuth 2.1 authorization server for the MCP endpoint.
 *
 * Clients (claude.ai and other MCP clients) register themselves with Dynamic
 * Client Registration, then send the user here to approve access. Approval
 * means typing the connector password set in StartOS. PKCE is checked by the
 * SDK's token handler. Tokens are random strings; only their SHA-256 hashes
 * are kept, in a JSON file on the package's volume, so restarts don't log
 * clients out.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import express, { Response } from 'express'
import { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js'
import {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js'
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import {
  InvalidGrantError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js'
import {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { config } from './config.js'

const ACCESS_TTL_S = 60 * 60 // 1 hour
const REFRESH_TTL_S = 60 * 60 * 24 * 90 // 90 days
const CODE_TTL_MS = 5 * 60 * 1000
const PENDING_TTL_MS = 10 * 60 * 1000
const MAX_FAILURES = 5
const FAILURE_WINDOW_MS = 15 * 60 * 1000

type Grant = {
  clientId: string
  scopes: string[]
  resource?: string
  expiresAt: number // epoch seconds
}

type State = {
  clients: Record<string, OAuthClientInformationFull>
  access: Record<string, Grant>
  refresh: Record<string, Grant>
  /** Fingerprint of the connector password the tokens were issued under. */
  passwordFingerprint?: string
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex')
const newToken = () => randomBytes(32).toString('base64url')
const now = () => Math.floor(Date.now() / 1000)

const passwordFingerprint = createHash('sha256')
  .update('mealie-mcp-password:' + config.connectorPassword)
  .digest('hex')

function loadState(): State {
  let s: Partial<State> = {}
  try {
    s = JSON.parse(readFileSync(config.stateFile, 'utf8'))
  } catch {}
  const loaded: State = {
    clients: s.clients ?? {},
    access: s.access ?? {},
    refresh: s.refresh ?? {},
    passwordFingerprint,
  }
  // Changing the connector password signs out every connected assistant.
  if (s.passwordFingerprint && s.passwordFingerprint !== passwordFingerprint) {
    console.info(
      'Connector password changed: signing out all connected assistants',
    )
    loaded.access = {}
    loaded.refresh = {}
  }
  return loaded
}

const state = loadState()

function save() {
  const t = now()
  for (const map of [state.access, state.refresh]) {
    for (const [k, g] of Object.entries(map)) if (g.expiresAt < t) delete map[k]
  }
  const tmp = `${config.stateFile}.tmp`
  writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 })
  renameSync(tmp, config.stateFile)
}

save()

const clientsStore: OAuthRegisteredClientsStore = {
  getClient: (id) => state.clients[id],
  registerClient: (client) => {
    const full = {
      ...client,
      client_id: randomBytes(16).toString('hex'),
      client_id_issued_at: now(),
    } as OAuthClientInformationFull
    state.clients[full.client_id] = full
    save()
    return full
  },
}

type Pending = {
  client: OAuthClientInformationFull
  params: AuthorizationParams
  createdAt: number
}
type Code = Pending & { issuedAt: number }

const pending = new Map<string, Pending>()
const codes = new Map<string, Code>()
let failures: number[] = []

function passwordMatches(input: string): boolean {
  const a = createHash('sha256').update(input).digest()
  const b = createHash('sha256').update(config.connectorPassword).digest()
  return timingSafeEqual(a, b)
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  )

function page(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect to Mealie</title>
<style>
body{font-family:system-ui,sans-serif;max-width:26rem;margin:3rem auto;padding:0 1rem;color:#222}
h1{font-size:1.3rem}input,button{font-size:1rem;padding:.6rem;width:100%;box-sizing:border-box;margin-top:.5rem}
button{background:#E58325;color:#fff;border:0;border-radius:.3rem;cursor:pointer}.err{color:#b00020}
.muted{color:#666;font-size:.9rem}
</style></head><body>${body}</body></html>`
}

function approvalForm(id: string, clientName: string, error?: string): string {
  return page(`<h1>Connect ${escapeHtml(clientName)} to Mealie?</h1>
<p>It will be able to read and change your recipes, meal plans and shopping lists.</p>
${error ? `<p class="err">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/authorize/approve">
<input type="hidden" name="request" value="${escapeHtml(id)}">
<label for="pw">Connector password (set in StartOS)</label>
<input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
<button type="submit">Allow access</button>
</form>
<p class="muted">Not expecting this? Close the page.</p>`)
}

function redirectWithCode(res: Response, p: Pending) {
  const code = newToken()
  codes.set(code, { ...p, issuedAt: Date.now() })
  const target = new URL(p.params.redirectUri)
  target.searchParams.set('code', code)
  if (p.params.state !== undefined)
    target.searchParams.set('state', p.params.state)
  res.redirect(302, target.toString())
}

function issueTokens(
  clientId: string,
  scopes: string[],
  resource?: string,
): OAuthTokens {
  const access = newToken()
  const refresh = newToken()
  const t = now()
  state.access[hash(access)] = {
    clientId,
    scopes,
    resource,
    expiresAt: t + ACCESS_TTL_S,
  }
  state.refresh[hash(refresh)] = {
    clientId,
    scopes,
    resource,
    expiresAt: t + REFRESH_TTL_S,
  }
  save()
  return {
    access_token: access,
    token_type: 'bearer',
    expires_in: ACCESS_TTL_S,
    refresh_token: refresh,
    scope: scopes.join(' '),
  }
}

export const provider: OAuthServerProvider = {
  clientsStore,

  async authorize(client, params, res) {
    const id = newToken()
    pending.set(id, { client, params, createdAt: Date.now() })
    for (const [k, p] of pending) {
      if (Date.now() - p.createdAt > PENDING_TTL_MS) pending.delete(k)
    }
    res
      .status(200)
      .setHeader(
        'Content-Security-Policy',
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https:",
      )
      .setHeader('X-Frame-Options', 'DENY')
      .type('html')
      .send(approvalForm(id, client.client_name ?? 'An AI assistant'))
  },

  async challengeForAuthorizationCode(_client, code) {
    const c = codes.get(code)
    if (!c) throw new InvalidGrantError('Unknown authorization code')
    return c.params.codeChallenge
  },

  async exchangeAuthorizationCode(
    client,
    code,
    _verifier,
    redirectUri,
    resource,
  ) {
    const c = codes.get(code)
    codes.delete(code)
    if (!c || Date.now() - c.issuedAt > CODE_TTL_MS) {
      throw new InvalidGrantError('Authorization code is invalid or expired')
    }
    if (c.client.client_id !== client.client_id) {
      throw new InvalidGrantError(
        'Authorization code was issued to another client',
      )
    }
    if (redirectUri && redirectUri !== c.params.redirectUri) {
      throw new InvalidGrantError('redirect_uri does not match')
    }
    const res = (resource ?? c.params.resource)?.toString()
    if (res && res !== config.mcpUrl.toString()) {
      throw new InvalidGrantError('Token requested for another resource')
    }
    return issueTokens(
      client.client_id,
      c.params.scopes ?? [],
      config.mcpUrl.toString(),
    )
  },

  async exchangeRefreshToken(client, refreshToken) {
    const key = hash(refreshToken)
    const g = state.refresh[key]
    if (!g || g.clientId !== client.client_id || g.expiresAt < now()) {
      throw new InvalidGrantError('Refresh token is invalid or expired')
    }
    // Rotate: each refresh token works once.
    delete state.refresh[key]
    return issueTokens(client.client_id, g.scopes, g.resource)
  },

  async verifyAccessToken(token): Promise<AuthInfo> {
    const g = state.access[hash(token)]
    if (!g || g.expiresAt < now())
      throw new InvalidTokenError('Invalid or expired token')
    return {
      token,
      clientId: g.clientId,
      scopes: g.scopes,
      expiresAt: g.expiresAt,
      resource: g.resource ? new URL(g.resource) : undefined,
    }
  },

  async revokeToken(client, { token }: OAuthTokenRevocationRequest) {
    const key = hash(token)
    for (const map of [state.access, state.refresh]) {
      if (map[key]?.clientId === client.client_id) delete map[key]
    }
    save()
  },
}

/** The password form posts here. */
export const approvalRouter = express.Router()
approvalRouter.post(
  '/authorize/approve',
  express.urlencoded({ extended: false, limit: '4kb' }),
  (req, res) => {
    const id = String(req.body?.request ?? '')
    const p = pending.get(id)
    if (!p || Date.now() - p.createdAt > PENDING_TTL_MS) {
      pending.delete(id)
      res
        .status(400)
        .type('html')
        .send(
          page(
            '<h1>This request expired</h1><p>Start connecting again from your AI assistant.</p>',
          ),
        )
      return
    }
    const t = Date.now()
    failures = failures.filter((f) => t - f < FAILURE_WINDOW_MS)
    if (failures.length >= MAX_FAILURES) {
      res
        .status(429)
        .type('html')
        .send(
          approvalForm(
            id,
            p.client.client_name ?? 'An AI assistant',
            'Too many wrong passwords. Try again in 15 minutes.',
          ),
        )
      return
    }
    if (!passwordMatches(String(req.body?.password ?? ''))) {
      failures.push(t)
      console.warn('Connector approval: wrong password')
      res
        .status(401)
        .type('html')
        .send(
          approvalForm(
            id,
            p.client.client_name ?? 'An AI assistant',
            'Wrong password.',
          ),
        )
      return
    }
    pending.delete(id)
    console.info(
      `Connector approved for client "${p.client.client_name ?? p.client.client_id}"`,
    )
    redirectWithCode(res, p)
  },
)

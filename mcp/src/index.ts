import express from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import { approvalRouter, provider } from './auth.js'
import { config } from './config.js'
import { ORGANIZING_SCHEME } from './organizers.js'
import { MEAL_GUIDANCE, registerTools } from './tools.js'

const app = express()
// StartOS terminates TLS and proxies to us; trust exactly that one hop so
// rate limiting sees real client addresses.
app.set('trust proxy', 1)

app.get('/healthz', (_req, res) => {
  res.json({ ok: true })
})

app.use(
  mcpAuthRouter({
    provider,
    issuerUrl: config.publicUrl,
    resourceServerUrl: config.mcpUrl,
    resourceName: 'Mealie',
    scopesSupported: ['mealie'],
  }),
)
app.use(approvalRouter)

const auth = requireBearerAuth({
  verifier: provider,
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(config.mcpUrl),
  expectedResource: config.mcpUrl,
})

const SERVER_INSTRUCTIONS = [
  'Mealie recipe box, meal planner, and shopping list paired with the YesChef Android app.',
  ORGANIZING_SCHEME,
  MEAL_GUIDANCE,
  'After importing or creating a recipe, check unlabeledFoods and gaps: assign missing store sections with set_food_store_section, wire step summaries and 0-based ingredient indexes (ONLY ingredients actually prepped or added in each step; leave passive steps like preheat, simmer, bake, rest, and serve empty []), and when applying cooking-note feedback pass changeSummary on update_recipe (or call log_recipe_change) so those notes are marked reviewed.',
].join(' ')

// Stateless Streamable HTTP: a fresh server and transport per request.
app.post('/mcp', auth, express.json({ limit: '4mb' }), async (req, res) => {
  const server = new McpServer(
    { name: 'mealie', version: '1.0.0' },
    { instructions: SERVER_INSTRUCTIONS },
  )
  registerTools(server)
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  })
  res.on('close', () => {
    transport.close()
    server.close()
  })
  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (err) {
    console.error('MCP request failed', err)
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal error' },
        id: null,
      })
    }
  }
})

const methodNotAllowed = (_req: express.Request, res: express.Response) => {
  res
    .status(405)
    .set('Allow', 'POST')
    .json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed' },
      id: null,
    })
}
app.get('/mcp', auth, methodNotAllowed)
app.delete('/mcp', auth, methodNotAllowed)

app.listen(config.port, '0.0.0.0', () => {
  console.info(
    `Mealie MCP server listening on :${config.port}, public URL ${config.mcpUrl}`,
  )
})

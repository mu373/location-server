import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { z } from 'zod'

const placeSchema = z.object({
  name: z.string().nullable().describe(
    'User-defined OwnTracks waypoint label, such as Home or Office. '
    + 'This is not a geographic address, neighborhood, municipality, or reverse-geocoded place name.',
  ),
  rid: z.string(),
})

const currentLocationSchema = z.object({
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  acc: z.number().nullable(),
  updated_at: z.number().int().nullable(),
  place: placeSchema.nullable(),
})

export function createLocationClient({
  baseUrl,
  username,
  password,
  fetchImpl = fetch,
  timeoutMs = 5000,
}) {
  if (!baseUrl || !username || !password) {
    throw new Error('LOCATION_API_URL, AUTH_USER, and AUTH_PASS must be set')
  }

  const currentUrl = new URL('/current', `${baseUrl.replace(/\/$/, '')}/`)
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`

  return async function getCurrentLocation() {
    const response = await fetchImpl(currentUrl, {
      headers: { authorization },
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!response.ok) {
      throw new Error(`Location API returned HTTP ${response.status}`)
    }

    return currentLocationSchema.parse(await response.json())
  }
}

function createServer(getCurrentLocation) {
  const server = new McpServer({
    name: 'location',
    version: '1.0.0',
  })

  server.registerTool(
    'get_current_location',
    {
      description: 'Get the user\'s latest reported coordinates, accuracy, timestamp, '
        + 'and matching OwnTracks waypoint. The waypoint name is only a user-defined '
        + 'label, not an address or geographic interpretation of the coordinates.',
      inputSchema: z.object({}),
      outputSchema: currentLocationSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const location = await getCurrentLocation()
      return {
        content: [{ type: 'text', text: JSON.stringify(location) }],
        structuredContent: location,
      }
    },
  )

  return server
}

export function createMcpApp({
  getCurrentLocation,
  allowedHosts = ['location-mcp', 'localhost', '127.0.0.1'],
}) {
  const app = createMcpExpressApp({
    host: '0.0.0.0',
    allowedHosts,
  })

  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.post('/mcp', async (req, res) => {
    const server = createServer(getCurrentLocation)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })

    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (error) {
      console.error('MCP request failed:', error)
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        })
      }
    } finally {
      res.on('close', () => {
        transport.close()
        server.close()
      })
    }
  })

  app.all('/mcp', (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed' },
      id: null,
    })
  })

  return app
}

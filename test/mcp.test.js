import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createLocationClient, createMcpApp } from '../src/mcp.js'

const expectedLocation = {
  lat: 35.681236,
  lon: 139.767125,
  acc: 4,
  updated_at: 1788368778,
  place: { name: 'Tokyo Station', rid: 'tokyo-station' },
}

test('location client authenticates and validates the REST response', async () => {
  let request
  const getCurrentLocation = createLocationClient({
    baseUrl: 'http://location-server:8080',
    username: 'agent',
    password: 'secret',
    fetchImpl: async (url, options) => {
      request = { url: url.toString(), options }
      return new Response(JSON.stringify(expectedLocation), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })

  assert.deepEqual(await getCurrentLocation(), expectedLocation)
  assert.equal(request.url, 'http://location-server:8080/current')
  assert.equal(request.options.headers.authorization, 'Basic YWdlbnQ6c2VjcmV0')
})

test('location client reports upstream failures without returning a body', async () => {
  const getCurrentLocation = createLocationClient({
    baseUrl: 'http://location-server:8080',
    username: 'agent',
    password: 'secret',
    fetchImpl: async () => new Response('sensitive response', { status: 401 }),
  })

  await assert.rejects(getCurrentLocation(), /Location API returned HTTP 401/)
})

test('MCP exposes the current location as a read-only structured tool', async (context) => {
  const app = createMcpApp({
    getCurrentLocation: async () => expectedLocation,
  })
  const httpServer = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
  })
  context.after(() => new Promise((resolve) => httpServer.close(resolve)))

  const address = httpServer.address()
  const client = new Client({ name: 'location-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${address.port}/mcp`),
  )
  context.after(() => client.close())

  await client.connect(transport)
  const tools = await client.listTools()
  assert.deepEqual(tools.tools.map((tool) => tool.name), ['get_current_location'])
  assert.match(tools.tools[0].description, /user-defined label/)
  assert.match(
    tools.tools[0].outputSchema.properties.place.anyOf[0].properties.name.description,
    /not a geographic address/,
  )

  const result = await client.callTool({
    name: 'get_current_location',
    arguments: {},
  })
  assert.deepEqual(result.structuredContent, expectedLocation)
  assert.equal(result.isError, undefined)
})

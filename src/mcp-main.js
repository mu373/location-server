import { createLocationClient, createMcpApp } from './mcp.js'

const port = Number(process.env.MCP_PORT || 8799)
const getCurrentLocation = createLocationClient({
  baseUrl: process.env.LOCATION_API_URL,
  username: process.env.AUTH_USER,
  password: process.env.AUTH_PASS,
  timeoutMs: Number(process.env.LOCATION_API_TIMEOUT_MS || 5000),
})

const app = createMcpApp({ getCurrentLocation })
app.listen(port, '0.0.0.0', () => {
  console.log(`location MCP listening on :${port}`)
})

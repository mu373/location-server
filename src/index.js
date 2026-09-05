import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { serve } from '@hono/node-server'
import { db } from './db.js'

const app = new Hono()

const EARTH_RADIUS_METERS = 6_371_000

function distanceMeters(lat1, lon1, lat2, lon2) {
  const toRadians = (degrees) => degrees * Math.PI / 180
  const deltaLat = toRadians(lat2 - lat1)
  const deltaLon = toRadians(lon2 - lon1)
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2))
    * Math.sin(deltaLon / 2) ** 2

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a))
}

const AUTH_USER = process.env.AUTH_USER
const AUTH_PASS = process.env.AUTH_PASS

if (!AUTH_USER || !AUTH_PASS) {
  throw new Error('AUTH_USER and AUTH_PASS must be set')
}

app.get('/health', (c) => c.json({ ok: true }))

app.use('/ingest', basicAuth({ username: AUTH_USER, password: AUTH_PASS }))
app.use('/current', basicAuth({ username: AUTH_USER, password: AUTH_PASS }))

// Receiving side: persist raw OwnTracks messages as-is. No derived logic here.
app.post('/ingest', async (c) => {
  let body
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }

  const type = body._type ?? 'unknown'
  const now = Math.floor(Date.now() / 1000)

  const insert = db.prepare(`
    INSERT INTO events (type, tst, lat, lon, acc, batt, event, desc, rid, raw_json, received_at)
    VALUES (@type, @tst, @lat, @lon, @acc, @batt, @event, @desc, @rid, @raw_json, @received_at)
  `)

  insert.run({
    type,
    tst: body.tst ?? null,
    lat: body.lat ?? null,
    lon: body.lon ?? null,
    acc: body.acc ?? null,
    batt: body.batt ?? null,
    event: body.event ?? null,
    desc: body.desc ?? null,
    rid: body.rid ?? null,
    raw_json: JSON.stringify(body),
    received_at: now,
  })

  // OwnTracks HTTP mode expects HTTP 200 with a JSON array (e.g. friends' locations).
  return c.json([])
})

// Serving side: read stored events and synthesize a "current status" view.
app.get('/current', (c) => {
  const location = db.prepare(`
    SELECT * FROM events
    WHERE type = 'location'
    ORDER BY COALESCE(tst, received_at) DESC
    LIMIT 1
  `).get()

  // OwnTracks publishes waypoint definitions separately from location events.
  // Use the latest revision of each waypoint because edits retain their original
  // OwnTracks timestamp and therefore cannot be ordered reliably by `tst`.
  const waypoints = db.prepare(`
    SELECT e.*
    FROM events e
    INNER JOIN (
      SELECT rid, MAX(id) AS max_id
      FROM events
      WHERE type = 'waypoint' AND rid IS NOT NULL
      GROUP BY rid
    ) latest ON e.id = latest.max_id
  `).all()

  const coordinateMatches = location
    ? waypoints.flatMap((waypoint) => {
      let raw
      try {
        raw = JSON.parse(waypoint.raw_json)
      } catch {
        return []
      }

      const radius = Number(raw.rad)
      if (
        !Number.isFinite(location.lat)
        || !Number.isFinite(location.lon)
        || !Number.isFinite(waypoint.lat)
        || !Number.isFinite(waypoint.lon)
        || !Number.isFinite(radius)
        || radius <= 0
      ) {
        return []
      }

      const distance = distanceMeters(
        location.lat,
        location.lon,
        waypoint.lat,
        waypoint.lon,
      )
      const accuracy = Number.isFinite(location.acc) ? location.acc : 0

      return distance <= radius + accuracy
        ? [{ waypoint, radius, distance }]
        : []
    }).sort((a, b) => a.radius - b.radius || a.distance - b.distance)
    : []

  const latestPerRegion = db.prepare(`
    SELECT e.*
    FROM events e
    INNER JOIN (
      SELECT rid, MAX(COALESCE(tst, received_at)) AS max_tst
      FROM events
      WHERE type = 'transition' AND rid IS NOT NULL
      GROUP BY rid
    ) m ON e.rid = m.rid AND COALESCE(e.tst, e.received_at) = m.max_tst
    WHERE e.type = 'transition'
  `).all()

  const currentlyInside = latestPerRegion
    .filter((t) => t.event === 'enter')
    .sort((a, b) => (b.tst ?? b.received_at) - (a.tst ?? a.received_at))

  const coordinatePlace = coordinateMatches[0]?.waypoint ?? null
  const place = coordinatePlace ?? currentlyInside[0] ?? null

  return c.json({
    lat: location?.lat ?? null,
    lon: location?.lon ?? null,
    acc: location?.acc ?? null,
    updated_at: location ? (location.tst ?? location.received_at) : null,
    place: place ? { name: place.desc, rid: place.rid } : null,
  })
})

const port = Number(process.env.PORT || 8080)
serve({ fetch: app.fetch, port })
console.log(`location-server listening on :${port}`)

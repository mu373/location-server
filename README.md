# Location Server

A small self-hosted server that receives location updates from OwnTracks clients,
stores them in SQLite, and exposes the current location over HTTP and MCP.

## Use cases

Use this server as a small self-hosted destination for OwnTracks when a local service,
dashboard, or agent needs the latest location and waypoint name. It is designed for one
person or tracker rather than as a multi-user tracking platform.

## Setup

```sh
cp .env.example .env
openssl rand -hex 32
# Paste the generated value into AUTH_PASS in .env.
pnpm install
docker compose up -d --build
curl http://127.0.0.1:8080/health
```

The default Compose configuration publishes the service on loopback. Change
`LOCATION_BIND_ADDRESS` only when the service should listen on another host interface.

### Traefik overlay

Traefik support is optional and kept out of the base Compose configuration. Set
`LOCATION_HOST`, `TRAEFIK_NETWORK`, `TRAEFIK_ENTRYPOINT`, and
`TRAEFIK_CERT_RESOLVER` for an existing Traefik installation, then run:

```sh
docker compose -f docker-compose.yml -f compose.traefik.yml up -d --build
```

The overlay joins the configured external Traefik network and publishes only the
location service. The loopback port remains available for local diagnostics.

## iPhone app configuration

In [OwnTracks for iPhone](https://apps.apple.com/us/app/owntracks/id692424691), select
HTTP mode and configure:

```text
URL:      https://location.example.com/ingest
Username: <AUTH_USER>
Password: <AUTH_PASS>
```

Use the app's manual publish button, then verify the result:

```sh
curl -u '<AUTH_USER>:<AUTH_PASS>' https://location.example.com/current
```

Create named circular waypoints in the app to make `/current` report places and react to
`enter` / `leave` events. Use HTTPS outside a trusted local network. See the OwnTracks
[iOS guide](https://owntracks.org/booklet/features/ios/) for detailed app setup.

## Endpoints

- `GET /health`: unauthenticated liveness check
- `POST /ingest`: authenticated OwnTracks HTTP endpoint
- `GET /current`: authenticated latest location and current region

Both authenticated endpoints use HTTP Basic authentication from `AUTH_USER`
and `AUTH_PASS`. SQLite data is persisted in `./data/location.db`.

## Location resolving logic

`/current` returns the newest `location` message and resolves its place from stored
waypoints. It first checks whether the coordinates fall within a waypoint's radius
(including reported GPS accuracy). If none match, it falls back to waypoint transition
state: `enter` activates a place and `leave` deactivates it. Coordinate matching takes
precedence, and the place is `null` when neither method finds one.

## Agent MCP

The optional `agent` Compose profile exposes one read-only MCP tool over Streamable
HTTP:

| Tool | Arguments | Result |
| --- | --- | --- |
| `get_current_location` | None | Latest `lat`, `lon`, `acc`, `updated_at` (Unix time), and matched `place` (`name` and `rid`). Values are `null` when unavailable. |

The tool returns the same resolved data as `GET /current`. It cannot request a new
location from the phone, read location history, modify waypoints, or reverse-geocode
coordinates.

Start the MCP service with:

```sh
docker compose --profile agent up -d --build
```

Set `AGENT_NETWORK` to an existing Docker network shared with the MCP client. The MCP
endpoint is available to containers on that network at
`http://location-mcp:8799/mcp`. The MCP process proxies the private REST service and
keeps its Basic Auth credentials out of the client container. It is not published
through Traefik or directly on a host port.

## Privacy and retention

SQLite contains precise location history and raw OwnTracks payloads. It is unencrypted
and has no automatic retention policy, so protect the data directory and endpoint.

## License

MIT

# Location Server

A small OwnTracks-compatible HTTP receiver backed by SQLite.

## Run

```sh
cp .env.example .env
# Replace AUTH_PASS in .env before continuing.
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

## Endpoints

- `GET /health`: unauthenticated liveness check
- `POST /ingest`: authenticated OwnTracks HTTP endpoint
- `GET /current`: authenticated latest location and current region

Both authenticated endpoints use HTTP Basic authentication from `AUTH_USER`
and `AUTH_PASS`. SQLite data is persisted in `./data/location.db`.

## Agent MCP

The optional `agent` Compose profile runs a read-only Streamable HTTP MCP facade:

```sh
docker compose --profile agent up -d --build
```

Set `AGENT_NETWORK` to an existing Docker network shared with the MCP client. The MCP
endpoint is available to containers on that network at
`http://location-mcp:8799/mcp`. The MCP process proxies the private REST service and
keeps its Basic Auth credentials out of the client container. It is not published
through Traefik or directly on a host port.

## License

MIT

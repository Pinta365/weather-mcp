# weather-mcp

A Deno-based [Model Context Protocol](https://modelcontextprotocol.io) server that exposes worldwide weather data via [Open-Meteo](https://open-meteo.com).

## Tools

- **`find_location(query, count?)`** — Geocode a place name to coordinates. Returns matches with country, admin region, timezone, elevation, and population. Call this first whenever the user names a place.
- **`get_forecast(latitude, longitude, days)`** — Daily forecast (1–16 days). Per-day fields: max/min temperature, apparent temperature, precipitation sum, max precipitation probability, snowfall, sunshine and daylight duration, sunrise/sunset, max UV, max wind speed and gusts, dominant wind direction, shortwave radiation sum (MJ/m² — direct input for solar yield), and a WMO weather code with a human-readable label.
- **`get_hourly_forecast(latitude, longitude, hours)`** — Hour-by-hour forecast (1–384 h). Per-hour fields: temperature, apparent temperature, relative humidity, dew point, precipitation probability, precipitation, snowfall, cloud cover, visibility, UV, shortwave radiation (W/m²), wind speed and gusts, wind direction, `is_day`, and a WMO code with label.
- **`get_current_conditions(latitude, longitude)`** — Live conditions: temperature, apparent temperature, `is_day`, humidity, precipitation, cloud cover, MSL pressure, wind speed and gusts, wind direction, and a WMO code with label.

All units are metric: °C, m/s, mm, hPa, MJ/m², W/m².

## Requirements

- [Deno 2.x](https://deno.com)

## Run

```bash
deno task start
```

The server speaks MCP over stdio, so nothing visible happens until an MCP client connects.

## Wire into an MCP client

### Claude Desktop / Claude Code

Add to your MCP server config:

```json
{
  "mcpServers": {
    "weather": {
      "command": "deno",
      "args": [
        "run",
        "--allow-net=api.open-meteo.com,geocoding-api.open-meteo.com",
        "/absolute/path/to/weather-mcp/main.ts"
      ]
    }
  }
}
```

Restart the client; the four tools should appear.

## Caching

Responses are cached in-memory with TTLs sized to respect Open-Meteo's free-tier rate limit (10k calls/day, non-commercial):

| Tool                     | TTL    |
|--------------------------|--------|
| `find_location`          | 24 h   |
| `get_forecast`           | 1 h    |
| `get_hourly_forecast`    | 30 min |
| `get_current_conditions` | 10 min |

Coordinates are rounded to 2 decimal places (~1.1 km) for cache keys, so nearby queries deduplicate. The cache is per-process and resets on restart.

## Permissions

`deno task start` runs with `--allow-net` scoped to the two Open-Meteo hosts. No filesystem or environment access is granted.

## License

MIT. See [LICENSE](./LICENSE).

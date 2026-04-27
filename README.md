# weather-mcp

A Deno-based [Model Context Protocol](https://modelcontextprotocol.io) server that exposes worldwide weather data, aggregated across multiple providers with weighted averaging. Suitable for trip planning, agriculture, solar yield estimates, RV travel, and any other context where atomic, structured weather data is useful to an LLM agent.

## Providers

Each weather request is fanned out to all providers whose coverage includes the requested coordinates. The router picks **one baseline** (the highest-priority provider whose coverage matches) plus **every regional specialist** that also covers the location. Responses are merged with a weighted mean for numeric fields, weighted mode for weather codes, and circular mean for wind direction.

| Provider     | Tier      | Coverage          | Default weight | Notes                                            |
|--------------|-----------|-------------------|----------------|--------------------------------------------------|
| Open-Meteo   | baseline  | Global            | 1.0            | Internal ensemble of ECMWF, ICON, GFS, JMA, etc. |
| MET Norway   | regional  | Nordic bbox       | 1.5            | MEPS model — high-resolution Nordic specialist.  |
| SMHI         | regional  | Nordic bbox       | 1.5            | `snow1g` API — Sweden/Nordic specialist.         |

`find_location` (geocoding) is single-source and always uses Open-Meteo.

## Tools

- **`find_location(query, count?)`** — Geocode a place name to coordinates. Returns matches with country, admin region, timezone, elevation, and population. Call this first whenever the user names a place.
- **`get_forecast(latitude, longitude, days)`** — Daily forecast (1–16 days). Per-day fields: max/min temperature, apparent temperature, precipitation sum, max precipitation probability, snowfall, sunshine and daylight duration, sunrise/sunset, max UV, max wind speed and gusts, dominant wind direction, shortwave radiation sum (MJ/m² — direct input for solar yield), and a WMO weather code with a human-readable label.
- **`get_hourly_forecast(latitude, longitude, hours)`** — Hour-by-hour forecast (1–384 h). Per-hour fields: temperature, apparent temperature, relative humidity, dew point, precipitation probability, precipitation, snowfall, cloud cover, visibility, UV, shortwave radiation (W/m²), wind speed and gusts, wind direction, `is_day`, and a WMO code with label.
- **`get_current_conditions(latitude, longitude)`** — Live conditions: temperature, apparent temperature, `is_day`, humidity, precipitation, cloud cover, MSL pressure, wind speed and gusts, wind direction, and a WMO code with label.

All weather responses include `contributingProviders: string[]` and `failedProviders: { name, error }[]` so the consumer can see which providers actually served the response.

All units are metric: °C, m/s, mm, hPa, MJ/m², W/m². **All times are UTC** (the `timezone` field reports the location's timezone for any client-side conversion).

## Requirements

- [Deno 2.x](https://deno.com)

## Run

```bash
deno task start       # production stdio
deno task dev         # watch mode
deno task check       # typecheck
deno task test        # run the test suite (no network)
```

The server speaks MCP over stdio, so nothing visible happens until an MCP client connects.

## Wire into an MCP client

### Claude Desktop / Claude Code

**Minimal config** (defaults for everything):

```json
{
  "mcpServers": {
    "weather": {
      "command": "deno",
      "args": [
        "run",
        "--allow-net=api.open-meteo.com,geocoding-api.open-meteo.com,api.met.no,opendata-download-metfcst.smhi.se",
        "/absolute/path/to/weather-mcp/main.ts"
      ]
    }
  }
}
```

**With custom provider weights** — add `--allow-env=WEATHERMCP_WEIGHTS` to `args` and a matching `env` block:

```json
{
  "mcpServers": {
    "weather": {
      "command": "deno",
      "args": [
        "run",
        "--allow-net=api.open-meteo.com,geocoding-api.open-meteo.com,api.met.no,opendata-download-metfcst.smhi.se",
        "--allow-env=WEATHERMCP_WEIGHTS",
        "/absolute/path/to/weather-mcp/main.ts"
      ],
      "env": {
        "WEATHERMCP_WEIGHTS": "open-meteo:1.0,met-norway:2.0,smhi:2.0"
      }
    }
  }
}
```

Restart the client; the four tools should appear.

## Caching

Each provider is wrapped in its own in-memory TTL cache, sized to respect each upstream's rate limit (Open-Meteo's free tier is 10k calls/day, non-commercial; MET Norway requires reasonable use):

| Cache                    | TTL    |
|--------------------------|--------|
| `find_location`          | 24 h   |
| `get_forecast`           | 1 h    |
| `get_hourly_forecast`    | 30 min |
| `get_current_conditions` | 10 min |

Coordinates are rounded to 2 decimal places (~1.1 km) for cache keys, so nearby queries deduplicate. The cache is per-process and resets on restart.

## Configuration

### `WEATHERMCP_WEIGHTS` (optional)

Override per-provider weights via an environment variable, set in your MCP client config alongside the server entry (see the JSON snippet above). Format:

```
WEATHERMCP_WEIGHTS=open-meteo:1.0,met-norway:2.0,smhi:2.0
```

Higher weight = more influence on the merged numeric fields and weighted mode for weather codes. Whitespace is tolerated. Unknown providers and malformed entries are ignored. Missing providers default to 1.0. If `--allow-env=WEATHERMCP_WEIGHTS` isn't granted, the env var is silently skipped and defaults are used — you don't need to grant env access just to run with the default weights.

### Adding a provider

1. Implement `WeatherProvider` from `providers/types.ts` (set `tier: "baseline" | "regional"`, `priority`, and a `coverage(coords) => boolean` — `everywhere` or `boundingBox(...)` from `providers/coverage.ts`).
2. Wrap it in `CachedWeatherProvider` and pass it into the `WeatherAggregator` array in `main.ts`.
3. Add the provider's host(s) to `--allow-net` in `deno.json`.

`baseline` providers compete (highest `priority` whose coverage matches wins; the rest sit out). `regional` providers all run if their coverage matches.

## Permissions

`deno task start` runs with the minimum permissions needed:

- `--allow-net` scoped to the four upstream hosts (`api.open-meteo.com`, `geocoding-api.open-meteo.com`, `api.met.no`, `opendata-download-metfcst.smhi.se`)
- `--allow-env=WEATHERMCP_WEIGHTS` for the optional weights override (omit entirely if you're running with default weights)

No filesystem, run, or broader env access is granted.

## License

MIT. See [LICENSE](./LICENSE).

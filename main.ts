import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { OpenMeteoProvider } from "./providers/open-meteo.ts";
import { MetNorwayProvider } from "./providers/met-norway.ts";
import { SmhiProvider } from "./providers/smhi.ts";
import { CachedLocationProvider, CachedWeatherProvider } from "./providers/cache.ts";
import { WeatherAggregator } from "./providers/aggregator.ts";
import { readWeightsFromEnv } from "./weights.ts";

const weights = readWeightsFromEnv();

const openMeteo = new OpenMeteoProvider({
  weight: weights["open-meteo"] ?? 1.0,
  priority: 1,
});

const metNorway = new MetNorwayProvider({
  weight: weights["met-norway"] ?? 1.5,
});

const smhi = new SmhiProvider({
  weight: weights["smhi"] ?? 1.5,
});

const aggregator = new WeatherAggregator([
  new CachedWeatherProvider(openMeteo),
  new CachedWeatherProvider(metNorway),
  new CachedWeatherProvider(smhi),
]);

const geocoder = new CachedLocationProvider(openMeteo);

const server = new McpServer({
  name: "weather-mcp",
  version: "0.2.0",
});

const latitude = z.number().min(-90).max(90).describe("Latitude in decimal degrees, WGS84");
const longitude = z.number().min(-180).max(180).describe("Longitude in decimal degrees, WGS84");

server.registerTool(
  "find_location",
  {
    title: "Find a location by name",
    description:
      "Geocode a place name to coordinates. Returns up to N matches with latitude, longitude, " +
      "country, admin region, timezone, elevation, and population. Call this first whenever the " +
      "user names a place (e.g. 'Stockholm', 'Yosemite Valley', 'Tuscany'); the weather tools " +
      "all require coordinates.",
    inputSchema: {
      query: z.string().min(1).describe(
        "Place name to search for, e.g. 'Stockholm' or 'Yosemite'",
      ),
      count: z.number().int().min(1).max(20).default(5).describe(
        "Maximum number of matches to return",
      ),
    },
  },
  async ({ query, count }) => {
    const matches = await geocoder.findLocation(query, count);
    return {
      content: [{ type: "text", text: JSON.stringify(matches, null, 2) }],
    };
  },
);

server.registerTool(
  "get_forecast",
  {
    title: "Get daily weather forecast",
    description:
      "Daily forecast for a coordinate, aggregated across multiple weather providers (weighted " +
      "mean for numeric fields, weighted mode for weather code). The first day in the response " +
      "is ALWAYS today at the location; pass days=2 to include tomorrow, days=7 for a week " +
      "starting today, days=16 for the full horizon. Per-day fields: max/min temperature (°C), " +
      "apparent temperature, total precipitation (mm), max precipitation probability (%), " +
      "snowfall (cm), sunshine and daylight duration (s), sunrise/sunset, max UV index, max " +
      "wind speed and gusts (m/s), dominant wind direction (°), shortwave radiation sum " +
      "(MJ/m^2 - direct input for solar yield estimates), and a WMO weather code with a " +
      "human-readable label. Times are GMT/UTC. Response includes contributingProviders.",
    inputSchema: {
      latitude,
      longitude,
      days: z.number().int().min(1).max(16).describe(
        "Number of days to forecast, INCLUDING today. days=1 returns only today; " +
          "days=2 returns today + tomorrow; days=7 returns today + the next 6 days. Range 1-16.",
      ),
    },
  },
  async ({ latitude, longitude, days }) => {
    const forecast = await aggregator.getForecast({ latitude, longitude }, days);
    return {
      content: [{ type: "text", text: JSON.stringify(forecast, null, 2) }],
    };
  },
);

server.registerTool(
  "get_hourly_forecast",
  {
    title: "Get hourly weather forecast",
    description:
      "Hour-by-hour forecast for a coordinate, aggregated across multiple weather providers. " +
      "The first hour in the response is ALWAYS the current hour at the location; hours=1 " +
      "returns just that, hours=24 covers roughly the next day, hours=48 covers two days, etc. " +
      "Per-hour fields: temperature (°C), apparent temperature, relative humidity (%), dew " +
      "point (°C), precipitation probability (%), precipitation (mm), snowfall (cm), cloud " +
      "cover (%), visibility (m), UV index, shortwave radiation (W/m^2), wind speed and gusts " +
      "(m/s), wind direction (°), is_day flag, and a WMO weather code with a human-readable " +
      "label. Times are GMT/UTC. Use when timing within a day matters: hike windows, solar " +
      "irradiance at specific hours, RV departure timing.",
    inputSchema: {
      latitude,
      longitude,
      hours: z.number().int().min(1).max(384).describe(
        "Number of hours to forecast, starting from the current hour. hours=1 returns just " +
          "the current hour; hours=24 covers roughly the next day; hours=48 two days. Range 1-384 (~16 days).",
      ),
    },
  },
  async ({ latitude, longitude, hours }) => {
    const forecast = await aggregator.getHourlyForecast({ latitude, longitude }, hours);
    return {
      content: [{ type: "text", text: JSON.stringify(forecast, null, 2) }],
    };
  },
);

server.registerTool(
  "get_current_conditions",
  {
    title: "Get current weather conditions",
    description:
      "Live conditions at a coordinate, aggregated across multiple weather providers. Returns " +
      "temperature (°C), apparent temperature, is_day flag, relative humidity (%), " +
      "precipitation (mm), cloud cover (%), pressure (hPa), wind speed and gusts (m/s), wind " +
      "direction (°), and a WMO weather code with a human-readable label. Times are GMT/UTC.",
    inputSchema: {
      latitude,
      longitude,
    },
  },
  async ({ latitude, longitude }) => {
    const current = await aggregator.getCurrentConditions({ latitude, longitude });
    return {
      content: [{ type: "text", text: JSON.stringify(current, null, 2) }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  `[weather-mcp] connected on stdio with providers: ${
    [openMeteo.name, metNorway.name, smhi.name].join(", ")
  }`,
);


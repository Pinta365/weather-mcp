import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { OpenMeteoProvider } from "./providers/open-meteo.ts";
import { CachedWeatherProvider } from "./providers/cache.ts";

const provider = new CachedWeatherProvider(new OpenMeteoProvider());

const server = new McpServer({
  name: "weather-mcp",
  version: "0.1.0",
});

const latitude = z.number().min(-90).max(90).describe("Latitude in decimal degrees, WGS84");
const longitude = z.number().min(-180).max(180).describe("Longitude in decimal degrees, WGS84");

server.registerTool(
  "find_location",
  {
    title: "Find a location by name",
    description: "Geocode a place name to coordinates. Returns up to N matches with latitude, longitude, " +
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
    const matches = await provider.findLocation(query, count);
    return {
      content: [{ type: "text", text: JSON.stringify(matches, null, 2) }],
    };
  },
);

server.registerTool(
  "get_forecast",
  {
    title: "Get daily weather forecast",
    description: "Daily forecast for a coordinate. Per-day fields: max/min temperature (°C), apparent " +
      "temperature, total precipitation (mm), max precipitation probability (%), snowfall (cm), " +
      "sunshine and daylight duration (s), sunrise/sunset, max UV index, max wind speed and " +
      "gusts (m/s), dominant wind direction (°), shortwave radiation sum (MJ/m^2 - direct " +
      "input for solar yield estimates), and a WMO weather code with a human-readable label. " +
      "Use for trip planning, agriculture, solar yield, RV travel.",
    inputSchema: {
      latitude,
      longitude,
      days: z.number().int().min(1).max(16).describe("Number of forecast days (1-16)"),
    },
  },
  async ({ latitude, longitude, days }) => {
    const forecast = await provider.getForecast({ latitude, longitude }, days);
    return {
      content: [{ type: "text", text: JSON.stringify(forecast, null, 2) }],
    };
  },
);

server.registerTool(
  "get_hourly_forecast",
  {
    title: "Get hourly weather forecast",
    description: "Hour-by-hour forecast for a coordinate over the next N hours. Per-hour fields: " +
      "temperature (°C), apparent temperature, relative humidity (%), dew point (°C), " +
      "precipitation probability (%), precipitation (mm), snowfall (cm), cloud cover (%), " +
      "visibility (m), UV index, shortwave radiation (W/m^2 - instantaneous solar irradiance), " +
      "wind speed and gusts (m/s), wind direction (°), is_day flag, and a WMO weather code " +
      "with a human-readable label. Use this when timing within a day matters: hike windows, " +
      "solar irradiance at specific hours, RV departure timing.",
    inputSchema: {
      latitude,
      longitude,
      hours: z.number().int().min(1).max(384).describe(
        "Number of forecast hours from now (1-384, ~16 days)",
      ),
    },
  },
  async ({ latitude, longitude, hours }) => {
    const forecast = await provider.getHourlyForecast({ latitude, longitude }, hours);
    return {
      content: [{ type: "text", text: JSON.stringify(forecast, null, 2) }],
    };
  },
);

server.registerTool(
  "get_current_conditions",
  {
    title: "Get current weather conditions",
    description: "Live conditions at a coordinate: temperature (°C), apparent temperature, is_day flag, " +
      "relative humidity (%), precipitation (mm), cloud cover (%), pressure (hPa), wind speed " +
      "and gusts (m/s), wind direction (°), and a WMO weather code with a human-readable label.",
    inputSchema: {
      latitude,
      longitude,
    },
  },
  async ({ latitude, longitude }) => {
    const current = await provider.getCurrentConditions({ latitude, longitude });
    return {
      content: [{ type: "text", text: JSON.stringify(current, null, 2) }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[weather-mcp] connected on stdio");

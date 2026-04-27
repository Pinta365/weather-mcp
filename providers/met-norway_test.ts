import { assertEquals, assertExists } from "@std/assert";
import { MetNorwayProvider, symbolCodeToWmo } from "./met-norway.ts";

const originalFetch = globalThis.fetch;

interface FixtureEntry {
  time: string;
  temperature: number;
  precipitation?: number;
  symbol?: string;
  windFromDirection?: number;
  windSpeed?: number;
  cloudCover?: number;
  humidity?: number;
  pressure?: number;
}

function buildFixture(entries: FixtureEntry[]) {
  return {
    properties: {
      timeseries: entries.map((e) => ({
        time: e.time,
        data: {
          instant: {
            details: {
              air_temperature: e.temperature,
              air_pressure_at_sea_level: e.pressure ?? 1013,
              cloud_area_fraction: e.cloudCover ?? 50,
              relative_humidity: e.humidity ?? 60,
              wind_from_direction: e.windFromDirection ?? 180,
              wind_speed: e.windSpeed ?? 3,
            },
          },
          next_1_hours: e.symbol || e.precipitation !== undefined
            ? {
              summary: e.symbol ? { symbol_code: e.symbol } : undefined,
              details: e.precipitation !== undefined
                ? { precipitation_amount: e.precipitation }
                : undefined,
            }
            : undefined,
        },
      })),
    },
  };
}

function stubFetch(body: unknown): { captured: { url: URL; headers: Headers }[] } {
  const captured: { url: URL; headers: Headers }[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof URL
      ? input
      : new URL(typeof input === "string" ? input : input.url);
    captured.push({ url, headers: new Headers(init?.headers) });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return { captured };
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

Deno.test("symbolCodeToWmo strips diurnal suffix and maps known codes", () => {
  assertEquals(symbolCodeToWmo("clearsky_day"), 0);
  assertEquals(symbolCodeToWmo("clearsky_night"), 0);
  assertEquals(symbolCodeToWmo("partlycloudy_day"), 2);
  assertEquals(symbolCodeToWmo("cloudy"), 3);
  assertEquals(symbolCodeToWmo("fog"), 45);
  assertEquals(symbolCodeToWmo("lightrain"), 61);
  assertEquals(symbolCodeToWmo("heavyrain"), 65);
  assertEquals(symbolCodeToWmo("rainshowers_polartwilight"), 81);
  assertEquals(symbolCodeToWmo("heavysnow"), 75);
  assertEquals(symbolCodeToWmo("rainshowersandthunder_day"), 95);
  assertEquals(symbolCodeToWmo("heavyrainshowersandthunder_day"), 96);
});

Deno.test("symbolCodeToWmo returns null for unknown or missing codes", () => {
  assertEquals(symbolCodeToWmo(null), null);
  assertEquals(symbolCodeToWmo("zzz_unknown"), null);
});

Deno.test("MetNorwayProvider declares regional tier with Nordic bbox by default", () => {
  const p = new MetNorwayProvider();
  assertEquals(p.tier, "regional");
  assertEquals(p.coverage({ latitude: 59.33, longitude: 18.07 }), true); // Stockholm
  assertEquals(p.coverage({ latitude: 35.68, longitude: 139.69 }), false); // Tokyo
});

Deno.test("MetNorwayProvider can be configured globally as a baseline", () => {
  const p = new MetNorwayProvider({ nordicOnly: false });
  assertEquals(p.tier, "baseline");
  assertEquals(p.coverage({ latitude: 35.68, longitude: 139.69 }), true);
});

Deno.test("MetNorwayProvider sends the required User-Agent header", async () => {
  const stub = stubFetch(buildFixture([
    { time: "2026-04-27T13:00:00Z", temperature: 10, symbol: "clearsky_day" },
  ]));
  try {
    const p = new MetNorwayProvider();
    await p.getCurrentConditions({ latitude: 59.33, longitude: 18.07 });
    assertEquals(stub.captured.length, 1);
    const ua = stub.captured[0].headers.get("user-agent");
    assertExists(ua);
    assertEquals(ua!.startsWith("weather-mcp/"), true);
  } finally {
    restoreFetch();
  }
});

Deno.test("MetNorwayProvider parses current conditions from the first timeseries entry", async () => {
  stubFetch(buildFixture([
    {
      time: "2026-04-27T13:00:00Z",
      temperature: 10.5,
      symbol: "partlycloudy_day",
      windFromDirection: 220,
      windSpeed: 4.5,
      humidity: 70,
      pressure: 1015,
      cloudCover: 60,
      precipitation: 0,
    },
    {
      time: "2026-04-27T14:00:00Z",
      temperature: 11,
      symbol: "partlycloudy_day",
    },
  ]));
  try {
    const p = new MetNorwayProvider();
    const result = await p.getCurrentConditions({ latitude: 59.33, longitude: 18.07 });
    assertEquals(result.contributingProviders, ["met-norway"]);
    assertEquals(result.observedAt, "2026-04-27T13:00");
    assertEquals(result.temperatureC, 10.5);
    assertEquals(result.isDay, true);
    assertEquals(result.weatherCode, 2);
    assertEquals(result.weatherLabel, "Partly cloudy");
    assertEquals(result.windSpeedMs, 4.5);
    assertEquals(result.windDirectionDeg, 220);
    assertEquals(result.relativeHumidityPct, 70);
    assertEquals(result.pressureMslHpa, 1015);
    assertEquals(result.cloudCoverPct, 60);
    assertEquals(result.precipitationMm, 0);
  } finally {
    restoreFetch();
  }
});

Deno.test("MetNorwayProvider parses hourly forecast and slices to N hours", async () => {
  stubFetch(buildFixture([
    { time: "2026-04-27T13:00:00Z", temperature: 10, symbol: "clearsky_day" },
    { time: "2026-04-27T14:00:00Z", temperature: 11, symbol: "clearsky_day" },
    { time: "2026-04-27T15:00:00Z", temperature: 12, symbol: "clearsky_day" },
  ]));
  try {
    const p = new MetNorwayProvider();
    const result = await p.getHourlyForecast({ latitude: 59.33, longitude: 18.07 }, 2);
    assertEquals(result.hours.length, 2);
    assertEquals(result.hours[0].time, "2026-04-27T13:00");
    assertEquals(result.hours[0].temperatureC, 10);
    assertEquals(result.hours[0].weatherLabel, "Clear sky");
    assertEquals(result.hours[1].time, "2026-04-27T14:00");
  } finally {
    restoreFetch();
  }
});

Deno.test("MetNorwayProvider aggregates hourly entries into per-day max/min/sum", async () => {
  stubFetch(buildFixture([
    { time: "2026-04-27T00:00:00Z", temperature: 5, precipitation: 0.5, symbol: "lightrain" },
    { time: "2026-04-27T12:00:00Z", temperature: 14, precipitation: 0.0, symbol: "partlycloudy_day" },
    { time: "2026-04-27T18:00:00Z", temperature: 8, precipitation: 1.5, symbol: "lightrain" },
    { time: "2026-04-28T00:00:00Z", temperature: 4, precipitation: 0.0, symbol: "clearsky_night" },
    { time: "2026-04-28T12:00:00Z", temperature: 16, precipitation: 0.0, symbol: "clearsky_day" },
  ]));
  try {
    const p = new MetNorwayProvider();
    const result = await p.getForecast({ latitude: 59.33, longitude: 18.07 }, 5);
    assertEquals(result.days.length, 2);

    const d1 = result.days[0];
    assertEquals(d1.date, "2026-04-27");
    assertEquals(d1.temperatureMaxC, 14);
    assertEquals(d1.temperatureMinC, 5);
    assertEquals(d1.precipitationSumMm, 2.0);
    assertEquals(d1.weatherCode, 61); // lightrain occurs twice, partlycloudy once

    const d2 = result.days[1];
    assertEquals(d2.date, "2026-04-28");
    assertEquals(d2.temperatureMaxC, 16);
    assertEquals(d2.temperatureMinC, 4);
    assertEquals(d2.weatherCode, 0); // clearsky
  } finally {
    restoreFetch();
  }
});

Deno.test("MetNorwayProvider getForecast caps the number of days returned", async () => {
  const entries: FixtureEntry[] = [];
  for (let day = 0; day < 5; day++) {
    const date = `2026-04-${String(27 + day).padStart(2, "0")}`;
    entries.push({ time: `${date}T12:00:00Z`, temperature: 10, symbol: "clearsky_day" });
  }
  stubFetch(buildFixture(entries));
  try {
    const p = new MetNorwayProvider();
    const result = await p.getForecast({ latitude: 59.33, longitude: 18.07 }, 2);
    assertEquals(result.days.length, 2);
  } finally {
    restoreFetch();
  }
});

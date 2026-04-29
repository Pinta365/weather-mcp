import { assertEquals, assertExists } from "@std/assert";
import { SmhiProvider, symbolCodeToWmo } from "./index.ts";

const originalFetch = globalThis.fetch;

interface FixtureEntry {
  time: string;
  temperature?: number;
  windSpeed?: number;
  windGust?: number;
  windFromDirection?: number;
  humidity?: number;
  pressure?: number;
  visibilityKm?: number;
  cloudOctas?: number;
  precipitationMm?: number;
  precipitationProbability?: number;
  symbolCode?: number;
}

function buildFixture(entries: FixtureEntry[]) {
  return {
    timeSeries: entries.map((e) => ({
      time: e.time,
      data: {
        air_temperature: e.temperature,
        wind_speed: e.windSpeed,
        wind_speed_of_gust: e.windGust,
        wind_from_direction: e.windFromDirection,
        relative_humidity: e.humidity,
        air_pressure_at_mean_sea_level: e.pressure,
        visibility_in_air: e.visibilityKm,
        cloud_area_fraction: e.cloudOctas,
        precipitation_amount_mean: e.precipitationMm,
        probability_of_precipitation: e.precipitationProbability,
        symbol_code: e.symbolCode,
      },
    })),
  };
}

function stubFetch(body: unknown): URL[] {
  const captured: URL[] = [];
  globalThis.fetch = ((input: string | URL | Request): Promise<Response> => {
    const url = input instanceof URL
      ? input
      : new URL(typeof input === "string" ? input : input.url);
    captured.push(url);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return captured;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

Deno.test("symbolCodeToWmo maps canonical Wsymb2 codes", () => {
  assertEquals(symbolCodeToWmo(1), 0);
  assertEquals(symbolCodeToWmo(4), 2);
  assertEquals(symbolCodeToWmo(6), 3);
  assertEquals(symbolCodeToWmo(7), 45);
  assertEquals(symbolCodeToWmo(11), 95);
  assertEquals(symbolCodeToWmo(20), 65);
  assertEquals(symbolCodeToWmo(27), 75);
});

Deno.test("symbolCodeToWmo returns null for null and out-of-range codes", () => {
  assertEquals(symbolCodeToWmo(null), null);
  assertEquals(symbolCodeToWmo(0), null);
  assertEquals(symbolCodeToWmo(99), null);
});

Deno.test("SmhiProvider is regional with Nordic bbox by default", () => {
  const p = new SmhiProvider();
  assertEquals(p.tier, "regional");
  assertEquals(p.coverage({ latitude: 59.33, longitude: 18.07 }), true); // Stockholm
  assertEquals(p.coverage({ latitude: 35.68, longitude: 139.69 }), false); // Tokyo
});

Deno.test("SmhiProvider hits snow1g endpoint with path-style coordinates", async () => {
  const captured = stubFetch(
    buildFixture([{ time: "2026-04-27T20:00:00Z", temperature: 5, symbolCode: 4 }]),
  );
  try {
    const p = new SmhiProvider();
    await p.getCurrentConditions({ latitude: 59.33, longitude: 18.07 });
    assertEquals(captured.length, 1);
    const url = captured[0];
    assertEquals(url.host, "opendata-download-metfcst.smhi.se");
    assertEquals(
      url.pathname,
      "/api/category/snow1g/version/1/geotype/point/lon/18.070000/lat/59.330000/data.json",
    );
  } finally {
    restoreFetch();
  }
});

Deno.test("SmhiProvider parses current conditions with octa-to-percent and km-to-m conversions", async () => {
  stubFetch(buildFixture([{
    time: "2026-04-27T20:00:00Z",
    temperature: 4.9,
    windSpeed: 3.1,
    windGust: 8.1,
    windFromDirection: 28,
    humidity: 72,
    pressure: 1024.3,
    visibilityKm: 23.6,
    cloudOctas: 8,
    precipitationMm: 0.1,
    symbolCode: 4,
  }]));
  try {
    const p = new SmhiProvider();
    const result = await p.getCurrentConditions({ latitude: 59.33, longitude: 18.07 });
    assertEquals(result.contributingProviders, ["smhi"]);
    assertEquals(result.observedAt, "2026-04-27T20:00");
    assertEquals(result.temperatureC, 4.9);
    assertEquals(result.windSpeedMs, 3.1);
    assertEquals(result.windGustsMs, 8.1);
    assertEquals(result.windDirectionDeg, 28);
    assertEquals(result.relativeHumidityPct, 72);
    assertEquals(result.pressureMslHpa, 1024.3);
    assertEquals(result.cloudCoverPct, 100); // 8 octas -> 100%
    assertEquals(result.precipitationMm, 0.1);
    assertEquals(result.weatherCode, 2); // symbol_code 4 (Halfclear) -> WMO 2
    assertEquals(result.weatherLabel, "Partly cloudy");
    // SMHI doesn't provide is_day or apparent temperature
    assertEquals(result.isDay, null);
    assertEquals(result.apparentTemperatureC, null);
  } finally {
    restoreFetch();
  }
});

Deno.test("SmhiProvider parses hourly entries and converts visibility km to meters", async () => {
  stubFetch(buildFixture([
    {
      time: "2026-04-27T20:00:00Z",
      temperature: 5,
      visibilityKm: 23.6,
      cloudOctas: 4,
      precipitationProbability: 17,
      symbolCode: 4,
    },
    {
      time: "2026-04-27T21:00:00Z",
      temperature: 4.5,
      visibilityKm: 20,
      cloudOctas: 4,
      precipitationProbability: 7,
      symbolCode: 4,
    },
  ]));
  try {
    const p = new SmhiProvider();
    const result = await p.getHourlyForecast({ latitude: 59.33, longitude: 18.07 }, 5);
    assertEquals(result.hours.length, 2);
    assertEquals(result.hours[0].time, "2026-04-27T20:00");
    assertEquals(result.hours[0].temperatureC, 5);
    assertEquals(result.hours[0].visibilityM, 23600); // 23.6 km -> 23600 m
    assertEquals(result.hours[0].cloudCoverPct, 50); // 4 octas -> 50%
    assertEquals(result.hours[0].precipitationProbabilityPct, 17);
    assertEquals(result.hours[0].weatherLabel, "Partly cloudy");
  } finally {
    restoreFetch();
  }
});

Deno.test("SmhiProvider getHourlyForecast slices to N hours", async () => {
  stubFetch(buildFixture([
    { time: "2026-04-27T20:00:00Z", temperature: 5, symbolCode: 1 },
    { time: "2026-04-27T21:00:00Z", temperature: 4, symbolCode: 1 },
    { time: "2026-04-27T22:00:00Z", temperature: 3, symbolCode: 1 },
  ]));
  try {
    const p = new SmhiProvider();
    const result = await p.getHourlyForecast({ latitude: 59.33, longitude: 18.07 }, 2);
    assertEquals(result.hours.length, 2);
  } finally {
    restoreFetch();
  }
});

Deno.test("SmhiProvider aggregates hourly data into per-day max/min/sum", async () => {
  stubFetch(buildFixture([
    { time: "2026-04-27T00:00:00Z", temperature: 4, precipitationMm: 0.5, symbolCode: 18 }, // light rain
    { time: "2026-04-27T12:00:00Z", temperature: 14, precipitationMm: 0.0, symbolCode: 4 }, // halfclear
    { time: "2026-04-27T18:00:00Z", temperature: 8, precipitationMm: 1.5, symbolCode: 18 }, // light rain
    { time: "2026-04-28T00:00:00Z", temperature: 3, precipitationMm: 0.0, symbolCode: 1 }, // clear
    { time: "2026-04-28T12:00:00Z", temperature: 16, precipitationMm: 0.0, symbolCode: 1 }, // clear
  ]));
  try {
    const p = new SmhiProvider();
    const result = await p.getForecast({ latitude: 59.33, longitude: 18.07 }, 5);
    assertEquals(result.days.length, 2);

    const d1 = result.days[0];
    assertEquals(d1.date, "2026-04-27");
    assertEquals(d1.temperatureMaxC, 14);
    assertEquals(d1.temperatureMinC, 4);
    assertEquals(d1.precipitationSumMm, 2.0);
    assertEquals(d1.weatherCode, 61); // Wsymb2 18 (light rain) appears twice -> WMO 61

    const d2 = result.days[1];
    assertEquals(d2.date, "2026-04-28");
    assertEquals(d2.weatherCode, 0); // Wsymb2 1 (clear) -> WMO 0
  } finally {
    restoreFetch();
  }
});

Deno.test("SmhiProvider getForecast caps the number of days returned", async () => {
  const entries: FixtureEntry[] = [];
  for (let day = 0; day < 5; day++) {
    const date = `2026-04-${String(27 + day).padStart(2, "0")}`;
    entries.push({ time: `${date}T12:00:00Z`, temperature: 10, symbolCode: 1 });
  }
  stubFetch(buildFixture(entries));
  try {
    const p = new SmhiProvider();
    const result = await p.getForecast({ latitude: 59.33, longitude: 18.07 }, 2);
    assertEquals(result.days.length, 2);
  } finally {
    restoreFetch();
  }
});

Deno.test("SmhiProvider throws on non-200 response", async () => {
  globalThis.fetch = (() =>
    Promise.resolve(new Response("Not Found", { status: 404 }))) as typeof fetch;
  try {
    const p = new SmhiProvider();
    let err: Error | null = null;
    try {
      await p.getCurrentConditions({ latitude: 59.33, longitude: 18.07 });
    } catch (e) {
      err = e as Error;
    }
    assertExists(err);
    assertEquals(err!.message.includes("404"), true);
  } finally {
    restoreFetch();
  }
});

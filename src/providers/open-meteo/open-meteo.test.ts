import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { OpenMeteoProvider } from "./index.ts";

const originalFetch = globalThis.fetch;

function stubFetch(handler: (url: URL) => unknown): URL[] {
  const captured: URL[] = [];
  globalThis.fetch = ((input: string | URL | Request): Promise<Response> => {
    const url = input instanceof URL
      ? input
      : new URL(typeof input === "string" ? input : input.url);
    captured.push(url);
    const body = handler(url);
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

Deno.test("getForecast hits api.open-meteo.com with the expected params and parses the response", async () => {
  const captured = stubFetch(() => ({
    timezone: "GMT",
    daily: {
      time: ["2026-04-25", "2026-04-26"],
      weather_code: [3, 61],
      temperature_2m_max: [12, 11],
      temperature_2m_min: [4, 5],
      apparent_temperature_max: [10, 9],
      apparent_temperature_min: [2, 3],
      sunrise: ["2026-04-25T05:30", "2026-04-26T05:28"],
      sunset: ["2026-04-25T20:15", "2026-04-26T20:17"],
      daylight_duration: [52800, 53000],
      sunshine_duration: [30000, 25000],
      uv_index_max: [4.5, 3.8],
      precipitation_sum: [0, 5.2],
      snowfall_sum: [0, 0],
      precipitation_probability_max: [10, 80],
      wind_speed_10m_max: [5.4, 7.1],
      wind_gusts_10m_max: [12.3, 15.5],
      wind_direction_10m_dominant: [180, 200],
      shortwave_radiation_sum: [18.5, 12.3],
    },
  }));

  try {
    const provider = new OpenMeteoProvider();
    const result = await provider.getForecast({ latitude: 59.33, longitude: 18.07 }, 2);

    assertEquals(captured.length, 1);
    const url = captured[0];
    assertEquals(url.host, "api.open-meteo.com");
    assertEquals(url.pathname, "/v1/forecast");
    assertEquals(url.searchParams.get("latitude"), "59.33");
    assertEquals(url.searchParams.get("longitude"), "18.07");
    assertEquals(url.searchParams.get("forecast_days"), "2");
    assertEquals(url.searchParams.get("wind_speed_unit"), "ms");
    assertEquals(url.searchParams.get("timezone"), "GMT");
    assertExists(url.searchParams.get("daily"));

    assertEquals(result.contributingProviders, ["open-meteo"]);
    assertEquals(result.failedProviders, []);
    assertEquals(result.timezone, "GMT");
    assertEquals(result.days.length, 2);
    assertEquals(result.days[0].date, "2026-04-25");
    assertEquals(result.days[0].temperatureMaxC, 12);
    assertEquals(result.days[0].weatherCode, 3);
    assertEquals(result.days[0].weatherLabel, "Overcast");
    assertEquals(result.days[1].weatherLabel, "Slight rain");
    assertEquals(result.days[0].shortwaveRadiationSumMjPerM2, 18.5);
    assertEquals(result.days[0].uvIndexMax, 4.5);
    assertEquals(result.days[0].windGustsMaxMs, 12.3);
  } finally {
    restoreFetch();
  }
});

Deno.test("getHourlyForecast uses forecast_hours and parses hourly entries", async () => {
  const captured = stubFetch(() => ({
    timezone: "GMT",
    hourly: {
      time: ["2026-04-25T11:00", "2026-04-25T12:00"],
      temperature_2m: [10.5, 10.6],
      apparent_temperature: [9.0, 9.1],
      relative_humidity_2m: [70, 68],
      dew_point_2m: [5.0, 4.8],
      precipitation_probability: [10, 20],
      precipitation: [0, 0.1],
      snowfall: [0, 0],
      weather_code: [3, 51],
      cloud_cover: [80, 90],
      visibility: [20000, 18000],
      uv_index: [1.6, 4.45],
      shortwave_radiation: [352, 314],
      wind_speed_10m: [3.2, 3.5],
      wind_gusts_10m: [6.8, 7.0],
      wind_direction_10m: [220, 225],
      is_day: [1, 1],
    },
  }));

  try {
    const provider = new OpenMeteoProvider();
    const result = await provider.getHourlyForecast({ latitude: 59.33, longitude: 18.07 }, 2);

    const url = captured[0];
    assertEquals(url.searchParams.get("forecast_hours"), "2");
    assertEquals(url.searchParams.get("timezone"), "GMT");
    assertExists(url.searchParams.get("hourly"));

    assertEquals(result.contributingProviders, ["open-meteo"]);
    assertEquals(result.hours.length, 2);
    assertEquals(result.hours[0].time, "2026-04-25T11:00");
    assertEquals(result.hours[0].temperatureC, 10.5);
    assertEquals(result.hours[0].uvIndex, 1.6);
    assertEquals(result.hours[0].shortwaveRadiationWm2, 352);
    assertEquals(result.hours[0].isDay, true);
    assertEquals(result.hours[1].weatherLabel, "Light drizzle");
  } finally {
    restoreFetch();
  }
});

Deno.test("getHourlyForecast normalizes is_day=0 to false", async () => {
  stubFetch(() => ({
    timezone: "GMT",
    hourly: {
      time: ["2026-04-25T03:00"],
      temperature_2m: [5],
      apparent_temperature: [4],
      relative_humidity_2m: [80],
      dew_point_2m: [2],
      precipitation_probability: [0],
      precipitation: [0],
      snowfall: [0],
      weather_code: [0],
      cloud_cover: [10],
      visibility: [30000],
      uv_index: [0],
      shortwave_radiation: [0],
      wind_speed_10m: [1.5],
      wind_gusts_10m: [3],
      wind_direction_10m: [180],
      is_day: [0],
    },
  }));

  try {
    const provider = new OpenMeteoProvider();
    const result = await provider.getHourlyForecast({ latitude: 59.33, longitude: 18.07 }, 1);
    assertEquals(result.hours[0].isDay, false);
    assertEquals(result.hours[0].weatherLabel, "Clear sky");
  } finally {
    restoreFetch();
  }
});

Deno.test("getCurrentConditions parses current weather and normalizes is_day to boolean", async () => {
  const captured = stubFetch(() => ({
    timezone: "GMT",
    current: {
      time: "2026-04-25T11:00",
      temperature_2m: 10.5,
      apparent_temperature: 9.0,
      is_day: 1,
      relative_humidity_2m: 70,
      precipitation: 0,
      cloud_cover: 80,
      pressure_msl: 1015.2,
      wind_speed_10m: 3.2,
      wind_gusts_10m: 6.8,
      wind_direction_10m: 220,
      weather_code: 3,
    },
  }));

  try {
    const provider = new OpenMeteoProvider();
    const result = await provider.getCurrentConditions({ latitude: 59.33, longitude: 18.07 });

    const url = captured[0];
    assertExists(url.searchParams.get("current"));

    assertEquals(result.contributingProviders, ["open-meteo"]);
    assertEquals(result.observedAt, "2026-04-25T11:00");
    assertEquals(result.isDay, true);
    assertEquals(result.temperatureC, 10.5);
    assertEquals(result.weatherCode, 3);
    assertEquals(result.weatherLabel, "Overcast");
    assertEquals(result.pressureMslHpa, 1015.2);
  } finally {
    restoreFetch();
  }
});

Deno.test("findLocation hits the geocoding host and normalizes results", async () => {
  const captured = stubFetch(() => ({
    results: [
      {
        name: "Stockholm",
        latitude: 59.32938,
        longitude: 18.06871,
        elevation: 17,
        timezone: "Europe/Stockholm",
        country: "Sweden",
        country_code: "SE",
        admin1: "Stockholm",
        admin2: "Stockholm Municipality",
        population: 1515017,
      },
    ],
  }));

  try {
    const provider = new OpenMeteoProvider();
    const matches = await provider.findLocation("Stockholm", 5);

    const url = captured[0];
    assertEquals(url.host, "geocoding-api.open-meteo.com");
    assertEquals(url.pathname, "/v1/search");
    assertEquals(url.searchParams.get("name"), "Stockholm");
    assertEquals(url.searchParams.get("count"), "5");

    assertEquals(matches.length, 1);
    assertEquals(matches[0].name, "Stockholm");
    assertEquals(matches[0].countryCode, "SE");
    assertEquals(matches[0].latitude, 59.32938);
    assertEquals(matches[0].admin2, "Stockholm Municipality");
    assertEquals(matches[0].population, 1515017);
  } finally {
    restoreFetch();
  }
});

Deno.test("findLocation returns [] when geocoding has no results", async () => {
  stubFetch(() => ({}));

  try {
    const provider = new OpenMeteoProvider();
    const matches = await provider.findLocation("zzznotaplaceqqq", 5);
    assertEquals(matches, []);
  } finally {
    restoreFetch();
  }
});

Deno.test("OpenMeteoProvider declares baseline tier and global coverage", () => {
  const provider = new OpenMeteoProvider();
  assertEquals(provider.tier, "baseline");
  assertEquals(provider.coverage({ latitude: 0, longitude: 0 }), true);
  assertEquals(provider.coverage({ latitude: 89, longitude: 179 }), true);
});

Deno.test("provider throws on non-200 response", async () => {
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response("rate limit hit", { status: 429, statusText: "Too Many Requests" }),
    )) as typeof fetch;

  try {
    const provider = new OpenMeteoProvider();
    await assertRejects(
      () => provider.getForecast({ latitude: 0, longitude: 0 }, 1),
      Error,
      "429",
    );
  } finally {
    restoreFetch();
  }
});

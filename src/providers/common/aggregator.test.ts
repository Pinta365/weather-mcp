import { assertAlmostEquals, assertEquals, assertRejects } from "@std/assert";
import { selectProviders, WeatherAggregator } from "./aggregator.ts";
import { boundingBox, everywhere } from "./coverage.ts";
import type {
  Coordinates,
  CurrentConditions,
  DailyForecastEntry,
  Forecast,
  HourlyForecast,
  HourlyForecastEntry,
  ProviderTier,
  WeatherProvider,
} from "../../types.ts";

function nullDaily(date: string): DailyForecastEntry {
  return {
    date,
    temperatureMaxC: null,
    temperatureMinC: null,
    apparentTemperatureMaxC: null,
    apparentTemperatureMinC: null,
    precipitationSumMm: null,
    precipitationProbabilityMaxPct: null,
    snowfallSumCm: null,
    sunshineDurationSeconds: null,
    daylightDurationSeconds: null,
    sunrise: null,
    sunset: null,
    uvIndexMax: null,
    windSpeedMaxMs: null,
    windGustsMaxMs: null,
    windDirectionDominantDeg: null,
    shortwaveRadiationSumMjPerM2: null,
    weatherCode: null,
    weatherLabel: null,
  };
}

function nullHourly(time: string): HourlyForecastEntry {
  return {
    time,
    temperatureC: null,
    apparentTemperatureC: null,
    relativeHumidityPct: null,
    dewPointC: null,
    precipitationProbabilityPct: null,
    precipitationMm: null,
    snowfallCm: null,
    cloudCoverPct: null,
    visibilityM: null,
    uvIndex: null,
    shortwaveRadiationWm2: null,
    windSpeedMs: null,
    windGustsMs: null,
    windDirectionDeg: null,
    isDay: null,
    weatherCode: null,
    weatherLabel: null,
  };
}

function nullCurrent(): CurrentConditions {
  return {
    contributingProviders: [],
    failedProviders: [],
    location: { latitude: 0, longitude: 0 },
    timezone: "GMT",
    observedAt: "now",
    isDay: null,
    temperatureC: null,
    apparentTemperatureC: null,
    windSpeedMs: null,
    windGustsMs: null,
    windDirectionDeg: null,
    relativeHumidityPct: null,
    precipitationMm: null,
    cloudCoverPct: null,
    pressureMslHpa: null,
    weatherCode: null,
    weatherLabel: null,
  };
}

interface ProviderConfig {
  name: string;
  tier?: ProviderTier;
  priority?: number;
  weight?: number;
  coverage?: (c: Coordinates) => boolean;
  forecast?: Partial<DailyForecastEntry>;
  hourly?: Partial<HourlyForecastEntry>;
  current?: Partial<CurrentConditions>;
  fail?: boolean;
}

class FakeProvider implements WeatherProvider {
  readonly name: string;
  readonly tier: ProviderTier;
  readonly priority: number;
  readonly weight: number;
  readonly coverage: (c: Coordinates) => boolean;
  readonly #cfg: ProviderConfig;

  constructor(cfg: ProviderConfig) {
    this.name = cfg.name;
    this.tier = cfg.tier ?? "regional";
    this.priority = cfg.priority ?? 1;
    this.weight = cfg.weight ?? 1;
    this.coverage = cfg.coverage ?? everywhere;
    this.#cfg = cfg;
  }

  getForecast(coords: Coordinates, _days: number): Promise<Forecast> {
    if (this.#cfg.fail) return Promise.reject(new Error(`${this.name} broke`));
    return Promise.resolve({
      contributingProviders: [this.name],
      failedProviders: [],
      location: coords,
      timezone: "GMT",
      days: [{ ...nullDaily("2026-04-25"), ...this.#cfg.forecast }],
    });
  }

  getHourlyForecast(coords: Coordinates, _hours: number): Promise<HourlyForecast> {
    if (this.#cfg.fail) return Promise.reject(new Error(`${this.name} broke`));
    return Promise.resolve({
      contributingProviders: [this.name],
      failedProviders: [],
      location: coords,
      timezone: "GMT",
      hours: [{ ...nullHourly("2026-04-25T12:00"), ...this.#cfg.hourly }],
    });
  }

  getCurrentConditions(coords: Coordinates): Promise<CurrentConditions> {
    if (this.#cfg.fail) return Promise.reject(new Error(`${this.name} broke`));
    return Promise.resolve({
      ...nullCurrent(),
      contributingProviders: [this.name],
      location: coords,
      ...this.#cfg.current,
    });
  }
}

Deno.test("selectProviders picks the highest-priority baseline plus all matching regionals", () => {
  const baselineLow = new FakeProvider({ name: "global-low", tier: "baseline", priority: 1 });
  const baselineHigh = new FakeProvider({
    name: "europe-best",
    tier: "baseline",
    priority: 10,
    coverage: boundingBox(35, 71, -10, 40),
  });
  const nordic = new FakeProvider({
    name: "nordic",
    tier: "regional",
    coverage: boundingBox(54, 72, 4, 32),
  });
  const us = new FakeProvider({
    name: "us",
    tier: "regional",
    coverage: boundingBox(24, 49, -125, -66),
  });

  const stockholm = selectProviders([baselineLow, baselineHigh, nordic, us], {
    latitude: 59.33,
    longitude: 18.07,
  });
  assertEquals(stockholm.map((p) => p.name), ["europe-best", "nordic"]);

  const tokyo = selectProviders([baselineLow, baselineHigh, nordic, us], {
    latitude: 35.68,
    longitude: 139.69,
  });
  assertEquals(tokyo.map((p) => p.name), ["global-low"]);

  const nyc = selectProviders([baselineLow, baselineHigh, nordic, us], {
    latitude: 40.71,
    longitude: -74.0,
  });
  assertEquals(nyc.map((p) => p.name), ["global-low", "us"]);
});

Deno.test("WeatherAggregator with a single provider passes through (degenerate case)", async () => {
  const open = new FakeProvider({
    name: "open-meteo",
    tier: "baseline",
    weight: 1,
    forecast: { temperatureMaxC: 12, weatherCode: 3 },
  });
  const agg = new WeatherAggregator([open]);
  const result = await agg.getForecast({ latitude: 59.33, longitude: 18.07 }, 1);

  assertEquals(result.contributingProviders, ["open-meteo"]);
  assertEquals(result.failedProviders, []);
  assertEquals(result.days[0].temperatureMaxC, 12);
  assertEquals(result.days[0].weatherCode, 3);
  assertEquals(result.days[0].weatherLabel, "Overcast");
});

Deno.test("WeatherAggregator computes weighted mean for numeric daily fields", async () => {
  const open = new FakeProvider({
    name: "open-meteo",
    tier: "baseline",
    weight: 1,
    forecast: { temperatureMaxC: 10, precipitationSumMm: 0, weatherCode: 0 },
  });
  const nordic = new FakeProvider({
    name: "nordic",
    tier: "regional",
    weight: 3,
    forecast: { temperatureMaxC: 14, precipitationSumMm: 4, weatherCode: 0 },
  });
  const agg = new WeatherAggregator([open, nordic]);
  const result = await agg.getForecast({ latitude: 59.33, longitude: 18.07 }, 1);

  // (10*1 + 14*3) / (1+3) = 13
  assertEquals(result.days[0].temperatureMaxC, 13);
  // (0*1 + 4*3) / 4 = 3
  assertEquals(result.days[0].precipitationSumMm, 3);
  assertEquals(result.contributingProviders, ["open-meteo", "nordic"]);
});

Deno.test("WeatherAggregator drops null values from weighted mean computation", async () => {
  const a = new FakeProvider({
    name: "a",
    tier: "baseline",
    weight: 2,
    forecast: { uvIndexMax: 5 },
  });
  const b = new FakeProvider({
    name: "b",
    tier: "regional",
    weight: 8,
    forecast: { uvIndexMax: null }, // shouldn't drag the average toward zero
  });
  const agg = new WeatherAggregator([a, b]);
  const result = await agg.getForecast({ latitude: 0, longitude: 0 }, 1);

  // Only `a` contributed UV, so the mean is just its value.
  assertEquals(result.days[0].uvIndexMax, 5);
});

Deno.test("WeatherAggregator picks weather code by weighted mode", async () => {
  const a = new FakeProvider({ name: "a", tier: "baseline", weight: 1, forecast: { weatherCode: 0 } });
  const b = new FakeProvider({ name: "b", tier: "regional", weight: 1, forecast: { weatherCode: 61 } });
  const c = new FakeProvider({ name: "c", tier: "regional", weight: 5, forecast: { weatherCode: 61 } });
  const agg = new WeatherAggregator([a, b, c]);
  const result = await agg.getForecast({ latitude: 0, longitude: 0 }, 1);

  // codes 61 sum to weight 6, code 0 sum to weight 1 -> 61 wins
  assertEquals(result.days[0].weatherCode, 61);
  assertEquals(result.days[0].weatherLabel, "Slight rain");
});

Deno.test("WeatherAggregator averages wind direction circularly (handles 350°/10° -> ~0°)", async () => {
  const a = new FakeProvider({
    name: "a",
    tier: "baseline",
    weight: 1,
    forecast: { windDirectionDominantDeg: 350 },
  });
  const b = new FakeProvider({
    name: "b",
    tier: "regional",
    weight: 1,
    forecast: { windDirectionDominantDeg: 10 },
  });
  const agg = new WeatherAggregator([a, b]);
  const result = await agg.getForecast({ latitude: 0, longitude: 0 }, 1);

  const dir = result.days[0].windDirectionDominantDeg!;
  // Circular mean of 350 and 10 is ~0; allow wrap to either ~0 or ~360.
  const wrapped = dir > 180 ? dir - 360 : dir;
  assertAlmostEquals(wrapped, 0, 0.5);
});

Deno.test("WeatherAggregator records failures and still returns a merged result", async () => {
  const open = new FakeProvider({ name: "open-meteo", tier: "baseline", weight: 1, forecast: { temperatureMaxC: 12 } });
  const broken = new FakeProvider({ name: "broken", tier: "regional", weight: 5, fail: true });
  const agg = new WeatherAggregator([open, broken]);
  const result = await agg.getForecast({ latitude: 0, longitude: 0 }, 1);

  assertEquals(result.contributingProviders, ["open-meteo"]);
  assertEquals(result.failedProviders.length, 1);
  assertEquals(result.failedProviders[0].name, "broken");
  // Numeric value comes only from the successful provider.
  assertEquals(result.days[0].temperatureMaxC, 12);
});

Deno.test("WeatherAggregator throws when every provider fails", async () => {
  const a = new FakeProvider({ name: "a", tier: "baseline", weight: 1, fail: true });
  const b = new FakeProvider({ name: "b", tier: "regional", weight: 1, fail: true });
  const agg = new WeatherAggregator([a, b]);
  await assertRejects(
    () => agg.getForecast({ latitude: 0, longitude: 0 }, 1),
    Error,
    "All providers failed",
  );
});

Deno.test("WeatherAggregator throws when no provider covers the requested coords", async () => {
  const nordic = new FakeProvider({
    name: "nordic",
    tier: "regional",
    coverage: boundingBox(54, 72, 4, 32),
  });
  const agg = new WeatherAggregator([nordic]);
  await assertRejects(
    () => agg.getForecast({ latitude: 35.68, longitude: 139.69 }, 1), // Tokyo
    Error,
    "No providers cover",
  );
});

Deno.test("WeatherAggregator merges hourly entries by time across providers", async () => {
  const a = new FakeProvider({
    name: "a",
    tier: "baseline",
    weight: 1,
    hourly: { temperatureC: 10 },
  });
  const b = new FakeProvider({
    name: "b",
    tier: "regional",
    weight: 1,
    hourly: { temperatureC: 12 },
  });
  const agg = new WeatherAggregator([a, b]);
  const result = await agg.getHourlyForecast({ latitude: 0, longitude: 0 }, 1);

  assertEquals(result.hours.length, 1);
  assertEquals(result.hours[0].temperatureC, 11);
});

Deno.test("WeatherAggregator merges current conditions across providers", async () => {
  const a = new FakeProvider({
    name: "a",
    tier: "baseline",
    weight: 1,
    current: { temperatureC: 10, weatherCode: 0 },
  });
  const b = new FakeProvider({
    name: "b",
    tier: "regional",
    weight: 3,
    current: { temperatureC: 14, weatherCode: 0 },
  });
  const agg = new WeatherAggregator([a, b]);
  const result = await agg.getCurrentConditions({ latitude: 0, longitude: 0 });

  assertEquals(result.temperatureC, 13);
  assertEquals(result.weatherCode, 0);
  assertEquals(result.contributingProviders, ["a", "b"]);
});

Deno.test("WeatherAggregator constructor rejects empty provider list", () => {
  let err: Error | null = null;
  try {
    new WeatherAggregator([]);
  } catch (e) {
    err = e as Error;
  }
  assertEquals(err?.message, "WeatherAggregator requires at least one provider");
});

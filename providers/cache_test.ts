import { assertEquals } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { CachedWeatherProvider, TtlCache } from "./cache.ts";
import type {
  Coordinates,
  CurrentConditions,
  Forecast,
  HourlyForecast,
  LocationMatch,
  LocationProvider,
  WeatherProvider,
} from "./types.ts";

Deno.test("TtlCache.get returns undefined for missing keys", () => {
  const cache = new TtlCache<string>();
  assertEquals(cache.get("missing"), undefined);
});

Deno.test("TtlCache.set then get returns the stored value", () => {
  const cache = new TtlCache<string>();
  cache.set("k", "v", 60_000);
  assertEquals(cache.get("k"), "v");
});

Deno.test("TtlCache evicts entries past their TTL", () => {
  using time = new FakeTime();
  const cache = new TtlCache<string>();
  cache.set("k", "v", 1_000);
  assertEquals(cache.get("k"), "v");
  time.tick(1_500);
  assertEquals(cache.get("k"), undefined);
});

class StubProvider implements WeatherProvider, LocationProvider {
  readonly name = "stub";
  readonly weight = 1;
  forecastCalls = 0;
  hourlyCalls = 0;
  currentCalls = 0;
  locationCalls = 0;

  getForecast(coords: Coordinates, _days: number): Promise<Forecast> {
    this.forecastCalls++;
    return Promise.resolve({
      provider: this.name,
      location: coords,
      timezone: "UTC",
      days: [],
    });
  }

  getHourlyForecast(coords: Coordinates, _hours: number): Promise<HourlyForecast> {
    this.hourlyCalls++;
    return Promise.resolve({
      provider: this.name,
      location: coords,
      timezone: "UTC",
      hours: [],
    });
  }

  getCurrentConditions(coords: Coordinates): Promise<CurrentConditions> {
    this.currentCalls++;
    return Promise.resolve({
      provider: this.name,
      location: coords,
      timezone: "UTC",
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
    });
  }

  findLocation(_query: string, _count: number): Promise<LocationMatch[]> {
    this.locationCalls++;
    return Promise.resolve([]);
  }
}

Deno.test("CachedWeatherProvider deduplicates identical forecast requests", async () => {
  const inner = new StubProvider();
  const cached = new CachedWeatherProvider(inner);

  await cached.getForecast({ latitude: 59.33, longitude: 18.07 }, 3);
  await cached.getForecast({ latitude: 59.33, longitude: 18.07 }, 3);

  assertEquals(inner.forecastCalls, 1);
});

Deno.test("CachedWeatherProvider quantizes coordinates for cache keys", async () => {
  const inner = new StubProvider();
  const cached = new CachedWeatherProvider(inner);

  // Both round to (59.33, 18.07) at 2 decimal places
  await cached.getForecast({ latitude: 59.331, longitude: 18.072 }, 3);
  await cached.getForecast({ latitude: 59.334, longitude: 18.069 }, 3);

  assertEquals(inner.forecastCalls, 1);
});

Deno.test("CachedWeatherProvider keys forecast cache by days", async () => {
  const inner = new StubProvider();
  const cached = new CachedWeatherProvider(inner);

  await cached.getForecast({ latitude: 59.33, longitude: 18.07 }, 3);
  await cached.getForecast({ latitude: 59.33, longitude: 18.07 }, 7);

  assertEquals(inner.forecastCalls, 2);
});

Deno.test("CachedWeatherProvider keys hourly cache by hours", async () => {
  const inner = new StubProvider();
  const cached = new CachedWeatherProvider(inner);

  await cached.getHourlyForecast({ latitude: 59.33, longitude: 18.07 }, 24);
  await cached.getHourlyForecast({ latitude: 59.33, longitude: 18.07 }, 48);

  assertEquals(inner.hourlyCalls, 2);
});

Deno.test("CachedWeatherProvider deduplicates current-conditions requests", async () => {
  const inner = new StubProvider();
  const cached = new CachedWeatherProvider(inner);

  await cached.getCurrentConditions({ latitude: 59.33, longitude: 18.07 });
  await cached.getCurrentConditions({ latitude: 59.33, longitude: 18.07 });

  assertEquals(inner.currentCalls, 1);
});

Deno.test("CachedWeatherProvider normalizes location queries case-insensitively and trims whitespace", async () => {
  const inner = new StubProvider();
  const cached = new CachedWeatherProvider(inner);

  await cached.findLocation("Stockholm", 5);
  await cached.findLocation("stockholm", 5);
  await cached.findLocation("  STOCKHOLM  ", 5);

  assertEquals(inner.locationCalls, 1);
});

Deno.test("CachedWeatherProvider expires forecast entries after TTL", async () => {
  using time = new FakeTime();
  const inner = new StubProvider();
  const cached = new CachedWeatherProvider(inner);

  await cached.getForecast({ latitude: 0, longitude: 0 }, 1);
  // Forecast TTL is 1 hour
  time.tick(60 * 60 * 1000 + 1);
  await cached.getForecast({ latitude: 0, longitude: 0 }, 1);

  assertEquals(inner.forecastCalls, 2);
});

Deno.test("CachedWeatherProvider exposes inner provider's name and weight", () => {
  const inner = new StubProvider();
  const cached = new CachedWeatherProvider(inner);

  assertEquals(cached.name, "stub");
  assertEquals(cached.weight, 1);
});

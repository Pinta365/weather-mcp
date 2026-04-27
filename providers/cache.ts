import type {
  Coordinates,
  CurrentConditions,
  Forecast,
  HourlyForecast,
  LocationMatch,
  LocationProvider,
  ProviderTier,
  WeatherProvider,
} from "./types.ts";

const CURRENT_TTL_MS = 10 * 60 * 1000;
const FORECAST_TTL_MS = 60 * 60 * 1000;
const HOURLY_TTL_MS = 30 * 60 * 1000;
const LOCATION_TTL_MS = 24 * 60 * 60 * 1000;

const COORD_PRECISION = 2;

interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

export class TtlCache<V> {
  readonly #entries = new Map<string, CacheEntry<V>>();

  get(key: string): V | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    this.#entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}

function roundCoord(n: number): number {
  const factor = 10 ** COORD_PRECISION;
  return Math.round(n * factor) / factor;
}

function coordKey(c: Coordinates): string {
  return `${roundCoord(c.latitude)},${roundCoord(c.longitude)}`;
}

export class CachedWeatherProvider implements WeatherProvider {
  readonly #inner: WeatherProvider;
  readonly #current = new TtlCache<CurrentConditions>();
  readonly #forecast = new TtlCache<Forecast>();
  readonly #hourly = new TtlCache<HourlyForecast>();

  constructor(inner: WeatherProvider) {
    this.#inner = inner;
  }

  get name(): string {
    return this.#inner.name;
  }

  get weight(): number {
    return this.#inner.weight;
  }

  get tier(): ProviderTier {
    return this.#inner.tier;
  }

  get priority(): number {
    return this.#inner.priority;
  }

  coverage(coords: Coordinates): boolean {
    return this.#inner.coverage(coords);
  }

  async getForecast(coords: Coordinates, days: number): Promise<Forecast> {
    const key = `${coordKey(coords)}|${days}`;
    const hit = this.#forecast.get(key);
    if (hit) return hit;
    const value = await this.#inner.getForecast(coords, days);
    this.#forecast.set(key, value, FORECAST_TTL_MS);
    return value;
  }

  async getHourlyForecast(coords: Coordinates, hours: number): Promise<HourlyForecast> {
    const key = `${coordKey(coords)}|${hours}`;
    const hit = this.#hourly.get(key);
    if (hit) return hit;
    const value = await this.#inner.getHourlyForecast(coords, hours);
    this.#hourly.set(key, value, HOURLY_TTL_MS);
    return value;
  }

  async getCurrentConditions(coords: Coordinates): Promise<CurrentConditions> {
    const key = coordKey(coords);
    const hit = this.#current.get(key);
    if (hit) return hit;
    const value = await this.#inner.getCurrentConditions(coords);
    this.#current.set(key, value, CURRENT_TTL_MS);
    return value;
  }
}

export class CachedLocationProvider implements LocationProvider {
  readonly #inner: LocationProvider;
  readonly #cache = new TtlCache<LocationMatch[]>();

  constructor(inner: LocationProvider) {
    this.#inner = inner;
  }

  get name(): string {
    return this.#inner.name;
  }

  async findLocation(query: string, count: number): Promise<LocationMatch[]> {
    const key = `${query.trim().toLowerCase()}|${count}`;
    const hit = this.#cache.get(key);
    if (hit) return hit;
    const value = await this.#inner.findLocation(query, count);
    this.#cache.set(key, value, LOCATION_TTL_MS);
    return value;
  }
}

import { describeWeatherCode } from "./wmo.ts";
import type {
  Coordinates,
  CurrentConditions,
  DailyForecastEntry,
  Forecast,
  HourlyForecast,
  HourlyForecastEntry,
  ProviderFailure,
  WeatherProvider,
} from "./types.ts";

export function selectProviders(
  providers: readonly WeatherProvider[],
  coords: Coordinates,
): WeatherProvider[] {
  const baseline = providers
    .filter((p) => p.tier === "baseline" && p.coverage(coords))
    .sort((a, b) => b.priority - a.priority)[0];
  const regionals = providers.filter(
    (p) => p.tier === "regional" && p.coverage(coords),
  );
  return baseline ? [baseline, ...regionals] : regionals;
}

interface Success<V> {
  value: V;
  weight: number;
  name: string;
}

type Part<E> = { entry: E; weight: number };

export class WeatherAggregator {
  readonly #providers: readonly WeatherProvider[];

  constructor(providers: readonly WeatherProvider[]) {
    if (providers.length === 0) {
      throw new Error("WeatherAggregator requires at least one provider");
    }
    this.#providers = providers;
  }

  async getForecast(coords: Coordinates, days: number): Promise<Forecast> {
    const { successes, failures } = await this.#runAll(
      coords,
      (p) => p.getForecast(coords, days),
    );
    const merged = mergeDays(successes);
    return {
      contributingProviders: successes.map((s) => s.name),
      failedProviders: failures,
      location: coords,
      timezone: pickTimezone(successes),
      days: merged,
    };
  }

  async getHourlyForecast(coords: Coordinates, hours: number): Promise<HourlyForecast> {
    const { successes, failures } = await this.#runAll(
      coords,
      (p) => p.getHourlyForecast(coords, hours),
    );
    const merged = mergeHours(successes);
    return {
      contributingProviders: successes.map((s) => s.name),
      failedProviders: failures,
      location: coords,
      timezone: pickTimezone(successes),
      hours: merged,
    };
  }

  async getCurrentConditions(coords: Coordinates): Promise<CurrentConditions> {
    const { successes, failures } = await this.#runAll(
      coords,
      (p) => p.getCurrentConditions(coords),
    );
    const parts: Part<CurrentConditions>[] = successes.map((s) => ({
      entry: s.value,
      weight: s.weight,
    }));
    const code = weightedMode(parts, (e) => e.weatherCode);
    return {
      contributingProviders: successes.map((s) => s.name),
      failedProviders: failures,
      location: coords,
      timezone: pickTimezone(successes),
      observedAt: firstNonNullStr(parts, (e) => e.observedAt) ?? "",
      isDay: firstNonNullBool(parts, (e) => e.isDay),
      temperatureC: weightedMean(parts, (e) => e.temperatureC),
      apparentTemperatureC: weightedMean(parts, (e) => e.apparentTemperatureC),
      windSpeedMs: weightedMean(parts, (e) => e.windSpeedMs),
      windGustsMs: weightedMean(parts, (e) => e.windGustsMs),
      windDirectionDeg: circularMean(parts, (e) => e.windDirectionDeg),
      relativeHumidityPct: weightedMean(parts, (e) => e.relativeHumidityPct),
      precipitationMm: weightedMean(parts, (e) => e.precipitationMm),
      cloudCoverPct: weightedMean(parts, (e) => e.cloudCoverPct),
      pressureMslHpa: weightedMean(parts, (e) => e.pressureMslHpa),
      weatherCode: code,
      weatherLabel: describeWeatherCode(code),
    };
  }

  async #runAll<V>(
    coords: Coordinates,
    call: (p: WeatherProvider) => Promise<V>,
  ): Promise<{ successes: Success<V>[]; failures: ProviderFailure[] }> {
    const selected = selectProviders(this.#providers, coords);
    if (selected.length === 0) {
      throw new Error(
        `No providers cover coordinates ${coords.latitude}, ${coords.longitude}`,
      );
    }
    const settled = await Promise.allSettled(selected.map((p) => call(p)));
    const successes: Success<V>[] = [];
    const failures: ProviderFailure[] = [];
    for (let i = 0; i < settled.length; i++) {
      const r = settled[i];
      const p = selected[i];
      if (r.status === "fulfilled") {
        successes.push({ value: r.value, weight: p.weight, name: p.name });
      } else {
        failures.push({ name: p.name, error: errorMessage(r.reason) });
      }
    }
    if (successes.length === 0) {
      throw new Error(
        `All providers failed: ${failures.map((f) => `${f.name}: ${f.error}`).join("; ")}`,
      );
    }
    return { successes, failures };
  }
}

function pickTimezone<V extends { timezone: string }>(successes: Success<V>[]): string {
  return successes[0]?.value.timezone ?? "GMT";
}

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return String(reason);
}

function mergeDays(successes: Success<Forecast>[]): DailyForecastEntry[] {
  const byDate = new Map<string, Part<DailyForecastEntry>[]>();
  for (const s of successes) {
    for (const day of s.value.days) {
      const arr = byDate.get(day.date) ?? [];
      arr.push({ entry: day, weight: s.weight });
      byDate.set(day.date, arr);
    }
  }
  return [...byDate.keys()]
    .sort()
    .map((date) => mergeDailyEntry(date, byDate.get(date)!));
}

function mergeDailyEntry(date: string, parts: Part<DailyForecastEntry>[]): DailyForecastEntry {
  const code = weightedMode(parts, (e) => e.weatherCode);
  return {
    date,
    temperatureMaxC: weightedMean(parts, (e) => e.temperatureMaxC),
    temperatureMinC: weightedMean(parts, (e) => e.temperatureMinC),
    apparentTemperatureMaxC: weightedMean(parts, (e) => e.apparentTemperatureMaxC),
    apparentTemperatureMinC: weightedMean(parts, (e) => e.apparentTemperatureMinC),
    precipitationSumMm: weightedMean(parts, (e) => e.precipitationSumMm),
    precipitationProbabilityMaxPct: weightedMean(parts, (e) => e.precipitationProbabilityMaxPct),
    snowfallSumCm: weightedMean(parts, (e) => e.snowfallSumCm),
    sunshineDurationSeconds: weightedMean(parts, (e) => e.sunshineDurationSeconds),
    daylightDurationSeconds: weightedMean(parts, (e) => e.daylightDurationSeconds),
    sunrise: firstNonNullStr(parts, (e) => e.sunrise),
    sunset: firstNonNullStr(parts, (e) => e.sunset),
    uvIndexMax: weightedMean(parts, (e) => e.uvIndexMax),
    windSpeedMaxMs: weightedMean(parts, (e) => e.windSpeedMaxMs),
    windGustsMaxMs: weightedMean(parts, (e) => e.windGustsMaxMs),
    windDirectionDominantDeg: circularMean(parts, (e) => e.windDirectionDominantDeg),
    shortwaveRadiationSumMjPerM2: weightedMean(parts, (e) => e.shortwaveRadiationSumMjPerM2),
    weatherCode: code,
    weatherLabel: describeWeatherCode(code),
  };
}

function mergeHours(successes: Success<HourlyForecast>[]): HourlyForecastEntry[] {
  const byTime = new Map<string, Part<HourlyForecastEntry>[]>();
  for (const s of successes) {
    for (const hour of s.value.hours) {
      const arr = byTime.get(hour.time) ?? [];
      arr.push({ entry: hour, weight: s.weight });
      byTime.set(hour.time, arr);
    }
  }
  return [...byTime.keys()]
    .sort()
    .map((time) => mergeHourlyEntry(time, byTime.get(time)!));
}

function mergeHourlyEntry(time: string, parts: Part<HourlyForecastEntry>[]): HourlyForecastEntry {
  const code = weightedMode(parts, (e) => e.weatherCode);
  return {
    time,
    temperatureC: weightedMean(parts, (e) => e.temperatureC),
    apparentTemperatureC: weightedMean(parts, (e) => e.apparentTemperatureC),
    relativeHumidityPct: weightedMean(parts, (e) => e.relativeHumidityPct),
    dewPointC: weightedMean(parts, (e) => e.dewPointC),
    precipitationProbabilityPct: weightedMean(parts, (e) => e.precipitationProbabilityPct),
    precipitationMm: weightedMean(parts, (e) => e.precipitationMm),
    snowfallCm: weightedMean(parts, (e) => e.snowfallCm),
    cloudCoverPct: weightedMean(parts, (e) => e.cloudCoverPct),
    visibilityM: weightedMean(parts, (e) => e.visibilityM),
    uvIndex: weightedMean(parts, (e) => e.uvIndex),
    shortwaveRadiationWm2: weightedMean(parts, (e) => e.shortwaveRadiationWm2),
    windSpeedMs: weightedMean(parts, (e) => e.windSpeedMs),
    windGustsMs: weightedMean(parts, (e) => e.windGustsMs),
    windDirectionDeg: circularMean(parts, (e) => e.windDirectionDeg),
    isDay: firstNonNullBool(parts, (e) => e.isDay),
    weatherCode: code,
    weatherLabel: describeWeatherCode(code),
  };
}

function weightedMean<E>(parts: Part<E>[], pick: (e: E) => number | null): number | null {
  let sum = 0;
  let totalWeight = 0;
  for (const { entry, weight } of parts) {
    const v = pick(entry);
    if (v === null) continue;
    sum += v * weight;
    totalWeight += weight;
  }
  return totalWeight === 0 ? null : sum / totalWeight;
}

function weightedMode<E>(parts: Part<E>[], pick: (e: E) => number | null): number | null {
  const tally = new Map<number, number>();
  for (const { entry, weight } of parts) {
    const v = pick(entry);
    if (v === null) continue;
    tally.set(v, (tally.get(v) ?? 0) + weight);
  }
  if (tally.size === 0) return null;
  let bestCode: number | null = null;
  let bestWeight = -1;
  for (const [code, w] of tally) {
    if (w > bestWeight) {
      bestWeight = w;
      bestCode = code;
    }
  }
  return bestCode;
}

function circularMean<E>(parts: Part<E>[], pick: (e: E) => number | null): number | null {
  let sumSin = 0;
  let sumCos = 0;
  let totalWeight = 0;
  for (const { entry, weight } of parts) {
    const v = pick(entry);
    if (v === null) continue;
    const rad = (v * Math.PI) / 180;
    sumSin += Math.sin(rad) * weight;
    sumCos += Math.cos(rad) * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return null;
  const meanRad = Math.atan2(sumSin / totalWeight, sumCos / totalWeight);
  let deg = (meanRad * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

function firstNonNullStr<E>(parts: Part<E>[], pick: (e: E) => string | null): string | null {
  for (const { entry } of parts) {
    const v = pick(entry);
    if (v !== null) return v;
  }
  return null;
}

function firstNonNullBool<E>(parts: Part<E>[], pick: (e: E) => boolean | null): boolean | null {
  for (const { entry } of parts) {
    const v = pick(entry);
    if (v !== null) return v;
  }
  return null;
}

import { describeWeatherCode } from "./wmo.ts";
import { type CoverageFn, boundingBox, everywhere } from "./coverage.ts";
import type {
  Coordinates,
  CurrentConditions,
  DailyForecastEntry,
  Forecast,
  HourlyForecast,
  HourlyForecastEntry,
  ProviderTier,
  WeatherProvider,
} from "./types.ts";

const ENDPOINT_BASE =
  "https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/geotype/point";

const NORDIC_BBOX: CoverageFn = boundingBox(54, 71.5, 4, 32);

interface SmhiTimeseriesEntry {
  time: string;
  data: {
    air_temperature?: number;
    wind_from_direction?: number;
    wind_speed?: number;
    wind_speed_of_gust?: number;
    relative_humidity?: number;
    air_pressure_at_mean_sea_level?: number;
    visibility_in_air?: number; // km
    cloud_area_fraction?: number; // octas (0-8)
    precipitation_amount_mean?: number;
    probability_of_precipitation?: number;
    symbol_code?: number;
  };
}

interface SmhiResponse {
  timeSeries: SmhiTimeseriesEntry[];
}

export class SmhiProvider implements WeatherProvider {
  readonly name = "smhi";
  readonly tier: ProviderTier;
  readonly weight: number;
  readonly priority: number;
  readonly coverage: CoverageFn;

  constructor(opts: { weight?: number; priority?: number; nordicOnly?: boolean } = {}) {
    this.weight = opts.weight ?? 1;
    this.priority = opts.priority ?? 1;
    if (opts.nordicOnly === false) {
      this.tier = "baseline";
      this.coverage = everywhere;
    } else {
      this.tier = "regional";
      this.coverage = NORDIC_BBOX;
    }
  }

  async getForecast(coords: Coordinates, days: number): Promise<Forecast> {
    const data = await fetchSmhi(coords);
    const hours = data.timeSeries.map(toHourlyEntry);
    return {
      contributingProviders: [this.name],
      failedProviders: [],
      location: coords,
      timezone: "GMT",
      days: aggregateDaily(hours, days),
    };
  }

  async getHourlyForecast(coords: Coordinates, hours: number): Promise<HourlyForecast> {
    const data = await fetchSmhi(coords);
    const allEntries = data.timeSeries.map(toHourlyEntry);
    return {
      contributingProviders: [this.name],
      failedProviders: [],
      location: coords,
      timezone: "GMT",
      hours: allEntries.slice(0, hours),
    };
  }

  async getCurrentConditions(coords: Coordinates): Promise<CurrentConditions> {
    const data = await fetchSmhi(coords);
    const first = data.timeSeries[0];
    if (!first) throw new Error("SMHI returned an empty timeSeries");
    const d = first.data;
    const code = symbolCodeToWmo(d.symbol_code ?? null);
    return {
      contributingProviders: [this.name],
      failedProviders: [],
      location: coords,
      timezone: "GMT",
      observedAt: normalizeTime(first.time),
      isDay: null,
      temperatureC: d.air_temperature ?? null,
      apparentTemperatureC: null,
      windSpeedMs: d.wind_speed ?? null,
      windGustsMs: d.wind_speed_of_gust ?? null,
      windDirectionDeg: d.wind_from_direction ?? null,
      relativeHumidityPct: d.relative_humidity ?? null,
      precipitationMm: d.precipitation_amount_mean ?? null,
      cloudCoverPct: octasToPercent(d.cloud_area_fraction),
      pressureMslHpa: d.air_pressure_at_mean_sea_level ?? null,
      weatherCode: code,
      weatherLabel: describeWeatherCode(code),
    };
  }
}

async function fetchSmhi(coords: Coordinates): Promise<SmhiResponse> {
  // SMHI's path-style coordinates require the canonical decimal form (no scientific notation).
  const lat = coords.latitude.toFixed(6);
  const lon = coords.longitude.toFixed(6);
  const url = `${ENDPOINT_BASE}/lon/${lon}/lat/${lat}/data.json`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `SMHI request failed: ${res.status} ${res.statusText} - ${body.slice(0, 200)}`,
    );
  }
  return await res.json() as SmhiResponse;
}

function toHourlyEntry(e: SmhiTimeseriesEntry): HourlyForecastEntry {
  const d = e.data;
  const code = symbolCodeToWmo(d.symbol_code ?? null);
  return {
    time: normalizeTime(e.time),
    temperatureC: d.air_temperature ?? null,
    apparentTemperatureC: null,
    relativeHumidityPct: d.relative_humidity ?? null,
    dewPointC: null,
    precipitationProbabilityPct: d.probability_of_precipitation ?? null,
    precipitationMm: d.precipitation_amount_mean ?? null,
    snowfallCm: null,
    cloudCoverPct: octasToPercent(d.cloud_area_fraction),
    visibilityM: typeof d.visibility_in_air === "number" ? d.visibility_in_air * 1000 : null,
    uvIndex: null,
    shortwaveRadiationWm2: null,
    windSpeedMs: d.wind_speed ?? null,
    windGustsMs: d.wind_speed_of_gust ?? null,
    windDirectionDeg: d.wind_from_direction ?? null,
    isDay: null,
    weatherCode: code,
    weatherLabel: describeWeatherCode(code),
  };
}

function aggregateDaily(hours: HourlyForecastEntry[], maxDays: number): DailyForecastEntry[] {
  const byDate = new Map<string, HourlyForecastEntry[]>();
  for (const h of hours) {
    const date = h.time.slice(0, 10);
    const arr = byDate.get(date) ?? [];
    arr.push(h);
    byDate.set(date, arr);
  }
  return [...byDate.keys()]
    .sort()
    .slice(0, maxDays)
    .map((date) => aggregateOneDay(date, byDate.get(date)!));
}

function aggregateOneDay(date: string, hours: HourlyForecastEntry[]): DailyForecastEntry {
  const code = modeWeatherCode(hours);
  return {
    date,
    temperatureMaxC: maxOf(hours, (h) => h.temperatureC),
    temperatureMinC: minOf(hours, (h) => h.temperatureC),
    apparentTemperatureMaxC: null,
    apparentTemperatureMinC: null,
    precipitationSumMm: sumOf(hours, (h) => h.precipitationMm),
    precipitationProbabilityMaxPct: maxOf(hours, (h) => h.precipitationProbabilityPct),
    snowfallSumCm: null,
    sunshineDurationSeconds: null,
    daylightDurationSeconds: null,
    sunrise: null,
    sunset: null,
    uvIndexMax: null,
    windSpeedMaxMs: maxOf(hours, (h) => h.windSpeedMs),
    windGustsMaxMs: maxOf(hours, (h) => h.windGustsMs),
    windDirectionDominantDeg: circularMeanWeightedByWind(hours),
    shortwaveRadiationSumMjPerM2: null,
    weatherCode: code,
    weatherLabel: describeWeatherCode(code),
  };
}

function maxOf(hours: HourlyForecastEntry[], pick: (h: HourlyForecastEntry) => number | null) {
  let max: number | null = null;
  for (const h of hours) {
    const v = pick(h);
    if (v === null) continue;
    if (max === null || v > max) max = v;
  }
  return max;
}

function minOf(hours: HourlyForecastEntry[], pick: (h: HourlyForecastEntry) => number | null) {
  let min: number | null = null;
  for (const h of hours) {
    const v = pick(h);
    if (v === null) continue;
    if (min === null || v < min) min = v;
  }
  return min;
}

function sumOf(hours: HourlyForecastEntry[], pick: (h: HourlyForecastEntry) => number | null) {
  let sum: number | null = null;
  for (const h of hours) {
    const v = pick(h);
    if (v === null) continue;
    sum = (sum ?? 0) + v;
  }
  return sum;
}

function modeWeatherCode(hours: HourlyForecastEntry[]): number | null {
  const tally = new Map<number, number>();
  for (const h of hours) {
    if (h.weatherCode === null) continue;
    tally.set(h.weatherCode, (tally.get(h.weatherCode) ?? 0) + 1);
  }
  if (tally.size === 0) return null;
  let bestCode: number | null = null;
  let bestCount = -1;
  for (const [c, n] of tally) {
    if (n > bestCount) {
      bestCount = n;
      bestCode = c;
    }
  }
  return bestCode;
}

function circularMeanWeightedByWind(hours: HourlyForecastEntry[]): number | null {
  let sumSin = 0;
  let sumCos = 0;
  let totalWeight = 0;
  for (const h of hours) {
    if (h.windDirectionDeg === null) continue;
    const w = h.windSpeedMs ?? 1;
    const rad = (h.windDirectionDeg * Math.PI) / 180;
    sumSin += Math.sin(rad) * w;
    sumCos += Math.cos(rad) * w;
    totalWeight += w;
  }
  if (totalWeight === 0) return null;
  let deg = (Math.atan2(sumSin / totalWeight, sumCos / totalWeight) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

function normalizeTime(iso: string): string {
  return iso.replace(/:00Z$/, "").replace(/Z$/, "").slice(0, 16);
}

function octasToPercent(octas: number | undefined): number | null {
  if (typeof octas !== "number") return null;
  return (octas / 8) * 100;
}

const WSYMB2_TO_WMO: Record<number, number> = {
  1: 0, // Clear sky
  2: 1, // Nearly clear sky
  3: 2, // Variable cloudiness
  4: 2, // Halfclear sky
  5: 3, // Cloudy sky
  6: 3, // Overcast
  7: 45, // Fog
  8: 80, // Light rain showers
  9: 81, // Moderate rain showers
  10: 82, // Heavy rain showers
  11: 95, // Thunderstorm
  12: 85, // Light sleet showers
  13: 86, // Moderate sleet showers
  14: 86, // Heavy sleet showers
  15: 85, // Light snow showers
  16: 86, // Moderate snow showers
  17: 86, // Heavy snow showers
  18: 61, // Light rain
  19: 63, // Moderate rain
  20: 65, // Heavy rain
  21: 95, // Thunder
  22: 67, // Light sleet
  23: 67, // Moderate sleet
  24: 67, // Heavy sleet
  25: 71, // Light snow
  26: 73, // Moderate snow
  27: 75, // Heavy snow
};

export function symbolCodeToWmo(code: number | null): number | null {
  if (code === null || code === undefined) return null;
  return WSYMB2_TO_WMO[code] ?? null;
}

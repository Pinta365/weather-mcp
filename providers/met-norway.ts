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

const ENDPOINT = "https://api.met.no/weatherapi/locationforecast/2.0/compact";
const USER_AGENT = "weather-mcp/0.1 (https://github.com/Pinta365/weathermcp)";

const NORDIC_BBOX: CoverageFn = boundingBox(54, 71.5, 4, 32);

interface MetNorwayInstantDetails {
  air_pressure_at_sea_level?: number;
  air_temperature?: number;
  cloud_area_fraction?: number;
  relative_humidity?: number;
  wind_from_direction?: number;
  wind_speed?: number;
}

interface MetNorwaySummary {
  symbol_code?: string;
}

interface MetNorwayBucket {
  summary?: MetNorwaySummary;
  details?: { precipitation_amount?: number };
}

interface MetNorwayTimeseriesEntry {
  time: string;
  data: {
    instant: { details: MetNorwayInstantDetails };
    next_1_hours?: MetNorwayBucket;
    next_6_hours?: MetNorwayBucket;
    next_12_hours?: MetNorwayBucket;
  };
}

interface MetNorwayResponse {
  properties: {
    timeseries: MetNorwayTimeseriesEntry[];
  };
}

export class MetNorwayProvider implements WeatherProvider {
  readonly name = "met-norway";
  readonly tier: ProviderTier;
  readonly weight: number;
  readonly priority: number;
  readonly coverage: CoverageFn;

  constructor(opts: { weight?: number; priority?: number; nordicOnly?: boolean } = {}) {
    this.weight = opts.weight ?? 1;
    this.priority = opts.priority ?? 1;
    // Default: regional specialist with Nordic bbox. Set nordicOnly=false to expose globally.
    if (opts.nordicOnly === false) {
      this.tier = "baseline";
      this.coverage = everywhere;
    } else {
      this.tier = "regional";
      this.coverage = NORDIC_BBOX;
    }
  }

  async getForecast(coords: Coordinates, days: number): Promise<Forecast> {
    const data = await fetchMet(coords);
    const hours = data.properties.timeseries.map(toHourlyEntry);
    const dailyEntries = aggregateDaily(hours, days);
    return {
      contributingProviders: [this.name],
      failedProviders: [],
      location: coords,
      timezone: "GMT",
      days: dailyEntries,
    };
  }

  async getHourlyForecast(coords: Coordinates, hours: number): Promise<HourlyForecast> {
    const data = await fetchMet(coords);
    const allEntries = data.properties.timeseries.map(toHourlyEntry);
    const sliced = allEntries.slice(0, hours);
    return {
      contributingProviders: [this.name],
      failedProviders: [],
      location: coords,
      timezone: "GMT",
      hours: sliced,
    };
  }

  async getCurrentConditions(coords: Coordinates): Promise<CurrentConditions> {
    const data = await fetchMet(coords);
    const first = data.properties.timeseries[0];
    if (!first) {
      throw new Error("MET Norway returned an empty timeseries");
    }
    const inst = first.data.instant.details;
    const symbolCode = first.data.next_1_hours?.summary?.symbol_code ??
      first.data.next_6_hours?.summary?.symbol_code ?? null;
    const code = symbolCodeToWmo(symbolCode);
    return {
      contributingProviders: [this.name],
      failedProviders: [],
      location: coords,
      timezone: "GMT",
      observedAt: normalizeTime(first.time),
      isDay: isDayFromSymbol(symbolCode),
      temperatureC: inst.air_temperature ?? null,
      apparentTemperatureC: null,
      windSpeedMs: inst.wind_speed ?? null,
      windGustsMs: null,
      windDirectionDeg: inst.wind_from_direction ?? null,
      relativeHumidityPct: inst.relative_humidity ?? null,
      precipitationMm: first.data.next_1_hours?.details?.precipitation_amount ?? null,
      cloudCoverPct: inst.cloud_area_fraction ?? null,
      pressureMslHpa: inst.air_pressure_at_sea_level ?? null,
      weatherCode: code,
      weatherLabel: describeWeatherCode(code),
    };
  }
}

async function fetchMet(coords: Coordinates): Promise<MetNorwayResponse> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("lat", String(coords.latitude));
  url.searchParams.set("lon", String(coords.longitude));
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `MET Norway request failed: ${res.status} ${res.statusText} - ${body.slice(0, 200)}`,
    );
  }
  return await res.json() as MetNorwayResponse;
}

function toHourlyEntry(e: MetNorwayTimeseriesEntry): HourlyForecastEntry {
  const inst = e.data.instant.details;
  const symbolCode = e.data.next_1_hours?.summary?.symbol_code ??
    e.data.next_6_hours?.summary?.symbol_code ?? null;
  const code = symbolCodeToWmo(symbolCode);
  return {
    time: normalizeTime(e.time),
    temperatureC: inst.air_temperature ?? null,
    apparentTemperatureC: null,
    relativeHumidityPct: inst.relative_humidity ?? null,
    dewPointC: null,
    precipitationProbabilityPct: null,
    precipitationMm: e.data.next_1_hours?.details?.precipitation_amount ?? null,
    snowfallCm: null,
    cloudCoverPct: inst.cloud_area_fraction ?? null,
    visibilityM: null,
    uvIndex: null,
    shortwaveRadiationWm2: null,
    windSpeedMs: inst.wind_speed ?? null,
    windGustsMs: null,
    windDirectionDeg: inst.wind_from_direction ?? null,
    isDay: isDayFromSymbol(symbolCode),
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
  const dates = [...byDate.keys()].sort().slice(0, maxDays);
  return dates.map((date) => aggregateOneDay(date, byDate.get(date)!));
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
    precipitationProbabilityMaxPct: null,
    snowfallSumCm: null,
    sunshineDurationSeconds: null,
    daylightDurationSeconds: null,
    sunrise: null,
    sunset: null,
    uvIndexMax: null,
    windSpeedMaxMs: maxOf(hours, (h) => h.windSpeedMs),
    windGustsMaxMs: null,
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
  // "2026-04-27T13:00:00Z" -> "2026-04-27T13:00" (matches Open-Meteo's GMT format)
  return iso.replace(/:00Z$/, "").replace(/Z$/, "").slice(0, 16);
}

function isDayFromSymbol(symbol: string | null): boolean | null {
  if (!symbol) return null;
  if (symbol.endsWith("_day")) return true;
  if (symbol.endsWith("_night")) return false;
  if (symbol.endsWith("_polartwilight")) return null;
  return null;
}

const SYMBOL_TO_WMO: Record<string, number> = {
  clearsky: 0,
  fair: 1,
  partlycloudy: 2,
  cloudy: 3,
  fog: 45,
  lightrain: 61,
  rain: 63,
  heavyrain: 65,
  lightrainshowers: 80,
  rainshowers: 81,
  heavyrainshowers: 82,
  lightsleet: 67,
  sleet: 67,
  heavysleet: 67,
  lightsleetshowers: 85,
  sleetshowers: 86,
  heavysleetshowers: 86,
  lightsnow: 71,
  snow: 73,
  heavysnow: 75,
  lightsnowshowers: 85,
  snowshowers: 86,
  heavysnowshowers: 86,
  lightrainandthunder: 95,
  rainandthunder: 95,
  heavyrainandthunder: 96,
  lightsleetandthunder: 95,
  sleetandthunder: 95,
  heavysleetandthunder: 96,
  lightsnowandthunder: 95,
  snowandthunder: 95,
  heavysnowandthunder: 96,
  lightrainshowersandthunder: 95,
  rainshowersandthunder: 95,
  heavyrainshowersandthunder: 96,
  lightsleetshowersandthunder: 95,
  sleetshowersandthunder: 95,
  heavysleetshowersandthunder: 96,
  lightsnowshowersandthunder: 95,
  snowshowersandthunder: 95,
  heavysnowshowersandthunder: 96,
};

export function symbolCodeToWmo(symbol: string | null): number | null {
  if (!symbol) return null;
  const stem = symbol.replace(/_(day|night|polartwilight)$/, "");
  return SYMBOL_TO_WMO[stem] ?? null;
}

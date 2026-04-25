import { describeWeatherCode } from "./wmo.ts";
import type {
  Coordinates,
  CurrentConditions,
  DailyForecastEntry,
  Forecast,
  HourlyForecast,
  HourlyForecastEntry,
  LocationMatch,
  LocationProvider,
  WeatherProvider,
} from "./types.ts";

const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";

const DAILY_FIELDS = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "apparent_temperature_max",
  "apparent_temperature_min",
  "sunrise",
  "sunset",
  "daylight_duration",
  "sunshine_duration",
  "uv_index_max",
  "precipitation_sum",
  "snowfall_sum",
  "precipitation_probability_max",
  "wind_speed_10m_max",
  "wind_gusts_10m_max",
  "wind_direction_10m_dominant",
  "shortwave_radiation_sum",
] as const;

const HOURLY_FIELDS = [
  "temperature_2m",
  "apparent_temperature",
  "relative_humidity_2m",
  "dew_point_2m",
  "precipitation_probability",
  "precipitation",
  "snowfall",
  "weather_code",
  "cloud_cover",
  "visibility",
  "uv_index",
  "shortwave_radiation",
  "wind_speed_10m",
  "wind_gusts_10m",
  "wind_direction_10m",
  "is_day",
] as const;

const CURRENT_FIELDS = [
  "temperature_2m",
  "apparent_temperature",
  "is_day",
  "relative_humidity_2m",
  "precipitation",
  "cloud_cover",
  "pressure_msl",
  "wind_speed_10m",
  "wind_gusts_10m",
  "wind_direction_10m",
  "weather_code",
] as const;

interface OpenMeteoForecastResponse {
  timezone: string;
  daily: {
    time: string[];
    weather_code: (number | null)[];
    temperature_2m_max: (number | null)[];
    temperature_2m_min: (number | null)[];
    apparent_temperature_max: (number | null)[];
    apparent_temperature_min: (number | null)[];
    sunrise: (string | null)[];
    sunset: (string | null)[];
    daylight_duration: (number | null)[];
    sunshine_duration: (number | null)[];
    uv_index_max: (number | null)[];
    precipitation_sum: (number | null)[];
    snowfall_sum: (number | null)[];
    precipitation_probability_max: (number | null)[];
    wind_speed_10m_max: (number | null)[];
    wind_gusts_10m_max: (number | null)[];
    wind_direction_10m_dominant: (number | null)[];
    shortwave_radiation_sum: (number | null)[];
  };
}

interface OpenMeteoHourlyResponse {
  timezone: string;
  hourly: {
    time: string[];
    temperature_2m: (number | null)[];
    apparent_temperature: (number | null)[];
    relative_humidity_2m: (number | null)[];
    dew_point_2m: (number | null)[];
    precipitation_probability: (number | null)[];
    precipitation: (number | null)[];
    snowfall: (number | null)[];
    weather_code: (number | null)[];
    cloud_cover: (number | null)[];
    visibility: (number | null)[];
    uv_index: (number | null)[];
    shortwave_radiation: (number | null)[];
    wind_speed_10m: (number | null)[];
    wind_gusts_10m: (number | null)[];
    wind_direction_10m: (number | null)[];
    is_day: (number | null)[];
  };
}

interface OpenMeteoCurrentResponse {
  timezone: string;
  current: {
    time: string;
    temperature_2m: number | null;
    apparent_temperature: number | null;
    is_day: number | null;
    relative_humidity_2m: number | null;
    precipitation: number | null;
    cloud_cover: number | null;
    pressure_msl: number | null;
    wind_speed_10m: number | null;
    wind_gusts_10m: number | null;
    wind_direction_10m: number | null;
    weather_code: number | null;
  };
}

interface OpenMeteoGeocodingResponse {
  results?: Array<{
    name: string;
    latitude: number;
    longitude: number;
    elevation?: number | null;
    timezone: string;
    country: string;
    country_code: string;
    admin1?: string | null;
    admin2?: string | null;
    population?: number | null;
  }>;
}

export class OpenMeteoProvider implements WeatherProvider, LocationProvider {
  readonly name = "open-meteo";
  readonly weight: number;

  constructor(weight = 1) {
    this.weight = weight;
  }

  async getForecast(coords: Coordinates, days: number): Promise<Forecast> {
    const url = new URL(FORECAST_ENDPOINT);
    url.searchParams.set("latitude", String(coords.latitude));
    url.searchParams.set("longitude", String(coords.longitude));
    url.searchParams.set("forecast_days", String(days));
    url.searchParams.set("daily", DAILY_FIELDS.join(","));
    url.searchParams.set("wind_speed_unit", "ms");
    url.searchParams.set("timezone", "auto");

    const data = await fetchJson<OpenMeteoForecastResponse>(url);
    const d = data.daily;

    const entries: DailyForecastEntry[] = d.time.map((date, i) => {
      const code = d.weather_code[i] ?? null;
      return {
        date,
        temperatureMaxC: d.temperature_2m_max[i] ?? null,
        temperatureMinC: d.temperature_2m_min[i] ?? null,
        apparentTemperatureMaxC: d.apparent_temperature_max[i] ?? null,
        apparentTemperatureMinC: d.apparent_temperature_min[i] ?? null,
        precipitationSumMm: d.precipitation_sum[i] ?? null,
        precipitationProbabilityMaxPct: d.precipitation_probability_max[i] ?? null,
        snowfallSumCm: d.snowfall_sum[i] ?? null,
        sunshineDurationSeconds: d.sunshine_duration[i] ?? null,
        daylightDurationSeconds: d.daylight_duration[i] ?? null,
        sunrise: d.sunrise[i] ?? null,
        sunset: d.sunset[i] ?? null,
        uvIndexMax: d.uv_index_max[i] ?? null,
        windSpeedMaxMs: d.wind_speed_10m_max[i] ?? null,
        windGustsMaxMs: d.wind_gusts_10m_max[i] ?? null,
        windDirectionDominantDeg: d.wind_direction_10m_dominant[i] ?? null,
        shortwaveRadiationSumMjPerM2: d.shortwave_radiation_sum[i] ?? null,
        weatherCode: code,
        weatherLabel: describeWeatherCode(code),
      };
    });

    return {
      provider: this.name,
      location: coords,
      timezone: data.timezone,
      days: entries,
    };
  }

  async getHourlyForecast(coords: Coordinates, hours: number): Promise<HourlyForecast> {
    const url = new URL(FORECAST_ENDPOINT);
    url.searchParams.set("latitude", String(coords.latitude));
    url.searchParams.set("longitude", String(coords.longitude));
    url.searchParams.set("forecast_hours", String(hours));
    url.searchParams.set("hourly", HOURLY_FIELDS.join(","));
    url.searchParams.set("wind_speed_unit", "ms");
    url.searchParams.set("timezone", "auto");

    const data = await fetchJson<OpenMeteoHourlyResponse>(url);
    const h = data.hourly;

    const entries: HourlyForecastEntry[] = h.time.map((time, i) => {
      const code = h.weather_code[i] ?? null;
      const isDayRaw = h.is_day[i];
      return {
        time,
        temperatureC: h.temperature_2m[i] ?? null,
        apparentTemperatureC: h.apparent_temperature[i] ?? null,
        relativeHumidityPct: h.relative_humidity_2m[i] ?? null,
        dewPointC: h.dew_point_2m[i] ?? null,
        precipitationProbabilityPct: h.precipitation_probability[i] ?? null,
        precipitationMm: h.precipitation[i] ?? null,
        snowfallCm: h.snowfall[i] ?? null,
        cloudCoverPct: h.cloud_cover[i] ?? null,
        visibilityM: h.visibility[i] ?? null,
        uvIndex: h.uv_index[i] ?? null,
        shortwaveRadiationWm2: h.shortwave_radiation[i] ?? null,
        windSpeedMs: h.wind_speed_10m[i] ?? null,
        windGustsMs: h.wind_gusts_10m[i] ?? null,
        windDirectionDeg: h.wind_direction_10m[i] ?? null,
        isDay: isDayRaw === null || isDayRaw === undefined ? null : isDayRaw === 1,
        weatherCode: code,
        weatherLabel: describeWeatherCode(code),
      };
    });

    return {
      provider: this.name,
      location: coords,
      timezone: data.timezone,
      hours: entries,
    };
  }

  async getCurrentConditions(coords: Coordinates): Promise<CurrentConditions> {
    const url = new URL(FORECAST_ENDPOINT);
    url.searchParams.set("latitude", String(coords.latitude));
    url.searchParams.set("longitude", String(coords.longitude));
    url.searchParams.set("current", CURRENT_FIELDS.join(","));
    url.searchParams.set("wind_speed_unit", "ms");
    url.searchParams.set("timezone", "auto");

    const data = await fetchJson<OpenMeteoCurrentResponse>(url);
    const c = data.current;
    const code = c.weather_code ?? null;

    return {
      provider: this.name,
      location: coords,
      timezone: data.timezone,
      observedAt: c.time,
      isDay: c.is_day === null || c.is_day === undefined ? null : c.is_day === 1,
      temperatureC: c.temperature_2m ?? null,
      apparentTemperatureC: c.apparent_temperature ?? null,
      windSpeedMs: c.wind_speed_10m ?? null,
      windGustsMs: c.wind_gusts_10m ?? null,
      windDirectionDeg: c.wind_direction_10m ?? null,
      relativeHumidityPct: c.relative_humidity_2m ?? null,
      precipitationMm: c.precipitation ?? null,
      cloudCoverPct: c.cloud_cover ?? null,
      pressureMslHpa: c.pressure_msl ?? null,
      weatherCode: code,
      weatherLabel: describeWeatherCode(code),
    };
  }

  async findLocation(query: string, count: number): Promise<LocationMatch[]> {
    const url = new URL(GEOCODING_ENDPOINT);
    url.searchParams.set("name", query);
    url.searchParams.set("count", String(count));
    url.searchParams.set("language", "en");
    url.searchParams.set("format", "json");

    const data = await fetchJson<OpenMeteoGeocodingResponse>(url);
    const results = data.results ?? [];

    return results.map((r) => ({
      name: r.name,
      country: r.country,
      countryCode: r.country_code,
      admin1: r.admin1 ?? null,
      admin2: r.admin2 ?? null,
      latitude: r.latitude,
      longitude: r.longitude,
      elevationM: r.elevation ?? null,
      timezone: r.timezone,
      population: r.population ?? null,
    }));
  }
}

async function fetchJson<T>(url: URL): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Open-Meteo request failed: ${res.status} ${res.statusText} - ${body.slice(0, 200)}`,
    );
  }
  return await res.json() as T;
}

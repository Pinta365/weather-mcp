export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface DailyForecastEntry {
  date: string;
  temperatureMaxC: number | null;
  temperatureMinC: number | null;
  apparentTemperatureMaxC: number | null;
  apparentTemperatureMinC: number | null;
  precipitationSumMm: number | null;
  precipitationProbabilityMaxPct: number | null;
  snowfallSumCm: number | null;
  sunshineDurationSeconds: number | null;
  daylightDurationSeconds: number | null;
  sunrise: string | null;
  sunset: string | null;
  uvIndexMax: number | null;
  windSpeedMaxMs: number | null;
  windGustsMaxMs: number | null;
  windDirectionDominantDeg: number | null;
  shortwaveRadiationSumMjPerM2: number | null;
  weatherCode: number | null;
  weatherLabel: string | null;
}

export interface Forecast {
  provider: string;
  location: Coordinates;
  timezone: string;
  days: DailyForecastEntry[];
}

export interface HourlyForecastEntry {
  time: string;
  temperatureC: number | null;
  apparentTemperatureC: number | null;
  relativeHumidityPct: number | null;
  dewPointC: number | null;
  precipitationProbabilityPct: number | null;
  precipitationMm: number | null;
  snowfallCm: number | null;
  cloudCoverPct: number | null;
  visibilityM: number | null;
  uvIndex: number | null;
  shortwaveRadiationWm2: number | null;
  windSpeedMs: number | null;
  windGustsMs: number | null;
  windDirectionDeg: number | null;
  isDay: boolean | null;
  weatherCode: number | null;
  weatherLabel: string | null;
}

export interface HourlyForecast {
  provider: string;
  location: Coordinates;
  timezone: string;
  hours: HourlyForecastEntry[];
}

export interface CurrentConditions {
  provider: string;
  location: Coordinates;
  timezone: string;
  observedAt: string;
  isDay: boolean | null;
  temperatureC: number | null;
  apparentTemperatureC: number | null;
  windSpeedMs: number | null;
  windGustsMs: number | null;
  windDirectionDeg: number | null;
  relativeHumidityPct: number | null;
  precipitationMm: number | null;
  cloudCoverPct: number | null;
  pressureMslHpa: number | null;
  weatherCode: number | null;
  weatherLabel: string | null;
}

export interface LocationMatch {
  name: string;
  country: string;
  countryCode: string;
  admin1: string | null;
  admin2: string | null;
  latitude: number;
  longitude: number;
  elevationM: number | null;
  timezone: string;
  population: number | null;
}

export interface WeatherProvider {
  readonly name: string;
  readonly weight: number;
  getForecast(coords: Coordinates, days: number): Promise<Forecast>;
  getHourlyForecast(coords: Coordinates, hours: number): Promise<HourlyForecast>;
  getCurrentConditions(coords: Coordinates): Promise<CurrentConditions>;
}

export interface LocationProvider {
  readonly name: string;
  findLocation(query: string, count: number): Promise<LocationMatch[]>;
}

import { assertEquals } from "@std/assert";
import { describeWeatherCode } from "./wmo.ts";

Deno.test("describeWeatherCode maps known WMO codes", () => {
  assertEquals(describeWeatherCode(0), "Clear sky");
  assertEquals(describeWeatherCode(2), "Partly cloudy");
  assertEquals(describeWeatherCode(45), "Fog");
  assertEquals(describeWeatherCode(61), "Slight rain");
  assertEquals(describeWeatherCode(75), "Heavy snowfall");
  assertEquals(describeWeatherCode(95), "Thunderstorm");
  assertEquals(describeWeatherCode(99), "Thunderstorm with heavy hail");
});

Deno.test("describeWeatherCode returns null for null or undefined", () => {
  assertEquals(describeWeatherCode(null), null);
  assertEquals(describeWeatherCode(undefined), null);
});

Deno.test("describeWeatherCode falls back for unknown codes", () => {
  assertEquals(describeWeatherCode(42), "Unknown (WMO 42)");
  assertEquals(describeWeatherCode(200), "Unknown (WMO 200)");
});

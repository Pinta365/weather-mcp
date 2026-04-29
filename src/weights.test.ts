import { assertEquals } from "@std/assert";
import { parseWeights } from "./weights.ts";

Deno.test("parseWeights returns {} for undefined or empty", () => {
  assertEquals(parseWeights(undefined), {});
  assertEquals(parseWeights(""), {});
  assertEquals(parseWeights("   "), {});
});

Deno.test("parseWeights parses basic name:value,name:value form", () => {
  assertEquals(parseWeights("open-meteo:1.0,met-norway:2.0"), {
    "open-meteo": 1.0,
    "met-norway": 2.0,
  });
});

Deno.test("parseWeights tolerates whitespace around names, values, and separators", () => {
  assertEquals(
    parseWeights("  open-meteo : 1.5 ,  met-norway:2 "),
    { "open-meteo": 1.5, "met-norway": 2 },
  );
});

Deno.test("parseWeights drops malformed and negative entries", () => {
  assertEquals(parseWeights("foo,bar:abc,baz:-1,ok:3"), { ok: 3 });
});

Deno.test("parseWeights skips empty pairs (trailing commas, doubled commas)", () => {
  assertEquals(parseWeights("open-meteo:1,,,met-norway:2,"), {
    "open-meteo": 1,
    "met-norway": 2,
  });
});

Deno.test("parseWeights accepts zero as a valid weight (silences a provider)", () => {
  assertEquals(parseWeights("noisy-provider:0"), { "noisy-provider": 0 });
});

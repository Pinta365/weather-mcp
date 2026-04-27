import { assertEquals } from "@std/assert";
import { boundingBox, everywhere } from "./coverage.ts";

Deno.test("everywhere returns true for any coordinate", () => {
  assertEquals(everywhere({ latitude: 0, longitude: 0 }), true);
  assertEquals(everywhere({ latitude: 89.9, longitude: 179.9 }), true);
  assertEquals(everywhere({ latitude: -89.9, longitude: -179.9 }), true);
});

Deno.test("boundingBox includes coords inside the box and on its borders", () => {
  const nordic = boundingBox(54, 71.5, 4, 32);
  // Stockholm
  assertEquals(nordic({ latitude: 59.33, longitude: 18.07 }), true);
  // Oslo
  assertEquals(nordic({ latitude: 59.91, longitude: 10.75 }), true);
  // Reykjavik (west of bbox)
  assertEquals(nordic({ latitude: 64.13, longitude: -21.94 }), false);
  // London (south of bbox)
  assertEquals(nordic({ latitude: 51.51, longitude: -0.13 }), false);
  // Border cases
  assertEquals(nordic({ latitude: 54, longitude: 4 }), true);
  assertEquals(nordic({ latitude: 71.5, longitude: 32 }), true);
  // Just outside borders
  assertEquals(nordic({ latitude: 53.99, longitude: 18 }), false);
  assertEquals(nordic({ latitude: 60, longitude: 32.01 }), false);
});

import { expect, test } from "vitest";
import { buttonClass } from "./lib/buttonClass";

test("ghost is the default toolbar action class", () => {
  expect(buttonClass("ghost")).toBe("ghost");
});

test("primary and danger are explicit variants, not inferred from labels", () => {
  expect(buttonClass("primary")).toBe("primary");
  expect(buttonClass("danger")).toBe("danger");
});

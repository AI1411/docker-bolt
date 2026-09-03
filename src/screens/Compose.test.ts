import { expect, test } from "vitest";
import { Compose } from "./Compose";

test("exports compose screen", () => {
  expect(Compose).toBeTypeOf("function");
});

import { expect, test } from "vitest";
import { pruneConfirmBody, pruneHasWork } from "./lib/prune";

test("confirm is disabled when every prune count is zero", () => {
  expect(
    pruneHasWork({ stopped_containers: 0, dangling_images: 0, unused_networks: 0 }),
  ).toBe(false);
  expect(
    pruneHasWork({ stopped_containers: 1, dangling_images: 0, unused_networks: 0 }),
  ).toBe(true);
});

test("confirm body lists the three prune counts", () => {
  expect(
    pruneConfirmBody({ stopped_containers: 2, dangling_images: 0, unused_networks: 1 }),
  ).toBe("2 stopped containers, 0 dangling images, 1 unused networks");
});

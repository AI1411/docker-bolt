import { expect, test } from "vitest";
import {
  browserUrlForPort,
  publishedPortLabel,
  summarizePublishedPorts,
  type PublishedPort,
} from "./lib/ports";

function tcp(host_ip: string, host_port: number, container_port: number): PublishedPort {
  return { host_ip, host_port, container_port, protocol: "tcp" };
}

test("host binding label uses 8080:80 when ports differ", () => {
  expect(publishedPortLabel(tcp("0.0.0.0", 8080, 80))).toBe("8080:80");
  expect(publishedPortLabel(tcp("0.0.0.0", 8080, 8080))).toBe("8080");
});

test("summary shows two ports then +N; empty is an em dash", () => {
  expect(summarizePublishedPorts([])).toBe("—");
  expect(
    summarizePublishedPorts([
      tcp("0.0.0.0", 8080, 80),
      tcp("0.0.0.0", 443, 443),
      tcp("0.0.0.0", 9090, 90),
    ]),
  ).toBe("8080:80, 443 +1");
});

test("browser URL uses localhost for wildcards; 443 is https; UDP is skipped", () => {
  expect(browserUrlForPort(tcp("0.0.0.0", 8080, 80))).toBe("http://127.0.0.1:8080");
  expect(browserUrlForPort(tcp("::", 443, 443))).toBe("https://127.0.0.1:443");
  expect(
    browserUrlForPort({
      host_ip: "0.0.0.0",
      host_port: 53,
      container_port: 53,
      protocol: "udp",
    }),
  ).toBeNull();
});

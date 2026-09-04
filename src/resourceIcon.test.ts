import { expect, test } from "vitest";
import { resourceIconKind } from "./lib/resourceIcon";

test("maps well-known image names to icon kinds", () => {
  expect(resourceIconKind("mysql:8.0")).toBe("mysql");
  expect(resourceIconKind("library/mariadb:latest")).toBe("mariadb");
  expect(resourceIconKind("postgres:16")).toBe("postgres");
  expect(resourceIconKind("redis:7-alpine")).toBe("redis");
  expect(resourceIconKind("mongo:7")).toBe("mongo");
  expect(resourceIconKind("nginx:1.27")).toBe("nginx");
  expect(resourceIconKind("node:22")).toBe("node");
  expect(resourceIconKind("python:3.12")).toBe("python");
  expect(resourceIconKind("elasticsearch:8.15.0")).toBe("elasticsearch");
  expect(resourceIconKind("rabbitmq:3")).toBe("rabbitmq");
  expect(resourceIconKind("bitnami/kafka")).toBe("kafka");
  expect(resourceIconKind("grafana/grafana")).toBe("grafana");
  expect(resourceIconKind("prom/prometheus")).toBe("prometheus");
  expect(resourceIconKind("traefik:v3")).toBe("traefik");
  expect(resourceIconKind("minio/minio")).toBe("minio");
  expect(resourceIconKind("wordpress:latest")).toBe("wordpress");
  expect(resourceIconKind("golang:1.23")).toBe("go");
  expect(resourceIconKind("httpd:2.4")).toBe("apache");
});

test("falls back to container for unknown images", () => {
  expect(resourceIconKind("my-app:dev")).toBe("container");
  expect(resourceIconKind("")).toBe("container");
});

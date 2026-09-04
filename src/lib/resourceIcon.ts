export type ResourceIconKind =
  | "mysql"
  | "mariadb"
  | "postgres"
  | "redis"
  | "mongo"
  | "nginx"
  | "node"
  | "python"
  | "elasticsearch"
  | "rabbitmq"
  | "kafka"
  | "grafana"
  | "prometheus"
  | "traefik"
  | "minio"
  | "wordpress"
  | "go"
  | "rust"
  | "ruby"
  | "php"
  | "apache"
  | "docker"
  | "container";

const RULES: Array<{ kind: ResourceIconKind; needles: string[] }> = [
  { kind: "mariadb", needles: ["mariadb"] },
  { kind: "mysql", needles: ["mysql"] },
  { kind: "postgres", needles: ["postgres"] },
  { kind: "redis", needles: ["redis"] },
  { kind: "mongo", needles: ["mongo"] },
  { kind: "elasticsearch", needles: ["elasticsearch", "elastic"] },
  { kind: "rabbitmq", needles: ["rabbitmq"] },
  { kind: "kafka", needles: ["kafka"] },
  { kind: "grafana", needles: ["grafana"] },
  { kind: "prometheus", needles: ["prometheus"] },
  { kind: "traefik", needles: ["traefik"] },
  { kind: "minio", needles: ["minio"] },
  { kind: "wordpress", needles: ["wordpress"] },
  { kind: "nginx", needles: ["nginx"] },
  { kind: "node", needles: ["node"] },
  { kind: "python", needles: ["python"] },
  { kind: "go", needles: ["golang"] },
  { kind: "rust", needles: ["rust"] },
  { kind: "ruby", needles: ["ruby"] },
  { kind: "php", needles: ["php"] },
  { kind: "apache", needles: ["httpd", "apache"] },
  { kind: "docker", needles: ["docker"] },
];

export function resourceIconKind(ref: string): ResourceIconKind {
  const value = ref.toLowerCase();
  for (const rule of RULES) {
    if (rule.needles.some((needle) => value.includes(needle))) return rule.kind;
  }
  return "container";
}

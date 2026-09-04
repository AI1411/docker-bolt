import type { SimpleIcon } from "simple-icons";
import {
  siApache,
  siApachekafka,
  siDocker,
  siElasticsearch,
  siGo,
  siGrafana,
  siMariadb,
  siMinio,
  siMongodb,
  siMysql,
  siNginx,
  siNodedotjs,
  siPhp,
  siPostgresql,
  siPrometheus,
  siPython,
  siRabbitmq,
  siRedis,
  siRuby,
  siRust,
  siTraefikproxy,
  siWordpress,
} from "simple-icons";
import type { ResourceIconKind } from "../lib/resourceIcon";

type IconProps = { className?: string };

function strokeProps(className?: string) {
  return {
    className,
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
}

export function IconBolt(props: IconProps) {
  return (
    <svg {...strokeProps(props.className)} width={20} height={20} viewBox="0 0 16 16">
      <path d="M9 1.5 3.5 9h4L7 14.5 12.5 7h-4L9 1.5z" />
    </svg>
  );
}

export function IconContainers(props: IconProps) {
  return (
    <svg {...strokeProps(props.className)}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M2.5 6.5h11M6.5 2.5v11" />
    </svg>
  );
}

export function IconCompose(props: IconProps) {
  return (
    <svg {...strokeProps(props.className)}>
      <rect x="2" y="3" width="5" height="4" rx="1" />
      <rect x="9" y="3" width="5" height="4" rx="1" />
      <rect x="5.5" y="9" width="5" height="4" rx="1" />
    </svg>
  );
}

export function IconImages(props: IconProps) {
  return (
    <svg {...strokeProps(props.className)}>
      <rect x="3" y="4.5" width="10" height="8" rx="1.5" />
      <path d="M3 7.5h10" />
    </svg>
  );
}

export function IconVolumes(props: IconProps) {
  return (
    <svg {...strokeProps(props.className)}>
      <ellipse cx="8" cy="4.5" rx="5" ry="2" />
      <path d="M3 4.5v7c0 1.1 2.2 2 5 2s5-.9 5-2v-7" />
    </svg>
  );
}

export function IconNetworks(props: IconProps) {
  return (
    <svg {...strokeProps(props.className)}>
      <circle cx="4" cy="8" r="2" />
      <circle cx="12" cy="4.5" r="2" />
      <circle cx="12" cy="11.5" r="2" />
      <path d="M6 8h4M10.2 5.6 6 7.2M10.2 10.4 6 8.8" />
    </svg>
  );
}

const BRAND: Record<ResourceIconKind, SimpleIcon | null> = {
  mysql: siMysql,
  mariadb: siMariadb,
  postgres: siPostgresql,
  redis: siRedis,
  mongo: siMongodb,
  nginx: siNginx,
  node: siNodedotjs,
  python: siPython,
  elasticsearch: siElasticsearch,
  rabbitmq: siRabbitmq,
  kafka: siApachekafka,
  grafana: siGrafana,
  prometheus: siPrometheus,
  traefik: siTraefikproxy,
  minio: siMinio,
  wordpress: siWordpress,
  go: siGo,
  rust: siRust,
  ruby: siRuby,
  php: siPhp,
  apache: siApache,
  docker: siDocker,
  container: null,
};

function tileBackground(hex: string): string {
  const n = Number.parseInt(hex, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (luminance < 28) return "#3a3a3c";
  return `#${hex}`;
}

function glyphFill(hex: string): string {
  const n = Number.parseInt(hex, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 160 ? "#1d1d1f" : "#f5f5f7";
}

function BrandMark({ icon }: { icon: SimpleIcon }) {
  return (
    <svg className="resource-tile-logo" viewBox="0 0 24 24" aria-hidden="true">
      <path fill={glyphFill(icon.hex)} d={icon.path} />
    </svg>
  );
}

export function ResourceTile({
  kind,
  running,
}: {
  kind: ResourceIconKind | "compose" | "volume" | "image" | "network";
  running?: boolean;
}) {
  const extra =
    kind === "compose"
      ? siDocker
      : kind === "volume"
        ? null
        : kind === "network"
          ? null
        : kind === "image"
          ? siDocker
          : BRAND[kind];
  const bg =
    extra != null
      ? tileBackground(extra.hex)
      : kind === "volume"
        ? "#8e8e93"
        : kind === "network"
          ? "#636366"
        : "#5b6abf";
  return (
    <span className="resource-tile" style={{ background: bg }} title={extra?.title ?? kind}>
      {extra ? <BrandMark icon={extra} /> : <span className="resource-tile-label">{kind === "volume" ? "Vol" : kind === "network" ? "Net" : "Ct"}</span>}
      {running === undefined ? null : (
        <span className={`resource-dot${running ? " running" : ""}`} />
      )}
    </span>
  );
}

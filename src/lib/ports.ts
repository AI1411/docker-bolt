export type PublishedPort = {
  host_ip: string;
  host_port: number;
  container_port: number;
  protocol: string;
};

export function publishedPortLabel(port: PublishedPort): string {
  if (port.host_port === port.container_port) {
    return String(port.host_port);
  }
  return `${port.host_port}:${port.container_port}`;
}

export function summarizePublishedPorts(ports: PublishedPort[], max = 2): string {
  if (ports.length === 0) return "—";
  const shown = ports.slice(0, max).map(publishedPortLabel);
  const extra = ports.length - max;
  if (extra > 0) return `${shown.join(", ")} +${extra}`;
  return shown.join(", ");
}

export function browserUrlForPort(port: PublishedPort): string | null {
  if (port.protocol.toLowerCase() !== "tcp" || port.host_port === 0) {
    return null;
  }
  const scheme = port.host_port === 443 ? "https" : "http";
  const raw = port.host_ip;
  const host =
    raw === "" || raw === "0.0.0.0" || raw === "::" || raw === "[::]" ? "127.0.0.1" : raw;
  if (host.includes(":") && !host.startsWith("[")) {
    return `${scheme}://[${host}]:${port.host_port}`;
  }
  return `${scheme}://${host}:${port.host_port}`;
}

import { NavLink, useLocation } from "react-router-dom";
import { IconBolt, IconCompose, IconContainers, IconImages, IconNetworks, IconVolumes } from "./icons";
import { containersNavActive, navCount } from "../lib/navActive";
import { useCompose } from "../stores/compose";
import { useConnection } from "../stores/connection";
import { useContainers } from "../stores/containers";
import { useImages } from "../stores/images";
import { useNetworks } from "../stores/networks";
import { useVolumes } from "../stores/volumes";

const items = [
  { to: "/", key: "containers", label: "Containers", icon: IconContainers },
  { to: "/compose", key: "compose", label: "Compose", icon: IconCompose },
  { to: "/images", key: "images", label: "Images", icon: IconImages },
  { to: "/volumes", key: "volumes", label: "Volumes", icon: IconVolumes },
  { to: "/networks", key: "networks", label: "Networks", icon: IconNetworks },
] as const;

export function Sidebar() {
  const pathname = useLocation().pathname;
  const connected = useConnection((s) => s.view.status === "connected");
  const containerCount = navCount(connected, useContainers((s) => s.loading), useContainers((s) => s.rows.length));
  const composeCount = navCount(connected, useCompose((s) => s.loading), useCompose((s) => s.rows.length));
  const imageCount = navCount(connected, useImages((s) => s.loading), useImages((s) => s.rows.length));
  const volumeCount = navCount(connected, useVolumes((s) => s.loading), useVolumes((s) => s.rows.length));
  const networkCount = navCount(connected, useNetworks((s) => s.loading), useNetworks((s) => s.rows.length));
  const counts = {
    containers: containerCount,
    compose: composeCount,
    images: imageCount,
    volumes: volumeCount,
    networks: networkCount,
  };

  return (
    <nav className="sidebar">
      <div className="brand">
        <IconBolt />
        DockBolt
      </div>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          className={({ isActive }) => {
            const active = item.key === "containers" ? containersNavActive(pathname) : isActive;
            return active ? "nav active" : "nav";
          }}
        >
          <item.icon />
          <span className="nav-label">{item.label}</span>
          {counts[item.key] != null ? <span className="nav-count">{counts[item.key]}</span> : null}
        </NavLink>
      ))}
    </nav>
  );
}

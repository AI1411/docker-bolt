import { NavLink } from "react-router-dom";
import { IconCompose, IconContainers, IconImages, IconVolumes } from "./icons";

const items = [
  { to: "/", end: true, label: "Containers", icon: IconContainers },
  { to: "/compose", end: false, label: "Compose", icon: IconCompose },
  { to: "/images", end: false, label: "Images", icon: IconImages },
  { to: "/volumes", end: false, label: "Volumes", icon: IconVolumes },
] as const;

export function Sidebar() {
  return (
    <nav className="sidebar">
      <div className="brand">DockBolt</div>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => (isActive ? "nav active" : "nav")}
        >
          <item.icon />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

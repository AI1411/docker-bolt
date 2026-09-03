import { NavLink } from "react-router-dom";

export function Sidebar() {
  return (
    <nav className="sidebar">
      <div className="brand">DockBolt</div>
      <NavLink to="/" end className={({ isActive }) => (isActive ? "nav active" : "nav")}>
        Containers
      </NavLink>
      <NavLink to="/compose" className={({ isActive }) => (isActive ? "nav active" : "nav")}>
        Compose
      </NavLink>
      <NavLink to="/images" className={({ isActive }) => (isActive ? "nav active" : "nav")}>
        Images
      </NavLink>
      <NavLink to="/volumes" className={({ isActive }) => (isActive ? "nav active" : "nav")}>
        Volumes
      </NavLink>
    </nav>
  );
}

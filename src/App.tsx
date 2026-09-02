import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { listenConnection, listenInvalidate } from "./lib/tauri";
import { Containers } from "./screens/Containers";
import { Images } from "./screens/Images";
import { Volumes } from "./screens/Volumes";
import { useConnection } from "./stores/connection";
import { useContainers } from "./stores/containers";
import { useImages } from "./stores/images";
import { useVolumes } from "./stores/volumes";

function LogsPlaceholder() {
  return (
    <div className="screen">
      <div className="empty">Logs</div>
    </div>
  );
}

export default function App() {
  useEffect(() => {
    const pending = [
      listenConnection((view) => {
        useConnection.getState().setView(view);
      }),
      listenInvalidate((resource) => {
        if (useConnection.getState().view.status !== "connected") return;
        if (resource === "containers") void useContainers.getState().reload();
        if (resource === "images") void useImages.getState().reload();
        if (resource === "volumes") void useVolumes.getState().reload();
      }),
    ];
    void useConnection.getState().bootstrap();
    return () => {
      void Promise.all(pending).then((unlisteners) => {
        unlisteners.forEach((unlisten) => unlisten());
      });
    };
  }, []);

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <Routes>
          <Route path="/" element={<Containers />} />
          <Route path="/images" element={<Images />} />
          <Route path="/volumes" element={<Volumes />} />
          <Route path="/containers/:id/logs" element={<LogsPlaceholder />} />
        </Routes>
      </main>
      <StatusBar />
    </div>
  );
}

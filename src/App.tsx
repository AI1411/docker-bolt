import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { listenConnection, listenInvalidate } from "./lib/tauri";
import { Containers } from "./screens/Containers";
import { Images } from "./screens/Images";
import { Logs } from "./screens/Logs";
import { Volumes } from "./screens/Volumes";
import { useConnection } from "./stores/connection";
import { useContainers } from "./stores/containers";
import { useImages } from "./stores/images";
import { useLogs } from "./stores/logs";
import { useVolumes } from "./stores/volumes";

export default function App() {
  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    void (async () => {
      const unlistenConnection = await listenConnection((view) => {
        if (view.status === "disconnected") {
          useContainers.getState().clear();
          useImages.getState().clear();
          useVolumes.getState().clear();
          useLogs.getState().reset();
        }
        useConnection.getState().setView(view);
      });
      const unlistenInvalidate = await listenInvalidate((resource) => {
        if (useConnection.getState().view.status !== "connected") return;
        if (resource === "containers") {
          void useContainers.getState().reload();
          void useImages.getState().reload();
        }
        if (resource === "images") void useImages.getState().reload();
        if (resource === "volumes") void useVolumes.getState().reload();
      });
      if (cancelled) {
        unlistenConnection();
        unlistenInvalidate();
        return;
      }
      unlisteners.push(unlistenConnection, unlistenInvalidate);
      await useConnection.getState().bootstrap();
    })();

    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
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
          <Route path="/containers/:id/logs" element={<Logs />} />
        </Routes>
      </main>
      <StatusBar />
    </div>
  );
}

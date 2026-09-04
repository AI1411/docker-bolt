import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { listenConnection, listenInvalidate } from "./lib/tauri";
import { Compose } from "./screens/Compose";
import { Containers } from "./screens/Containers";
import { Images } from "./screens/Images";
import { Logs } from "./screens/Logs";
import { Networks } from "./screens/Networks";
import { Volumes } from "./screens/Volumes";
import { useConnection } from "./stores/connection";
import { useCompose } from "./stores/compose";
import { useContainers } from "./stores/containers";
import { useImages } from "./stores/images";
import { useLogs } from "./stores/logs";
import { useNetworks } from "./stores/networks";
import { useVolumes } from "./stores/volumes";
import { useInspect } from "./stores/inspect";

export default function App() {
  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    void (async () => {
      const unlistenConnection = await listenConnection((view) => {
        if (view.status === "disconnected") {
          useCompose.getState().clear();
          useContainers.getState().clear();
          useImages.getState().clear();
          useVolumes.getState().clear();
          useNetworks.getState().clear();
          useLogs.getState().reset();
          useInspect.getState().clear();
        }
        useConnection.getState().setView(view);
      });
      const unlistenInvalidate = await listenInvalidate((resource) => {
        if (useConnection.getState().view.status !== "connected") return;
        if (resource === "containers") {
          void useContainers.getState().reload();
          void useImages.getState().reload();
          useInspect.getState().invalidate();
        }
        if (resource === "images") void useImages.getState().reload();
        if (resource === "volumes") void useVolumes.getState().reload();
        if (resource === "networks") void useNetworks.getState().reload();
        if (resource === "compose") void useCompose.getState().reload();
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
          <Route path="/compose" element={<Compose />} />
          <Route path="/images" element={<Images />} />
          <Route path="/volumes" element={<Volumes />} />
          <Route path="/networks" element={<Networks />} />
          <Route path="/containers/:id/logs" element={<Logs />} />
        </Routes>
      </main>
      <StatusBar />
    </div>
  );
}

import type { PrunePreview } from "./tauri";

export function pruneHasWork(preview: PrunePreview): boolean {
  return preview.stopped_containers + preview.dangling_images + preview.unused_networks > 0;
}

export function pruneConfirmBody(preview: PrunePreview): string {
  return [
    `${preview.stopped_containers} stopped containers`,
    `${preview.dangling_images} dangling images`,
    `${preview.unused_networks} unused networks`,
  ].join(", ");
}

import { useEffect, useState } from "react";
import type { EditorStore, EditorState } from "../app/editor-store";
import { imageDimensions, type ImageFormat } from "../assets/prepare-image-asset";

type Entry = { id: string; format: string; size: number; dimensions: string; url: string | undefined };
const formatOf = (path: string): ImageFormat | null => {
  const extension = path.split(".").at(-1);
  return extension === "png" || extension === "jpg" || extension === "webp" || extension === "hdr" || extension === "exr" ? extension : null;
};
export function ResourceLibrary({ store, state, blocked, onImport }: { store: EditorStore; state: EditorState; blocked: boolean; onImport: () => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const assets = state.document.project.assets;
  const signature = assets.map(asset => `${asset.id}:${asset.hash}`).join("|");
  useEffect(() => {
    const urls: string[] = [];
    const next = assets.map(asset => {
      const bytes = store.readAssetBytes(asset.id);
      const format = formatOf(asset.path);
      const dimensions = bytes && format ? imageDimensions(bytes, format) : null;
      let url: string | undefined;
      if (bytes && format && ["png", "jpg", "webp"].includes(format)) {
        url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: asset.mediaType }));
        urls.push(url);
      }
      return { id: asset.id, format: format?.toUpperCase() ?? asset.mediaType, size: bytes?.byteLength ?? 0,
        dimensions: dimensions ? `${dimensions[0]} × ${dimensions[1]}` : "Размеры недоступны", url };
    });
    setEntries(next);
    return () => { for (const url of urls) URL.revokeObjectURL(url); };
    // signature tracks the Project.assets list; history and project replacement invalidate all previews.
  }, [store, signature, state.document.project]);
  return <div className="resource-library">
    <button type="button" disabled={blocked} onClick={onImport}>Импортировать ресурс</button>
    <p className="panel-hint">PNG, JPEG и WebP можно назначить в инспекторе материала как текстуру основного цвета.</p>
    {!entries.length && <p className="panel-hint">Ресурсов пока нет.</p>}
    {entries.map(entry => <div className="resource-card" key={entry.id}>
      {entry.url ? <img src={entry.url} alt={`Превью ресурса ${entry.format}`} /> : <div className="resource-placeholder">{entry.format === "HDR" || entry.format === "EXR" ? "HDR-превью недоступно" : "Превью недоступно"}</div>}
      <div><strong>{entry.format}</strong><p>{entry.size.toLocaleString("ru-RU")} байт · {entry.dimensions}</p></div>
    </div>)}
  </div>;
}

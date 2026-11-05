import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, ExternalLink, FileText, Image as ImageIcon, Paperclip, Trash2 } from 'lucide-react';
import { useHQ } from '../store';
import { deleteWithUndo } from '../lib/undo';
import { getAssetBlob, putAssetBlob } from '../lib/assets';
import { openAsset, saveAssetCopy } from '../lib/open-file';
import { btnGhost } from './ui';
import type { Asset, EntityRef } from '../types';

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function AssetRow({ asset, onDelete }: { asset: Asset; onDelete: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const isImage = asset.mime.startsWith('image/');

  useEffect(() => {
    let revoked: string | null = null;
    void getAssetBlob(asset.id, asset.mime).then((blob) => {
      if (blob) {
        revoked = URL.createObjectURL(blob);
        setUrl(revoked);
      }
    });
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [asset.id]);

  return (
    <div className="group flex items-center gap-3 rounded-xl border border-line bg-surface2/50 px-3 py-2">
      {isImage && url ? (
        <img src={url} alt={asset.name} className="h-9 w-9 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          {isImage ? <ImageIcon size={15} /> : <FileText size={15} />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium">{asset.name}</div>
        <div className="text-2xs text-dim">{prettySize(asset.size)}</div>
      </div>
      <button
        type="button"
        onClick={() => void openAsset(asset)}
        aria-label={`Open ${asset.name}`}
        title={`Open ${asset.name}`}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:text-accent"
      >
        <ExternalLink size={14} />
      </button>
      <button
        type="button"
        onClick={() => void saveAssetCopy(asset)}
        aria-label={`Save a copy of ${asset.name}…`}
        title="Save a copy…"
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:text-accent"
      >
        <Download size={14} />
      </button>
      <button
        onClick={onDelete}
        aria-label={`Delete ${asset.name}`}
        className="text-dim opacity-0 transition-opacity hover:text-warn group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

/** File attachments for any entity: metadata in the store, blobs in IndexedDB. */
export default function Attachments({ entity }: { entity: EntityRef }) {
  const assets = useHQ((s) => s.assets);
  const links = useHQ((s) => s.links);
  const addAsset = useHQ((s) => s.addAsset);
  const deleteAsset = useHQ((s) => s.deleteAsset);
  const fileRef = useRef<HTMLInputElement>(null);

  const mine = useMemo(() => {
    const linkedIds = new Set(
      links
        .filter(
          (l) =>
            (l.from.type === 'asset' && l.to.id === entity.id) ||
            (l.to.type === 'asset' && l.from.id === entity.id),
        )
        .map((l) => (l.from.type === 'asset' ? l.from.id : l.to.id)),
    );
    return assets.filter((a) => linkedIds.has(a.id));
  }, [assets, links, entity.id]);

  const upload = async (file: File) => {
    const id = addAsset({ name: file.name, mime: file.type || 'application/octet-stream', size: file.size }, entity);
    await putAssetBlob(id, file, file.name);
  };

  return (
    <div className="space-y-2">
      {mine.map((a) => (
        <AssetRow
          key={a.id}
          asset={a}
          onDelete={() => deleteWithUndo(() => deleteAsset(a.id))}
        />
      ))}
      <button onClick={() => fileRef.current?.click()} className={btnGhost}>
        <Paperclip size={14} /> Attach file
      </button>
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        aria-label="Attach a file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

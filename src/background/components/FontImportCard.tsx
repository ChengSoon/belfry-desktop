import { FileType2, Trash2, Upload } from "lucide-react";
import { ICON } from "../../theme/sizing";
import type { ImportedFontAsset } from "../../typography/contracts";
import "./fontImportCard.css";

const FONT_IMPORT_DETAIL_ID = "font-import-detail";

interface FontImportCardProps {
  activeFileName: string | null;
  assets: ImportedFontAsset[];
  busy: boolean;
  error: string | null;
  onClear: (fileName: string) => Promise<void>;
  onPick: () => Promise<void>;
}

export function FontImportCard(props: FontImportCardProps) {
  const { activeFileName, assets, busy, error, onClear, onPick } = props;
  const active = assets.find((asset) => asset.fileName === activeFileName) ?? null;
  return (
    <>
      <section aria-busy={busy} aria-label="导入字体" className="font-import-card">
        <span aria-hidden="true" className="font-import-card__icon">
          <FileType2 size={ICON.md} />
        </span>
        <span className="font-import-card__body">
          <span className="font-import-card__heading">
            <strong>导入字体文件</strong>
            {assets.length > 0 ? <small>已导入 {assets.length} 个</small> : null}
          </span>
          <small className="font-import-card__detail" id={FONT_IMPORT_DETAIL_ID}>
            TTF / OTF / WOFF / WOFF2 · 单个最大 30 MB
          </small>
        </span>
        <span className="font-import-card__actions">
          <button
            aria-describedby={FONT_IMPORT_DETAIL_ID}
            className="font-import-card__pick"
            disabled={busy}
            onClick={() => void onPick()}
            type="button"
          >
            <Upload aria-hidden="true" size={ICON.xs} />
            {busy ? "处理中…" : "导入字体"}
          </button>
          {active ? (
            <button
              aria-label={`删除当前字体 ${active.displayName}`}
              className="font-import-card__remove"
              disabled={busy}
              onClick={() => void onClear(active.fileName)}
              title={`删除当前字体 ${active.displayName}`}
              type="button"
            >
              <Trash2 aria-hidden="true" size={ICON.xs} />
            </button>
          ) : null}
        </span>
      </section>
      {error ? <p className="appearance__error appearance__font-error" role="alert">{error}</p> : null}
    </>
  );
}

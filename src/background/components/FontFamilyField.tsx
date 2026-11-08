import { t, useTranslation } from "../../i18n";
import { useCallback, useEffect, useState } from "react";
import { Combobox } from "../../components/controls/Combobox";
import {
  MAX_FONT_FAMILY_LENGTH,
  type ImportedFontAsset,
  type TypographyConfig,
  type TypographyController,
} from "../../typography/contracts";
import { findActiveImportedFont } from "../../typography/storage";

const FONT_UPDATE_DELAY = 250;
const FONT_SUGGESTIONS = [
  "JetBrains Mono",
  "Cascadia Mono",
  "Consolas",
  "SF Mono",
  "Fira Code",
  "Iosevka",
] as const;

export function useFontChoice(config: TypographyConfig, update: TypographyController["update"]) {
  useTranslation();
  const active = findActiveImportedFont(config);
  const selected = active?.displayName ?? config.fontFamily;
  const [value, setValue] = useState(selected);
  useEffect(() => setValue(selected), [selected]);

  const chooseValue = useCallback((next: string) => {
    const imported = config.importedFonts.find((font) => font.displayName === next);
    if (imported) update({ activeImportedFont: imported.fileName });
    else update({ activeImportedFont: null, fontFamily: next });
  }, [config.importedFonts, update]);

  useEffect(() => {
    if (value === selected) return;
    const timer = window.setTimeout(() => chooseValue(value), FONT_UPDATE_DELAY);
    return () => window.clearTimeout(timer);
  }, [chooseValue, selected, value]);

  const commit = () => {
    const normalized = value.replace(/\s+/g, " ").trim();
    setValue(normalized);
    if (normalized !== selected) chooseValue(normalized);
  };
  const selectDefault = () => {
    setValue("");
    update({ activeImportedFont: null, fontFamily: "" });
  };
  const selectImported = (fileName: string) => {
    const font = config.importedFonts.find((item) => item.fileName === fileName);
    if (!font) return;
    setValue(font.displayName);
    update({ activeImportedFont: font.fileName });
  };
  const selectSystem = (fontFamily: string) => {
    setValue(fontFamily);
    update({ activeImportedFont: null, fontFamily });
  };
  return { value, setValue, commit, selectDefault, selectImported, selectSystem };
}

interface FontFamilyFieldProps {
  activeImportedFileName: string | null;
  importedFonts: ImportedFontAsset[];
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onSelectDefault: () => void;
  onSelectImported: (fileName: string) => void;
  onSelectSystem: (fontFamily: string) => void;
}

export function FontFamilyField(props: FontFamilyFieldProps) {
  useTranslation();
  const options = fontOptions(props.importedFonts);
  const selectedValue = props.activeImportedFileName ?? (props.value ? `system-${props.value}` : "default");
  return <label className="appearance__row appearance__row--wide"><span className="appearance__label">{t("background.FontFamilyField.text_078838da42")}</span>
    <Combobox ariaLabel={t("background.FontFamilyField.text_078838da42")} value={props.value} selectedValue={selectedValue} placeholder={t("background.FontFamilyField.text_04b7708368")}
      maxLength={MAX_FONT_FAMILY_LENGTH} onChange={props.onChange} onCommit={props.onCommit}
      onSelect={(key) => selectFontOption(options.find((option) => option.key === key), props)}
      options={options.map((option) => ({ value: option.key, label: option.label, description: option.detail }))} />
  </label>;
}

function selectFontOption(option: FontOption | undefined, props: FontFamilyFieldProps) {
  if (!option) return;
  if (option.kind === "default") props.onSelectDefault();
  else if (option.kind === "imported") props.onSelectImported(option.fileName);
  else props.onSelectSystem(option.label);
}

interface FontOption {
  key: string;
  kind: "default" | "imported" | "system";
  label: string;
  detail: string;
  fileName: string;
}

function fontOptions(importedFonts: ImportedFontAsset[]): FontOption[] {
  const options: FontOption[] = [{
    key: "default",
    kind: "default",
    label: t("background.FontFamilyField.text_04b7708368"),
    detail: t("background.FontFamilyField.text_5693b493d1"),
    fileName: "",
  }];
  for (const font of importedFonts) {
    const format = font.fileName.split(".").at(-1)?.toUpperCase() ?? "FONT";
    options.push({
      key: font.fileName,
      kind: "imported",
      label: font.displayName,
      detail: t("background.FontFamilyField.text_5c2ca41fbf", { format: format }),
      fileName: font.fileName,
    });
  }
  for (const font of FONT_SUGGESTIONS) {
    if (importedFonts.some((item) => item.displayName === font)) continue;
    options.push({ key: `system-${font}`, kind: "system", label: font, detail: t("background.FontFamilyField.text_6663f4edaf"), fileName: "" });
  }
  return options;
}

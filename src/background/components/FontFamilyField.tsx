import { Check, ChevronDown, FileType2, Monitor, Type } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { ICON } from "../../theme/sizing";
import {
  MAX_FONT_FAMILY_LENGTH,
  type ImportedFontAsset,
  type TypographyConfig,
  type TypographyController,
} from "../../typography/contracts";
import { findActiveImportedFont } from "../../typography/storage";
import "./fontFamilyField.css";
import { useFontDropdown } from "./useFontDropdown";

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
  const { activeImportedFileName, importedFonts, value } = props;
  const listId = useId();
  const labelId = useId();
  const options = fontOptions(importedFonts);
  const selectedIndex = selectedOptionIndex(options, activeImportedFileName, value);
  const chooseAt = (index: number) => selectFontOption(options[index], props);
  const dropdown = useFontDropdown({
    optionCount: options.length,
    selectedIndex,
    onCommit: props.onCommit,
    onSelect: chooseAt,
  });
  const changeValue = (next: string) => { props.onChange(next); dropdown.openForTyping(); };

  return (
    <div className="appearance__row appearance__row--wide">
      <span className="appearance__label" id={labelId}>字体</span>
      <div className="font-combobox" onBlur={dropdown.onBlur} ref={dropdown.rootRef}>
        <FontInput
          activeDescendant={dropdown.activeId(listId)}
          activeImported={activeImportedFileName !== null}
          expanded={dropdown.open}
          inputRef={dropdown.inputRef}
          labelId={labelId}
          listId={listId}
          onChange={changeValue}
          onFocus={dropdown.openMenu}
          onKeyDown={dropdown.onKeyDown}
          value={value}
        />
        <button
          aria-label={dropdown.open ? "收起字体选项" : "展开字体选项"}
          className={`font-combobox__toggle${dropdown.open ? " is-open" : ""}`}
          onClick={dropdown.toggle}
          type="button"
        >
          <ChevronDown aria-hidden="true" size={ICON.sm} />
        </button>
        {dropdown.open ? (
          <FontOptions
            activeIndex={dropdown.activeIndex}
            listId={listId}
            onHover={dropdown.setActiveIndex}
            onSelect={dropdown.select}
            options={options}
            selectedIndex={selectedIndex}
          />
        ) : null}
      </div>
    </div>
  );
}

function selectFontOption(option: FontOption | undefined, props: FontFamilyFieldProps) {
  if (!option) return;
  if (option.kind === "default") props.onSelectDefault();
  else if (option.kind === "imported") props.onSelectImported(option.fileName);
  else props.onSelectSystem(option.label);
}

interface FontInputProps {
  activeDescendant: string | undefined;
  activeImported: boolean;
  expanded: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  labelId: string;
  listId: string;
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

function FontInput(props: FontInputProps) {
  return (
    <input
      aria-activedescendant={props.activeDescendant}
      aria-autocomplete="list"
      aria-controls={props.listId}
      aria-expanded={props.expanded}
      aria-labelledby={props.labelId}
      autoComplete="off"
      className={`appearance__font-input${props.activeImported ? " is-imported" : ""}`}
      maxLength={MAX_FONT_FAMILY_LENGTH}
      onChange={(event) => props.onChange(event.target.value)}
      onFocus={props.onFocus}
      onKeyDown={props.onKeyDown}
      placeholder="系统默认"
      ref={props.inputRef}
      role="combobox"
      spellCheck={false}
      type="text"
      value={props.value}
    />
  );
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
    label: "系统默认",
    detail: "应用内置字体栈",
    fileName: "",
  }];
  for (const font of importedFonts) {
    const format = font.fileName.split(".").at(-1)?.toUpperCase() ?? "FONT";
    options.push({
      key: font.fileName,
      kind: "imported",
      label: font.displayName,
      detail: `已导入 · ${format}`,
      fileName: font.fileName,
    });
  }
  for (const font of FONT_SUGGESTIONS) {
    if (importedFonts.some((item) => item.displayName === font)) continue;
    options.push({ key: `system-${font}`, kind: "system", label: font, detail: "系统字体建议", fileName: "" });
  }
  return options;
}

function selectedOptionIndex(options: FontOption[], activeFileName: string | null, value: string) {
  if (activeFileName) return options.findIndex((option) => option.fileName === activeFileName);
  if (!value) return 0;
  return options.findIndex((option) => option.kind === "system" && option.label === value);
}

interface FontOptionsProps {
  activeIndex: number;
  listId: string;
  options: FontOption[];
  selectedIndex: number;
  onHover: (index: number) => void;
  onSelect: (index: number) => void;
}

function FontOptions(props: FontOptionsProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menuRef.current?.children.item(props.activeIndex)?.scrollIntoView({ block: "nearest" });
  }, [props.activeIndex]);
  return (
    <div className="font-combobox__menu" id={props.listId} ref={menuRef} role="listbox">
      {props.options.map((option, index) => (
        <button
          aria-selected={index === props.selectedIndex}
          className={`font-combobox__option${index === props.activeIndex ? " is-active" : ""}`}
          id={`${props.listId}-option-${index}`}
          key={option.key}
          onClick={() => props.onSelect(index)}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => props.onHover(index)}
          role="option"
          type="button"
        >
          <FontOptionIcon kind={option.kind} />
          <span><strong>{option.label}</strong><small>{option.detail}</small></span>
          {index === props.selectedIndex ? <Check aria-hidden="true" size={ICON.sm} /> : null}
        </button>
      ))}
    </div>
  );
}

function FontOptionIcon({ kind }: { kind: FontOption["kind"] }) {
  if (kind === "default") return <Monitor aria-hidden="true" size={ICON.sm} />;
  if (kind === "imported") return <FileType2 aria-hidden="true" size={ICON.sm} />;
  return <Type aria-hidden="true" size={ICON.sm} />;
}

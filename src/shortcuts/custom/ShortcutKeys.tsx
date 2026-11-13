/** 键帽：每个键单独一个 kbd（曜石 T19）；整组读作完整组合键。 */
export function ShortcutKeys({ chord }: { chord: string[] }) {
  return <span className="shortcut-keys" aria-label={chord.join("+")} role="img">{chord.map((key, index) => <kbd key={index}>{key}</kbd>)}</span>;
}

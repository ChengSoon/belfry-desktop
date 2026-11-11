import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { useTranslation } from "../../i18n";
import { readProjectProviders } from "../../provider/project/api";
import { toAppFailure } from "../../workspace/errors";
import { roomSetMemberModel } from "../api";
import type { Room, RoomMember } from "../contracts";
import type { RoomsState } from "../useRooms";

/** member 保留打开表单时的快照，轮询不能悄悄改变保存时的比较条件。 */
export function RoleModelDialog({ room, member, rooms, onClose }: {
  room: Room; member: RoomMember; rooms: RoomsState; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState(member.modelOverride ? "override" : "inherit");
  const [model, setModel] = useState(member.modelOverride ?? "");
  const [suggestions, setSuggestions] = useState<{ value: string; label: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const alive = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    alive.current = true;
    let current = true;
    void readProjectProviders(room.projectRoot).then((report) => {
      if (!current) return;
      const choices = report.agents.find((agent) => agent.kind === member.agent)?.choices ?? [];
      const models = [...new Set(choices.map((choice) => choice.model.trim()).filter(Boolean))];
      setSuggestions(models.map((value) => ({ value, label: value })));
    }).catch(() => { /* 候选不可用时仍允许输入当前供应商支持的模型。 */ });
    return () => { current = false; alive.current = false; };
  }, [room.projectRoot, member.agent]);

  const trimmed = model.trim();
  const invalid = mode === "override" && (!trimmed || [...trimmed].length > 256 || /[\s\p{Cc}]/u.test(trimmed));
  const changed = (mode === "inherit" ? null : trimmed) !== (member.modelOverride ?? null);
  const save = async () => {
    if (inFlight.current || invalid || !changed) return;
    inFlight.current = true;
    setSaving(true);
    setFailure(null);
    const result = await rooms.run(async () => {
      try {
        return await roomSetMemberModel(room.id, member, mode === "inherit" ? null : trimmed);
      } catch (cause) {
        if (alive.current) setFailure(() => cause);
        throw cause;
      }
    });
    inFlight.current = false;
    if (!alive.current) return;
    setSaving(false);
    if (result) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !inFlight.current) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="break-words leading-snug">{t("rooms.roleModel.title", { title: member.title })}</DialogTitle>
          <DialogDescription>{t("rooms.roleModel.description")}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className="grid gap-2">
            <Label htmlFor="role-model-mode">{t("rooms.roleModel.mode")}</Label>
            <Select value={mode} disabled={saving} onValueChange={(value) => { setMode(value); setFailure(null); }}>
              <SelectTrigger className="w-full" id="role-model-mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit">{t("rooms.roleModel.inherit")}</SelectItem>
                <SelectItem value="override">{t("rooms.roleModel.override")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mode === "override" ? (
            <div className="grid min-w-0 gap-2">
              <Label htmlFor="role-model-id">{t("rooms.roleModel.model")}</Label>
              <div className="flex min-w-0 gap-1">
                <Input id="role-model-id" aria-label={t("rooms.roleModel.model")} disabled={saving} required maxLength={256}
                  autoComplete="off" spellCheck={false} value={model} placeholder={t("rooms.roleModel.placeholder")}
                  onChange={(event) => { setModel(event.target.value); setFailure(null); }} />
                {suggestions.length ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" size="icon" variant="outline" disabled={saving} aria-label={t("rooms.roleModel.suggestions")}><ChevronDown /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="max-w-[calc(100vw-3rem)]">
                      {suggestions.map((option) => <DropdownMenuItem key={option.value} onSelect={() => { setModel(option.value); setFailure(null); }}>
                        <span className="truncate" title={option.value}>{option.label}</span>
                      </DropdownMenuItem>)}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{t("rooms.roleModel.modelHint")}</p>
              {trimmed && invalid ? <p className="text-sm text-destructive" role="alert">{t("rooms.roleModel.invalid")}</p> : null}
            </div>
          ) : <p className="text-sm leading-relaxed text-muted-foreground">{t("rooms.roleModel.inheritHint")}</p>}
          <p className="text-sm leading-relaxed text-muted-foreground">{t("rooms.roleModel.nextLaunch")}</p>
          {failure ? <p className="break-words text-sm text-destructive" role="alert">{toAppFailure(failure).message}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>{t("rooms.roleModel.cancel")}</Button>
            <Button type="submit" disabled={saving || invalid || !changed}>{t(saving ? "rooms.roleModel.saving" : "rooms.roleModel.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

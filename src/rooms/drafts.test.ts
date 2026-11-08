import { expect, it } from "vitest";
import { forgetRoomDraft, roomDraft, type DraftAttachment } from "./drafts";

const attachment = (id: string): DraftAttachment => ({ key: id, sourceKey: id, name: id,
  attachment: { id, name: id, path: `/tmp/${id}`, size: 2, mimeType: "text/plain" } });

it("clears only the submitted fields and files, even when the draft has no subscriber", () => {
  const store = roomDraft("send-new-input");
  store.update({ text: "submitted", ask: false, items: [attachment("old")] });
  const snapshot = store.beginSend()!;
  store.update({ text: "new input", to: "new recipient", items: [...store.getSnapshot().items, attachment("new")] });
  expect(store.beginSend()).toBeNull();
  store.finishSend(snapshot, true);
  expect(store.getSnapshot()).toMatchObject({ text: "new input", to: "new recipient", sending: false, ask: true });
  expect(store.getSnapshot().items.map((item) => item.key)).toEqual(["new"]);
});

it("uses edit revisions so editing back to the same text does not clear the new draft", () => {
  const store = roomDraft("edit-back");
  store.update({ text: "same" });
  const snapshot = store.beginSend()!;
  store.update({ text: "different" });
  store.update({ text: "same" });
  store.finishSend(snapshot, true);
  expect(store.getSnapshot().text).toBe("same");
});

it("retains failed submissions and clears an untouched draft after explicit retry succeeds", () => {
  const store = roomDraft("retry");
  store.update({ text: "retry me", ask: false, items: [attachment("retry-file")] });
  const failed = store.beginSend()!;
  store.finishSend(failed, false);
  expect(store.getSnapshot()).toMatchObject({ text: "retry me", ask: false, sending: false });
  expect(store.getSnapshot().items).toHaveLength(1);
  const retry = store.beginSend()!;
  store.finishSend(failed, true);
  expect(store.getSnapshot().sending).toBe(true);
  store.finishSend(retry, true);
  expect(store.getSnapshot()).toMatchObject({ text: "", ask: true, items: [], sending: false });
});

it("deleting a room invalidates its old draft without recreating it on a late completion", () => {
  const old = roomDraft("deleted");
  old.update({ text: "old" });
  const snapshot = old.beginSend()!;
  forgetRoomDraft("deleted");
  old.finishSend(snapshot, false);
  expect(roomDraft("deleted").getSnapshot().text).toBe("");
  expect(old.disposed).toBe(true);
});

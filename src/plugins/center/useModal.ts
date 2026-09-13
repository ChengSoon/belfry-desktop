import { useDialog } from "../../components/controls/useDialog";

export function useModal(close: () => void, disabled = false) {
  return useDialog(close, disabled);
}

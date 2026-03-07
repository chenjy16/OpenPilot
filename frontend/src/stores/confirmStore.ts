import { create } from 'zustand';

interface ConfirmRequest {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

interface ConfirmState {
  request: ConfirmRequest | null;
  show: (req: ConfirmRequest) => void;
  close: () => void;
}

export const useConfirmStore = create<ConfirmState>((set) => ({
  request: null,
  show: (req) => set({ request: req }),
  close: () => set({ request: null }),
}));

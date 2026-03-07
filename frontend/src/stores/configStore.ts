import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ConfigState {
  selectedModel: string;
  setModel: (model: string) => void;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      selectedModel: 'gpt-3.5-turbo',
      setModel: (model: string) => set({ selectedModel: model }),
    }),
    { name: 'ai-assistant-config' }
  )
);

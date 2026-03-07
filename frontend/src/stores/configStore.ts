import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ConfigState {
  selectedModel: string;
  setModel: (model: string) => void;
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      selectedModel: 'google/gemini-2.0-flash',
      setModel: (model: string) => set({ selectedModel: model }),
    }),
    { name: 'ai-assistant-config' }
  )
);

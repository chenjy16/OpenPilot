import React, { useState, useEffect } from 'react';
import { useConfigStore } from '../../stores/configStore';
import { get } from '../../services/apiClient';

interface ModelCatalogEntry {
  ref: string;
  provider: string;
  modelId: string;
  name: string;
  api: string;
  reasoning: boolean;
  input: string[];
  contextWindow: number;
  maxTokens: number;
  cost: { input: number; output: number };
  configured: boolean;
  providerLabel?: string;
}

// Fallback for when API is unavailable
const FALLBACK_MODELS = [
  { ref: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai' },
  { ref: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' },
  { ref: 'anthropic/claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic' },
  { ref: 'openai/gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'openai' },
];

const ModelSelector: React.FC = () => {
  const selectedModel = useConfigStore((s) => s.selectedModel);
  const setModel = useConfigStore((s) => s.setModel);
  const [models, setModels] = useState<ModelCatalogEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    get<ModelCatalogEntry[]>('/models/configured')
      .then((data) => { setModels(data); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  // Group by provider
  const grouped = new Map<string, ModelCatalogEntry[]>();
  const items = loaded && models.length > 0 ? models : FALLBACK_MODELS as any[];
  for (const m of items) {
    const key = m.providerLabel ?? m.provider;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(m);
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="model-selector" className="text-sm font-medium text-gray-700">
        模型
      </label>
      <select
        id="model-selector"
        value={selectedModel}
        onChange={(e) => setModel(e.target.value)}
        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        {[...grouped.entries()].map(([provider, providerModels]) => (
          <optgroup key={provider} label={provider}>
            {providerModels.map((m) => (
              <option key={m.ref} value={m.ref}>
                {m.name}{m.reasoning ? ' 🧠' : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
};

export default ModelSelector;

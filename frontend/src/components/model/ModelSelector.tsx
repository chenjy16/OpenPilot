import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
  { ref: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google' },
  { ref: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google' },
  { ref: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai' },
  { ref: 'anthropic/claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic' },
];

const ModelSelector: React.FC = () => {
  const { t } = useTranslation();
  const selectedModel = useConfigStore((s) => s.selectedModel);
  const setModel = useConfigStore((s) => s.setModel);
  const [models, setModels] = useState<ModelCatalogEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      get<ModelCatalogEntry[]>('/models/configured').catch(() => []),
      get<Record<string, any>>('/config').catch(() => null),
    ]).then(([data, config]) => {
      setModels(data);
      setLoaded(true);
      // Sync with config default: if config has a different primary model and it's available, use it
      const configDefault = config?.agents?.defaults?.model?.primary;
      if (configDefault && data.some((m: any) => m.ref === configDefault) && configDefault !== selectedModel) {
        setModel(configDefault);
      }
      // If current selection is a legacy/unavailable model, switch to config default or first configured
      else if (data.length > 0 && !data.some(m => m.ref === selectedModel)) {
        const best = (configDefault && data.some((m: any) => m.ref === configDefault))
          ? configDefault
          : data[0].ref;
        setModel(best);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        {t('model.label')}
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

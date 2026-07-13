export type PanelId =
  | 'code'
  | 'inputs'
  | 'data'
  | 'variables'
  | 'watch'
  | 'callStack'
  | 'explainer'
  | 'console';
export type ColumnId = 'left' | 'center' | 'right';

export type PanelVisibility = Record<PanelId, boolean>;
export type ColumnWeights = Record<ColumnId, number>;
export type PanelWeights = Record<PanelId, number>;

export type PanelDefinition = {
  id: PanelId;
  label: string;
};

export const PANEL_DEFINITIONS: PanelDefinition[] = [
  { id: 'code', label: 'Code' },
  { id: 'inputs', label: 'Test inputs' },
  { id: 'data', label: 'Data' },
  { id: 'variables', label: 'Variables' },
  { id: 'watch', label: 'Watch' },
  { id: 'callStack', label: 'Call stack' },
  { id: 'explainer', label: 'Explainer' },
  { id: 'console', label: 'Console' },
];

export const DEFAULT_PANEL_VISIBILITY: PanelVisibility = {
  code: true,
  // This panel is still rendered only for Python function mode, so enabling
  // it by default reveals inputs contextually without adding script-mode UI.
  inputs: true,
  data: true,
  variables: true,
  watch: false,
  callStack: true,
  explainer: false,
  console: true,
};

export const FULL_PANEL_VISIBILITY: PanelVisibility = {
  code: true,
  inputs: true,
  data: true,
  variables: true,
  watch: true,
  callStack: true,
  explainer: true,
  console: true,
};

export const DEFAULT_COLUMN_WEIGHTS: ColumnWeights = {
  left: 1.05,
  center: 1.35,
  right: 1,
};

export const DEFAULT_PANEL_WEIGHTS: PanelWeights = {
  code: 1,
  inputs: 0.55,
  data: 1,
  variables: 1.2,
  watch: 1,
  callStack: 0.9,
  explainer: 1,
  console: 1.1,
};

export function normalizePanelVisibility(value: unknown): PanelVisibility {
  const stored = isRecord(value) ? value : {};
  return Object.fromEntries(
    PANEL_DEFINITIONS.map((panel) => [
      panel.id,
      typeof stored[panel.id] === 'boolean' ? stored[panel.id] : DEFAULT_PANEL_VISIBILITY[panel.id],
    ]),
  ) as PanelVisibility;
}

export function normalizeWeights<T extends string>(
  value: unknown,
  defaults: Record<T, number>,
): Record<T, number> {
  const stored = isRecord(value) ? value : {};
  return Object.fromEntries(
    Object.entries(defaults).map(([key, defaultValue]) => {
      const storedValue = stored[key];
      return [
        key,
        typeof storedValue === 'number' && Number.isFinite(storedValue) && storedValue > 0
          ? storedValue
          : defaultValue,
      ];
    }),
  ) as Record<T, number>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

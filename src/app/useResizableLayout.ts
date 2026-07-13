/**
 * Workbench layout state: which panels are visible, how wide each column
 * is, how tall each stacked panel is, and the pointer + keyboard machinery
 * for resizing them. Choices persist to localStorage outside embed mode.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  DEFAULT_COLUMN_WEIGHTS,
  DEFAULT_PANEL_VISIBILITY,
  DEFAULT_PANEL_WEIGHTS,
  FULL_PANEL_VISIBILITY,
  PANEL_DEFINITIONS,
  normalizePanelVisibility,
  normalizeWeights,
  type ColumnId,
  type ColumnWeights,
  type PanelId,
  type PanelVisibility,
  type PanelWeights,
} from './layoutState';

const PANEL_VISIBILITY_STORAGE_KEY = 'cv-panel-visibility-v2';
const LEGACY_PANEL_VISIBILITY_STORAGE_KEY = 'cv-panel-visibility-v1';
const COLUMN_WEIGHTS_STORAGE_KEY = 'cv-column-weights-v1';
const PANEL_WEIGHTS_STORAGE_KEY = 'cv-panel-weights-v1';

const COLUMN_MIN_WIDTHS: Record<ColumnId, number> = {
  left: 300,
  center: 320,
  right: 280,
};

const PANEL_MIN_HEIGHT = 92;
const KEYBOARD_RESIZE_STEP = 24;

const DEFAULT_EMBED_PANEL_VISIBILITY: PanelVisibility = {
  code: true,
  inputs: true,
  data: true,
  variables: false,
  watch: false,
  callStack: true,
  explainer: false,
  console: true,
};

function readStoredValue<T>(key: string, fallback: T, normalize: (value: unknown) => T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? normalize(JSON.parse(raw)) : fallback;
  } catch {
    return fallback;
  }
}

function saveStoredValue(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* local storage unavailable */
  }
}

export function readStoredPanelVisibility(): PanelVisibility {
  try {
    const current = window.localStorage.getItem(PANEL_VISIBILITY_STORAGE_KEY);
    if (current) {
      return normalizePanelVisibility(JSON.parse(current));
    }

    const legacy = window.localStorage.getItem(LEGACY_PANEL_VISIBILITY_STORAGE_KEY);
    if (legacy) {
      // Inputs used to default to hidden. Reveal them once during migration,
      // while preserving every other layout choice from the previous schema.
      return { ...normalizePanelVisibility(JSON.parse(legacy)), inputs: true };
    }
  } catch {
    /* stored layout unavailable or malformed */
  }
  return { ...DEFAULT_PANEL_VISIBILITY };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/* Snapshot rendered sizes so a resize only redistributes space between the
   two adjacent tracks while every other track keeps its pixel size. */
function measuredColumnWidths(
  refs: Record<ColumnId, HTMLDivElement | null>,
): Partial<ColumnWeights> {
  return Object.fromEntries(
    Object.entries(refs)
      .map(([columnId, node]) => [columnId, node?.getBoundingClientRect().width])
      .filter((entry): entry is [ColumnId, number] => typeof entry[1] === 'number'),
  ) as Partial<ColumnWeights>;
}

function measuredPanelHeights(
  refs: Partial<Record<PanelId, HTMLDivElement | null>>,
): Partial<PanelWeights> {
  return Object.fromEntries(
    Object.entries(refs)
      .map(([panelId, node]) => [panelId, node?.getBoundingClientRect().height])
      .filter((entry): entry is [PanelId, number] => typeof entry[1] === 'number'),
  ) as Partial<PanelWeights>;
}

function isPanelId(id: string): id is PanelId {
  return PANEL_DEFINITIONS.some((panel) => panel.id === id);
}

function columnTrack(columnId: ColumnId, weights: ColumnWeights): string {
  return `minmax(${COLUMN_MIN_WIDTHS[columnId]}px, ${weights[columnId]}fr)`;
}

function workbenchColumns(columnIds: readonly ColumnId[], weights: ColumnWeights): string {
  if (columnIds.length === 0) {
    return '1fr';
  }
  return columnIds
    .flatMap((columnId, index) =>
      index === 0 ? [columnTrack(columnId, weights)] : ['10px', columnTrack(columnId, weights)],
    )
    .join(' ');
}

export function useResizableLayout(embedMode: boolean) {
  const [panelVisibility, setPanelVisibility] = useState<PanelVisibility>(() =>
    embedMode
      ? { ...DEFAULT_EMBED_PANEL_VISIBILITY }
      : readStoredPanelVisibility(),
  );
  const [columnWeights, setColumnWeights] = useState<ColumnWeights>(() =>
    embedMode
      ? { ...DEFAULT_COLUMN_WEIGHTS }
      : readStoredValue(COLUMN_WEIGHTS_STORAGE_KEY, DEFAULT_COLUMN_WEIGHTS, (value) =>
          normalizeWeights(value, DEFAULT_COLUMN_WEIGHTS),
        ),
  );
  const [panelWeights, setPanelWeights] = useState<PanelWeights>(() =>
    embedMode
      ? { ...DEFAULT_PANEL_WEIGHTS }
      : readStoredValue(PANEL_WEIGHTS_STORAGE_KEY, DEFAULT_PANEL_WEIGHTS, (value) =>
          normalizeWeights(value, DEFAULT_PANEL_WEIGHTS),
        ),
  );
  const columnRefs = useRef<Record<ColumnId, HTMLDivElement | null>>({
    left: null,
    center: null,
    right: null,
  });
  const panelSlotRefs = useRef<Partial<Record<PanelId, HTMLDivElement | null>>>({});

  useEffect(() => {
    if (!embedMode) {
      saveStoredValue(PANEL_VISIBILITY_STORAGE_KEY, panelVisibility);
    }
  }, [embedMode, panelVisibility]);

  useEffect(() => {
    if (!embedMode) {
      saveStoredValue(COLUMN_WEIGHTS_STORAGE_KEY, columnWeights);
    }
  }, [columnWeights, embedMode]);

  useEffect(() => {
    if (!embedMode) {
      saveStoredValue(PANEL_WEIGHTS_STORAGE_KEY, panelWeights);
    }
  }, [embedMode, panelWeights]);

  const registerColumn = useCallback((columnId: ColumnId, node: HTMLDivElement | null) => {
    columnRefs.current[columnId] = node;
  }, []);

  const registerPanelSlot = useCallback((panelId: PanelId, node: HTMLDivElement | null) => {
    panelSlotRefs.current[panelId] = node;
  }, []);

  const togglePanelVisibility = useCallback((id: string, visible: boolean) => {
    if (!isPanelId(id)) {
      return;
    }
    setPanelVisibility((current) => ({ ...current, [id]: visible }));
  }, []);

  const resetLayout = useCallback(() => {
    setPanelVisibility(
      embedMode ? { ...DEFAULT_EMBED_PANEL_VISIBILITY } : { ...DEFAULT_PANEL_VISIBILITY },
    );
    setColumnWeights({ ...DEFAULT_COLUMN_WEIGHTS });
    setPanelWeights({ ...DEFAULT_PANEL_WEIGHTS });
  }, [embedMode]);

  const showAllPanels = useCallback(() => {
    setPanelVisibility(
      embedMode ? { ...DEFAULT_EMBED_PANEL_VISIBILITY } : { ...FULL_PANEL_VISIBILITY },
    );
    setColumnWeights({ ...DEFAULT_COLUMN_WEIGHTS });
    setPanelWeights({ ...DEFAULT_PANEL_WEIGHTS });
  }, [embedMode]);

  const startColumnResize = useCallback(
    (beforeColumn: ColumnId, afterColumn: ColumnId, event: ReactPointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      const beforeNode = columnRefs.current[beforeColumn];
      const afterNode = columnRefs.current[afterColumn];
      if (!beforeNode || !afterNode) {
        return;
      }

      event.preventDefault();
      const startX = event.clientX;
      const startBefore = beforeNode.getBoundingClientRect().width;
      const startAfter = afterNode.getBoundingClientRect().width;
      const startWidths = measuredColumnWidths(columnRefs.current);
      const total = startBefore + startAfter;
      const beforeMin = Math.min(COLUMN_MIN_WIDTHS[beforeColumn], total / 2);
      const afterMin = Math.min(COLUMN_MIN_WIDTHS[afterColumn], total / 2);
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const handleMove = (moveEvent: PointerEvent) => {
        const beforeWidth = clamp(
          startBefore + moveEvent.clientX - startX,
          beforeMin,
          total - afterMin,
        );
        setColumnWeights((current) => ({
          ...current,
          ...startWidths,
          [beforeColumn]: beforeWidth,
          [afterColumn]: total - beforeWidth,
        }));
      };

      const stopResize = () => {
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', stopResize);
        window.removeEventListener('pointercancel', stopResize);
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', stopResize);
      window.addEventListener('pointercancel', stopResize);
    },
    [],
  );

  const startPanelResize = useCallback(
    (beforePanel: PanelId, afterPanel: PanelId, event: ReactPointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      const beforeNode = panelSlotRefs.current[beforePanel];
      const afterNode = panelSlotRefs.current[afterPanel];
      if (!beforeNode || !afterNode) {
        return;
      }

      event.preventDefault();
      const startY = event.clientY;
      const startBefore = beforeNode.getBoundingClientRect().height;
      const startAfter = afterNode.getBoundingClientRect().height;
      const startHeights = measuredPanelHeights(panelSlotRefs.current);
      const total = startBefore + startAfter;
      const minHeight = Math.min(PANEL_MIN_HEIGHT, total / 2);
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;

      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';

      const handleMove = (moveEvent: PointerEvent) => {
        const beforeHeight = clamp(
          startBefore + moveEvent.clientY - startY,
          minHeight,
          total - minHeight,
        );
        setPanelWeights((current) => ({
          ...current,
          ...startHeights,
          [beforePanel]: beforeHeight,
          [afterPanel]: total - beforeHeight,
        }));
      };

      const stopResize = () => {
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', stopResize);
        window.removeEventListener('pointercancel', stopResize);
      };

      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', stopResize);
      window.addEventListener('pointercancel', stopResize);
    },
    [],
  );

  // Keyboard equivalents of the drag resizers (arrow keys on the focused
  // separator): shift space between the two adjacent tracks in fixed steps.
  const adjustColumnPair = useCallback(
    (beforeColumn: ColumnId, afterColumn: ColumnId, direction: -1 | 1) => {
      const beforeNode = columnRefs.current[beforeColumn];
      const afterNode = columnRefs.current[afterColumn];
      if (!beforeNode || !afterNode) {
        return;
      }
      const startBefore = beforeNode.getBoundingClientRect().width;
      const startAfter = afterNode.getBoundingClientRect().width;
      const startWidths = measuredColumnWidths(columnRefs.current);
      const total = startBefore + startAfter;
      const beforeMin = Math.min(COLUMN_MIN_WIDTHS[beforeColumn], total / 2);
      const afterMin = Math.min(COLUMN_MIN_WIDTHS[afterColumn], total / 2);
      const beforeWidth = clamp(
        startBefore + direction * KEYBOARD_RESIZE_STEP,
        beforeMin,
        total - afterMin,
      );
      setColumnWeights((current) => ({
        ...current,
        ...startWidths,
        [beforeColumn]: beforeWidth,
        [afterColumn]: total - beforeWidth,
      }));
    },
    [],
  );

  const adjustPanelPair = useCallback(
    (beforePanel: PanelId, afterPanel: PanelId, direction: -1 | 1) => {
      const beforeNode = panelSlotRefs.current[beforePanel];
      const afterNode = panelSlotRefs.current[afterPanel];
      if (!beforeNode || !afterNode) {
        return;
      }
      const startBefore = beforeNode.getBoundingClientRect().height;
      const startAfter = afterNode.getBoundingClientRect().height;
      const startHeights = measuredPanelHeights(panelSlotRefs.current);
      const total = startBefore + startAfter;
      const minHeight = Math.min(PANEL_MIN_HEIGHT, total / 2);
      const beforeHeight = clamp(
        startBefore + direction * KEYBOARD_RESIZE_STEP,
        minHeight,
        total - minHeight,
      );
      setPanelWeights((current) => ({
        ...current,
        ...startHeights,
        [beforePanel]: beforeHeight,
        [afterPanel]: total - beforeHeight,
      }));
    },
    [],
  );

  const columnsTemplate = useCallback(
    (columnIds: readonly ColumnId[]) => workbenchColumns(columnIds, columnWeights),
    [columnWeights],
  );

  const panelControls = useMemo(
    () =>
      PANEL_DEFINITIONS.map((panel) => ({
        ...panel,
        visible: panelVisibility[panel.id],
      })),
    [panelVisibility],
  );

  return {
    adjustColumnPair,
    adjustPanelPair,
    columnsTemplate,
    panelControls,
    panelVisibility,
    panelWeights,
    registerColumn,
    registerPanelSlot,
    resetLayout,
    showAllPanels,
    startColumnResize,
    startPanelResize,
    togglePanelVisibility,
  };
}

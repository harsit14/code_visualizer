import { useCallback, useEffect, useRef, useState } from 'react';
import type { Language, SessionResult } from '../engine/types';
import { buildIframeEmbedCode, encodeShareState } from './shareState';
import { MAX_TRACE_FILE_BYTES, parseTraceImport } from './traceImport';
import { buildTraceSvgExport } from './traceSvgExport';

const EXPORT_VERSION = 2;
const DEFAULT_IMPORT_LABEL = 'Import';
const DEFAULT_IMPORT_TITLE = 'Import a previously exported trace';
const EMBED_SEARCH_PARAM = 'embed';

type ImportedTrace = {
  code: string;
  language: Language;
  result: SessionResult;
  step: number;
};

type UseTraceTransferOptions = {
  code: string;
  exampleId: string | null;
  functionOverride: string | null;
  inputLiterals: string[] | undefined;
  language: Language;
  onImportTrace: (trace: ImportedTrace) => void;
  result: SessionResult | null;
  seed: number | null;
  step: number;
};

export function useTraceTransfer({
  code,
  exampleId,
  functionOverride,
  inputLiterals,
  language,
  onImportTrace,
  result,
  seed,
  step,
}: UseTraceTransferOptions) {
  const [shareLabel, setShareLabel] = useState('Share');
  const [embedLabel, setEmbedLabel] = useState('Embed');
  const [importError, setImportError] = useState<string | null>(null);
  const dismissImportError = useCallback(() => setImportError(null), []);
  const [importLabel, setImportLabel] = useState(DEFAULT_IMPORT_LABEL);
  const [importTitle, setImportTitle] = useState(DEFAULT_IMPORT_TITLE);
  const importSerial = useRef(0);
  const importStatusTimeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      importSerial.current += 1;
      if (importStatusTimeoutRef.current !== null) {
        window.clearTimeout(importStatusTimeoutRef.current);
      }
    },
    [],
  );

  const showImportStatus = useCallback((label: string, title: string) => {
    if (importStatusTimeoutRef.current !== null) {
      window.clearTimeout(importStatusTimeoutRef.current);
    }
    setImportError(label === 'Import failed' ? title : null);
    setImportLabel(label);
    setImportTitle(title);
    importStatusTimeoutRef.current = window.setTimeout(() => {
      setImportLabel(DEFAULT_IMPORT_LABEL);
      setImportTitle(DEFAULT_IMPORT_TITLE);
      importStatusTimeoutRef.current = null;
    }, 2200);
  }, []);

  const buildShareUrl = useCallback(
    (embed: boolean) => {
      const url = new URL(window.location.href);
      url.hash = encodeShareState({
        code,
        exampleId: exampleId ?? undefined,
        functionName: functionOverride ?? undefined,
        inputs: inputLiterals,
        language,
        seed: seed ?? undefined,
      });
      if (embed) {
        url.searchParams.set(EMBED_SEARCH_PARAM, '1');
      } else {
        url.searchParams.delete(EMBED_SEARCH_PARAM);
      }
      return url;
    },
    [code, exampleId, functionOverride, inputLiterals, language, seed],
  );

  const handleShare = useCallback(async () => {
    let url: URL;
    try {
      url = buildShareUrl(false);
    } catch {
      setShareLabel('Too large — export instead');
      window.setTimeout(() => setShareLabel('Share'), 3000);
      return;
    }
    window.history.replaceState(null, '', url);
    try {
      if (!navigator.clipboard) {
        throw new Error('Clipboard unavailable');
      }
      await navigator.clipboard.writeText(url.toString());
      setShareLabel('Copied!');
    } catch {
      setShareLabel('Link set');
    }
    window.setTimeout(() => setShareLabel('Share'), 1800);
  }, [buildShareUrl]);

  const handleEmbed = useCallback(async () => {
    let url: URL;
    try {
      url = buildShareUrl(true);
    } catch {
      setEmbedLabel('Too large — export instead');
      window.setTimeout(() => setEmbedLabel('Embed'), 3000);
      return;
    }
    const iframeCode = buildIframeEmbedCode(url.toString());
    try {
      if (!navigator.clipboard) {
        throw new Error('Clipboard unavailable');
      }
      await navigator.clipboard.writeText(iframeCode);
      setEmbedLabel('Copied!');
    } catch {
      setEmbedLabel('Copy failed');
    }
    window.setTimeout(() => setEmbedLabel('Embed'), 1800);
  }, [buildShareUrl]);

  const handleExport = useCallback(() => {
    if (!result) {
      return;
    }
    const payload = {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      code,
      step,
      result,
      language,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `code-visualizer-trace-${Date.now()}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [code, language, result, step]);

  const handleExportSvg = useCallback(() => {
    const exportData = buildTraceSvgExport(code, result);
    if (!exportData) {
      return;
    }
    const blob = new Blob([exportData.svg], {
      type: 'image/svg+xml;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = exportData.filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [code, result]);

  const handleImport = useCallback(
    (file: File) => {
      const serial = ++importSerial.current;
      setImportError(null);
      if (file.size > MAX_TRACE_FILE_BYTES) {
        showImportStatus('Import failed', 'Trace files must be no larger than 20 MB.');
        return;
      }
      void file
        .text()
        .then((text) => {
          if (serial !== importSerial.current) return;
          try {
            const trace = parseTraceImport(text);
            onImportTrace(trace);
            showImportStatus('Imported', 'Trace imported successfully');
          } catch (error) {
            showImportStatus(
              'Import failed',
              error instanceof Error ? error.message : 'Invalid trace file.',
            );
          }
        })
        .catch(() => {
          if (serial === importSerial.current)
            showImportStatus('Import failed', 'Could not read selected file');
        });
    },
    [onImportTrace, showImportStatus],
  );

  return {
    importError,
    dismissImportError,
    embedLabel,
    handleEmbed,
    handleExport,
    handleExportSvg,
    handleImport,
    handleShare,
    importLabel,
    importTitle,
    shareLabel,
  };
}

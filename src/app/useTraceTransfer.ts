import { useCallback, useEffect, useRef, useState } from 'react';
import type { Language, SessionResult } from '../engine/types';
import { buildIframeEmbedCode, encodeShareState } from './shareState';
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

function importedLanguage(language: Language | undefined): Language {
  return language === 'javascript' || language === 'typescript' ? language : 'python';
}

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
  const [importLabel, setImportLabel] = useState(DEFAULT_IMPORT_LABEL);
  const [importTitle, setImportTitle] = useState(DEFAULT_IMPORT_TITLE);
  const importStatusTimeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
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
    const url = buildShareUrl(false);
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
    const url = buildShareUrl(true);
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
      void file
        .text()
        .then((text) => {
          try {
            const payload = JSON.parse(text) as {
              code?: string;
              language?: Language;
              result?: SessionResult;
              step?: number;
              version?: number;
            };
            if (typeof payload.code === 'string' && payload.result) {
              onImportTrace({
                code: payload.code,
                language: importedLanguage(payload.language),
                result: payload.result,
                step: payload.step ?? 0,
              });
              showImportStatus('Imported', 'Trace imported successfully');
              return;
            }
            showImportStatus('Import failed', 'Selected JSON is not a Code Visualizer trace');
          } catch {
            showImportStatus('Import failed', 'Selected file is not valid JSON');
          }
        })
        .catch(() => showImportStatus('Import failed', 'Could not read selected file'));
    },
    [onImportTrace, showImportStatus],
  );

  return {
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

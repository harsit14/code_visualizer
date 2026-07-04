import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AnalysisInfo, FunctionInfo } from '../engine/types';
import { InputsPanel } from './InputsPanel';

const activeFunction: FunctionInfo = {
  name: 'solve',
  qualname: 'solve',
  className: null,
  params: [
    {
      name: 'nums',
      annotation: null,
      inferred: 'list[int]',
      source: 'name',
    },
  ],
  line: 1,
  isGenerator: false,
  docstring: null,
  returns: null,
};

const analysis: AnalysisInfo = {
  mode: 'function',
  functions: [activeFunction],
  defaultFunction: activeFunction.qualname,
  definesTreeNode: false,
  definesListNode: false,
  referencesTreeNode: false,
  referencesListNode: false,
  diagnostics: [],
};

describe('InputsPanel', () => {
  it('uses the concise generated-inputs hint', () => {
    const html = renderToStaticMarkup(
      <InputsPanel
        activeFunction={activeFunction}
        analysis={analysis}
        drafts={null}
        isBusy={false}
        lastInputs={null}
        onDraftsChange={() => {}}
        onFunctionChange={() => {}}
        onRegenerate={() => {}}
        onSeedChange={() => {}}
        seed={null}
      />,
    );

    expect(html).toContain('inputs are generated');
    expect(html).not.toContain('no entry point');
  });
});

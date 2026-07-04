import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PracticeTestCase } from '../app/practiceCases';
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

const caseOne: PracticeTestCase = {
  id: 'case-1',
  name: 'Case 1',
  inputs: ['[2, 7, 11, 15]'],
  expected: '[0, 1]',
  actual: '[0, 1]',
  error: null,
  memoryMb: 0.1,
  runtimeMs: 2,
  status: 'pass',
};

function renderInputsPanel(testCases: PracticeTestCase[] = []) {
  return renderToStaticMarkup(
    <InputsPanel
      activeFunction={activeFunction}
      analysis={analysis}
      drafts={null}
      isBusy={false}
      lastInputs={null}
      onAddTestCase={() => {}}
      onDraftsChange={() => {}}
      onFunctionChange={() => {}}
      onRegenerate={() => {}}
      onRemoveTestCase={() => {}}
      onRunTestCases={() => {}}
      onSeedChange={() => {}}
      onTraceTestCase={() => {}}
      onUpdateTestCase={() => {}}
      seed={null}
      testCases={testCases}
      testCasesBusy={false}
    />
  );
}

describe('InputsPanel', () => {
  it('uses the concise generated-inputs hint', () => {
    const html = renderInputsPanel();

    expect(html).toContain('inputs are generated');
    expect(html).not.toContain('no entry point');
  });

  it('renders saved practice cases without opening a separate surface', () => {
    const html = renderInputsPanel([caseOne]);

    expect(html).toContain('Cases');
    expect(html).toContain('Case 1');
    expect(html).toContain('pass');
    expect(html).toContain('[0, 1]');
    expect(html).toContain('0.10 MB');
  });
});

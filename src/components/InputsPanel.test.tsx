import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PracticeNotebook } from '../app/practiceNotebook';
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

const caseTwo: PracticeTestCase = {
  ...caseOne,
  actual: '[1, 0]',
  id: 'case-2',
  name: 'Case 2',
  status: 'fail',
};

const exploratoryCase: PracticeTestCase = {
  ...caseOne,
  actual: '21',
  expected: '',
  id: 'case-3',
  name: 'Edge single',
  status: 'ran',
};

const notebook: PracticeNotebook = {
  notes: '',
  patterns: 'two pointers, sorting',
  status: 'practicing',
  updatedAt: 123,
};

function renderInputsPanel(testCases: PracticeTestCase[] = []) {
  return renderToStaticMarkup(
    <InputsPanel
      activeFunction={activeFunction}
      analysis={analysis}
      drafts={null}
      isBusy={false}
      lastInputs={null}
      onAcceptTestCaseActual={() => {}}
      onAddEdgeTestCases={() => {}}
      onAddTestCase={() => {}}
      onDraftsChange={() => {}}
      onFunctionChange={() => {}}
      onPracticeNotebookChange={() => {}}
      onRegenerate={() => {}}
      onRemoveTestCase={() => {}}
      onRunFailedTestCases={() => {}}
      onRunTestCases={() => {}}
      onSeedChange={() => {}}
      onTraceTestCase={() => {}}
      onUpdateTestCase={() => {}}
      practiceNotebook={notebook}
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

  it('renders the compact practice notebook summary', () => {
    const html = renderInputsPanel();

    expect(html).toContain('Notebook');
    expect(html).toContain('practicing');
    expect(html).toContain('two pointers, sorting');
  });

  it('renders saved practice cases without opening a separate surface', () => {
    const html = renderInputsPanel([caseOne]);

    expect(html).toContain('Cases');
    expect(html).toContain('1/1 pass');
    expect(html).toContain('Case 1');
    expect(html).toContain('pass');
    expect(html).toContain('[0, 1]');
    expect(html).toContain('0.10 MB');
  });

  it('summarizes scored and exploratory practice runs in the folded header', () => {
    expect(renderInputsPanel([caseOne, caseTwo])).toContain('1/2 pass');
    expect(renderInputsPanel([exploratoryCase])).toContain('1 ran');
  });

  it('shows the rerun-failed action only when a case failed', () => {
    expect(renderInputsPanel([caseOne])).not.toContain('Run failed');
    expect(renderInputsPanel([caseOne, caseTwo])).toContain('Run failed');
  });

  it('offers to use actual output as expected when they differ', () => {
    expect(renderInputsPanel([caseOne])).not.toContain('Use actual');
    expect(renderInputsPanel([exploratoryCase])).toContain('Use actual');
  });
});

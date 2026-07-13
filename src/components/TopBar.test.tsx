import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TopBar } from './TopBar';

function renderTopBar() {
  return renderToStaticMarkup(
    <TopBar
      canExport
      embedLabel="Copy embed"
      exampleId="two-sum"
      hasDraft={false}
      historyRefreshToken={0}
      importLabel="Import JSON"
      importTitle="Import a trace"
      language="python"
      onEmbed={() => {}}
      onExampleChange={() => {}}
      onExport={() => {}}
      onExportSvg={() => {}}
      onImport={() => {}}
      onLanguageChange={() => {}}
      onOpenHistoryItem={() => {}}
      onOpenLanding={() => {}}
      onResetLayout={() => {}}
      onShare={() => {}}
      onShowAllPanels={() => {}}
      onTogglePanel={() => {}}
      onToggleTheme={() => {}}
      onUseLearnLayout={() => {}}
      panelControls={[
        { id: 'code', label: 'Code', visible: true },
        { id: 'data', label: 'Data', visible: true },
      ]}
      shareLabel="Share"
      status={{
        interruptSupported: false,
        message: 'Ready',
        phase: 'ready',
        progress: 1,
        stage: 'ready',
      }}
      theme="dark"
    />,
  );
}

describe('TopBar', () => {
  it('keeps primary context visible and consolidates secondary tools', () => {
    const html = renderTopBar();

    expect(html).toContain('Two Sum — LeetCode function');
    expect(html).toContain('aria-label="Copy runnable link"');
    expect(html).toContain('aria-label="Open workspace menu"');
    expect(html).toContain('Layout');
    expect(html).toContain('Learn');
    expect(html).toContain('Advanced');
    expect(html).toContain('Trace tools');
    expect(html).toContain('Shortcuts');
    expect(html.match(/<details class="panel-menu/g)).toHaveLength(2);
  });

  it('keeps compact toolbar controls named for assistive technology', () => {
    const html = renderTopBar();

    expect(html).toContain('aria-label="Back to landing page"');
    expect(html).toContain('aria-label="Open saved code history"');
    expect(html).toContain('aria-label="Switch to light mode"');
    expect(html).toContain('aria-label="Account"');
  });
});

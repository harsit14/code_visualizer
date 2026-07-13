import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readStyle = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const tokens = readStyle('tokens.css');
const globalStyles = readStyle('global.css');
const dashboardSkin = readStyle('components/traced-light.css');
const compactComponentStyles = [
  readStyle('components/controls-bar.css'),
  readStyle('components/editor.css'),
  readStyle('components/top-bar.css'),
  readStyle('components/variables-watch.css'),
  readStyle('components/visual-refresh.css'),
].join('\n');

function ruleBlock(source: string, selector: string): string {
  const start = source.indexOf(selector);
  const open = source.indexOf('{', start);
  const close = source.indexOf('\n}', open);
  if (start < 0 || open < 0 || close < 0) {
    throw new Error(`Missing CSS block: ${selector}`);
  }
  return source.slice(open + 1, close);
}

function color(block: string, property: string): string {
  const match = block.match(new RegExp(`${property}:\\s*(#[0-9a-f]{6})`, 'i'));
  if (!match) {
    throw new Error(`Missing color token: ${property}`);
  }
  return match[1];
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(
    (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('dashboard accessibility styles', () => {
  it('keeps faint text above WCAG AA contrast in both dashboard themes', () => {
    const baseDark = ruleBlock(tokens, ":root[data-theme='dark']");
    const baseLight = ruleBlock(tokens, ":root[data-theme='light']");
    const dashboardDark = ruleBlock(dashboardSkin, '.app-shell.dashboard-instrument');
    const dashboardLight = ruleBlock(
      dashboardSkin,
      ":root[data-theme='light'] .app-shell.dashboard-instrument",
    );

    for (const theme of [baseDark, baseLight, dashboardDark, dashboardLight]) {
      expect(
        contrast(color(theme, '--text-faint'), color(theme, '--bg-raised')),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('avoids sub-11.5px functional labels in compact dashboard components', () => {
    expect(compactComponentStyles).not.toMatch(/font-size:\s*(?:8|9|10|10\.5|11)px/);
  });

  it('provides readable stacked panels and larger coarse-pointer controls', () => {
    expect(globalStyles).toMatch(
      /@media \(max-width: 1100px\)[\s\S]*?\.panel-slot[\s\S]*?flex: 0 0 auto !important/,
    );
    expect(globalStyles).toMatch(/@media \(pointer: coarse\)[\s\S]*?min-height: 40px/);
    expect(globalStyles).toMatch(
      /\.dashboard-instrument \.transport button[\s\S]*?min-width: 40px/,
    );
  });
});

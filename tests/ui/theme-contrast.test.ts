import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const tokens = readFileSync(resolve('src/ui/manager/tokens.css'), 'utf8');

function cssBlock(selector: string): string {
  const start = tokens.lastIndexOf(`${selector} {`);
  if (start < 0) {
    throw new Error(`Missing CSS block: ${selector}`);
  }
  const bodyStart = tokens.indexOf('{', start) + 1;
  const bodyEnd = tokens.indexOf('}', bodyStart);
  return tokens.slice(bodyStart, bodyEnd);
}

function color(block: string, token: string): string {
  const value = block.match(
    new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, 'iu'),
  )?.[1];
  if (!value) {
    throw new Error(`Missing color token: ${token}`);
  }
  return value;
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/gu)
    ?.map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4,
    );
  if (!channels || channels.length !== 3) {
    throw new Error(`Invalid color: ${hex}`);
  }
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

describe('light theme text contrast', () => {
  it.each([
    ['浅色', ':root'],
    ['暖红', ".manager-app[data-theme='warm-red']"],
    ['雾蓝', ".manager-app[data-theme='slate']"],
  ])('%s muted text stays readable on every theme surface', (_name, selector) => {
    const block = cssBlock(selector);
    const foreground = color(block, '--color-text-muted');

    for (const backgroundToken of [
      '--color-workspace',
      '--color-surface',
      '--color-surface-secondary',
    ]) {
      expect(
        contrastRatio(foreground, color(block, backgroundToken)),
        `${selector} ${backgroundToken}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type PackageJson = {
  scripts?: Record<string, string>;
};

const packageJson = JSON.parse(
  readFileSync(resolve('package.json'), 'utf8'),
) as PackageJson;

describe('项目工具链', () => {
  it('每次 npm test 前重新构建并保留快速测试入口', () => {
    expect(packageJson.scripts?.pretest).toBe('npm run build');
    expect(packageJson.scripts?.test).toBe('vitest run');
    expect(packageJson.scripts?.['test:unit']).toBe(
      'vitest run --exclude "tests/build/**" --exclude "tests/e2e/**"',
    );
    expect(packageJson.scripts?.['test:watch']).toBe(
      'vitest --exclude "tests/build/**" --exclude "tests/e2e/**"',
    );
  });

  it('安装依赖后生成 WXT 类型配置', () => {
    expect(packageJson.scripts?.postinstall).toBe('wxt prepare');
  });

  it('提供真实的 Playwright E2E 入口', () => {
    expect(packageJson.scripts?.pree2e).toBe('npm run build');
    expect(packageJson.scripts?.e2e).toBe('playwright test');
    expect(existsSync(resolve('playwright.config.ts'))).toBe(true);
    expect(existsSync(resolve('tests/e2e/bootstrap.spec.ts'))).toBe(true);
  });
});

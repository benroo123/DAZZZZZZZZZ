import { describe, expect, it } from 'vitest';
import { getTheme, themeEntries, themes } from './themes';

describe('mobile themes', () => {
  it('ships every product direction as a complete theme', () => {
    expect(themeEntries).toHaveLength(8);
    for (const [, theme] of themeEntries) {
      expect(theme.name).toBeTruthy();
      expect(theme.brand).toMatch(/^#[0-9A-F]{6}$/i);
      expect(theme.activity).not.toBe(theme.post);
      expect(theme.cardRadius).toBeGreaterThanOrEqual(0);
    }
  });

  it('falls back to clear blue for unknown persisted keys', () => {
    expect(getTheme('missing')).toEqual(themes['clear-blue']);
  });
});

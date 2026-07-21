import { describe, expect, it } from 'vitest';
import { getMobileLayout } from './layout';

describe('mobile responsive layout', () => {
  it('uses tighter spacing and a shorter match card on small phones', () => {
    const layout = getMobileLayout(320, 640);

    expect(layout.compact).toBe(true);
    expect(layout.short).toBe(true);
    expect(layout.horizontalPadding).toBe(14);
    expect(layout.matchImageAspectRatio).toBeGreaterThan(1);
    expect(layout.themeColumns).toBe(1);
  });

  it('keeps two theme columns on a standard phone', () => {
    const layout = getMobileLayout(393, 852);

    expect(layout.compact).toBe(false);
    expect(layout.short).toBe(false);
    expect(layout.horizontalPadding).toBe(18);
    expect(layout.themeColumns).toBe(2);
  });

  it('switches to compact content when the system font is enlarged', () => {
    expect(getMobileLayout(430, 900, 1.5).compact).toBe(true);
  });
});

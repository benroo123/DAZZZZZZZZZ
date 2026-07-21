export type MobileLayout = {
  compact: boolean;
  short: boolean;
  horizontalPadding: number;
  verticalPadding: number;
  matchImageAspectRatio: number;
  themeColumns: 1 | 2;
};

export function getMobileLayout(width: number, height: number, fontScale = 1): MobileLayout {
  const compact = width < 375 || fontScale >= 1.3;
  const short = height < 720;

  return {
    compact,
    short,
    horizontalPadding: width < 360 ? 14 : 18,
    verticalPadding: short ? 12 : 18,
    matchImageAspectRatio: short ? 1.05 : 0.86,
    themeColumns: compact ? 1 : 2,
  };
}

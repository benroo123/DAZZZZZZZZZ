import rawThemes from '../../../packages/contracts/themes.json';

export type ThemeTokens = {
  name: string;
  queryValue: string;
  brand: string;
  brandSoft: string;
  accent: string;
  activity: string;
  post: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  cardRadius: number;
  dark: boolean;
};

export type ThemeKey = keyof typeof rawThemes;
export const themes = rawThemes as Record<ThemeKey, ThemeTokens>;
export const themeEntries = Object.entries(themes) as Array<[ThemeKey, ThemeTokens]>;
export const defaultTheme: ThemeKey = 'clear-blue';

export function getTheme(key: string): ThemeTokens {
  return themes[key as ThemeKey] ?? themes[defaultTheme];
}

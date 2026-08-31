/**
 * ANSI Color & Styling Utilities for Groupy CLI.
 * Pure native zero-dependency terminal styling with custom brand palette.
 */

const ESC = "\x1b[";

export const c = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  italic: `${ESC}3m`,
  underline: `${ESC}4m`,

  // Brand terracotta / coral color (#d97757) matching Groupy emblem
  brand: `${ESC}38;2;217;119;87m`,
  brandBold: `${ESC}1;38;2;217;119;87m`,
  bgBrand: `${ESC}48;2;217;119;87m`,

  // Foreground colors
  black: `${ESC}30m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  blue: `${ESC}34m`,
  magenta: `${ESC}35m`,
  cyan: `${ESC}36m`,
  white: `${ESC}37m`,
  gray: `${ESC}90m`,

  // Bright colors
  brightRed: `${ESC}91m`,
  brightGreen: `${ESC}92m`,
  brightYellow: `${ESC}93m`,
  brightBlue: `${ESC}94m`,
  brightMagenta: `${ESC}95m`,
  brightCyan: `${ESC}96m`,
  brightWhite: `${ESC}97m`,

  // Background colors
  bgBlack: `${ESC}40m`,
  bgDarkGray: `${ESC}100m`,
};

export const style = {
  bold: (t: string) => `${c.bold}${t}${c.reset}`,
  dim: (t: string) => `${c.dim}${t}${c.reset}`,
  italic: (t: string) => `${c.italic}${t}${c.reset}`,
  brand: (t: string) => `${c.brand}${t}${c.reset}`,
  brandBold: (t: string) => `${c.brandBold}${t}${c.reset}`,
  cyan: (t: string) => `${c.cyan}${t}${c.reset}`,
  green: (t: string) => `${c.green}${t}${c.reset}`,
  yellow: (t: string) => `${c.yellow}${t}${c.reset}`,
  red: (t: string) => `${c.red}${t}${c.reset}`,
  magenta: (t: string) => `${c.magenta}${t}${c.reset}`,
  gray: (t: string) => `${c.gray}${t}${c.reset}`,
  badge: (label: string, color = c.bgBrand + c.white) =>
    ` ${color}${c.bold} ${label} ${c.reset} `,
  stripAnsi: (t: string) => t.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, ""),
};

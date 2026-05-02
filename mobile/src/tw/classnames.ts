import type { TextStyle, ViewStyle } from "react-native";

type Style = ViewStyle & TextStyle;

const spacing: Record<string, number> = {
  "1": 4,
  "2": 8,
  "2.5": 10,
  "3": 12,
  "4": 16,
  "5": 20,
  "6": 24,
  "7": 28,
  "12": 48,
  "28": 112,
};

const textColors: Record<string, string> = {
  "text-white": "#ffffff",
  "text-white/28": "rgba(255,255,255,0.28)",
  "text-white/36": "rgba(255,255,255,0.36)",
  "text-white/38": "rgba(255,255,255,0.38)",
  "text-white/42": "rgba(255,255,255,0.42)",
  "text-white/46": "rgba(255,255,255,0.46)",
  "text-white/48": "rgba(255,255,255,0.48)",
  "text-white/50": "rgba(255,255,255,0.5)",
  "text-white/58": "rgba(255,255,255,0.58)",
  "text-white/72": "rgba(255,255,255,0.72)",
  "text-white/76": "rgba(255,255,255,0.76)",
  "text-white/78": "rgba(255,255,255,0.78)",
  "text-[#111112]": "#111112",
  "text-[#E07878]": "#E07878",
  "text-red-100": "#fee2e2",
  "text-emerald-100": "#d1fae5",
};

const backgroundColors: Record<string, string> = {
  "bg-[#1a1a1b]": "#1a1a1b",
  "bg-[#202021]": "#202021",
  "bg-[#E07878]": "#E07878",
  "bg-[#E07878]/16": "rgba(224,120,120,0.16)",
  "bg-[#E07878]/20": "rgba(224,120,120,0.2)",
  "bg-transparent": "transparent",
  "bg-white/4": "rgba(255,255,255,0.04)",
  "bg-white/5": "rgba(255,255,255,0.05)",
  "bg-white/6": "rgba(255,255,255,0.06)",
  "bg-white/7": "rgba(255,255,255,0.07)",
  "bg-white/8": "rgba(255,255,255,0.08)",
  "bg-white/9": "rgba(255,255,255,0.09)",
  "bg-white/10": "rgba(255,255,255,0.1)",
  "bg-white/11": "rgba(255,255,255,0.11)",
  "bg-red-500/14": "rgba(239,68,68,0.14)",
  "bg-emerald-500/16": "rgba(16,185,129,0.16)",
};

const cache = new Map<string, Style>();

export function resolveClassName(className?: string) {
  if (!className) {
    return undefined;
  }

  const cached = cache.get(className);
  if (cached) {
    return cached;
  }

  const style: Style = {};

  for (const token of className.split(/\s+/).filter(Boolean)) {
    applyToken(style, token);
  }

  cache.set(className, style);
  return style;
}

function applyToken(style: Style, token: string) {
  if (token in textColors) {
    style.color = textColors[token];
    return;
  }

  if (token in backgroundColors) {
    style.backgroundColor = backgroundColors[token];
    return;
  }

  const fontSize = matchPixelToken(token, "text");
  if (fontSize !== undefined) {
    style.fontSize = fontSize;
    return;
  }

  const radius = matchPixelToken(token, "rounded");
  if (radius !== undefined) {
    style.borderRadius = radius;
    return;
  }

  const height = matchPixelToken(token, "h");
  if (height !== undefined) {
    style.height = height;
    return;
  }

  const width = matchPixelToken(token, "w");
  if (width !== undefined) {
    style.width = width;
    return;
  }

  const minHeight = matchPixelToken(token, "min-h");
  if (minHeight !== undefined) {
    style.minHeight = minHeight;
    return;
  }

  const maxWidth = matchPixelToken(token, "max-w");
  if (maxWidth !== undefined) {
    style.maxWidth = maxWidth;
    return;
  }

  const lineHeight = matchPixelToken(token, "leading");
  if (lineHeight !== undefined) {
    style.lineHeight = lineHeight;
    return;
  }

  switch (token) {
    case "absolute":
      style.position = "absolute";
      return;
    case "flex-1":
      style.flex = 1;
      return;
    case "flex-row":
      style.flexDirection = "row";
      return;
    case "flex-wrap":
      style.flexWrap = "wrap";
      return;
    case "items-center":
      style.alignItems = "center";
      return;
    case "items-start":
      style.alignItems = "flex-start";
      return;
    case "items-end":
      style.alignItems = "flex-end";
      return;
    case "items-baseline":
      style.alignItems = "baseline";
      return;
    case "justify-center":
      style.justifyContent = "center";
      return;
    case "justify-between":
      style.justifyContent = "space-between";
      return;
    case "min-w-0":
      style.minWidth = 0;
      return;
    case "w-full":
      style.width = "100%";
      return;
    case "overflow-hidden":
      style.overflow = "hidden";
      return;
    case "rounded-full":
      style.borderRadius = 9999;
      return;
    case "max-w-[760px]":
      style.maxWidth = 760;
      return;
    case "h-9":
      style.height = 36;
      return;
    case "h-11":
      style.height = 44;
      return;
    case "h-12":
      style.height = 48;
      return;
    case "w-9":
      style.width = 36;
      return;
    case "w-11":
      style.width = 44;
      return;
    case "min-h-10":
      style.minHeight = 40;
      return;
    case "min-h-12":
      style.minHeight = 48;
      return;
    case "min-h-16":
      style.minHeight = 64;
      return;
    case "font-medium":
      style.fontWeight = "500";
      return;
    case "font-semibold":
      style.fontWeight = "600";
      return;
    case "text-right":
      style.textAlign = "right";
      return;
    case "leading-5":
      style.lineHeight = 20;
      return;
    case "mr-auto":
      style.marginRight = "auto";
      return;
  }

  applySpacingToken(style, token);
}

function applySpacingToken(style: Style, token: string) {
  const match = /^(gap|px|py|pt|pb|mt)-(.+)$/.exec(token);
  if (!match) {
    return;
  }

  const value = spacing[match[2]];
  if (value === undefined) {
    return;
  }

  switch (match[1]) {
    case "gap":
      style.gap = value;
      return;
    case "px":
      style.paddingHorizontal = value;
      return;
    case "py":
      style.paddingVertical = value;
      return;
    case "pt":
      style.paddingTop = value;
      return;
    case "pb":
      style.paddingBottom = value;
      return;
    case "mt":
      style.marginTop = value;
      return;
  }
}

function matchPixelToken(token: string, prefix: string) {
  const match = new RegExp(`^${prefix}-\\[(\\d+)px\\]$`).exec(token);
  return match ? Number(match[1]) : undefined;
}

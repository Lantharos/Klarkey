import React from "react";
import {
  Pressable as RNPressable,
  ScrollView as RNScrollView,
  Text as RNText,
  TextInput as RNTextInput,
  View as RNView,
} from "react-native";
import type { PressableStateCallbackType } from "react-native";

import { resolveClassName } from "./classnames";

export type ViewProps = React.ComponentProps<typeof RNView> & {
  className?: string;
};

export function View(props: ViewProps) {
  const { className, style, ...rest } = props;
  return <RNView {...rest} style={[resolveClassName(className), style]} />;
}

export type TextProps = React.ComponentProps<typeof RNText> & {
  className?: string;
};

export function Text(props: TextProps) {
  const { className, style, ...rest } = props;
  return <RNText {...rest} style={[resolveClassName(className), style]} />;
}

export type PressableProps = React.ComponentProps<typeof RNPressable> & {
  className?: string;
};

export function Pressable(props: PressableProps) {
  const { className, style, ...rest } = props;
  const resolvedStyle = resolveClassName(className);
  const nextStyle =
    typeof style === "function"
      ? (state: PressableStateCallbackType) => [resolvedStyle, style(state)]
      : [resolvedStyle, style];

  return <RNPressable {...rest} style={nextStyle} />;
}

export type ScrollViewProps = React.ComponentProps<typeof RNScrollView> & {
  className?: string;
  contentContainerClassName?: string;
};

export function ScrollView(props: ScrollViewProps) {
  const { className, contentContainerClassName, style, contentContainerStyle, ...rest } = props;
  return (
    <RNScrollView
      {...rest}
      style={[resolveClassName(className), style]}
      contentContainerStyle={[resolveClassName(contentContainerClassName), contentContainerStyle]}
    />
  );
}

export type TextInputProps = React.ComponentProps<typeof RNTextInput> & {
  className?: string;
};

export function TextInput(props: TextInputProps) {
  const { className, style, ...rest } = props;
  return <RNTextInput {...rest} style={[resolveClassName(className), style]} />;
}

import { useEffect, useState } from "react";
import { Keyboard, Platform, useWindowDimensions } from "react-native";
import type { KeyboardEvent, ViewStyle } from "react-native";

export function useKeyboardViewport(bottomInset: number, minHeight = 320) {
  const { height: windowHeight } = useWindowDimensions();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [largestWindowHeight, setLargestWindowHeight] = useState(windowHeight);

  useEffect(() => {
    if (keyboardHeight === 0) {
      setLargestWindowHeight((current) => Math.max(current, windowHeight));
    }
  }, [keyboardHeight, windowHeight]);

  useEffect(() => {
    const handleShow = (event: KeyboardEvent) => {
      if (Platform.OS === "ios") {
        Keyboard.scheduleLayoutAnimation(event);
      }
      setKeyboardHeight(Math.max(0, event.endCoordinates.height));
    };
    const handleHide = (event: KeyboardEvent) => {
      if (Platform.OS === "ios") {
        Keyboard.scheduleLayoutAnimation(event);
      }
      setKeyboardHeight(0);
    };
    const showEvent = Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, handleShow);
    const hide = Keyboard.addListener(hideEvent, handleHide);

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const adjustedKeyboardHeight = Math.max(0, keyboardHeight - bottomInset);
  const androidNeedsViewportFallback = Platform.OS === "android" && keyboardHeight > 0 && windowHeight >= largestWindowHeight - 24;
  const viewportHeight = androidNeedsViewportFallback ? Math.max(minHeight, largestWindowHeight - keyboardHeight) : undefined;
  const viewportStyle: ViewStyle | undefined = viewportHeight ? { flex: 0, height: viewportHeight } : undefined;

  return {
    keyboardVisible: keyboardHeight > 0,
    contentOffset: Platform.OS === "ios" ? adjustedKeyboardHeight : 0,
    dockOffset: Platform.OS === "ios" ? adjustedKeyboardHeight : 0,
    viewportHeight,
    viewportStyle,
  };
}

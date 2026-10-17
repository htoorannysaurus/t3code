import { Pressable } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";

/** Sits beside the "+" button and matches it; types "/" to open the command menu. */
export function ComposerSlashButton(props: {
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  const { scale } = useAndroidControlSizing();
  return (
    <Pressable
      accessibilityLabel="Slash commands"
      accessibilityHint="Types a slash to open the command menu"
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled }}
      className="size-[44px] shrink-0 items-center justify-center rounded-full active:opacity-70 disabled:opacity-50"
      disabled={props.disabled}
      onPress={props.onPress}
    >
      <Text
        className="font-t3-medium text-icon"
        style={{ fontSize: Math.round(20 * scale), lineHeight: Math.round(24 * scale) }}
      >
        /
      </Text>
    </Pressable>
  );
}

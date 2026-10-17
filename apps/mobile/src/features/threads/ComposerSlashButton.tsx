import { Pressable } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useAndroidControlSizing } from "../../components/ui/useAndroidControlSizing";

/** Sits beside the "+" button in the expanded composer; types "/" to open the command menu. */
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
      // Narrower than the "+" so the pair doesn't crowd the toolbar; hitSlop keeps
      // the tap target at 44pt.
      className="h-[44px] w-6 shrink-0 items-center justify-center active:opacity-70 disabled:opacity-50"
      hitSlop={{ left: 4, right: 14 }}
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

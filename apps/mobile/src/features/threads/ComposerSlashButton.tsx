import { Pressable } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
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
      // Tucked into the "+" button's own padding so the two read as a pair;
      // hitSlop keeps the tap target at 44pt.
      className="-ml-2 h-[44px] w-7 shrink-0 items-center justify-center active:opacity-70 disabled:opacity-50"
      hitSlop={{ left: 2, right: 10 }}
      disabled={props.disabled}
      onPress={props.onPress}
    >
      <SymbolView
        name="line.diagonal"
        size={Math.round(18 * scale)}
        weight="regular"
        tintColorClassName="accent-icon"
        type="monochrome"
      />
    </Pressable>
  );
}

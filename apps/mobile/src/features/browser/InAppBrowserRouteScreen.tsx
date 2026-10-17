import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useCallback, useRef, useState } from "react";
import { Linking, Pressable, Share, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewNavigation } from "react-native-webview";

import { AppTextInput } from "../../components/ui/AppText";
import { SymbolView, type AppSymbolViewProps } from "../../components/ui/AppSymbol";
import { Menu } from "../../components/ui/Menu";
import { LoadingStrip } from "../../components/ui/LoadingStrip";
import { readBrowserMemory, rememberBrowserPage } from "./browserMemory";

const HOME_URL = "https://www.google.com";

/** Turns address-bar input into a URL: keeps full URLs, adds https to bare
    hosts, and sends anything else to a search. */
export function resolveAddressInput(input: string): string | null {
  const text = input.trim();
  if (text === "") return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (!/\s/.test(text) && /^[^/]+\.[a-z]{2,}(?::\d+)?(\/.*)?$/i.test(text)) {
    return `https://${text}`;
  }
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(text)) return `http://${text}`;
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}

function displayAddress(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

type InAppBrowserRouteScreenProps = StaticScreenProps<{
  readonly url?: string;
  readonly threadId?: string;
}>;

function ToolbarButton(props: {
  readonly icon: AppSymbolViewProps["name"];
  readonly label: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={props.label}
      accessibilityRole="button"
      disabled={props.disabled}
      hitSlop={8}
      onPress={props.onPress}
      className="p-2.5 active:opacity-60 disabled:opacity-30"
    >
      <SymbolView
        name={props.icon}
        size={20}
        tintColorClassName="accent-icon"
        type="monochrome"
        weight="regular"
      />
    </Pressable>
  );
}

export function InAppBrowserRouteScreen({ route }: InAppBrowserRouteScreenProps) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView<object>>(null);
  const threadId = route.params?.threadId;
  // Opening without a link picks up where this chat's browser left off.
  const [memory] = useState(() => readBrowserMemory(threadId));
  const initialUrl = resolveAddressInput(route.params?.url ?? "") ?? memory.last?.url ?? HOME_URL;
  const [sourceUrl, setSourceUrl] = useState(initialUrl);
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [address, setAddress] = useState(displayAddress(initialUrl));
  const [editingAddress, setEditingAddress] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);

  const onNavigationStateChange = useCallback(
    (state: WebViewNavigation) => {
      setCanGoBack(state.canGoBack);
      setCanGoForward(state.canGoForward);
      setCurrentUrl(state.url);
      if (!editingAddress) setAddress(displayAddress(state.url));
      if (!state.loading) {
        rememberBrowserPage(threadId, {
          url: state.url,
          title: state.title || displayAddress(state.url),
        });
      }
    },
    [editingAddress, threadId],
  );

  const submitAddress = useCallback(() => {
    const next = resolveAddressInput(address);
    setEditingAddress(false);
    if (next === null) {
      setAddress(displayAddress(currentUrl));
      return;
    }
    setAddress(displayAddress(next));
    setSourceUrl(next);
    setCurrentUrl(next);
  }, [address, currentUrl]);

  return (
    <View className="flex-1 bg-sheet" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-1 pb-2 pl-3 pr-2 pt-1">
        <View className="h-10 min-w-0 flex-1 flex-row items-center rounded-xl bg-subtle-strong px-3">
          <AppTextInput
            accessibilityLabel="Address"
            autoCapitalize="none"
            autoCorrect={false}
            className="min-w-0 flex-1 text-base text-foreground"
            inputMode="url"
            keyboardType="web-search"
            onBlur={() => {
              setEditingAddress(false);
              setAddress(displayAddress(currentUrl));
            }}
            onChangeText={setAddress}
            onFocus={() => {
              setEditingAddress(true);
              setAddress(currentUrl);
            }}
            onSubmitEditing={submitAddress}
            placeholder="Search or enter address"
            returnKeyType="go"
            selectTextOnFocus
            value={address}
          />
        </View>
        <ToolbarButton
          icon={loading ? "xmark" : "arrow.clockwise"}
          label={loading ? "Stop loading" : "Reload"}
          onPress={() =>
            loading ? webViewRef.current?.stopLoading() : webViewRef.current?.reload()
          }
        />
      </View>
      {loading ? <LoadingStrip progress={progress} /> : null}
      <WebView
        ref={webViewRef}
        source={{ uri: sourceUrl }}
        allowsBackForwardNavigationGestures
        allowsInlineMediaPlayback
        pullToRefreshEnabled
        sharedCookiesEnabled
        setSupportMultipleWindows={false}
        style={{ flex: 1 }}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onLoadProgress={(event) => setProgress(event.nativeEvent.progress)}
        onNavigationStateChange={onNavigationStateChange}
      />
      <View
        className="flex-row items-center justify-around border-t border-border/60 px-4 pt-1"
        style={{ paddingBottom: Math.max(insets.bottom, 8) }}
      >
        <ToolbarButton
          icon="chevron.left"
          label="Back"
          disabled={!canGoBack}
          onPress={() => webViewRef.current?.goBack()}
        />
        <ToolbarButton
          icon="chevron.right"
          label="Forward"
          disabled={!canGoForward}
          onPress={() => webViewRef.current?.goForward()}
        />
        {threadId && readBrowserMemory(threadId).recent.length > 0 ? (
          <Menu
            title="Recent in this chat"
            actions={readBrowserMemory(threadId).recent.map((page) => ({
              id: page.url,
              title: page.title,
              subtitle: displayAddress(page.url),
            }))}
            onPressAction={({ nativeEvent }) => {
              setSourceUrl(nativeEvent.event);
              setCurrentUrl(nativeEvent.event);
              setAddress(displayAddress(nativeEvent.event));
            }}
          >
            <ToolbarButton
              icon={{ ios: "clock.arrow.circlepath", android: "public" }}
              label="Recent pages in this chat"
              onPress={() => undefined}
            />
          </Menu>
        ) : null}
        <ToolbarButton
          icon={{ ios: "square.and.arrow.up", android: "public" }}
          label="Share"
          onPress={() => void Share.share({ url: currentUrl }).catch(() => undefined)}
        />
        <ToolbarButton
          icon="safari"
          label="Open in Safari"
          onPress={() => void Linking.openURL(currentUrl).catch(() => undefined)}
        />
        <ToolbarButton icon="xmark" label="Close browser" onPress={() => navigation.goBack()} />
      </View>
    </View>
  );
}

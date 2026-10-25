// ABOUTME: Raycast command listing Rex sessions, sesh entries and zoxide directories in one searchable list.
// ABOUTME: Enter shows the session in the Rex app, creating it first when needed, then brings Rex forward.
import { homedir, userInfo } from "node:os";
import {
  Action,
  ActionPanel,
  Alert,
  Icon,
  Keyboard,
  List,
  closeMainWindow,
  confirmAlert,
  getPreferenceValues,
  open,
  showToast,
  Toast,
} from "@raycast/api";
import { showFailureToast, useCachedPromise } from "@raycast/utils";
import { connect, killSession, loadItems, runner } from "./cli";
import { expandPath, Item } from "./items";

interface Preferences {
  rexPath: string;
  rexApp: string;
  searchPath: string;
  includeZoxide: boolean;
}

const ICONS: Record<Item["kind"], Icon> = {
  rex: Icon.Terminal,
  sesh: Icon.Gear,
  dir: Icon.Folder,
};

const SECTIONS: { kind: Item["kind"]; title: string }[] = [
  { kind: "rex", title: "Open Sessions" },
  { kind: "sesh", title: "Sesh Config" },
  { kind: "dir", title: "Directories" },
];

export default function ConnectCommand() {
  const prefs = getPreferenceValues<Preferences>();
  const home = homedir();
  const run = runner(expandPath(prefs.searchPath, home), prefs.rexPath);
  const shell = userInfo().shell || "/bin/sh";

  const { data, isLoading, revalidate } = useCachedPromise(
    (includeZoxide: boolean) => loadItems(run, home, includeZoxide),
    [prefs.includeZoxide],
    {
      keepPreviousData: true,
      onError: (error) => {
        showFailureToast(error, { title: "Couldn't list Rex sessions. Is Rex running?" });
      },
    },
  );

  async function onConnect(item: Item) {
    const toast = await showToast({ style: Toast.Style.Animated, title: `Opening ${item.label}` });
    try {
      await connect(run, item, shell);
      await open(prefs.rexApp);
      await toast.hide();
      await closeMainWindow({ clearRootSearch: true });
    } catch (error) {
      await showFailureToast(error, { title: `Couldn't open ${item.label}` });
    }
  }

  async function onKill(item: Item) {
    const confirmed = await confirmAlert({
      title: `Close ${item.label}?`,
      message: "Every tab and program in this session ends.",
      primaryAction: { title: "Close Session", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    try {
      await killSession(run, item);
      revalidate();
    } catch (error) {
      await showFailureToast(error, { title: `Couldn't close ${item.label}` });
    }
  }

  const refresh = (
    <Action
      title="Refresh"
      icon={Icon.ArrowClockwise}
      shortcut={Keyboard.Shortcut.Common.Refresh}
      onAction={revalidate}
    />
  );

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search sessions and directories">
      <List.EmptyView
        icon={Icon.Terminal}
        title="Nothing to show"
        description="Start Rex, then press ⌘R."
        actions={<ActionPanel>{refresh}</ActionPanel>}
      />
      {SECTIONS.map(({ kind, title }) => (
        <List.Section key={kind} title={title}>
          {(data ?? [])
            .filter((item) => item.kind === kind)
            .map((item) => (
              <List.Item
                key={item.id}
                title={item.title}
                icon={ICONS[item.kind]}
                keywords={[item.label]}
                accessories={
                  item.windows !== undefined
                    ? [{ icon: Icon.AppWindow, text: String(item.windows), tooltip: "Tabs" }]
                    : item.startup
                      ? [{ tag: item.startup, tooltip: "Startup command" }]
                      : []
                }
                actions={
                  <ActionPanel>
                    <Action
                      title={item.kind === "rex" ? "Open Session" : "Create Session"}
                      icon={Icon.ArrowRight}
                      onAction={() => onConnect(item)}
                    />
                    {item.path && <Action.CopyToClipboard title="Copy Path" content={item.path} />}
                    {item.kind === "rex" && (
                      <Action
                        title="Close Session"
                        icon={Icon.XMarkCircle}
                        style={Action.Style.Destructive}
                        shortcut={{ modifiers: ["ctrl"], key: "x" }}
                        onAction={() => onKill(item)}
                      />
                    )}
                    {refresh}
                  </ActionPanel>
                }
              />
            ))}
        </List.Section>
      ))}
    </List>
  );
}

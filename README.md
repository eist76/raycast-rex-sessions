# Rex Sessions

A [Raycast](https://raycast.com) extension for [Rex](https://www.superlogical.com/rex/docs),
the terminal multiplexer. It does for Rex what the
[sesh extension](https://www.raycast.com/joshmedeski/sesh) does for tmux.

**Connect to Rex Session** shows one searchable list:

- **Open Sessions:** every session on the local Rex server, with its tab count.
- **Sesh Config:** the sessions in your [sesh](https://github.com/joshmedeski/sesh) config.
- **Directories:** your [zoxide](https://github.com/ajeetdsouza/zoxide) directories.

Press <kbd>Enter</kbd> to show the session in the Rex app and bring Rex to the
front. A sesh entry or directory that isn't open yet becomes a new session
named after it, in its directory, running the entry's startup command first.
Entries and directories already open as a session are listed only once.

| Shortcut | Action |
| --- | --- |
| <kbd>Enter</kbd> | Open or create the session |
| <kbd>⌘</kbd> <kbd>R</kbd> | Refresh |
| <kbd>⌃</kbd> <kbd>X</kbd> | Close an open session (asks first) |

## Requirements

- Rex for macOS. The `rex` CLI ships inside the app bundle, which is the
  default **rex CLI** preference.
- Optional: `sesh` and `zoxide`. Raycast doesn't use your shell's `PATH`, so
  the extension searches the **PATH for sesh and zoxide** preference. It
  expands a leading `~`, and by default covers mise shims and Homebrew.

Switching what the app shows uses Rex's `session.select` action, which needs
**Remote Control** turned on in Rex's settings.

## Development

```sh
npm install
npm run dev     # load the extension into Raycast
npm test        # unit tests, plus an integration test when rex, sesh and zoxide are installed
npm run lint
```

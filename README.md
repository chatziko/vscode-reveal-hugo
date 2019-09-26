# vscode-reveal-hugo

This extensions makes it easy to create presentations in vscode using
[reveal-hugo](https://reveal-hugo.dzello.com/) (a Hugo theme for
[Reveal.js](https://revealjs.com/)).

## Usage

- Open the `_index.md` (or any other `.md`) file of your presentation
- press 'F1' and select "RevealHugo: Open Preview to the Side"
- A preview of the presentation will open
- The slide in the preview will be automatically synced to the cursor in `_index.md`

Multiple source files and multiple previews can be open simultaneously.

### Backward sync

Add this to your `config.toml`:
```
[params.reveal_hugo]
post_message_events = true
```
or this to your front matter:
```
[reveal_hugo]
post_message_events = true
```
Now reopen the preview, changing slide in the preview will automatically
move the cursor to the corresponding position in the source file.

### Limitations

- Single-file presentations (`layout = "list"`) are not supported.
- If you add a new `.md` file to an existing presentation, you need to reopen
the preview to sync that file.

### See also

- [Documentation of reveal-hugo](https://github.com/dzello/reveal-hugo)

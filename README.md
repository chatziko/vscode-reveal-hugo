# vscode-reveal-hugo

This extensions makes it easy to create presentations in vscode using
[reveal-hugo](https://reveal-hugo.dzello.com/) (a Hugo theme for
[Reveal.js](https://revealjs.com/)).

## Usage

- Open the `_index.md` (or any other `.md`) file of your presentation.
- Press "F1" and select "RevealHugo: Open Preview to the Side".
- A preview of the presentation will open.
- The source will be in 2-ways sync with the preview.
	- Moving the cursor in the source file will move the preview to the corresponding slide.
	- Changing slide in the preview will move the cursor to the corresponding position in the source file.

Multiple source files and multiple previews can be open simultaneously.

### Limitations

- Single-file presentations (`layout = "list"`) are not supported.
- If you add a new `.md` file to an existing presentation, you need to reopen
the preview to sync that file.

### See also

- [Documentation of reveal-hugo](https://github.com/dzello/reveal-hugo)

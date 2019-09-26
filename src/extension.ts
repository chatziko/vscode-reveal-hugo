'use strict';
import * as vscode from 'vscode';
import os = require('os');
import fs = require('fs');
import path = require('path');
const spawn = require('child_process').spawn;

interface Slide {
    horiz: number;
    vert: number;
    offset?: number;        // character offset of the slide in the source file
}

interface File {
    fileName: string;
    weight: number;
    slides: Slide[];
}

interface Preview {
    hugoRoot: string;
    urlPath: string;
    files: File[];
    port?: number;
    server?: any;
    shownSlide?: Slide;              // absolute slide number shown in the preview
    panel?: vscode.WebviewPanel;
};

const previews = new Map<string, Preview>();

// called when the extension is activated (the very first time the command is executed)
export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerTextEditorCommand('vscode-reveal-hugo.openPreviewToTheSide', openPreviewToTheSide(context))
    );

    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection((event) => {
            const textEditor = event.textEditor as vscode.TextEditor;
            const preview = getDocumentPreview(textEditor.document);
            if(!preview)
                return;

            // find the file that is shown in the editor
            let file = preview.files.find(f => f.fileName == textEditor.document.fileName);
            if(!file) return;

            // find how many horizontal slides are before this file
            let prevSlides = 0;
            for(let f of preview.files) {
                if(f === file) break;
                prevSlides += f.slides[f.slides.length - 1].horiz + 1;
            }

            // this is the absolute slide, if it's different than the currently displayed one, show it
            const absSlide = shiftSlide(getEditorSlide(textEditor, file.slides), prevSlides);

            if(compareSlides(absSlide, preview.shownSlide) != 0) {
                preview.shownSlide = absSlide;
                showSlideInPreview(preview);
            }
        }),

        vscode.workspace.onDidChangeTextDocument((event) => {
            // TODO: maybe throttle?
            const preview = getDocumentPreview(event.document);
            if(!preview) return;

            for(let f of preview.files) {
                if(f.fileName == event.document.fileName) {
                    const text = event.document.getText();
                    const oldWeight = f.weight;

                    f.weight = parseWeight(f.fileName, text);
                    f.slides = parseSlides(text);

                    if(f.weight != oldWeight)
                        preview.files.sort((a, b) => (a.weight - b.weight) || (a.fileName < b.fileName ? -1 : 1));

                    break;
                }
            }
        }),
    );
}

function openPreviewToTheSide(context: vscode.ExtensionContext) {

    return (textEditor: vscode.TextEditor) => {
        const preview = createDocumentPreview(textEditor.document);
        if (!preview) {
            vscode.window.showErrorMessage('You need to run this on a markdown file within a reveal-hugo site');
            return;
        }

        // find the file that is shown in the editor
        let file = preview.files.find(f => f.fileName == textEditor.document.fileName);
        if(!file) return;

        // find how many horizontal slides are before this file
        let prevSlides = 0;
        for(let f of preview.files) {
            if(f === file) break;
            prevSlides += f.slides[f.slides.length - 1].horiz + 1;
        }

        // this is the absolute slide
        preview.shownSlide = shiftSlide(getEditorSlide(textEditor, file.slides), prevSlides);

        if(!preview.server) {
            startServer(context, preview);
        } else {
            showSlideInPreview(preview);
        }
    };        
}

function parseWeight(fileName: string, markdown: string): number {
    const base = path.basename(fileName);
    if(base == '_index.md' || base == 'index.md')
        return -1;

    const match = markdown.match(/^\s*"?weight"?\s*[:=]\s*(\d+),?\s*$/m);
    return match ? parseInt(match[1]) : 1e6;
}

function parseSlides(markdown: string): Slide[] {
    // TODO: detect empty doc with 0 slides
 
    let re = /^(\r?\n---+\r?\n|\r?\n\*\*\*+\r?\n|\r?\n___+\r?\n|(```+).*|{{% \/?section %}})$/gm;
    let match;
    let h = 0, v = 0;
    let inCodeFence = "", inVertical = false;
    let slides = [{ horiz: 0, vert: 0, offset: 0 }];       // first slide

    while(match = re.exec(markdown)) {
        let s = match[0];
        
        // code fences
        if(s.substr(0, 1) == "`") {
            if(!inCodeFence)
                inCodeFence = match[2];
            else if(inCodeFence == match[1])
                inCodeFence = "";

            continue;
        }
        if(inCodeFence) continue;       // ignore everything inside a code fence
        
        if(s == "{{% section %}}") {
            // This simply declares that future slides are vertical, does not affect the current slide
            inVertical = true;
            
        } else if(s == "{{% /section %}}") {
            // This simply declares that future slides are horizontal, does not affect the current slide
            v = 0;
            inVertical = false;

        } else {
            // horizontal rule: starts a new slide
            inVertical ? v++ : h++;
            slides.push({ horiz: h, vert: v, offset: match.index + s.length });
        }
    }

    return slides;
}

// Finds in which slide (of those in slides) the editor's cursor is located at
// The returned slide is relative to this file.
//
function getEditorSlide(textEditor: vscode.TextEditor, slides: Slide[]): Slide {
    let cursor = textEditor.document.offsetAt(textEditor.selection.active);

    let i;
    for(i = 0; i < slides.length && slides[i].offset <= cursor; i++)
        ;

    return slides[i - 1];
}

// Compares two slides based on their horiz/vert order, returns negative/0/positive
function compareSlides(a: Slide, b: Slide): number {
    return a.horiz != b.horiz
        ? a.horiz - b.horiz
        : a.vert  - b.vert;
}

// shift slide by n horizontal slides
function shiftSlide(slide: Slide, n: number): Slide {
    return {
        horiz: slide.horiz + n,
        vert: slide.vert,
    };
}

// Show a slide (relative to the current file) in the editor
function showSlideInEditor(textEditor: vscode.TextEditor, relSlide: Slide, file: File) {
    // if the cursor is already anywhere inside the requested slide, do nothing
    var curSlide = getEditorSlide(textEditor, file.slides);
    if(compareSlides(curSlide, relSlide) == 0)
        return;

    let i;
    for(i = 0; i < file.slides.length; i++)
        if(compareSlides(file.slides[i], relSlide) > 0)
            break;

    let startOffset = file.slides[i-1].offset;
    let endOffset   = i < file.slides.length ? file.slides[i].offset : 1e8;

    var startPos = textEditor.document.positionAt(startOffset);
    var endPos   = textEditor.document.positionAt(endOffset);

    // set cursor
    textEditor.selection = new vscode.Selection(startPos, startPos);

    // set visible
    textEditor.revealRange(new vscode.Range(startPos, endPos));
}

function showSlideInPreview(preview: Preview) {
    preview.panel.webview.postMessage({ command: "show_slide", slide: preview.shownSlide });
}

function getDocumentPreview(document: vscode.TextDocument): Preview {
    return previews.get(document.fileName);
}

function createDocumentPreview(document: vscode.TextDocument): Preview {
    const fileName = document.fileName;
    if(previews.has(fileName))
        return previews.get(fileName);

    const match = fileName.match(`^(.*)\\${path.sep}content\\${path.sep}.*\.md$`);
    if (!match) return;
    const hugoRoot = match[1];

    // we might be inside a subdirectory, go up until we find the first dir with an _index.md/index.md file
    let dir = path.dirname(fileName);
    while(!fs.existsSync(path.join(dir, '_index.md')) && !fs.existsSync(path.join(dir, 'index.md'))) {
        const parent = path.dirname(dir);
        if(parent == dir)
            return;      // reached root, no _index.md
        dir = parent;
    }

    const mdFiles= getMarkdownFiles(dir);
    if(!mdFiles.length) return;     // no _index.md found

    const preview: Preview = {
        hugoRoot: hugoRoot,
        urlPath: path.relative(path.join(hugoRoot, 'content'), path.dirname(mdFiles[0])).replace(path.sep, '/'),        // relative path from content to _index.md's dir
        files: [],
    };
    
    for(let mdFile of mdFiles) {
        const text = mdFile == fileName
            ? document.getText()
            : fs.readFileSync(mdFile, "utf8");

        preview.files.push({
            fileName: mdFile,
            weight: parseWeight(mdFile, text),
            slides: parseSlides(text),
        });

        previews.set(mdFile, preview);
    }
    preview.files.sort((a, b) => (a.weight - b.weight) || (a.fileName < b.fileName ? -1 : 1));

    return preview;
}

// returns all .md files of the presentation containing dir
//
function getMarkdownFiles(dir: string) {
    var files = [];

    if(path.basename(dir) == 'content') {
        // root of the content dir. Include only _index.md, and the contents of the 'home' subdirectory
        const index = path.join(dir, '_index.md');
        if(fs.existsSync(index))
            files.push(index);

        const home = path.join(dir, 'home');
        if(fs.existsSync(home))
             files = files.concat(getMarkdownFiles(home));

    } else {
        // Internal directory. Include all .md files, and all subdirectories not having their own _index.md/index.md
        for(let f of fs.readdirSync(dir)) {
            const full = path.join(dir, f);

            if(fs.statSync(full).isDirectory() &&
               !(fs.existsSync(path.join(full, '_index.md')) || fs.existsSync(path.join(full, 'index.md')))
            ) {
                files = files.concat(getMarkdownFiles(full));
            } else if(f.match(/\.md$/)) {
                files.push(full);
            }
        }
    }

    return files;
}

function startServer(context: vscode.ExtensionContext, preview: Preview) {
    // run hugo server
    preview.server = spawn('hugo', ['server', `-s=${preview.hugoRoot}`, '--disableFastRender', '--watch']);

    preview.server.stdout.on('data', (data) => {
        data = `${data}`;
        console.log(`hugo output: ${data}`);

        const res = data.match(/Web Server is available at.*localhost:(\d+)/);
        if (res) {
            preview.port = res[1];
            showPanel(context, preview);
        }
    });

    preview.server.stderr.on('data', (data) => {
        data = `${data}`;
        console.log(`hugo error: ${data}`);

        vscode.window.showErrorMessage(`hugo error: ${data}`);
        stopServer(preview.server);
    });

    preview.server.on('close', (code) => {
        console.log('hugo closing, code = ', code);
    });
}

function showPanel(context: vscode.ExtensionContext, preview: Preview) {
    preview.panel = vscode.window.createWebviewPanel(
        'extension.liveServerPreview',
        `http://localhost:${preview.port}/${preview.urlPath}`,
        vscode.ViewColumn.Two,
        {
            enableScripts: true,
            retainContextWhenHidden: true,      // keep the webview alive when the tab is hidden. TODO: use getState/setState
        }
    );

    preview.panel.webview.html = getPreviewHtml(preview);

    // Handle messages from the webview
    preview.panel.webview.onDidReceiveMessage(
        message => {
            // console.log("got message from the webview", message);
            if(message.eventName != "slidechanged")
                return;

            let absSlide = { horiz: message.state.indexh, vert: message.state.indexv };
            if(compareSlides(absSlide, preview.shownSlide) == 0)
                return;
            preview.shownSlide = absSlide;

            let file: File;
            let prevSlides = 0;

            for(let f of preview.files) {
                if(!f.slides.length) continue;
                const lastSlide = shiftSlide(f.slides[f.slides.length-1], prevSlides);

                if(compareSlides(lastSlide, absSlide) >= 0) {
                    file = f;
                    break;
                } else {
                    prevSlides = lastSlide.horiz + 1;   // slides are 0-based
                }
            }
            if(!file) return;

            for(let editor of vscode.window.visibleTextEditors) {
                if(editor.document.fileName == file.fileName) {
                    // pass relative slide to showSlideInEditor
                    showSlideInEditor(editor, shiftSlide(absSlide, -prevSlides), file);
                    break;
                }
            }
        },
        undefined,
        context.subscriptions
    );

    preview.panel.onDidDispose(
        () => {
            for(let f of preview.files) {
                previews.delete(f.fileName);
            }
            stopServer(preview.server);
        },
        null,
        context.subscriptions
    );
}

function stopServer(server) {
    console.log("shutdowning server...");
    if (os.platform() == 'win32') {
        spawn("taskkill", ["/pid", server.pid, '/f', '/t']);
    } else {
        server.kill('SIGTERM');
    }
}

// this method is called when your extension is deactivated
export function deactivate() {
    console.log("deactivated")
}

function getPreviewHtml(preview: Preview): string {
    const url = `http://localhost:${preview.port}/${preview.urlPath}#/${preview.shownSlide.horiz}/${preview.shownSlide.vert}`;

    return `
        <html>
            <header>
                <style>
                    body, html, div {
                        margin: 0;
                        padding: 0;
                        width: 100%;
                        height: 100%;
                        overflow: hidden;
                        background-color: #fff;
                    }
                </style>
            </header>
            <body>
                <iframe id="iframe" src="${url}" width="100%" height="100%" frameborder="0"></iframe>
                <script>
                var iframe = document.getElementById("iframe");
                const vscode = acquireVsCodeApi();

                // hack to set focus to the iframe on first load, and every time the panel gets focus
                window.addEventListener('load', function () {
                    iframe.blur();
                    iframe.focus();
                });
                window.addEventListener('focus', function () {
                    window.setTimeout(function() {
                        iframe.blur();
                        iframe.focus();
                    }, 100);
                });

                // handle messages from the extension
                window.addEventListener('message', function(e) {
                    const msg = e.data;

                    if(typeof(msg) == "string") {
                        vscode.postMessage(JSON.parse(msg));
                    } else {
                        iframe.contentWindow.postMessage(JSON.stringify({ method: 'slide', args: [ msg.slide.horiz, msg.slide.vert ] }), '*');
                    }
                });
                </script>
            </body>
        </html>
    `;
}
import { useEffect, useRef } from "react"
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view"
import { EditorState } from "@codemirror/state"
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { indentOnInput, bracketMatching, foldGutter } from "@codemirror/language"
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search"
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete"
import { markdown } from "@codemirror/lang-markdown"
import { python } from "@codemirror/lang-python"
import { javascript } from "@codemirror/lang-javascript"
import { json } from "@codemirror/lang-json"
import { yaml } from "@codemirror/lang-yaml"
import { StreamLanguage } from "@codemirror/language"
import { shell } from "@codemirror/legacy-modes/mode/shell"
import { ruby } from "@codemirror/legacy-modes/mode/ruby"
import { oneDark } from "@codemirror/theme-one-dark"

// Lightweight CodeMirror 6 wrapper. Picks the right language pack per
// file_type, applies the One Dark theme in dark mode (matches the app's
// existing palette), and notifies the parent on every edit.
//
// The component owns its EditorView. When `value` changes from outside
// (e.g. the user switches tabs) we replace the doc instead of unmounting
// so cursor/scroll state stays sane.

const LANGUAGE_FOR_TYPE: Record<string, () => any> = {
  md:   () => markdown(),
  py:   () => python(),
  js:   () => javascript(),
  ts:   () => javascript({ typescript: true }),
  json: () => json(),
  yaml: () => yaml(),
  // legacy-modes covers languages CodeMirror 6 doesn't ship as first-party
  // packs. Skill bundles regularly include POSIX scripts and the occasional
  // Ruby helper.
  sh:   () => StreamLanguage.define(shell),
  rb:   () => StreamLanguage.define(ruby),
}

interface CodeMirrorEditorProps {
  value: string
  fileType: string
  onChange: (next: string) => void
  className?: string
  readOnly?: boolean
  dark?: boolean
}

export function CodeMirrorEditor({
  value,
  fileType,
  onChange,
  className,
  readOnly = false,
  dark = true,
}: CodeMirrorEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!hostRef.current) return

    // Custom theme: fits the host element (parent decides height; .cm-scroller
    // gets the overflow so the editor scrolls instead of pushing the page).
    // Font is 13px monospace to match the rest of the dev surface — One Dark's
    // default 15-16px reads as a giant typewriter on a skill editor surface.
    const compactTheme = EditorView.theme({
      "&": {
        height: "100%",
        fontSize: "13px",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      },
      ".cm-scroller": {
        overflow: "auto",
        fontFamily: "inherit",
        lineHeight: "1.5",
      },
      ".cm-content": {
        padding: "8px 0",
      },
      ".cm-gutters": {
        fontSize: "12px",
      },
    })

    const langFactory = LANGUAGE_FOR_TYPE[fileType]
    const extensions = [
      lineNumbers(),
      highlightActiveLine(),
      history(),
      foldGutter(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      highlightSelectionMatches(),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...completionKeymap,
      ]),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return
        onChangeRef.current(update.state.doc.toString())
      }),
      EditorState.readOnly.of(readOnly),
      compactTheme,
    ]
    if (langFactory) extensions.push(langFactory())
    if (dark) extensions.push(oneDark)

    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: hostRef.current,
    })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileType, readOnly, dark])

  // External value updates (tab switch, programmatic reset) → swap the doc
  // without recreating the view, so cursor + selection state stays.
  useEffect(() => {
    const v = viewRef.current
    if (!v) return
    const current = v.state.doc.toString()
    if (current === value) return
    v.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  return <div ref={hostRef} className={className} />
}

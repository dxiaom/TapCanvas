// 画布光标预设：写入根节点 CSS 变量 --tc-canvas-cursor，画布空闲区域（pane/节点）
// 通过 var() 消费。默认值 arrow-a 固化在 styles.css :root（避免首帧闪烁），
// 本模块只负责应用 B/C 的内联覆盖；选回 arrow-a 时清除内联覆盖即可。
export type CanvasCursorId = 'arrow-a' | 'arrow-b' | 'arrow-c'

const CANVAS_CURSOR_CSS_VAR = '--tc-canvas-cursor'

function svgCursor(svg: string, hotspotX: number, hotspotY: number): string {
  const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
  // cursor 语法要求 url() 后必须带逗号分隔的回退关键字，否则整个值非法（视为 unset 回退继承）
  return `url("${uri}") ${hotspotX} ${hotspotY}, auto`
}

const ARROW_B_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M3 2L10.5 20.5L13.5 12.5L21.5 9.5Z" fill="#ffffff" stroke="#2b2b2e" stroke-width="1.6" stroke-linejoin="round"/></svg>'
const ARROW_C_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M3 2L10.5 20.5L13.5 12.5L21.5 9.5Z" fill="#f3f2ef" stroke="#121214" stroke-width="1.4" stroke-linejoin="round"/></svg>'

export function applyCanvasCursor(id: CanvasCursorId): void {
  if (typeof document === 'undefined') return
  if (id === 'arrow-b') {
    document.documentElement.style.setProperty(CANVAS_CURSOR_CSS_VAR, svgCursor(ARROW_B_SVG, 2, 2))
    return
  }
  if (id === 'arrow-c') {
    document.documentElement.style.setProperty(CANVAS_CURSOR_CSS_VAR, svgCursor(ARROW_C_SVG, 2, 2))
    return
  }
  // arrow-a：styles.css :root 中的默认值，清除内联覆盖即可
  document.documentElement.style.removeProperty(CANVAS_CURSOR_CSS_VAR)
}

import { TextContainerProperty } from '@evenrealities/even_hub_sdk'

// Even G2 canvas (same constants as navigateven / timetableven)
export const SCREEN_W = 576
export const SCREEN_H = 288
const HEADER_H = 28
const FOOTER_H = 28
const BODY_Y = HEADER_H
const BODY_H = SCREEN_H - HEADER_H - FOOTER_H

// Container IDs. Every rebuild carries the same ID set.
export const ID_CAPTURE = 1
export const ID_HEADER = 2
export const ID_BODY = 3
export const ID_FOOTER = 4
export const CONTAINER_TOTAL = 4

// Body text metrics measured on the simulator for navigateven (27px line pitch).
// Re-measure on real glasses.
const LINE_PITCH = 27
const BODY_PADDING = 6
export const LINES_PER_PAGE = Math.floor((BODY_H - BODY_PADDING * 2) / LINE_PITCH) // 8
// Half-width units per line at full width (navigateven: 44 at x=20..556).
export const WRAP_BUDGET = 44

export function charWidth(ch: string): number {
  const code = ch.codePointAt(0) ?? 0
  // ASCII and half-width katakana count 1; everything else (CJK, full-width) counts 2.
  if (code <= 0xff) return 1
  if (code >= 0xff61 && code <= 0xff9f) return 1
  return 2
}

/** Wrap text into display lines of at most `budget` half-width units, honouring explicit newlines. */
export function wrapText(text: string, budget = WRAP_BUDGET): string[] {
  const lines: string[] = []
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let current = ''
    let width = 0
    for (const ch of paragraph) {
      const w = charWidth(ch)
      if (width + w > budget) {
        lines.push(current)
        current = ''
        width = 0
      }
      current += ch
      width += w
    }
    lines.push(current)
  }
  return lines
}

/** Split wrapped lines into pages. Always returns at least one page. */
export function paginate(lines: string[], perPage = LINES_PER_PAGE): string[][] {
  if (lines.length === 0) return [['']]
  const pages: string[][] = []
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage))
  return pages
}

function buildCapture(): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0, yPosition: 0,
    width: SCREEN_W, height: SCREEN_H,
    borderWidth: 0, borderColor: 0, paddingLength: 0,
    containerID: ID_CAPTURE, containerName: 'eventLayer',
    content: ' ', isEventCapture: 1,
  })
}

function buildHeader(text: string): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0, yPosition: 0,
    width: SCREEN_W, height: HEADER_H,
    borderWidth: 0, borderColor: 8, paddingLength: 4,
    containerID: ID_HEADER, containerName: 'header',
    content: text, isEventCapture: 0,
  })
}

function buildFooter(text: string): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 0, yPosition: SCREEN_H - FOOTER_H,
    width: SCREEN_W, height: FOOTER_H,
    borderWidth: 0, borderColor: 8, paddingLength: 4,
    containerID: ID_FOOTER, containerName: 'footer',
    content: text, isEventCapture: 0,
  })
}

function buildBody(text: string): TextContainerProperty {
  return new TextContainerProperty({
    xPosition: 20, yPosition: BODY_Y,
    width: SCREEN_W - 40, height: BODY_H,
    borderWidth: 0, borderColor: 0, paddingLength: BODY_PADDING,
    containerID: ID_BODY, containerName: 'body',
    content: text || ' ', isEventCapture: 0,
  })
}

/** Every screen is header + one body + footer; the body text is already wrapped/paged by the caller. */
export function buildScreen(header: string, bodyLines: string[], footer: string): TextContainerProperty[] {
  return [buildCapture(), buildHeader(header), buildBody(bodyLines.join('\n')), buildFooter(footer)]
}

/** Vertically centre a short message inside the body. */
export function centeredMessage(message: string): string[] {
  const lines = wrapText(message)
  const pad = Math.max(0, Math.floor((LINES_PER_PAGE - lines.length) / 2))
  return [...Array<string>(pad).fill(''), ...lines]
}

import { describe, expect, it } from 'vitest'
import { charWidth, LINES_PER_PAGE, paginate, wrapText, WRAP_BUDGET } from '../src/glasses/layout.ts'

describe('wrapText', () => {
  it('counts CJK as 2 units and ASCII as 1', () => {
    expect(charWidth('a')).toBe(1)
    expect(charWidth('あ')).toBe(2)
    expect(charWidth('ｱ')).toBe(1)
  })
  it('wraps at the budget and keeps explicit newlines', () => {
    const text = 'あ'.repeat(30) + '\n' + 'b'.repeat(50)
    const lines = wrapText(text)
    expect(lines).toEqual(['あ'.repeat(22), 'あ'.repeat(8), 'b'.repeat(44), 'b'.repeat(6)])
    for (const l of lines) expect([...l].reduce((w, c) => w + charWidth(c), 0)).toBeLessThanOrEqual(WRAP_BUDGET)
  })
  it('keeps empty paragraphs', () => {
    expect(wrapText('a\n\nb')).toEqual(['a', '', 'b'])
  })
})

describe('paginate', () => {
  it('always yields one page', () => {
    expect(paginate([])).toEqual([['']])
  })
  it('splits into pages of LINES_PER_PAGE', () => {
    const lines = Array.from({ length: LINES_PER_PAGE * 2 + 1 }, (_, i) => `l${i}`)
    const pages = paginate(lines)
    expect(pages.length).toBe(3)
    expect(pages[0].length).toBe(LINES_PER_PAGE)
    expect(pages[2]).toEqual([`l${LINES_PER_PAGE * 2}`])
    expect(pages.flat()).toEqual(lines)
  })
})

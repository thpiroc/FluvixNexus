import { describe, expect, it } from 'vitest'
import { SECRET_MASK } from '../secret/secretMasking'
import {
  createTerminalOutputCollector,
  normalizeTerminalText,
  sanitizeTerminalOutput,
  terminalOutputDisplay,
  TERMINAL_OUTPUT_DISPLAY_MAX_LINE_LENGTH,
  TERMINAL_OUTPUT_DISPLAY_MAX_LINES,
  TERMINAL_OUTPUT_MAX_CHARS
} from './terminalOutput'

/**
 * コマンドの出力（Security Core v1 の STEP8）。**Secret Masking を最優先する。**
 *
 *   - 伏せてから渡す（Agent へも画面へも）
 *   - 切り詰めで検出をすり抜けさせない（Private Key の BEGIN を落とさない・切れ目の token を残さない）
 *   - 端末の制御・見えない文字で検出の形を崩させない
 *   - 検査できなければ丸ごと出さない
 */

const TOKEN = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz'
const KEY_BODY = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7'
const PRIVATE_KEY = [
  '-----BEGIN PRIVATE KEY-----',
  KEY_BODY,
  'bm90IGEgcmVhbCBrZXkgYnV0IGxvb2tzIGxpa2Ugb25lIGZvciB0ZXN0cw==',
  '-----END PRIVATE KEY-----'
].join('\n')

function collect(parts: readonly (readonly ['stdout' | 'stderr', string])[], max?: number) {
  const collector = createTerminalOutputCollector(max)

  for (const [stream, text] of parts) {
    collector.append(stream, Buffer.from(text, 'utf8'))
  }

  return collector.finish()
}

describe('集める', () => {
  it('stdout と stderr を届いた順に1本にする', () => {
    expect(
      collect([
        ['stdout', 'a\n'],
        ['stderr', 'b\n'],
        ['stdout', 'c\n']
      ])
    ).toEqual({
      text: 'a\nb\nc\n',
      truncated: false
    })
  })

  it('多バイト文字が chunk の境目で割れても化けない（stream ごとに読む）', () => {
    const bytes = Buffer.from('日本語', 'utf8')
    const collector = createTerminalOutputCollector()

    collector.append('stdout', bytes.subarray(0, 2))
    collector.append('stderr', Buffer.from('E', 'utf8'))
    collector.append('stdout', bytes.subarray(2))

    expect(collector.finish().text).toBe('E日本語')
  })

  it('上限は STEP3 の検査上限と同じで、超えた分は読み捨てる（先頭を残す）', () => {
    expect(TERMINAL_OUTPUT_MAX_CHARS).toBe(1_000_000)
    expect(
      collect(
        [
          ['stdout', 'head-'],
          ['stdout', 'x'.repeat(20)]
        ],
        10
      )
    ).toEqual({
      text: 'head-xxxxx',
      truncated: true
    })
  })
})

describe('伏せる', () => {
  it('出力の Secret を伏せる', () => {
    const safe = sanitizeTerminalOutput({ text: `token=${TOKEN}\nok\n`, truncated: false })

    expect(safe.text).not.toContain(TOKEN)
    expect(safe.text).toContain(SECRET_MASK)
    expect(safe.text).toContain('ok')
    expect(safe.secretMasked).toBe(true)
    expect(safe.maskedCount).toBeGreaterThan(0)
    expect(safe.withheld).toBe(false)
  })

  it('stdout と stderr にまたがった Private Key block も、まとめて伏せる', () => {
    const lines = PRIVATE_KEY.split('\n')
    const captured = collect([
      ['stdout', `${lines[0]}\n`],
      ['stderr', `${lines[1]}\n`],
      ['stdout', `${lines.slice(2).join('\n')}\n`]
    ])
    const safe = sanitizeTerminalOutput(captured)

    expect(safe.text).not.toContain(KEY_BODY)
    expect(safe.text).not.toContain('bm90IGEgcmVhbCBrZXk')
  })

  it('上限で END が切れても、BEGIN から末尾までを伏せる（鍵の本体を出さない）', () => {
    const head = 'build log\n'
    const text = `${head}${PRIVATE_KEY}`
    // END の手前で切れる上限。
    const captured = collect([['stdout', text]], head.length + 40)

    expect(captured.truncated).toBe(true)

    const safe = sanitizeTerminalOutput(captured)

    expect(safe.text).toContain('build log')
    expect(safe.text).not.toContain(KEY_BODY.slice(0, 12))
    expect(safe.text).not.toContain('PRIVATE KEY-----\nMII')
  })

  it('上限の切れ目にかかった token の前半を平文で残さない', () => {
    const text = `line one\ntoken ${TOKEN}`
    // token の途中で切る（形が合わず検出されない長さ）。
    const captured = collect([['stdout', text]], text.length - 20)
    const safe = sanitizeTerminalOutput(captured)

    expect(safe.text).not.toContain('ghp_0123456789')
    expect(safe.text).toContain('line one')
  })

  it('色の制御やゼロ幅の文字が token に挟まっても伏せる（取り除いてから検査する）', () => {
    const colored = `\u001b[32m${TOKEN.slice(0, 10)}\u001b[0m${TOKEN.slice(10)}`
    const zeroWidth = `${TOKEN.slice(0, 12)}​${TOKEN.slice(12)}`

    for (const text of [colored, zeroWidth]) {
      const safe = sanitizeTerminalOutput({ text, truncated: false })

      expect(safe.text).not.toContain(TOKEN.slice(14))
    }
  })

  it('Secret が無ければそのまま（ただし制御は取り除く）', () => {
    const safe = sanitizeTerminalOutput({
      text: '\u001b[1mPASS\u001b[0m tests\r\nprogress 10%\rprogress 100%\n',
      truncated: false
    })

    expect(safe).toMatchObject({
      text: 'PASS tests\nprogress 10%\nprogress 100%\n',
      secretMasked: false
    })
  })
})

describe('整える', () => {
  it('OSC（タイトル・リンク）・CSI・その他のエスケープを取り除く', () => {
    expect(
      normalizeTerminalText('\u001b]0;title\u0007a\u001b[2Kb\u001b(Bc\u001b]8;;http://x\u001b\\d')
    ).toBe('abcd')
  })

  it('見えない文字・双方向の上書き・行の区切りを取り除き、改行とタブは残す', () => {
    expect(normalizeTerminalText('a‮b​c d\u0000e\tf\ng\u0085h')).toBe('abcde\tf\ngh')
  })
})

describe('画面に出す形', () => {
  it('伏せた後の末尾を、行数と1行の長さで切る', () => {
    const lines = Array.from({ length: TERMINAL_OUTPUT_DISPLAY_MAX_LINES + 50 }, (_, i) => `l${i}`)
    lines.push('x'.repeat(TERMINAL_OUTPUT_DISPLAY_MAX_LINE_LENGTH + 10))

    const display = terminalOutputDisplay(
      sanitizeTerminalOutput({ text: `${lines.join('\n')}\n`, truncated: false })
    )

    expect(display.lines).toHaveLength(TERMINAL_OUTPUT_DISPLAY_MAX_LINES)
    expect(display.lines[display.lines.length - 1]).toHaveLength(
      TERMINAL_OUTPUT_DISPLAY_MAX_LINE_LENGTH
    )
    expect(display.lines[display.lines.length - 1].endsWith('…')).toBe(true)
    expect(display.truncated).toBe(true)
  })

  it('末尾に残る行に Secret があっても、伏せた後の文字しか出ない', () => {
    const text = `${'noise\n'.repeat(500)}${PRIVATE_KEY}\nGITHUB_TOKEN=${TOKEN}\n`
    const display = terminalOutputDisplay(sanitizeTerminalOutput({ text, truncated: false }))
    const joined = display.lines.join('\n')

    expect(joined).not.toContain(KEY_BODY)
    expect(joined).not.toContain(TOKEN)
    expect(display.secretMasked).toBe(true)
  })

  it('検査できなかった出力は1行も出さない', () => {
    const display = terminalOutputDisplay({
      text: '',
      truncated: false,
      secretMasked: false,
      maskedCount: 0,
      categories: [],
      withheld: true
    })

    expect(display).toEqual({ lines: [], truncated: false, secretMasked: false, withheld: true })
  })
})

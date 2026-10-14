import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'
import { describe, expect, it } from 'vitest'

/**
 * Agent パネルのドックパネル化の境界。
 *
 *   - Agent 専用のドック機構を作っていない（layout/ ・ dnd/ ・ resize/ ・ persistence/ は
 *     Agent を名指ししない。置き場所を尋ねるかは Registry の `placement` だけが決める）
 *   - パネルの移動・非表示・再表示の経路から、Agent の作業へ何も送らない
 *     （停止を送るのは AgentTaskProvider の停止ボタンの処理だけ）
 *   - Renderer から送れるものは今までどおり（IPC・Preload の契約は agentTaskSurface.test.ts）
 */

const RENDERER = join(__dirname, '..', '..', 'renderer', 'src')
const WORKSPACE = join(RENDERER, 'workspace')

/** 説明文を落として、コードだけを読む。 */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)

    if (statSync(path).isDirectory()) {
      return sourceFiles(path)
    }

    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

describe('Agent 専用のドック機構を作っていない', () => {
  it('layout / dnd / resize / persistence のコードは Agent を名指ししない', () => {
    for (const dir of ['layout', 'dnd', 'resize', 'persistence']) {
      for (const file of sourceFiles(join(WORKSPACE, dir))) {
        expect(codeOf(readFileSync(file, 'utf8')), file).not.toMatch(/['"]agent['"]/)
      }
    }
  })

  it('置き場所を尋ねるパネルは Registry の placement で決まり、今は Agent だけ', () => {
    const registry = codeOf(readFileSync(join(WORKSPACE, 'panels', 'registry.ts'), 'utf8'))
    const userPlaced = [...registry.matchAll(/id: '(\w+)',[^}]*?placement: 'user'/g)].map(
      (match) => match[1]
    )

    expect(userPlaced).toEqual(['agent'])
    expect(registry.match(/placement: 'preset'/g)).toHaveLength(5)
  })
})

describe('Main・IPC・Preload の契約を変えていない（最後の席の保存）', () => {
  const SRC = join(RENDERER, '..', '..')

  it('Main・Preload・IPC の契約は panelSeats を名指ししない（layout の中身は解釈しない）', () => {
    const dirs = [join(SRC, 'main'), join(SRC, 'preload'), join(SRC, 'shared', 'ipc')]

    for (const dir of dirs) {
      for (const file of sourceFiles(dir)) {
        expect(codeOf(readFileSync(file, 'utf8')), file).not.toMatch(/panelSeats/)
      }
    }
  })

  it('保存文書の型は layout を unknown のまま運び、schemaVersion は 1 のまま', () => {
    const shared = codeOf(
      readFileSync(join(SRC, 'shared', 'workspace', 'layoutDocument.ts'), 'utf8')
    )

    expect(shared).toMatch(/WORKSPACE_LAYOUT_SCHEMA_VERSION = 1\b/)
    expect(shared).toMatch(/readonly layout: unknown/)
    // 足したのは任意項目（?:）だけ。
    expect(shared).toMatch(/readonly panelSeats\?:/)
  })
})

describe('パネル操作から Agent の作業へ何も送らない', () => {
  it('Workspace Shell の側は agent-task の API に触れない', () => {
    for (const file of sourceFiles(WORKSPACE)) {
      expect(codeOf(readFileSync(file, 'utf8')), file).not.toMatch(/agentTask\s*\./)
    }
  })

  it('agent-task の操作を送るのは AgentTaskProvider だけ', () => {
    const senders = sourceFiles(RENDERER).filter((file) =>
      /fluvix\.agentTask\.(start|stop|continueTask)\b/.test(codeOf(readFileSync(file, 'utf8')))
    )

    expect(senders.map((file) => relative(RENDERER, file).split(sep).join('/'))).toEqual([
      'agentTask/AgentTaskProvider.tsx'
    ])
  })

  it('Provider は unmount の後始末で作業を止めない（購読を外すだけ）', () => {
    const hook = codeOf(readFileSync(join(RENDERER, 'agentTask', 'useAgentTask.ts'), 'utf8'))
    const cleanup = hook.slice(hook.indexOf('return () => {'))

    expect(cleanup).not.toMatch(/stop|halt|continueTask/)
    expect(cleanup).toMatch(/unsubscribe\(\)/)
  })
})

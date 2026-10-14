import type { PanelDefinition, PanelId } from './types'
import { AgentPanel } from './AgentPanel'
import { DebugPanel } from './DebugPanel'
import { EditorPanel } from './EditorPanel'
import { FilesPanel } from './FilesPanel'
import { GitPanel } from './GitPanel'
import { TerminalPanel } from './TerminalPanel'

/**
 * Panel Registry。
 *
 * レイアウトは「どのパネルをどこに置くか」を PanelId の並びとしてだけ持ち、
 * 実体（コンポーネント・表示名・識別色）への解決はここが一手に引き受ける。
 * この間接参照があるため、レイアウトを JSON として保存・復元でき、
 * Dock / Split でパネルを動かす処理も PanelId の並べ替えだけで済む。
 *
 * 追加の手順（IPC のドメイン追加と同じく、契約側から足す）:
 *   1. panels/types.ts の PanelId に識別子を足す
 *   2. panels/<Name>Panel.tsx を作る
 *   3. この表に登録する（Record<PanelId, ...> のため、漏れると型エラーになる）
 */
const PANEL_REGISTRY: Readonly<Record<PanelId, PanelDefinition>> = {
  files: {
    id: 'files',
    title: 'Files',
    accent: 'blue',
    placement: 'preset',
    Component: FilesPanel
  },
  editor: {
    id: 'editor',
    title: 'Editor',
    accent: 'neutral',
    placement: 'preset',
    Component: EditorPanel
  },
  terminal: {
    id: 'terminal',
    title: 'Terminal',
    accent: 'green',
    placement: 'preset',
    Component: TerminalPanel
  },
  git: {
    id: 'git',
    title: 'Git',
    accent: 'orange',
    placement: 'preset',
    Component: GitPanel
  },
  debug: {
    id: 'debug',
    title: 'Debug',
    accent: 'neutral',
    placement: 'preset',
    Component: DebugPanel
  },
  /*
    FN Agent（Security Core v1 の STEP9）。既定のレイアウトには置かず（Debug と同じ）、
    View メニュー・コマンド・ステータスバーから開く。プリセットに席が無いため、
    初めて出すときは置き場所を尋ね、その後は最後の席へ戻す（placement: 'user'）。
  */
  agent: {
    id: 'agent',
    title: 'Agent',
    accent: 'neutral',
    placement: 'user',
    Component: AgentPanel
  }
}

/** PanelId から定義を引く。未登録の id は型の時点で存在しないため、失敗しない。 */
export function getPanelDefinition(id: PanelId): PanelDefinition {
  return PANEL_REGISTRY[id]
}

/**
 * 素の文字列が登録済みの PanelId かどうか。
 *
 * 要るのは保存されたレイアウトを読み込むときだけ。ファイルの中身は素の string であり、
 * アプリの更新でパネル構成が変わっていることもあるため、木に入れる前にここで突き合わせる
 * （workspace/persistence/layoutDocument.ts）。
 */
export function isPanelId(value: string): value is PanelId {
  return Object.hasOwn(PANEL_REGISTRY, value)
}

/**
 * 利用者が置き場所を決めるパネル（`placement: 'user'`）かどうか。
 *
 * 最後の席（layout/panelSeats.ts）を持てるのはこのパネルだけ。保存ファイルの
 * `panelSeats` に他のパネルの席が書かれていても読み込まない（persistence/layoutDocument.ts）
 * ── 受け入れると、そのパネルの戻り先がプリセットから外れてしまう。
 */
export function isUserPlacedPanelId(value: string): value is PanelId {
  return isPanelId(value) && PANEL_REGISTRY[value].placement === 'user'
}

/**
 * 登録されているパネルをすべて返す。
 *
 * 「レイアウトに今出ていないパネルも含めた一覧」が要る場面で使う
 * （パネルを開くメニュー、レイアウト操作の対象選択など）。
 */
export function listPanelDefinitions(): readonly PanelDefinition[] {
  return Object.values(PANEL_REGISTRY)
}

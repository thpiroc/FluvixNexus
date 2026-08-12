import type { WorkspaceLayoutDocument } from '@shared/workspace'
import { reserveDockNodeIds } from '../layout/nodeId'
import { collectNodes } from '../layout/tree'
import { deserializeWorkspaceLayout, type LayoutRestoreResult } from './layoutDocument'

/**
 * 保存データからレイアウトを復元する入口。
 *
 * layout/nodeId.ts と同じく、このモジュールは**副作用を持つ**ことを役割にしている。
 * 検証と変換（純粋な部分）は persistence/layoutDocument.ts にあり、
 * ここが足すのは「復元した木が使っている id を発番器に予約する」1点だけ。
 *
 * 予約が要るのは、id の発番が起動ごとに 1 から始まるため。
 * 予約せずに復元すると、保存データに含まれる `dock-3` と、その後の分割で
 * 発番される `dock-3` が衝突し、木の中に同じ id が2つ現れる。
 * ノードの探索はすべて id で行うため、これは「別の領域を掴んでしまう」形で表面化する。
 *
 * 復元に失敗した場合は id を予約しない（採用しない木の id を確保する意味が無いため）。
 */
export function restoreWorkspaceLayout(document: WorkspaceLayoutDocument): LayoutRestoreResult {
  const result = deserializeWorkspaceLayout(document)

  if (result.ok) {
    reserveDockNodeIds(collectNodes(result.layout.root).map((node) => node.id))
  }

  return result
}

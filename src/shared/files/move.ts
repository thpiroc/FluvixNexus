/**
 * 移動（別のフォルダへ動かす）だけが持つ値。
 *
 * ## なぜ shared に置くか
 *
 * 移動が断られる理由のうち1つだけ、他の操作に無いものがある ──
 * **移動先が、移動するもの自身か、その中にある**（`src` を `src/lib` へ動かす）。
 * これはパスの形としては正しく、名前にも問題が無く、権限にも実在にも関係しない。
 * それでも成立しない要求で、fs に任せると OS ごとに違うコード（Windows は EINVAL、
 * POSIX は EINVAL）で返り、しかも「引数が変」以上のことは分からない。
 *
 * Main は判断できるが、その理由を Renderer へ伝える手段が要る。IpcError の
 * `detail` に載せるのがその手段で、**detail の文字列は契約の一部**になる
 * （fileName.ts の FileNameProblem を detail に載せているのと同じ扱い）。
 * 送る側と読む側の2箇所に同じ文字列を書くと、片方だけ直された時点で
 * 「理由が分かるはずの失敗が、理由の分からない失敗に落ちる」というずれが生まれる。
 *
 * shared 層のルールどおり、このファイルは定数だけを持つ。
 */

/**
 * 移動先が、移動するもの自身か、その配下にあることを表す `detail`。
 *
 * 載せるのは main/ipc/handlers/files.ts（INVALID_REQUEST の detail として）。
 * 読むのは renderer/src/files/filesError.ts。
 *
 * 「自分自身」と「その中」を分けていないのは、**利用者の次の一手が同じ**ため
 * ── どちらも別のフォルダを選び直すしかない。分けると文言が2つに増えるだけで、
 * できることは1つも増えない。
 *
 * **コピー（Session 3-6-2）も同じ理由でこの値を使う。** 値は
 * `destination-inside-source` で操作を含んでおらず、成立しない理由も
 * 次の一手も移動と変わらない（コピーでは、加えて複製が際限なく増える）。
 * 操作ごとに違うのは文言だけで、それを決めるのは Renderer 側
 * （filesError.ts が action で分ける。shared/files/copy.ts）。
 */
export const MOVE_INTO_SELF_DETAIL = 'destination-inside-source'

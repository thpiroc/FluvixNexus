import { describe, expect, it } from 'vitest'
import { copyCandidateName } from './copyName'
import { FILE_NAME_MAX_LENGTH } from './fileName'

/**
 * コピー名の規則の検証。
 *
 * ディスクを見ない純粋な規則なので、確かめるのは**候補の並び方**そのもの。
 * 「実際にどの候補が使われるか」は Main 側（排他で作ってみて、既にあれば次へ）の
 * 話で、そちらは mutateWorkspaceEntry.test.ts が実物のディスクで確かめる。
 */

describe('copyCandidateName', () => {
  it('0 番目の候補は元の名前そのまま（衝突していなければこれで済む）', () => {
    expect(copyCandidateName('example.txt', 'file', 0)).toBe('example.txt')
    expect(copyCandidateName('src', 'directory', 0)).toBe('src')
  })

  it('ファイルは拡張子の前に付く', () => {
    expect(copyCandidateName('example.txt', 'file', 1)).toBe('example copy.txt')
    expect(copyCandidateName('example.txt', 'file', 2)).toBe('example copy 2.txt')
    expect(copyCandidateName('example.txt', 'file', 3)).toBe('example copy 3.txt')
  })

  it('フォルダは末尾に付く（フォルダ名のドットは拡張子ではない）', () => {
    expect(copyCandidateName('src', 'directory', 1)).toBe('src copy')
    expect(copyCandidateName('src', 'directory', 2)).toBe('src copy 2')
    expect(copyCandidateName('my.folder', 'directory', 1)).toBe('my.folder copy')
  })

  it('拡張子は最後のドットで切る', () => {
    expect(copyCandidateName('archive.tar.gz', 'file', 1)).toBe('archive.tar copy.gz')
  })

  it('拡張子を持たないファイルは末尾に付く', () => {
    expect(copyCandidateName('LICENSE', 'file', 1)).toBe('LICENSE copy')
    expect(copyCandidateName('LICENSE', 'file', 2)).toBe('LICENSE copy 2')
  })

  /*
    先頭のドットだけの名前は拡張子ではない（fileEntry.ts の deriveExtension と同じ扱い）。
    ` copy.gitignore` になると、まったく別の意味の名前になる。
  */
  it('ドットで始まる名前は拡張子として切らない', () => {
    expect(copyCandidateName('.gitignore', 'file', 1)).toBe('.gitignore copy')
    expect(copyCandidateName('.env.local', 'file', 1)).toBe('.env copy.local')
  })

  /*
    末尾がドットの名前は他の OS で作られたものが実在しうる（ARCHITECTURE.md §10.2）。
    ここで拡張子として切ると、空の拡張子を付け直すことになる。
  */
  it('末尾がドットの名前は拡張子として切らない', () => {
    expect(copyCandidateName('notes.', 'file', 1)).toBe('notes. copy')
  })

  /*
    既に付いている " copy" を系列の続きとして読み直さない
    （利用者が最初からその名前を付けた場合と区別が付かないため）。
  */
  it('既にある copy を数え直さず、常に足す', () => {
    expect(copyCandidateName('example copy.txt', 'file', 1)).toBe('example copy copy.txt')
  })

  /*
    末尾に空白を持つ名前は他の OS で作られたものが実在しうる。trim すると
    別のファイルの名前に化けるため、ここでも落とさない（§10.2 と同じ理由）。
  */
  it('末尾の空白を落とさない', () => {
    expect(copyCandidateName('notes.txt ', 'file', 1)).toBe('notes copy.txt ')
    expect(copyCandidateName('notes ', 'directory', 1)).toBe('notes  copy')
  })

  /* ------------------------------------------------------------ 長さ */

  it('上限を超える場合は元の名前の方を削る', () => {
    const base = 'a'.repeat(FILE_NAME_MAX_LENGTH - 4)
    const candidate = copyCandidateName(`${base}.txt`, 'file', 2)

    expect(candidate).not.toBeNull()
    expect(candidate?.length).toBe(FILE_NAME_MAX_LENGTH)
    // 連番と拡張子は必ず残る（削ると衝突を避けられない / 別の種類のファイルになる）。
    expect(candidate?.endsWith(' copy 2.txt')).toBe(true)
  })

  it('元の名前が既に上限を超えていれば 0 番目の候補も作れない', () => {
    expect(copyCandidateName('a'.repeat(FILE_NAME_MAX_LENGTH + 1), 'file', 0)).toBeNull()
  })

  it('拡張子と連番だけで上限に達する名前は候補を作れない', () => {
    expect(copyCandidateName(`x.${'e'.repeat(FILE_NAME_MAX_LENGTH)}`, 'file', 1)).toBeNull()
  })

  /*
    削る単位はコードポイント。slice で切るとサロゲートペアが割れ、
    名前として壊れた文字が残る。
  */
  it('削るときにサロゲートペアを割らない', () => {
    const candidate = copyCandidateName(`${'🐟'.repeat(FILE_NAME_MAX_LENGTH)}.txt`, 'file', 1)

    expect(candidate).not.toBeNull()
    expect(candidate).not.toMatch(/[\uD800-\uDFFF]$/)
    expect(candidate?.endsWith(' copy.txt')).toBe(true)
  })

  /*
    生成した名前を findFileNameProblem に通していないことの裏付け
    （最初のドットより前が必ず " copy" で終わるため、予約デバイス名にならない）。
  */
  it('予約デバイス名から作った候補は予約名にならない', () => {
    expect(copyCandidateName('aux.ts', 'file', 1)).toBe('aux copy.ts')
    expect(copyCandidateName('con', 'directory', 1)).toBe('con copy')
  })
})

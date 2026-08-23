import { describe, expect, it } from 'vitest'
import { runGitExclusively } from './gitQueue'

/**
 * git を「常に1本だけ」動かす順番待ち（Session 3-8-3）。
 *
 * ここが効かないと、同時に走った `git add` が `.git/index.lock` を取り合い、
 * 押した方の片方が理由も無く失敗する。実際の git での確認は
 * gitStageRepository.test.ts にあり、ここで固定するのは**順番の規則**そのものになる。
 */
describe('runGitExclusively', () => {
  /** 好きなときに終わらせられる仕事を作る。 */
  function deferred(): {
    readonly promise: Promise<void>
    readonly resolve: () => void
  } {
    let release: () => void = () => undefined
    const promise = new Promise<void>((resolve) => {
      release = () => resolve()
    })

    return { promise, resolve: release }
  }

  it('前の仕事が終わるまで、次を始めない', async () => {
    const first = deferred()
    const started: string[] = []

    const one = runGitExclusively(async () => {
      started.push('one')
      await first.promise
      return 'one'
    })

    const two = runGitExclusively(async () => {
      started.push('two')
      return 'two'
    })

    // 1つ目が終わっていないので、2つ目はまだ始まっていない。
    await Promise.resolve()
    expect(started).toEqual(['one'])

    first.resolve()

    expect(await Promise.all([one, two])).toEqual(['one', 'two'])
    expect(started).toEqual(['one', 'two'])
  })

  it('積んだ順に走る', async () => {
    const order: number[] = []

    await Promise.all(
      [1, 2, 3, 4].map((index) =>
        runGitExclusively(async () => {
          order.push(index)
        })
      )
    )

    expect(order).toEqual([1, 2, 3, 4])
  })

  /*
    途中の仕事が失敗しても列そのものは止めない。止めると、1回の失敗で
    以降の Git 操作がすべて動かなくなる（アプリを開き直すまで直らない）。
  */
  it('失敗した仕事の後ろも走る', async () => {
    const failing = runGitExclusively(async () => {
      throw new Error('boom')
    })

    await expect(failing).rejects.toThrow('boom')
    await expect(runGitExclusively(async () => 'next')).resolves.toBe('next')
  })

  it('失敗はそのまま呼び出し側へ返る（握り潰さない）', async () => {
    await expect(
      runGitExclusively(async () => {
        throw new Error('detail')
      })
    ).rejects.toThrow('detail')
  })
})

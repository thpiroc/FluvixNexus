import type { FeedbackCategoryId } from '@shared/feedback'

/**
 * 保存先へ渡す1件のフィードバック（Electron に依存しない）。
 *
 * 利用者が入れたもの（種別・詳細）に、Main が知っている値（送信日時・
 * アプリのバージョン・環境）を足した形。**どの保存先にも同じものを渡す**
 * ── 保存先ごとに何を載せるかを決めさせると、Notion には OS があるのに
 * 別の保存先には無い、が生まれる。
 */
export interface FeedbackRecord {
  readonly category: FeedbackCategoryId
  readonly detail: string
  /** Main が受け取った時刻（ISO 8601, UTC）。 */
  readonly submittedAt: string
  readonly appVersion: string
  readonly environment: FeedbackEnvironment
}

/**
 * 最低限の環境情報。
 *
 * 載せるのは**不具合の切り分けに要る**ものだけで、利用者を特定できるもの
 * （ユーザー名・ホスト名・パス・ロケール以外の地域情報）は載せない。
 */
export interface FeedbackEnvironment {
  /** 例: `Windows_NT` */
  readonly os: string
  /** 例: `10.0.26200` */
  readonly osRelease: string
  /** 例: `x64` */
  readonly arch: string
  readonly electron: string
}

/** 環境情報を1行にする（保存先が文字列1つで持つとき用）。 */
export function formatFeedbackEnvironment(environment: FeedbackEnvironment): string {
  return `${environment.os} ${environment.osRelease} (${environment.arch}) / Electron ${environment.electron}`
}

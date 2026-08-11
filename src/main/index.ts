import { bootstrapApp } from './app/lifecycle'

/**
 * Main Process のエントリポイント。
 *
 * ここでは起動処理を呼び出すだけに留め、実処理は責務ごとのモジュールに委ねる。
 *  - app/       : アプリのライフサイクル管理・実行モード・メニュー
 *  - windows/   : ウィンドウ管理
 *  - security/  : 遷移ガード・権限などのセキュリティポリシー
 *  - ipc/       : Renderer からの要求の受け口（チャンネル登録基盤とドメインハンドラ）
 *  - store/     : userData 配下への状態の永続化
 *  - logger/    : Main 側のログ出力
 *  - platform/  : OS 依存処理の抽象化レイヤー
 */
bootstrapApp()

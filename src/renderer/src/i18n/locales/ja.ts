import type { TranslationMessages } from './types'

export const jaMessages = {
  language: {
    ja: '日本語',
    en: 'English'
  },
  settings: {
    title: '設定',
    closeTitle: '設定を閉じる（Esc）',
    closeLabel: '設定を閉じる',
    categoryNavLabel: '設定のカテゴリ',
    missingControl: 'この設定を操作する UI がありません。',
    categories: {
      general: {
        title: '一般',
        description: 'アプリ全体の基本設定。'
      },
      appearance: {
        title: '外観',
        description: 'アプリ全体の見た目。'
      },
      editor: {
        title: 'エディター',
        description: '編集中のファイルをいつ保存するか。'
      },
      files: {
        title: 'ファイル',
        description: 'ファイル一覧の見え方。'
      },
      terminal: {
        title: 'ターミナル',
        description: 'ターミナルの見え方。開いているタブすべてに効きます。'
      }
    },
    items: {
      general: {
        language: {
          title: '言語',
          description: 'Fluvix Nexus の表示言語を選びます。'
        }
      },
      appearance: {
        theme: {
          title: 'テーマ',
          description:
            '選ぶとすぐに切り替わります。エディター・ファイル・ターミナル・Git のすべてに効きます。'
        }
      },
      editor: {
        autoSaveMode: {
          title: '自動保存',
          description: '自動で保存する場面を選びます。しない場合も Ctrl+S はいつでも効きます。'
        },
        autoSaveDelayMs: {
          title: '自動保存までの待ち時間',
          description:
            '「入力が止まったら」を選んでいるときに、止まってから保存するまでの長さです。'
        }
      },
      files: {
        viewMode: {
          title: '表示方式',
          description:
            'パネルの形に任せると、横に広ければカラム、縦に長ければツリーになります。カラムの幅は境界を掴んで変えます。'
        }
      },
      terminal: {
        fontSize: {
          title: '文字の大きさ',
          description: 'ターミナルのタブ列からも変えられます。'
        },
        scrollback: {
          title: 'さかのぼれる行数',
          description: '減らすと、そのぶん古い出力はその場で捨てられます。'
        }
      }
    },
    controls: {
      language: {
        aria: '言語'
      },
      autoSaveMode: {
        aria: '自動保存'
      },
      autoSaveDelay: {
        label: '待ち時間',
        hintActive: '{min}〜{max}ms',
        hintInactive: '{min}〜{max}ms（今の方式では使われません）'
      },
      filesViewMode: {
        aria: 'ファイルの表示方式'
      },
      terminalFontSize: {
        label: '文字の大きさ',
        unit: 'px'
      },
      terminalScrollback: {
        label: 'さかのぼれる行数',
        unit: '行'
      },
      theme: {
        aria: 'テーマ'
      }
    },
    values: {
      autoSave: {
        off: '自動保存: しない',
        afterDelay: '自動保存: 入力が止まったら',
        onFocusChange: '自動保存: フォーカスが外れたら',
        onWindowChange: '自動保存: ウィンドウが切り替わったら'
      },
      filesView: {
        auto: 'パネルの形に任せる',
        tree: 'ツリー',
        columns: 'カラム'
      },
      theme: {
        dark: 'ダーク',
        light: 'ライト'
      }
    }
  },
  workspace: {
    noWorkspace: 'Workspace 未選択',
    noWorkspaceOpen: 'Workspace が開かれていません。',
    openFolder: 'フォルダを開く',
    openFolderEllipsis: 'フォルダを開く...',
    closeWorkspace: 'Workspace を閉じる',
    busy: '処理中...',
    viewMenu: 'View',
    layoutMenu: 'Layout: {title}',
    modified: '変更あり',
    settingsTitle: 'アプリ全体の設定を開きます。',
    settingsButton: '設定',
    resetLayout: 'レイアウトを初期化',
    emptyDock: 'パネルがありません（View メニューから表示できます）',
    closePanel: '{title} を閉じる',
    connecting: '接続中...',
    welcomeLead:
      '開発するフォルダを開くと、Files / Editor / Terminal / Git がそのフォルダを対象に動きます。',
    unavailablePrevious: '前回の Workspace が見つかりませんでした: {path}',
    panels: {
      files: 'Files',
      editor: 'Editor',
      terminal: 'Terminal',
      git: 'Git'
    },
    layout: {
      default: {
        title: 'Default',
        description: 'Files / Editor / Git を横に並べ、下に Terminal を置く'
      }
    }
  }
} satisfies TranslationMessages

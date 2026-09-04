import type { TranslationMessages } from './types'

export const jaMessages = {
  language: {
    ja: '日本語',
    en: 'English'
  },
  common: {
    actions: {
      cancel: 'キャンセル',
      close: '閉じる',
      retry: '再試行',
      stop: '中止'
    },
    ipcError: {
      invalidRequest: '入力内容が正しくありません。',
      notFound: '対象が見つかりませんでした。',
      conflict: '対象の現在の状態と競合しています。',
      busy: '対象が他のアプリで使用されている可能性があります。閉じてからもう一度お試しください。',
      permissionDenied: 'この操作は許可されていません。',
      unsupported: 'この環境では実行できません。',
      cancelled: '操作は中断されました。',
      channelUnavailable: 'アプリ内部の通信に失敗しました。再起動をお試しください。',
      internal: '予期しないエラーが発生しました。'
    }
  },
  files: {
    toolbar: {
      newFileLabel: '新規ファイル',
      newFileTitle: '新規ファイル（{target}）',
      newFolderLabel: '新規フォルダ',
      newFolderTitle: '新規フォルダ（{target}）',
      searchLabel: 'プロジェクト全体を検索',
      searchTitle: 'プロジェクト全体を検索（ファイル名 / 全文）',
      reloadLabel: 'ファイルツリーを再読み込み',
      reloadTitle: '再読み込み'
    },
    view: {
      groupLabel: 'Files の表示方式',
      tree: 'ツリー表示',
      columns: 'カラム表示',
      selectedTitle: '{label}（選択中。もう一度押すとパネルの形に合わせます）',
      switchTitle: '{label}へ切り替え'
    },
    pending: {
      move: '「{name}」の移動先フォルダを右クリックして「ここへ移動」を選んでください',
      copy: '「{name}」をコピーしました。貼り付け先フォルダを右クリックして「ここに貼り付け」を選んでください',
      cancel: 'やめる',
      copyNotice: '「{name}」をコピーしました（リンクなど {count} 件は複製していません）',
      copyNoticeCloseLabel: 'コピーの結果を閉じる',
      close: '閉じる'
    },
    drag: {
      copy: 'コピー',
      move: '移動',
      copyHint: 'Ctrl でコピー'
    },
    search: {
      backLabel: 'ファイルツリーへ戻る',
      modeGroupLabel: '探し方',
      nameMode: 'ファイル名',
      contentMode: '全文',
      namePlaceholder: 'ファイル名で検索',
      nameInputLabel: '{workspace} の中をファイル名で検索',
      contentPlaceholder: 'ファイルの中身を検索',
      contentInputLabel: '{workspace} の中のファイルの中身を検索',
      clearLabel: '検索語を消す',
      cancel: '中止',
      retry: 'もう一度',
      nameResultsLabel: 'ファイル名の検索結果',
      contentResultsLabel: '全文検索の結果',
      fileMatchCount: '{count} 件',
      fileMatchCountTruncated: '{count} 件以上',
      searching: '検索中…',
      noFiles: '一致するファイルはありません',
      found: '{count} 件',
      cancelled: '検索を中止しました',
      cancelledWithCount: '検索を中止しました（{count} 件まで）',
      noText: '一致するテキストはありません',
      foundContent: '{matchCount} 件（{fileCount} ファイル）',
      cancelledContentWithCount:
        '検索を中止しました（{matchCount} 件（{fileCount} ファイル）まで）',
      summaryWithLimit: '{summary}・{limit}',
      limits: {
        results: '上限（{max} 件）まで表示しています。語を足すと絞り込めます',
        matches: '上限（{max} 件）まで表示しています。語を足すと絞り込めます',
        files: 'ファイルが多いため、{max} 件まで読んで打ち切りました',
        scanned:
          'ファイルが多いため、途中で打ち切りました（見つからない場合は場所を絞ってください）',
        time: '時間がかかりすぎたため、途中で打ち切りました',
        depth: '深い階層（{max} 段より下）は検索していません',
        fileMatches: '1ファイルにつき {max} 件までを表示しています'
      }
    },
    note: {
      loading: '読み込み中…',
      empty: '（空のフォルダ）',
      truncated: 'ファイルが多いため、以降は表示していません',
      unavailable: '読み込めませんでした',
      retry: '再試行'
    },
    input: {
      newFolderName: '新しいフォルダ名',
      newFileName: '新しいファイル名',
      renameLabel: '{name} の新しい名前'
    },
    tree: {
      ariaLabel: '{workspace} のファイル',
      columnsAriaLabel: '{workspace} のファイル（カラム表示）',
      closeWorkspace: 'Workspace を閉じる',
      columnWidth: '{name} のカラム幅'
    },
    menu: {
      label: '{name} の操作',
      moveInto: '「{name}」をここへ移動',
      cancelMove: '移動をやめる',
      pasteInto: '「{name}」をここに貼り付け',
      cancelCopy: 'コピーをやめる',
      newFile: '新規ファイル',
      newFolder: '新規フォルダ',
      reload: '再読み込み',
      open: '開く',
      rename: '名前を変更',
      copy: 'コピー',
      move: '移動…',
      delete: '削除'
    },
    deleteConfirm: {
      ariaLabel: '削除の確認',
      file: '「{name}」をごみ箱に移動します。',
      emptyFolder: 'フォルダ「{name}」をごみ箱に移動します。',
      folderUnknown: 'フォルダ「{name}」を中身ごとごみ箱に移動します。',
      folderWithCount: 'フォルダ「{name}」を中身（{count} 件）ごとごみ箱に移動します。',
      note: 'ごみ箱から元に戻せます。',
      moveToTrash: 'ごみ箱に移動'
    },
    error: {
      treeNotFound: 'フォルダが見つかりません',
      treePermissionDenied: '読み取りが許可されていません',
      treeUnavailable: '読み込めませんでした',
      searchNotFound:
        'Workspace のフォルダが見つかりません（移動または削除された可能性があります）',
      searchPermissionDenied: 'Workspace のフォルダを読み取る権限がありません',
      searchInvalid: 'その検索語では検索できません',
      searchUnavailable: '検索できませんでした',
      nameEmpty: '名前を入力してください',
      nameTooLong: '名前が長すぎます（255 文字まで）',
      nameInvalidCharacters: '\\ / : * ? " < > | は使えません',
      nameDotName: '「.」「..」は名前として使えません',
      nameTrailingCharacter: '末尾に「.」や空白は使えません',
      nameReserved: 'Windows が予約している名前です（CON / PRN / AUX / NUL / COM1-9 / LPT1-9）',
      permissionCreate: 'この場所に作成する権限がありません',
      permissionRename: 'このファイル / フォルダの名前を変更する権限がありません',
      permissionMove: '移動元または移動先に対する権限がありません',
      permissionCopy: 'コピー元またはコピー先に対する権限がありません',
      permissionDelete: 'このファイル / フォルダを削除する権限がありません',
      unknownCreate: '作成に失敗しました',
      unknownRename: '名前の変更に失敗しました',
      unknownMove: '移動に失敗しました',
      unknownCopy: 'コピーに失敗しました',
      unknownDelete:
        '削除できませんでした（ごみ箱に送れない場所にあるか、名前が特殊な可能性があります）',
      copyPartial: 'コピーが途中で止まりました（作りかけがコピー先に残っています）',
      copyIntoSelf: 'フォルダを自分自身の中へはコピーできません',
      moveIntoSelf: 'フォルダを自分自身の中へは移動できません',
      copyLinkSource: 'リンク（symlink / ジャンクション）はコピーできません',
      conflictCopy: 'コピー先に同じ名前のものが多すぎます（名前を整理してからお試しください）',
      conflictMove: '移動先に同じ名前のファイル / フォルダが既にあります',
      conflictDefault: '同じ名前のファイル / フォルダが既にあります',
      busy: '他のアプリで使用されている可能性があります。閉じてからもう一度{action}をお試しください',
      actionCreate: '作成',
      actionRename: '名前の変更',
      actionMove: '移動',
      actionCopy: 'コピー',
      actionDelete: '削除',
      notFound: '対象が見つかりません（既に削除された可能性があります）',
      invalidLocation: 'その名前 / 場所は指定できません',
      dismissLabel: 'エラーを閉じる'
    }
  },
  editor: {
    empty: {
      title: 'ファイルが開かれていません',
      body: 'Files パネルでファイルを選ぶとここに開きます。'
    },
    tabs: {
      ariaLabel: '開いているファイル',
      closeLabel: '{name} を閉じる',
      dirty: '未保存',
      conflict: '未保存（ディスク側も変更されています）',
      deleted: '未保存（ディスク上から削除されました）'
    },
    saveAs: {
      button: '別名で保存',
      title: '保存先を選んで、このタブの内容を書き出します。',
      noticeDismissLabel: '閉じる',
      followed: '{name} へ保存しました。このタブはこのファイルを編集しています。',
      outsideWorkspace:
        '{name} へ保存しました（Workspace の外）。Workspace の外のファイルは開けないため、このタブは元のファイルを指したままです。',
      alreadyOpen:
        '{name} へ保存しました。その場所は別のタブで開いているため、このタブは切り替えていません。',
      saved: '{name} へ保存しました。'
    },
    document: {
      saving: '保存中…',
      saveError: '保存できませんでした（{message}）',
      conflictSaveBlocked: 'ディスク側が変更されているため保存していません',
      loading: '読み込み中…',
      preparingEditor: 'エディタを準備しています…',
      binary: 'バイナリファイルのため、テキストエディタでは表示できません（{size}）。',
      tooLarge: 'ファイルが大きいため表示できません（{size} / 上限 {limit}）。',
      retry: '再試行'
    },
    conflict: {
      deletedTitle:
        'このファイルはディスク上から削除されました。編集中の内容はここにだけ残っています。',
      saveAsTitle: '保存先を選んで、編集中の内容を新しいファイルとして書き出します。',
      saveAsNote: '内容を救い出す',
      title:
        'このファイルはアプリの外で変更されました。未保存の変更があるため、自動では反映していません。',
      reloadTitle: 'ディスク上の内容を読み込みます。Editor 上の未保存の変更は失われます。',
      reloadNote: '未保存の変更を破棄',
      compareTitle: 'ディスク上の内容と、Editor 上の内容を並べて比べます。',
      compareClose: '閉じる',
      compareOpen: '差分を見る',
      overwrite: '上書き保存',
      overwriteTitle: 'Editor 上の内容でディスクを書き換えます。ディスク側の変更は失われます。',
      overwriteNote: 'ディスク側の変更を破棄',
      loadingDisk: 'ディスク上の内容を読み込んでいます…',
      missingCompare: 'ディスク上から削除されているため、比べられません。',
      left: '左: ディスク上の内容',
      right: '右: Editor 上の内容（未保存）',
      preparingDiff: '差分を準備しています…'
    },
    closeConfirm: {
      title: '{name} の変更を保存しますか？',
      deletedBody:
        'このファイルはディスク上から削除されています。閉じると編集中の内容は失われます。',
      body: '保存しない場合、このファイルの未保存の変更は失われます。',
      discard: '保存しない',
      saveAndClose: '保存して閉じる',
      saving: '保存中…',
      saveFailedConflict:
        'ディスク側も変更されているため保存できませんでした。キャンセルして、Reload / Compare / 上書き から選んでください。',
      saveFailed: '保存できませんでした。内容を確認してから、もう一度お試しください。'
    },
    error: {
      tabGone: 'そのタブはもう開かれていません。',
      noWritableContent: '書き出せる中身がありません。',
      workspaceChanged: 'Workspace が切り替わりました。',
      notText: 'テキストとして読み込めませんでした。'
    }
  },
  terminal: {
    tabs: {
      ariaLabel: '開いているターミナル',
      fallbackName: 'ターミナル',
      closeLabel: '{name} を閉じる',
      newLabel: '新しいターミナル',
      newTitle: '新しいターミナル',
      shellMenuLabel: '開くシェルを選ぶ',
      settingsLabel: 'ターミナルの設定',
      foreign: '別のフォルダで起動',
      titleWithNotes: '{name}（{notes}）',
      noteSeparator: '・',
      starting: '起動中',
      exited: '終了',
      exitedWithCode: '終了 {code}',
      failed: '失敗'
    },
    notice: {
      exited: '終了しました（コード {code}）',
      retry: 'もう一度試す',
      newTerminal: '新しいターミナル'
    },
    empty: {
      message: 'ターミナルは開かれていません。＋ から新しく開けます。'
    },
    loading: 'ターミナルを準備しています…',
    settings: {
      label: 'ターミナルの設定',
      fontSize: '文字の大きさ',
      note: 'Enter か、欄から離れたときに反映されます。さかのぼれる行数は Settings の Terminal で変えられます。設定はアプリを開き直しても残ります。'
    },
    closeConfirm: {
      title: '{name} で実行中のものがあります',
      body: 'このタブを閉じると、実行中のコマンドも終了します。終了したものは戻せません。',
      runningNote: '実行中のコマンドがあります',
      close: '閉じる'
    },
    error: {
      noWorkspace: 'ターミナルを開くには、先にフォルダを開いてください。',
      tooMany: 'ターミナルを開きすぎています。使っていないものを閉じてください。',
      shellFailed: 'シェルを起動できませんでした。'
    },
    unsaved: {
      tabDetail: '{index} 番目のタブ'
    }
  },
  unsaved: {
    /** 「〜と、…。」で組み立てる（並べ方も句読点も言語で変わる）。 */
    body: '{action}と、{consequence}。',
    title: {
      filesAndTerminals: '保存されていない変更と、実行中のターミナルがあります',
      files: '保存されていない変更があります',
      terminals: '実行中のターミナルがあります'
    },
    action: {
      closeWorkspace: 'Workspace を閉じる',
      switchWorkspace: '別の Workspace へ切り替える',
      closeWindow: 'Fluvix Nexus を終了する'
    },
    consequence: {
      filesAndTerminals: '次のファイルの未保存の変更が失われ、実行中のターミナルが終了します',
      files: '次のファイルの未保存の変更が失われます',
      terminals: '次のターミナルで実行中のコマンドが終了します'
    },
    discard: {
      withoutSaving: '保存しない',
      exitWithoutSaving: '保存せずに終了',
      continueWithoutSaving: '保存せずに続ける',
      exit: '終了する',
      continue: '続ける'
    },
    saveAll: 'すべて保存',
    saveFailed:
      '保存できなかったファイルがあります。Editor で内容を確認してから、もう一度お試しください。',
    saving: '保存中…',
    note: {
      runningTerminal: '実行中のコマンドがあります',
      deletedFile: 'ディスク上から削除されています（Editor の「別名で保存」で救い出せます）'
    }
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
    openFolderEllipsis: 'フォルダを開く…',
    closeWorkspace: 'Workspace を閉じる',
    busy: '処理中…',
    viewMenu: 'View',
    layoutMenu: 'Layout: {title}',
    modified: '変更あり',
    settingsTitle: 'アプリ全体の設定を開きます。',
    settingsButton: '設定',
    resetLayout: 'レイアウトを初期化',
    emptyDock: 'パネルがありません（View メニューから表示できます）',
    closePanel: '{title} を閉じる',
    connecting: '接続中…',
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

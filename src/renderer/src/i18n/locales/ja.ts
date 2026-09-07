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
  /* 英語側（locales/en.ts の `command`）に構造の説明がある。 */
  command: {
    workspace: {
      openFolder: 'フォルダを開く',
      closeFolder: 'Workspace を閉じる'
    },
    editor: {
      save: '保存',
      saveAs: '名前を付けて保存'
    },
    view: {
      togglePanel: {
        files: 'Files パネルの表示を切り替える',
        editor: 'Editor パネルの表示を切り替える',
        terminal: 'Terminal パネルの表示を切り替える',
        git: 'Git パネルの表示を切り替える'
      },
      resetLayout: 'レイアウトを初期化'
    },
    settings: {
      open: '設定を開く',
      close: '設定を閉じる'
    },
    git: {
      refresh: 'Git の状態を調べ直す',
      commit: 'コミット',
      push: 'プッシュ',
      pull: 'プル',
      fetch: 'フェッチ',
      openHistory: 'コミット履歴を開く',
      stashPush: '作業ツリーを退避…'
    },
    files: {
      refresh: 'ファイルツリーを読み直す',
      search: {
        byName: 'ファイル名で探す',
        byContent: 'ファイルの内容で探す'
      }
    }
  },
  git: {
    common: {
      cancel: 'キャンセル',
      close: '閉じる',
      create: '作成',
      change: '変更',
      confirm: '確認',
      delete: '削除',
      discard: '変更を破棄',
      moveToTrash: 'ごみ箱に移動',
      stop: 'やめる',
      current: '現在',
      left: '左',
      right: '右',
      countOnly: '{count}',
      running: '{label}中…',
      runningSuffix: '{label} 中…'
    },
    panel: {
      branchButtonTitle: 'Branch {label} ── 切り替え / 作成',
      branchPanelLabel: 'Branch',
      historyTitle: 'Commit 履歴を見る',
      historyLabel: 'History',
      stashTitle: 'Stash を見る',
      stashLabel: 'Stash',
      remoteTitle: 'Remote を見る',
      remoteLabel: 'Remote',
      refreshTitle: 'Git の状態を再取得',
      refreshLabel: 'Git の状態を再取得',
      clean: '変更はありません。',
      stageAllTitle: '{label}をすべて Stage',
      stageAllLabel: 'すべて Stage',
      existingRepositoryLead: '既にある Repository がある場合は',
      existingRepositoryLink: '既存の Repository に接続する'
    },
    repository: {
      noWorkspaceTitle: 'Workspace が開かれていません。',
      gitUnavailableTitle: 'Git が見つかりませんでした。',
      gitUnavailableDescription:
        'この PC に Git がインストールされていないか、見つけられない場所にあります。Git をインストールしてから、もう一度お試しください。',
      notRepositoryTitle: 'このフォルダはまだ Git Repository ではありません。',
      notRepositoryDescription:
        'Git Repository にすると、変更の記録（Commit）や Branch の操作ができるようになります。GitHub への公開は、Repository にした後でいつでも選べます。',
      notRepositoryAction: 'Git Repository にする',
      nestedTitle: 'このフォルダは Git Repository「{name}」の一部です。',
      nestedDescription:
        'Repository の一部だけを開いている状態では、画面に見えていないファイルまで Commit の対象になってしまうため、Git 操作は行いません。Repository のフォルダそのものを Workspace として開き直してください。',
      noWorkTreeTitle: 'このフォルダには作業ツリーがありません。',
      noWorkTreeDescription:
        '編集するファイルを持たない Repository（bare Repository）です。clone した作業用のフォルダを Workspace として開いてください。',
      dubiousOwnershipTitle: 'Git がこのフォルダの所有者を信頼していません。',
      dubiousOwnershipDescription:
        '別のユーザーや管理者権限で作られたフォルダで起こります。Terminal パネルで git config --global --add safe.directory を実行して、このフォルダを信頼する設定を追加してください。',
      permissionDeniedTitle: 'このフォルダを読み取る権限がありません。',
      permissionDeniedDescription: 'フォルダのアクセス許可を確認してから、もう一度お試しください。',
      timeoutTitle: 'Git の応答がありませんでした。',
      timeoutDescription:
        'ネットワークドライブ上の Repository や、非常に大きな Repository で起こることがあります。もう一度お試しください。',
      failedTitle: 'Git の状態を取得できませんでした。',
      failedDescription: 'もう一度お試しください。詳しい内容はアプリのログに記録されています。',
      detachedHead: 'detached HEAD（{hash}）',
      unknownBranch: 'Branch 不明'
    },
    changes: {
      groups: {
        conflicted: 'Conflict',
        staged: 'Stage 済みの変更',
        unstaged: '変更',
        untracked: '未追跡のファイル'
      },
      kinds: {
        added: '追加',
        modified: '変更',
        deleted: '削除',
        renamed: '名前変更',
        copied: 'コピー',
        typeChanged: '種類変更',
        untracked: '未追跡',
        conflicted: 'Conflict'
      },
      row: {
        from: '{path} から',
        stage: '{path} を Stage',
        unstage: '{path} の Stage を解除',
        resolve: '{path} の Conflict を解決済みにする',
        diff: '{path} の Diff を見る',
        discard: '{path} の変更を破棄',
        label: '{path}（{kind}）'
      },
      discard: {
        untrackedMessage: '「{name}」をごみ箱に移動します。',
        untrackedNote: 'ごみ箱から元に戻せます。',
        deletedMessage: '「{name}」を、Stage 済みの内容から復元します。',
        modifiedMessage: '「{name}」の変更を、Stage 済みの内容に戻します。',
        modifiedNote: 'この変更は元に戻せません。Stage 済みの内容は変わりません。',
        blocked:
          'このファイルは Editor に未保存の変更があります。保存するかタブを閉じてから破棄してください。'
      }
    },
    operationFailure: {
      partial: {
        commit: 'Commit は完了しましたが、Push できませんでした。 ',
        githubRepository: 'GitHub の Repository は作成されました。 ',
        stashApply:
          'Stash の内容は作業ツリーに戻りましたが、Conflict しました（Stash は一覧に残しています）。 ',
        merge: 'Merge を開始し、自動で Merge できた変更は取り込みました。 '
      },
      reasons: {
        notReady: 'この Workspace では Git 操作を行えなくなりました。',
        nothingToDo: '実行することはありません。',
        identityMissing:
          'Git に記録する名前とメールアドレスが設定されていません。Terminal パネルで user.name と user.email を設定してからお試しください。',
        hookRejected:
          'Git hook がこの操作を止めました。詳しい内容は Terminal パネルかアプリのログをご確認ください。',
        unresolvedConflicts:
          '未解決の Conflict があります。内容を直してから「解決済みにする」を押してください。',
        operationInProgress: '他の Git 操作が実行中です。終わってからもう一度お試しください。',
        conflictMarkersPresent:
          'Conflict marker が残っています。Editor で <<<<<<<、=======、>>>>>>> を取り除いてからお試しください。',
        pathNotFound: '対象のファイルが見つかりませんでした。一覧を更新しました。',
        notOnBranch: 'Branch の上に居ないため、この操作は実行できません。',
        noRemote: 'Remote が設定されていません。Remote から追加してからお試しください。',
        noCommit: 'まだ Commit がありません。',
        githubCliMissing: 'GitHub CLI が見つかりませんでした。',
        githubSignedOut: 'GitHub CLI にログインしていません。',
        githubRepositoryExists:
          '同じ名前の GitHub Repository が既にあります。別の名前をお試しください。',
        noUpstream: 'この Branch には upstream が設定されていません。',
        authRequired: '認証が必要です。Terminal パネルでログインしてからお試しください。',
        networkUnavailable:
          'Remote に接続できませんでした。ネットワークを確認してからお試しください。',
        pushRejected:
          'Remote 側に手元に無い変更があるため Push できませんでした。先に Pull してからお試しください。',
        remoteRejected: 'Remote がこの操作を拒否しました。Remote の設定や権限をご確認ください。',
        diverged:
          '手元の Branch と upstream の両方に新しい変更があります。Pull して差分を解決してからお試しください。',
        unrelatedHistories:
          '共通の履歴が無い Branch のため、Merge できません。取り込む相手をご確認ください。',
        mergeConflict:
          'Conflict したファイルがあります。内容を直してから「解決済みにする」を押し、Commit してください。',
        localChangesBlocked:
          '作業ツリーの変更が上書きされるため実行できませんでした。Commit するか Stash してからお試しください。',
        branchExists: '同じ名前の Branch が既にあります。別の名前をお試しください。',
        branchNotMerged:
          'この Branch にしか無い Commit があるため削除できません。先に Merge するか、内容を確認のうえ Terminal パネルの git branch -D をご利用ください。',
        branchCheckedOut:
          'この Branch は現在チェックアウトされているため削除できません。別の Branch へ切り替えてからお試しください。',
        branchNotFound: '対象の Branch が見つかりませんでした。一覧を開き直してご確認ください。',
        commitNotFound:
          '指定した Commit が見つかりませんでした。History を開き直してご確認ください。',
        stashNotFound:
          '対象の Stash が見つかりませんでした。一覧が変わっている可能性があります。開き直してご確認ください。',
        remoteExists: '同じ名前の Remote が既にあります。別の名前をお試しください。',
        remoteNotFound: '対象の Remote が見つかりませんでした。一覧を開き直してご確認ください。',
        unsupportedTarget: 'この行はその操作の対象になりません。一覧を更新しました。',
        targetBusy:
          '対象のファイルが他のプログラムに使われています。閉じてからもう一度お試しください。',
        indexLocked:
          'Git の index.lock が残っているため実行できません。別の Git 操作が終わってからもう一度お試しください。',
        permissionDenied: 'アクセスが拒否されました。フォルダのアクセス許可をご確認ください。',
        timeout: '時間内に完了しませんでした。もう一度お試しください。',
        unknown: 'Git 操作に失敗しました。'
      }
    },
    commit: {
      placeholder: 'Commit メッセージ（Ctrl + Enter で Commit）',
      aria: 'Commit メッセージ',
      remaining: '残り {count} 文字',
      title: 'Stage 済みの変更を Commit',
      committing: 'Commit 中…',
      commit: 'Commit',
      commitAndPush: 'Commit & Push',
      commitAndPushing: 'Commit & Push 中…',
      problem: {
        empty: 'Commit メッセージを入力してください。',
        tooLong: 'Commit メッセージは {max} 文字までです。',
        invalidCharacters: 'Commit メッセージに使用できない文字が含まれています。'
      },
      readiness: {
        stageFirst: 'Commit するには、変更を Stage してください。',
        notOnBranchPush: 'Branch の上に居ないため Push できません。',
        commitAndPush: 'Stage 済みの変更を Commit して、そのまま Push します。'
      }
    },
    sync: {
      fetch: 'Fetch',
      pull: 'Pull',
      push: 'Push',
      aria: '{label} ── {note}',
      pushNotOnBranch: 'Branch の上に居ないため Push できません。',
      pushCreateUpstream: 'upstream を作って、この Branch を送ります。',
      pushNothing: '{upstream} へ送る Commit はありません。',
      pushCommits: '{count}Commit を {upstream} へ送ります。',
      pullNotOnBranch: 'Branch の上に居ないため Pull できません。',
      pullNoUpstream: 'upstream が設定されていないため Pull できません。',
      pullChanges: '{upstream} の変更を取り込みます{count}。',
      pullCount: '（{count} 件）',
      fetchNote:
        'Remote の最新の状態を取得します（取り込みは行いません）。相手から消えた Branch は一覧からも消えます。',
      upstreamUnknown: 'upstream は {name}（進み具合は取得できませんでした）',
      upstreamAheadBehind: '{name} より {ahead} 件進み、{behind} 件遅れています'
    },
    branch: {
      list: {
        loading: 'Branch を取得しています…',
        notReady: 'この Workspace では Git 操作を行えなくなりました。',
        failed: 'Branch の一覧を取得できませんでした。',
        empty: 'まだ Branch がありません。最初の Commit を作ると、この Branch が記録されます。',
        truncated: 'Branch が多いため、先頭の {count} 件だけを表示しています。'
      },
      switchCurrent: '{name}（今この Branch に居ます）',
      switchTo: '{name} へ切り替えます。',
      createEmpty: '今の場所から新しい Branch を作って切り替えます。',
      createReady: '{name} を作って切り替えます。',
      createFromCommitEmpty: '{hash} から新しい Branch を作って切り替えます。',
      createFromCommitReady: '{hash} から {name} を作って切り替えます。',
      deleteCurrent: '{name} は現在チェックアウトされているため削除できません。',
      deleteReady: '{name} を削除します。',
      mergeCurrent: '{name} は今この Branch に居るため取り込めません。',
      mergeReady: '{name} を {into} に取り込みます。',
      renameEmpty: '{name} の新しい名前を入力してください。',
      renameSame: '新しい名前を入力してください。',
      renameReady: '{name} を {newName} に変更します。',
      nameProblem: {
        empty: 'Branch 名を入力してください。',
        tooLong: 'Branch 名が長すぎます。',
        invalidCharacters: 'Branch 名に空白や ~ ^ : ? * [ \\ " < > | は使えません。',
        invalidShape:
          'この形の Branch 名は使えません（.. や / の位置、先頭の - や . をご確認ください）。',
        reserved: 'この名前は Git が別の意味で使うため、Branch 名にできません。'
      },
      deleteWarning: {
        message: 'Branch「{name}」を削除しますか？',
        note: 'この Branch にしか無い Commit がある場合、Git が削除を中止します。取り消しはできません。',
        confirm: '削除'
      },
      mergeWarning: {
        message: 'Branch「{name}」を {into} に取り込みますか？',
        note: '早送りできる場合は Merge Commit を作りません。Conflict した場合は、解決してから Commit すると完了します。',
        confirm: 'Merge'
      },
      abortWarning: {
        message: 'Merge を中止しますか？',
        note: 'Merge を開始する前の状態に戻ります。開始前からあった変更は残りますが、Conflict の解決中に書いた内容は失われます。',
        confirm: 'Merge を中止',
        title: 'Merge を中止して、開始する前の状態に戻します。',
        aria: 'Merge の中止の確認'
      },
      ui: {
        remoteSectionTitle: 'Remote Branch から、手元に Branch を作ります。',
        remoteSectionLabel: 'Remote Branch から作る',
        newBranchPlaceholder: '新しい Branch 名',
        newBranchAria: '新しい Branch 名',
        createButton: '作成',
        cancelTitle: 'やめる（Esc）',
        cancelLabel: 'やめる',
        renameTitle: '{name} の名前を変更します。',
        renameAria: '{name} の名前を変更',
        deleteAria: '{name} を削除',
        mergeAria: '{name} を取り込む',
        mergeConfirmAria: '{name} の Merge の確認',
        deleteConfirmAria: '{name} の削除の確認',
        renameInputAria: '{name} の新しい名前',
        changeButton: '変更',
        currentHint: '現在',
        trackNameAria: '{name} を追うローカル Branch 名'
      }
    },
    remoteBranch: {
      list: {
        loading: 'Remote Branch を取得しています…',
        notReady: 'この Workspace では Git 操作を行えなくなりました。',
        failed: 'Remote Branch の一覧を取得できませんでした。',
        emptyWithRemote:
          'Remote Branch がまだ手元にありません。Pull するか、Terminal パネルで git fetch を実行すると表示されます。',
        emptyWithoutRemote: 'Remote が設定されていません。上の「Remote」から追加してください。',
        truncated: 'Remote Branch が多いため、先頭の {count} 件だけを表示しています。',
        freshness: '最後に Fetch した時点の一覧です（この面では Fetch しません）。'
      },
      select: '{name} を追うローカル Branch を作ります。',
      create: '{remote} を追う {local} を作って切り替えます。'
    },
    diff: {
      aria: '{path} の Diff',
      changedByCommitTitle: 'このファイルを変えた Commit',
      closeTitle: 'Diff を閉じる（Esc）',
      closeLabel: 'Diff を閉じる',
      loading: 'Diff を読み込んでいます…',
      preparing: 'Diff を準備しています…',
      legendLeft: '左: {label}',
      legendRight: '右: {label}',
      sides: {
        notInGit: 'まだ Git にありません',
        workingTree: '作業ツリー',
        index: 'Stage 済み（index）',
        deleted: '削除されています',
        head: 'HEAD（最後の Commit）',
        currentBranchOurs: '現在の Branch（ours / stage 2）',
        incomingTheirs: '取り込み側（theirs / stage 3）',
        ours: 'ours（stage 2）',
        theirs: 'theirs（stage 3）',
        missing: 'まだありません',
        parentCommit: '親の Commit',
        thisCommit: 'この Commit',
        currentBranch: '現在の Branch',
        incoming: '取り込み側'
      },
      conflictMissingLeft: '左（{name}）にはファイルが存在しません。',
      conflictMissingRight: '右（{name}）にはファイルが存在しません。',
      conflictBothModified: '{ours}と{theirs}の両方で変更されています。',
      conflictBothAdded: '{ours}と{theirs}の両方で追加されています（共通の元がありません）。',
      conflictDeletedByThem: '{ours}では変更され、{theirs}では削除されています。',
      conflictDeletedByUs: '{ours}では削除され、{theirs}では変更されています。',
      conflictBothDeleted: '{ours}と{theirs}の両方で削除されています。',
      conflictAddedByUs: '{ours}だけで追加されています。',
      conflictAddedByThem: '{theirs}だけで追加されています。',
      titleFrom: '{path} から',
      unavailable: {
        notReady: 'この Workspace では Git 操作を行えなくなりました。',
        notFound: 'この変更は見つかりませんでした。一覧が新しくなっている可能性があります。',
        unsupportedTarget:
          'この行は Diff を出せません（フォルダや submodule にはファイルの Diff がありません）。',
        binary: 'バイナリのため Diff を表示できません。',
        tooLarge: 'ファイルが大きいため Diff を表示できません（2 MB まで）。',
        unreadable: 'Diff の内容を読み取れませんでした。',
        failed: 'Diff を取得できませんでした。'
      }
    },
    history: {
      ariaList: 'Commit 履歴',
      ariaDetail: 'Commit の変更ファイル',
      backTitle: 'History へ戻る（Esc）',
      backLabel: 'History へ戻る',
      title: 'Commit 履歴',
      detailTitle: '変更ファイル',
      closeTitle: 'History を閉じる',
      closeLabel: 'History を閉じる',
      list: {
        loading: 'History を取得しています…',
        notReady: 'この Workspace では Git 操作を行えなくなりました。',
        failed: 'History を取得できませんでした。',
        empty: 'まだ Commit がありません。最初の Commit を作ると、ここに並びます。',
        truncated: '新しい方から {count} 件だけを表示しています。'
      },
      row: {
        emptySubject: '（メッセージなし）',
        emptyAuthor: '（名前なし）',
        mergeTitle: '2つ以上の親を持つ Commit',
        mergeLabel: 'Merge',
        openCommitTitle: 'この Commit の変更ファイルを見る',
        createBranchTitle: '{hash} から Branch を作る'
      },
      time: {
        future: 'これから',
        now: 'たった今',
        minutesAgo: '{count} 分前',
        hoursAgo: '{count} 時間前',
        daysAgo: '{count} 日前',
        monthsAgo: '{count} か月前',
        yearsAgo: '{count} 年前'
      }
    },
    commitDetail: {
      loading: '変更ファイルを取得しています…',
      empty: 'この Commit で変わったファイルはありません。',
      notReady: 'この Workspace では Git 操作を行えなくなりました。',
      notFound: 'この Commit は見つかりませんでした。History が新しくなっている可能性があります。',
      merge:
        'Merge Commit は変更ファイルを表示できません（親が2つ以上あり、どちらと比べるかが決まらないため）。',
      failed: '変更ファイルを取得できませんでした。',
      truncated: '先頭から {count} 件だけを表示しています。',
      from: '{path} から',
      fileDiffTitle: '{path} の Diff を見る'
    },
    stash: {
      title: 'Stash',
      closeTitle: 'Stash を閉じる',
      closeLabel: 'Stash を閉じる',
      pushing: 'Stash しています…',
      pushButton: '作業ツリーを Stash',
      popButton: '戻す',
      popAria: '{subject} を作業ツリーへ戻す',
      dropAria: '{subject} を捨てる',
      dropConfirmAria: 'Stash を捨てる確認',
      cancel: 'やめる',
      list: {
        loading: 'Stash を取得しています…',
        notReady: 'この Workspace では Git 操作を行えなくなりました。',
        failed: 'Stash の一覧を取得できませんでした。',
        empty:
          'まだ Stash がありません。下の「作業ツリーを Stash」を押すと、今の変更をここへ避けられます。',
        truncated: 'Stash が多いため、新しい方から {count} 件だけを表示しています。'
      },
      row: {
        emptySubject: '（名前なし）'
      },
      readiness: {
        unresolvedConflicts:
          'Conflict が解決されていないため Stash できません。先に解決してからお試しください。',
        noStashableChangesUntrackedOnly:
          'Stash できる変更がありません（未追跡のファイルは Stash に含まれません）。',
        noStashableChanges: 'Stash できる変更がありません。',
        push: '{count} 件の変更を Stash し、作業ツリーを直前の Commit の状態に戻します。',
        pop: 'この Stash を作業ツリーへ戻し、一覧から取り除きます。',
        drop: 'この Stash を捨てます。'
      },
      warning: {
        message: 'Stash「{subject}」を捨てますか？',
        note: 'この Stash の中身は作業ツリーへ戻らなくなります。アプリからは取り消せません。',
        confirm: '捨てる'
      }
    },
    remote: {
      title: 'Remote',
      closeTitle: 'Remote を閉じる',
      closeLabel: 'Remote を閉じる',
      nameLabel: '名前',
      urlLabel: 'URL',
      nameAria: 'Remote 名',
      urlAria: 'Remote の URL',
      adding: '追加しています…',
      addButton: '追加',
      currentLabel: '現在',
      nextLabel: '変更後',
      currentDestination: '現在の送り先: {label}',
      cancel: 'やめる',
      setUrlConfirmAria: 'Remote の送り先を変更する確認',
      removeConfirmAria: 'Remote を削除する確認',
      newUrlAria: '{name} の新しい URL',
      newNameAria: '{name} の新しい名前',
      setUrlTitle: '{name} の送り先（URL）を変更',
      setUrlAria: '{name} の URL を変更',
      renameTitle: '{name} の名前を変更',
      renameAria: '{name} の名前を変更',
      removeAria: '{name} を削除',
      list: {
        loading: 'Remote を取得しています…',
        notReady: 'この Workspace では Git 操作を行えなくなりました。',
        failed: 'Remote の一覧を取得できませんでした。',
        empty:
          'まだ Remote がありません。下の欄に名前と URL を入れると、既にある Repository に接続できます。',
        truncated: 'Remote が多いため、先頭の {count} 件だけを表示しています。'
      },
      readiness: {
        addEmpty: '名前と URL を入れると、Remote を1つ登録します。',
        addReady: '{name} として登録します（この時点では通信しません）。',
        setUrlEmpty: '{name} の新しい URL を入力してください。',
        setUrlReady: '{name} の送り先を変更します（この時点では通信しません）。',
        renameEmpty: '{name} の新しい名前を入力してください。',
        renameSame: '新しい名前を入力してください。',
        renameCaseOnly:
          '大文字と小文字だけを変える改名は行えません（Git が途中で止まり、設定と upstream が食い違った状態になります）。別の名前を入力してください。',
        renameReady: '{name} を {newName} に変更します。',
        removeReady: '{name} を削除します。'
      },
      warning: {
        removeMessage: 'Remote「{name}」を削除しますか？',
        removeNote:
          'この Remote を追跡していた Branch の upstream も外れます。Commit は失われません。同じ URL で登録し直せます。',
        removeConfirm: '削除',
        setUrlMessage: 'Remote「{name}」の送り先を変更しますか？',
        setUrlNote:
          '取得済みの Remote 追跡情報は前の送り先のまま残るため、次の Pull まで ↑ ↓ の数は前の送り先と比べたものになります。Commit は失われません。',
        setUrlConfirm: '変更'
      },
      nameProblem: {
        empty: 'Remote 名を入力してください。',
        tooLong: 'Remote 名が長すぎます。',
        invalidCharacters: 'Remote 名に空白や . ~ ^ : ? * [ \\ " < > | は使えません。',
        invalidShape: 'この形の Remote 名は使えません（先頭の - や / の位置をご確認ください）。',
        reserved: 'この名前は Git が別の意味で使うため、Remote 名にできません。'
      },
      urlProblem: {
        empty: 'Remote の URL を入力してください。',
        tooLong: 'URL が長すぎます。',
        invalidCharacters: 'URL に空白や制御文字は使えません。',
        unsupportedScheme:
          'この形の URL は登録できません。https://… / ssh://… / user@host:path のいずれかで入力してください。',
        credentials:
          'URL に認証情報を含めることはできません。ユーザー名やトークンを除いた URL を入力してください（認証は Git の credential helper が扱います）。',
        invalidShape:
          'URL にホストか Repository の場所が足りません（例: https://github.com/owner/repo.git）。'
      }
    },
    inProgress: {
      fallback: 'Git 操作の途中のため実行できません。',
      block: '{title}この間は実行できません。{description}',
      mergeTitle: 'Merge の途中です。',
      mergeDescription:
        'Conflict を解決して「解決済みにする」を押し、Commit すると完了します。やめる場合は中止してください。',
      rebaseTitle: 'rebase の途中です。',
      rebaseDescription:
        'Fluvix Nexus は rebase を扱えないため、この間は Git の操作を止めています。Terminal パネルで `git rebase --continue` か `git rebase --abort` を実行してください。',
      cherryPickTitle: 'cherry-pick の途中です。',
      cherryPickDescription:
        'Fluvix Nexus は cherry-pick を扱えないため、この間は Git の操作を止めています。Terminal パネルで `git cherry-pick --continue` か `git cherry-pick --abort` を実行してください。',
      revertTitle: 'revert の途中です。',
      revertDescription:
        'Fluvix Nexus は revert を扱えないため、この間は Git の操作を止めています。Terminal パネルで `git revert --continue` か `git revert --abort` を実行してください。'
    },
    githubPublish: {
      openButton: 'GitHubに公開',
      title: 'GitHubに公開',
      closeTitle: '閉じる',
      closeLabel: 'GitHub に公開する面を閉じる',
      retry: 'もう一度確認する',
      namePlaceholder: 'Repository 名',
      nameAria: 'GitHub の Repository 名',
      visibilityLegend: '公開範囲',
      publishing: '公開中…',
      publishButton: '公開する',
      status: {
        loadingTitle: 'GitHub CLI を確認しています…',
        loadingDescription: '少しお待ちください。',
        cliMissingTitle: 'GitHub CLI が見つかりませんでした。',
        cliMissingDescription:
          'GitHub への公開には GitHub CLI が必要です。Terminal パネルで次のコマンドを実行してインストールし、「もう一度確認する」を押してください。',
        signedOutTitle: 'GitHub にログインしていません。',
        signedOutDescription:
          'Terminal パネルで次のコマンドを実行して GitHub にログインし、「もう一度確認する」を押してください。',
        failedTitle: 'GitHub CLI の状態を確認できませんでした。',
        failedDescription: 'もう一度お試しください。詳しい内容はアプリのログに記録されています。'
      },
      readiness: {
        checkingCli: 'GitHub CLI を確認しています…',
        cliNotReady: 'GitHub CLI の準備ができていないため公開できません。',
        empty: 'GitHub に Repository を作って、今の Branch を送ります。',
        ready: '{name} という Repository を作って公開します。'
      },
      nameProblem: {
        empty: 'Repository 名を入力してください。',
        tooLong: 'Repository 名が長すぎます。',
        invalidCharacters: 'Repository 名に使えるのは、英数字と - _ . だけです。',
        invalidShape:
          'この形の Repository 名は使えません（先頭の - や .、末尾の .git をご確認ください）。'
      },
      visibility: {
        privateLabel: '非公開（private）',
        privateNote: '自分だけが見られます。あとから GitHub 側で公開に変えられます。',
        publicLabel: '公開（public）',
        publicNote: '誰でも見られます。送った内容は取り消しても記録が残ることがあります。'
      }
    },
    initConfirm: {
      aria: 'Git Repository にする確認',
      message: '「{name}」を Git Repository にします。',
      note: 'このフォルダに .git が作られます。ファイルの中身は変わりません。',
      cancel: 'キャンセル',
      confirm: 'Repository にする'
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
      deleted: '未保存（ディスク上から削除されました）',
      titleWithNote: '{path}（{note}）'
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
      lsp: {
        title: '言語サーバー',
        description:
          '開いたコードの指摘を出す言語サーバーの設定。サーバー自体は別途インストールするもので、Fluvix Nexus には同梱されていません。'
      },
      files: {
        title: 'ファイル',
        description: 'ファイル一覧の見え方。'
      },
      terminal: {
        title: 'ターミナル',
        description: 'ターミナルの見え方。開いているタブすべてに効きます。'
      },
      keyboard: {
        title: 'キーボードショートカット',
        description: 'アプリの操作に割り当てられている打鍵の一覧。この版は閲覧のみです。'
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
      lsp: {
        enabled: {
          title: '言語サーバーを使う',
          description:
            '使わないことにすると、動いているサーバーを終了してエディター内蔵の検査に戻ります。編集・保存・検索には影響しません。'
        },
        servers: {
          title: '対象の言語',
          description:
            '言語サーバーを使う言語を選びます。上を「使わない」にしている間は効きません。'
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
      lspEnabled: {
        aria: '言語サーバーを使うか'
      },
      lspServers: {
        aria: '言語サーバーを使う言語'
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
      lsp: {
        on: '使う',
        off: '使わない'
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
    },
    /* 英語側（locales/en.ts の `settings.keyboard`）に構造の説明がある。 */
    keyboard: {
      tableLabel: 'キーボードショートカット',
      searchLabel: 'ショートカットを絞り込む',
      searchPlaceholder: '操作名・打鍵で探す',
      searchClear: 'クリア',
      noResults: '「{query}」に当てはまる操作がありません。',
      viewOnlyNote: 'この版では打鍵を変更できません。',
      terminalNote:
        'ターミナルの文字の大きさ（Ctrl と ＋ / － / 0）はターミナルパネルが受け持っており、ここには並びません。',
      columns: {
        command: '操作',
        shortcut: '打鍵'
      },
      unassigned: '未割り当て',
      categories: {
        workspace: 'Workspace',
        editor: 'Editor',
        view: 'View',
        settings: '設定',
        git: 'Git',
        files: 'Files'
      },
      sources: {
        default: '既定',
        user: 'ユーザー',
        workspace: 'Workspace'
      }
    }
  },
  /* 英語側（locales/en.ts の `lsp`）に、名前と言い回しを分けてある理由がある。 */
  lsp: {
    servers: {
      typescript: 'TypeScript / JavaScript',
      python: 'Python',
      csharp: 'C#'
    },
    status: {
      disabled: '使わない',
      unavailable: '未インストール',
      starting: '起動中…',
      ready: '利用可能',
      failed: '起動失敗',
      stopped: '停止中'
    },
    summary: {
      disabled: 'LSP: 使わない',
      unavailable: 'LSP: 未インストール',
      starting: 'LSP: 起動中…',
      ready: 'LSP: 利用可能',
      failed: 'LSP: 起動失敗',
      stopped: 'LSP: 停止中'
    },
    rename: {
      notRenameable: 'この位置の名前は変更できません。',
      invalidName: 'その名前は使えません。',
      unsupportedEdit: 'この名前変更にはファイル操作が必要なため、適用できません。',
      outsideWorkspace: 'この名前変更は Workspace の外のファイルに及ぶため、適用できません。',
      tooManyEdits: '変更箇所が多すぎるため、安全に適用できません。',
      malformed: 'Language Server の応答を適用できませんでした。',
      serverError: 'Language Server が名前を変更できませんでした。',
      stale: '名前の変更中にファイルが変わりました。もう一度実行してください。',
      writeFailed: '更新できなかったファイルがあります: {files}'
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

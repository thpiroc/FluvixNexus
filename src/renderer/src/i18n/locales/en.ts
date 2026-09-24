export const enMessages = {
  language: {
    ja: '日本語',
    en: 'English'
  },
  common: {
    actions: {
      cancel: 'Cancel',
      close: 'Close',
      retry: 'Retry',
      stop: 'Stop'
    },
    ipcError: {
      invalidRequest: 'The input is not valid.',
      notFound: 'The target could not be found.',
      conflict: 'The target conflicts with its current state.',
      busy: 'The target may be in use by another app. Close it and try again.',
      permissionDenied: 'This operation is not allowed.',
      unsupported: 'This environment does not support that operation.',
      cancelled: 'The operation was cancelled.',
      channelUnavailable: 'App communication failed. Try restarting the app.',
      internal: 'An unexpected error occurred.'
    }
  },
  /*
    Command の表示名（Session 4-7C）。

    key は `command.<CommandId>` に1対1で対応させてある
    （`commands/registry.ts` の `titleKey`）── 対応が機械的なので、
    足し忘れも綴り違いも commandLocalization.test.ts が実数で拾う。

    **既存の UI ラベルを流用していない。** `git.panel.refreshLabel` などは
    パネルのボタンのための文言で、長さも文脈も違う ── key を共有すると、
    片方を直したときにもう片方が黙って変わる。重複はここでは意図したものになる。

    **カテゴリを名前に埋め込まない**（`'Git: Commit'` にしない）。
    どのカテゴリのものかは一覧の見出しが持つ
    （settings/KeyboardShortcutsView.tsx）。
  */
  command: {
    workspace: {
      openFolder: 'Open Folder',
      closeFolder: 'Close Workspace'
    },
    editor: {
      save: 'Save',
      saveAs: 'Save As',
      goToDefinition: 'Go to Definition',
      findReferences: 'Find All References',
      renameSymbol: 'Rename Symbol',
      formatDocument: 'Format Document',
      triggerSuggest: 'Trigger Suggest',
      showHover: 'Show Hover'
    },
    view: {
      togglePanel: {
        files: 'Toggle Files Panel',
        editor: 'Toggle Editor Panel',
        terminal: 'Toggle Terminal Panel',
        git: 'Toggle Git Panel',
        debug: 'Toggle Debug Panel'
      },
      resetLayout: 'Reset Layout'
    },
    settings: {
      open: 'Open Settings',
      close: 'Close Settings'
    },
    debug: {
      addProfile: 'Add Debug Profile',
      editProfile: 'Edit Debug Profile',
      deleteProfile: 'Delete Debug Profile',
      startOrContinue: 'Start / Continue Debugging',
      start: 'Start Debugging',
      continue: 'Continue Debugging',
      pause: 'Pause Debugging',
      stepOver: 'Step Over',
      stepInto: 'Step Into',
      stepOut: 'Step Out',
      stop: 'Stop Debugging',
      toggleBreakpoint: 'Toggle Breakpoint'
    },
    git: {
      refresh: 'Refresh Git Status',
      commit: 'Commit',
      push: 'Push',
      pull: 'Pull',
      fetch: 'Fetch',
      openHistory: 'Open Commit History',
      stashPush: 'Stash Working Tree…'
    },
    files: {
      refresh: 'Reload File Tree',
      search: {
        byName: 'Search by File Name',
        byContent: 'Search File Contents'
      }
    }
  },
  git: {
    common: {
      cancel: 'Cancel',
      close: 'Close',
      create: 'Create',
      change: 'Change',
      confirm: 'Confirm',
      delete: 'Delete',
      discard: 'Discard Changes',
      moveToTrash: 'Move to Recycle Bin',
      stop: 'Stop',
      current: 'Current',
      left: 'Left',
      right: 'Right',
      countOnly: '{count}',
      running: '{label}…',
      runningSuffix: '{label} in progress…'
    },
    panel: {
      branchButtonTitle: 'Branch {label} -- switch / create',
      branchPanelLabel: 'Branch',
      historyTitle: 'View Commit history',
      historyLabel: 'History',
      stashTitle: 'View Stash',
      stashLabel: 'Stash',
      remoteTitle: 'View Remote',
      remoteLabel: 'Remote',
      refreshTitle: 'Refresh Git status',
      refreshLabel: 'Refresh Git status',
      clean: 'No changes.',
      stageAllTitle: 'Stage all {label}',
      stageAllLabel: 'Stage All',
      existingRepositoryLead: 'If you already have a Repository,',
      existingRepositoryLink: 'connect to an existing Repository'
    },
    repository: {
      noWorkspaceTitle: 'No Workspace is open.',
      gitUnavailableTitle: 'Git was not found.',
      gitUnavailableDescription:
        'Git may not be installed on this PC, or it may be somewhere Fluvix Nexus cannot find. Install Git, then try again.',
      notRepositoryTitle: 'This folder is not a Git Repository yet.',
      notRepositoryDescription:
        'Making it a Git Repository lets you record changes with Commit and work with Branches. You can publish to GitHub any time after creating the Repository.',
      notRepositoryAction: 'Make Git Repository',
      nestedTitle: 'This folder is part of the Git Repository "{name}".',
      nestedDescription:
        'Git operations are disabled when only part of a Repository is open because files outside the view could be included in Commit. Open the Repository folder itself as the Workspace.',
      noWorkTreeTitle: 'This folder does not have a working tree.',
      noWorkTreeDescription:
        'This is a bare Repository with no editable files. Open a cloned working folder as the Workspace.',
      dubiousOwnershipTitle: 'Git does not trust the owner of this folder.',
      dubiousOwnershipDescription:
        'This can happen with folders created by another user or with administrator privileges. Run git config --global --add safe.directory in the Terminal panel to trust this folder.',
      permissionDeniedTitle: 'You do not have permission to read this folder.',
      permissionDeniedDescription: 'Check the folder permissions, then try again.',
      timeoutTitle: 'Git did not respond.',
      timeoutDescription:
        'This can happen with repositories on network drives or very large repositories. Try again.',
      failedTitle: 'Could not read Git status.',
      failedDescription: 'Try again. Details were written to the app log.',
      detachedHead: 'detached HEAD ({hash})',
      unknownBranch: 'Unknown Branch'
    },
    changes: {
      groups: {
        conflicted: 'Conflict',
        staged: 'Staged Changes',
        unstaged: 'Changes',
        untracked: 'Untracked Files'
      },
      kinds: {
        added: 'Added',
        modified: 'Modified',
        deleted: 'Deleted',
        renamed: 'Renamed',
        copied: 'Copied',
        typeChanged: 'Type changed',
        untracked: 'Untracked',
        conflicted: 'Conflict'
      },
      row: {
        from: 'from {path}',
        stage: 'Stage {path}',
        unstage: 'Unstage {path}',
        resolve: 'Mark {path} as resolved',
        diff: 'View Diff for {path}',
        discard: 'Discard changes in {path}',
        label: '{path} ({kind})'
      },
      discard: {
        untrackedMessage: 'Move "{name}" to the Recycle Bin.',
        untrackedNote: 'You can restore it from the Recycle Bin.',
        deletedMessage: 'Restore "{name}" from the staged content.',
        modifiedMessage: 'Revert changes in "{name}" to the staged content.',
        modifiedNote: 'This change cannot be restored. The staged content will not change.',
        blocked:
          'This file has unsaved changes in Editor. Save it or close the tab before discarding changes.'
      }
    },
    operationFailure: {
      partial: {
        commit: 'Commit completed, but Push failed. ',
        githubRepository: 'The GitHub Repository was created. ',
        stashApply:
          'The Stash contents were restored to the working tree, but conflicts occurred. The Stash remains in the list. ',
        merge: 'Merge started and automatically merged changes were applied. '
      },
      reasons: {
        notReady: 'Git operations are no longer available in this Workspace.',
        nothingToDo: 'There is nothing to do.',
        identityMissing:
          'Git does not know who should be recorded as the author. Set user.name and user.email in the Terminal panel, then try again.',
        hookRejected:
          'A Git hook stopped this operation. Check the Terminal panel or app log for details.',
        unresolvedConflicts:
          'There are unresolved conflicts. Fix the files, then mark them as resolved.',
        operationInProgress:
          'Another Git operation is in progress. Wait for it to finish, then try again.',
        conflictMarkersPresent:
          'Conflict markers remain in this file. Remove <<<<<<<, =======, and >>>>>>> in the Editor, then try again.',
        pathNotFound: 'The target file could not be found. The list has been refreshed.',
        notOnBranch: 'You are not on a Branch, so this operation cannot run.',
        noRemote: 'No Remote is configured. Add one from Remote, then try again.',
        noCommit: 'There is no Commit yet.',
        githubCliMissing: 'GitHub CLI was not found.',
        githubSignedOut: 'GitHub CLI is not signed in.',
        githubRepositoryExists:
          'A GitHub Repository with the same name already exists. Choose another name.',
        noUpstream: 'No upstream is configured for this Branch.',
        authRequired:
          'Authentication is required. Sign in from the Terminal panel, then try again.',
        networkUnavailable:
          'Could not reach the Remote. Check the network connection, then try again.',
        pushRejected:
          'Push was rejected because the Remote has changes you do not have. Pull first, then try again.',
        remoteRejected:
          'The Remote rejected this operation. Check the Remote settings and permissions.',
        diverged:
          'The local Branch and upstream have both moved forward. Pull and resolve the differences, then try again.',
        unrelatedHistories:
          'This Branch cannot be merged because the histories are unrelated. Check the Branch you are merging.',
        mergeConflict: 'Some files conflicted. Fix them, mark them as resolved, then Commit.',
        localChangesBlocked:
          'This operation would overwrite working tree changes. Commit or Stash them, then try again.',
        branchExists: 'A Branch with the same name already exists. Try another name.',
        branchNotMerged:
          'This Branch has Commits that only exist here, so it cannot be deleted. Merge it first or, after checking the contents, use git branch -D in the Terminal panel.',
        branchCheckedOut:
          'This Branch is currently checked out. Switch to another Branch, then try again.',
        branchNotFound: 'The target Branch could not be found. Reopen the list and check again.',
        commitNotFound: 'The specified Commit could not be found. Reopen History and check again.',
        stashNotFound:
          'The target Stash could not be found. The list may have changed. Reopen it and check again.',
        remoteExists: 'A Remote with the same name already exists. Try another name.',
        remoteNotFound: 'The target Remote could not be found. Reopen the list and check again.',
        unsupportedTarget:
          'This row is not a valid target for that operation. The list was refreshed.',
        targetBusy: 'The target file is being used by another program. Close it, then try again.',
        indexLocked:
          'Git index.lock is still present. Wait for the other Git operation to finish, then try again.',
        permissionDenied: 'Access was denied. Check the folder permissions.',
        timeout: 'The operation did not finish in time. Try again.',
        unknown: 'Git operation failed.'
      }
    },
    commit: {
      placeholder: 'Commit message (Ctrl + Enter to Commit)',
      aria: 'Commit message',
      remaining: '{count} characters left',
      title: 'Commit staged changes',
      committing: 'Committing…',
      commit: 'Commit',
      commitAndPush: 'Commit & Push',
      commitAndPushing: 'Commit & Push in progress…',
      problem: {
        empty: 'Enter a Commit message.',
        tooLong: 'Commit messages can be up to {max} characters.',
        invalidCharacters: 'The Commit message contains characters that cannot be used.'
      },
      readiness: {
        stageFirst: 'Stage changes before Commit.',
        notOnBranchPush: 'Cannot Push because you are not on a Branch.',
        commitAndPush: 'Commit the staged changes, then Push them.'
      }
    },
    sync: {
      fetch: 'Fetch',
      pull: 'Pull',
      push: 'Push',
      aria: '{label} -- {note}',
      pushNotOnBranch: 'Cannot Push because you are not on a Branch.',
      pushCreateUpstream: 'Create an upstream and Push this Branch.',
      pushNothing: 'There are no Commits to Push to {upstream}.',
      pushCommits: 'Push {count}Commits to {upstream}.',
      pullNotOnBranch: 'Cannot Pull because you are not on a Branch.',
      pullNoUpstream: 'Cannot Pull because no upstream is configured.',
      pullChanges: 'Pull changes from {upstream}{count}.',
      pullCount: ' ({count})',
      fetchNote:
        'Fetch the latest Remote state without merging. Branches deleted on the other side will also disappear from the list.',
      upstreamUnknown: 'Upstream is {name} (progress could not be read)',
      upstreamAheadBehind: '{name}: {ahead} ahead, {behind} behind'
    },
    branch: {
      list: {
        loading: 'Fetching Branches…',
        notReady: 'Git operations are no longer available in this Workspace.',
        failed: 'Could not fetch Branch list.',
        empty: 'There are no Branches yet. Create the first Commit to record this Branch.',
        truncated: 'There are many Branches, so only the first {count} are shown.'
      },
      switchCurrent: '{name} (currently on this Branch)',
      switchTo: 'Switch to {name}.',
      createEmpty: 'Create a new Branch from the current location and switch to it.',
      createReady: 'Create {name} and switch to it.',
      createFromCommitEmpty: 'Create a new Branch from {hash} and switch to it.',
      createFromCommitReady: 'Create {name} from {hash} and switch to it.',
      deleteCurrent: '{name} is currently checked out, so it cannot be deleted.',
      deleteReady: 'Delete {name}.',
      mergeCurrent: '{name} is the current Branch, so it cannot be merged into itself.',
      mergeReady: 'Merge {name} into {into}.',
      renameEmpty: 'Enter a new name for {name}.',
      renameSame: 'Enter a new name.',
      renameReady: 'Rename {name} to {newName}.',
      nameProblem: {
        empty: 'Enter a Branch name.',
        tooLong: 'The Branch name is too long.',
        invalidCharacters: 'Branch names cannot contain spaces or ~ ^ : ? * [ \\ " < > |.',
        invalidShape:
          'This Branch name cannot be used. Check .., slash positions, leading -, and leading ..',
        reserved: 'This name is reserved by Git and cannot be used as a Branch name.'
      },
      deleteWarning: {
        message: 'Delete Branch "{name}"?',
        note: 'If this Branch has Commits that only exist here, Git will stop the deletion. This cannot be undone.',
        confirm: 'Delete'
      },
      mergeWarning: {
        message: 'Merge Branch "{name}" into {into}?',
        note: 'If this can fast-forward, no merge Commit will be created. If conflicts occur, resolve them and Commit to finish.',
        confirm: 'Merge'
      },
      abortWarning: {
        message: 'Abort Merge?',
        note: 'The Repository will return to the state before Merge started. Changes from before Merge started remain, but conflict-resolution edits made during Merge will be lost.',
        confirm: 'Abort Merge',
        title: 'Abort Merge and return to the state before it started.',
        aria: 'Confirm Abort Merge'
      },
      ui: {
        remoteSectionTitle: 'Create a local Branch from a Remote Branch.',
        remoteSectionLabel: 'Create from Remote Branches',
        newBranchPlaceholder: 'New Branch name',
        newBranchAria: 'New Branch name',
        createButton: 'Create',
        cancelTitle: 'Cancel (Esc)',
        cancelLabel: 'Cancel',
        renameTitle: 'Rename {name}.',
        renameAria: 'Rename {name}',
        deleteAria: 'Delete {name}',
        mergeAria: 'Merge {name}',
        mergeConfirmAria: 'Confirm Merge for {name}',
        deleteConfirmAria: 'Confirm Delete for {name}',
        renameInputAria: 'New name for {name}',
        changeButton: 'Change',
        currentHint: 'Current',
        trackNameAria: 'Local Branch name tracking {name}'
      }
    },
    remoteBranch: {
      list: {
        loading: 'Fetching Remote Branches…',
        notReady: 'Git operations are no longer available in this Workspace.',
        failed: 'Could not fetch Remote Branch list.',
        emptyWithRemote:
          'No Remote Branches are available locally yet. Pull, or run git fetch in the Terminal panel, to show them.',
        emptyWithoutRemote: 'No Remote is configured. Add one from Remote above.',
        truncated: 'There are many Remote Branches, so only the first {count} are shown.',
        freshness: 'This list is from the last Fetch. This panel does not Fetch.'
      },
      select: 'Create a local Branch tracking {name}.',
      create: 'Create {local} tracking {remote} and switch to it.'
    },
    diff: {
      aria: 'Diff for {path}',
      changedByCommitTitle: 'Commit that changed this file',
      closeTitle: 'Close Diff (Esc)',
      closeLabel: 'Close Diff',
      loading: 'Loading Diff…',
      preparing: 'Preparing Diff…',
      legendLeft: 'Left: {label}',
      legendRight: 'Right: {label}',
      sides: {
        notInGit: 'Not in Git yet',
        workingTree: 'working tree',
        index: 'staged (index)',
        deleted: 'Deleted',
        head: 'HEAD (last Commit)',
        currentBranchOurs: 'current Branch (ours / stage 2)',
        incomingTheirs: 'incoming side (theirs / stage 3)',
        ours: 'ours (stage 2)',
        theirs: 'theirs (stage 3)',
        missing: 'Not present yet',
        parentCommit: 'parent Commit',
        thisCommit: 'this Commit',
        currentBranch: 'current Branch',
        incoming: 'incoming side'
      },
      conflictMissingLeft: 'The file does not exist on the left ({name}).',
      conflictMissingRight: 'The file does not exist on the right ({name}).',
      conflictBothModified: 'Both {ours} and {theirs} modified this file.',
      conflictBothAdded: 'Both {ours} and {theirs} added this file with no common base.',
      conflictDeletedByThem: '{ours} modified this file, and {theirs} deleted it.',
      conflictDeletedByUs: '{ours} deleted this file, and {theirs} modified it.',
      conflictBothDeleted: 'Both {ours} and {theirs} deleted this file.',
      conflictAddedByUs: 'Only {ours} added this file.',
      conflictAddedByThem: 'Only {theirs} added this file.',
      titleFrom: 'from {path}',
      unavailable: {
        notReady: 'Git operations are no longer available in this Workspace.',
        notFound: 'This change could not be found. The list may have been refreshed.',
        unsupportedTarget:
          'Diff is not available for this row. Folders and submodules do not have file Diffs.',
        binary: 'Cannot show Diff for binary files.',
        tooLarge: 'Cannot show Diff because the file is too large (2 MB max).',
        unreadable: 'Could not read Diff content.',
        failed: 'Could not fetch Diff.'
      }
    },
    history: {
      ariaList: 'Commit History',
      ariaDetail: 'Changed files in Commit',
      backTitle: 'Back to History (Esc)',
      backLabel: 'Back to History',
      title: 'Commit History',
      detailTitle: 'Changed Files',
      closeTitle: 'Close History',
      closeLabel: 'Close History',
      list: {
        loading: 'Fetching History…',
        notReady: 'Git operations are no longer available in this Workspace.',
        failed: 'Could not fetch History.',
        empty: 'There are no Commits yet. Create the first Commit to show it here.',
        truncated: 'Only the newest {count} are shown.'
      },
      row: {
        emptySubject: '(No message)',
        emptyAuthor: '(No name)',
        mergeTitle: 'Commit with two or more parents',
        mergeLabel: 'Merge',
        openCommitTitle: 'View changed files in this Commit',
        createBranchTitle: 'Create a Branch from {hash}'
      },
      time: {
        future: 'in the future',
        now: 'just now',
        minutesAgo: '{count} minutes ago',
        hoursAgo: '{count} hours ago',
        daysAgo: '{count} days ago',
        monthsAgo: '{count} months ago',
        yearsAgo: '{count} years ago'
      }
    },
    commitDetail: {
      loading: 'Fetching changed files…',
      empty: 'No files changed in this Commit.',
      notReady: 'Git operations are no longer available in this Workspace.',
      notFound: 'This Commit could not be found. History may have been refreshed.',
      merge:
        'Merge Commits cannot show changed files because there are two or more parents and no single parent to compare against.',
      failed: 'Could not fetch changed files.',
      truncated: 'Only the first {count} files are shown.',
      from: 'from {path}',
      fileDiffTitle: 'View Diff for {path}'
    },
    stash: {
      title: 'Stash',
      closeTitle: 'Close Stash',
      closeLabel: 'Close Stash',
      pushing: 'Stashing…',
      pushButton: 'Stash Working Tree',
      popButton: 'Apply',
      popAria: 'Apply {subject} to the working tree',
      dropAria: 'Drop {subject}',
      dropConfirmAria: 'Confirm Drop Stash',
      cancel: 'Cancel',
      list: {
        loading: 'Fetching Stash…',
        notReady: 'Git operations are no longer available in this Workspace.',
        failed: 'Could not fetch Stash list.',
        empty:
          'There is no Stash yet. Press "Stash Working Tree" below to move current changes here.',
        truncated: 'There are many Stashes, so only the newest {count} are shown.'
      },
      row: {
        emptySubject: '(No name)'
      },
      readiness: {
        unresolvedConflicts:
          'Cannot Stash because conflicts are unresolved. Resolve them first, then try again.',
        noStashableChangesUntrackedOnly:
          'There are no changes that can be Stashed. Untracked files are not included.',
        noStashableChanges: 'There are no changes that can be Stashed.',
        push: 'Stash {count} changes and return the working tree to the previous Commit.',
        pop: 'Apply this Stash to the working tree and remove it from the list.',
        drop: 'Drop this Stash.'
      },
      warning: {
        message: 'Drop Stash "{subject}"?',
        note: 'The contents of this Stash will no longer be applied to the working tree. This cannot be undone from the app.',
        confirm: 'Drop'
      }
    },
    remote: {
      title: 'Remote',
      closeTitle: 'Close Remote',
      closeLabel: 'Close Remote',
      nameLabel: 'Name',
      urlLabel: 'URL',
      nameAria: 'Remote name',
      urlAria: 'Remote URL',
      adding: 'Adding…',
      addButton: 'Add',
      currentLabel: 'Current',
      nextLabel: 'After Change',
      currentDestination: 'Current destination: {label}',
      cancel: 'Cancel',
      setUrlConfirmAria: 'Confirm Remote destination change',
      removeConfirmAria: 'Confirm Remove Remote',
      newUrlAria: 'New URL for {name}',
      newNameAria: 'New name for {name}',
      setUrlTitle: 'Change destination (URL) for {name}',
      setUrlAria: 'Change URL for {name}',
      renameTitle: 'Rename {name}',
      renameAria: 'Rename {name}',
      removeAria: 'Remove {name}',
      list: {
        loading: 'Fetching Remotes…',
        notReady: 'Git operations are no longer available in this Workspace.',
        failed: 'Could not fetch Remote list.',
        empty:
          'No Remote is configured yet. Enter a name and URL below to connect to an existing Repository.',
        truncated: 'There are many Remotes, so only the first {count} are shown.'
      },
      readiness: {
        addEmpty: 'Enter a name and URL to register a Remote.',
        addReady: 'Register {name} without connecting yet.',
        setUrlEmpty: 'Enter a new URL for {name}.',
        setUrlReady: 'Change the destination for {name} without connecting yet.',
        renameEmpty: 'Enter a new name for {name}.',
        renameSame: 'Enter a new name.',
        renameCaseOnly:
          'Renaming only by letter case is not available because Git can stop midway and leave settings and upstreams inconsistent. Enter another name.',
        renameReady: 'Rename {name} to {newName}.',
        removeReady: 'Remove {name}.'
      },
      warning: {
        removeMessage: 'Remove Remote "{name}"?',
        removeNote:
          'Branches that tracked this Remote will lose their upstream. Commits will not be lost. You can add it again with the same URL.',
        removeConfirm: 'Delete',
        setUrlMessage: 'Change destination for Remote "{name}"?',
        setUrlNote:
          'Existing remote-tracking information will still point to the previous destination, so until the next Pull the ↑ ↓ counts compare against the previous destination. Commits will not be lost.',
        setUrlConfirm: 'Change'
      },
      nameProblem: {
        empty: 'Enter a Remote name.',
        tooLong: 'The Remote name is too long.',
        invalidCharacters: 'Remote names cannot contain spaces or . ~ ^ : ? * [ \\ " < > |.',
        invalidShape: 'This Remote name cannot be used. Check leading - and slash positions.',
        reserved: 'This name is reserved by Git and cannot be used as a Remote name.'
      },
      urlProblem: {
        empty: 'Enter the Remote URL.',
        tooLong: 'The URL is too long.',
        invalidCharacters: 'URLs cannot contain spaces or control characters.',
        unsupportedScheme:
          'This URL form cannot be registered. Use https://..., ssh://..., or user@host:path.',
        credentials:
          'URLs cannot include credentials. Enter the URL without a username or token. Authentication is handled by Git credential helper.',
        invalidShape:
          'The URL is missing a host or Repository path, for example https://github.com/owner/repo.git.'
      }
    },
    inProgress: {
      fallback: 'Cannot run because a Git operation is in progress.',
      block: '{title} Cannot run during this operation. {description}',
      mergeTitle: 'Merge is in progress.',
      mergeDescription:
        'Resolve conflicts, mark them as resolved, then Commit to finish. To stop, abort the Merge.',
      rebaseTitle: 'rebase is in progress.',
      rebaseDescription:
        'Fluvix Nexus cannot handle rebase, so Git operations are stopped for now. Run `git rebase --continue` or `git rebase --abort` in the Terminal panel.',
      cherryPickTitle: 'cherry-pick is in progress.',
      cherryPickDescription:
        'Fluvix Nexus cannot handle cherry-pick, so Git operations are stopped for now. Run `git cherry-pick --continue` or `git cherry-pick --abort` in the Terminal panel.',
      revertTitle: 'revert is in progress.',
      revertDescription:
        'Fluvix Nexus cannot handle revert, so Git operations are stopped for now. Run `git revert --continue` or `git revert --abort` in the Terminal panel.'
    },
    githubPublish: {
      openButton: 'Publish to GitHub',
      title: 'Publish to GitHub',
      closeTitle: 'Close',
      closeLabel: 'Close Publish to GitHub panel',
      retry: 'Check Again',
      namePlaceholder: 'Repository name',
      nameAria: 'GitHub Repository name',
      visibilityLegend: 'Visibility',
      publishing: 'Publishing…',
      publishButton: 'Publish',
      status: {
        loadingTitle: 'Checking GitHub CLI…',
        loadingDescription: 'Please wait.',
        cliMissingTitle: 'GitHub CLI was not found.',
        cliMissingDescription:
          'Publishing to GitHub requires GitHub CLI. Run the following command in the Terminal panel, then press "Check Again".',
        signedOutTitle: 'You are not signed in to GitHub.',
        signedOutDescription:
          'Run the following command in the Terminal panel to sign in to GitHub, then press "Check Again".',
        failedTitle: 'Could not check GitHub CLI status.',
        failedDescription: 'Try again. Details were written to the app log.'
      },
      readiness: {
        checkingCli: 'Checking GitHub CLI…',
        cliNotReady: 'Cannot publish because GitHub CLI is not ready.',
        empty: 'Create a Repository on GitHub and Push the current Branch.',
        ready: 'Create and publish a Repository named {name}.'
      },
      nameProblem: {
        empty: 'Enter a Repository name.',
        tooLong: 'The Repository name is too long.',
        invalidCharacters: 'Repository names can only use letters, numbers, -, _, and ..',
        invalidShape:
          'This Repository name cannot be used. Check leading -, leading ., and trailing .git.'
      },
      visibility: {
        privateLabel: 'Private',
        privateNote: 'Only you can see it. You can make it public later on GitHub.',
        publicLabel: 'Public',
        publicNote: 'Anyone can see it. Sent content may remain in records even if you undo it.'
      }
    },
    initConfirm: {
      aria: 'Confirm Make Git Repository',
      message: 'Make "{name}" a Git Repository.',
      note: 'A .git folder will be created in this folder. File contents will not change.',
      cancel: 'Cancel',
      confirm: 'Make Repository'
    }
  },
  files: {
    toolbar: {
      newFileLabel: 'New File',
      newFileTitle: 'New File ({target})',
      newFolderLabel: 'New Folder',
      newFolderTitle: 'New Folder ({target})',
      searchLabel: 'Search the whole project',
      searchTitle: 'Search the whole project (file names / contents)',
      reloadLabel: 'Reload file tree',
      reloadTitle: 'Reload'
    },
    view: {
      groupLabel: 'Files view mode',
      tree: 'Tree view',
      columns: 'Column view',
      selectedTitle: '{label} (selected. Press again to follow the panel shape)',
      switchTitle: 'Switch to {label}'
    },
    pending: {
      move: 'Right-click the destination folder for "{name}" and choose "Move Here".',
      copy: 'Copied "{name}". Right-click the destination folder and choose "Paste Here".',
      cancel: 'Cancel',
      copyNotice: 'Copied "{name}" ({count} link-like items were skipped)',
      copyNoticeCloseLabel: 'Close copy result',
      close: 'Close'
    },
    drag: {
      copy: 'Copy',
      move: 'Move',
      copyHint: 'Hold Ctrl to copy'
    },
    search: {
      backLabel: 'Back to file tree',
      modeGroupLabel: 'Search mode',
      nameMode: 'File name',
      contentMode: 'Contents',
      namePlaceholder: 'Search by file name',
      nameInputLabel: 'Search {workspace} by file name',
      contentPlaceholder: 'Search file contents',
      contentInputLabel: 'Search file contents in {workspace}',
      clearLabel: 'Clear search term',
      cancel: 'Stop',
      retry: 'Try Again',
      nameResultsLabel: 'File name search results',
      contentResultsLabel: 'Content search results',
      fileMatchCount: '{count} matches',
      fileMatchCountTruncated: '{count}+ matches',
      searching: 'Searching…',
      noFiles: 'No matching files',
      found: '{count} matches',
      cancelled: 'Search stopped',
      cancelledWithCount: 'Search stopped ({count} matches shown)',
      noText: 'No matching text',
      foundContent: '{matchCount} matches ({fileCount} files)',
      cancelledContentWithCount: 'Search stopped ({matchCount} matches in {fileCount} files shown)',
      summaryWithLimit: '{summary} — {limit}',
      limits: {
        results: 'Showing up to the limit ({max} matches). Add terms to narrow the search.',
        matches: 'Showing up to the limit ({max} matches). Add terms to narrow the search.',
        files: 'Stopped after reading {max} files because there are many files.',
        scanned:
          'Stopped partway through because there are many files. Narrow the location if nothing appears.',
        time: 'Stopped partway through because the search took too long.',
        depth: 'Skipped deep folders below {max} levels.',
        fileMatches: 'Showing up to {max} matches per file.'
      }
    },
    note: {
      loading: 'Loading…',
      empty: '(Empty folder)',
      truncated: 'There are too many files, so the rest are not shown.',
      unavailable: 'Could not load.',
      retry: 'Retry'
    },
    input: {
      newFolderName: 'New folder name',
      newFileName: 'New file name',
      renameLabel: 'New name for {name}'
    },
    tree: {
      ariaLabel: '{workspace} files',
      columnsAriaLabel: '{workspace} files (column view)',
      closeWorkspace: 'Close Workspace',
      columnWidth: '{name} column width'
    },
    menu: {
      label: '{name} actions',
      moveInto: 'Move "{name}" Here',
      cancelMove: 'Cancel Move',
      pasteInto: 'Paste "{name}" Here',
      cancelCopy: 'Cancel Copy',
      newFile: 'New File',
      newFolder: 'New Folder',
      reload: 'Reload',
      open: 'Open',
      rename: 'Rename',
      copy: 'Copy',
      move: 'Move…',
      delete: 'Delete'
    },
    deleteConfirm: {
      ariaLabel: 'Delete Confirmation',
      file: 'Move "{name}" to the Recycle Bin.',
      emptyFolder: 'Move folder "{name}" to the Recycle Bin.',
      folderUnknown: 'Move folder "{name}" and its contents to the Recycle Bin.',
      folderWithCount: 'Move folder "{name}" and its contents ({count} items) to the Recycle Bin.',
      note: 'You can restore it from the Recycle Bin.',
      moveToTrash: 'Move to Recycle Bin'
    },
    error: {
      treeNotFound: 'Folder not found',
      treePermissionDenied: 'Reading is not allowed',
      treeUnavailable: 'Could not load.',
      searchNotFound: 'The Workspace folder could not be found. It may have been moved or deleted.',
      searchPermissionDenied: 'You do not have permission to read the Workspace folder.',
      searchInvalid: 'That search term cannot be used.',
      searchUnavailable: 'Could not search.',
      nameEmpty: 'Enter a name',
      nameTooLong: 'The name is too long (255 characters max).',
      nameInvalidCharacters: '\\ / : * ? " < > | cannot be used.',
      nameDotName: '". " and ".." cannot be used as names.',
      nameTrailingCharacter: 'Names cannot end with "." or a space.',
      nameReserved: 'That name is reserved by Windows (CON / PRN / AUX / NUL / COM1-9 / LPT1-9).',
      permissionCreate: 'You do not have permission to create items here.',
      permissionRename: 'You do not have permission to rename this file or folder.',
      permissionMove: 'You do not have permission for the source or destination.',
      permissionCopy: 'You do not have permission for the source or destination.',
      permissionDelete: 'You do not have permission to delete this file or folder.',
      unknownCreate: 'Could not create it.',
      unknownRename: 'Could not rename it.',
      unknownMove: 'Could not move it.',
      unknownCopy: 'Could not copy it.',
      unknownDelete:
        'Could not delete it. It may be in a location without Recycle Bin support or have a special name.',
      copyPartial: 'Copy stopped partway through. A partial copy remains at the destination.',
      copyIntoSelf: 'Folders cannot be copied into themselves.',
      moveIntoSelf: 'Folders cannot be moved into themselves.',
      copyLinkSource: 'Links (symlinks / junctions) cannot be copied.',
      conflictCopy:
        'There are too many similarly named items at the destination. Clean up names and try again.',
      conflictMove: 'A file or folder with the same name already exists at the destination.',
      conflictDefault: 'A file or folder with the same name already exists.',
      busy: 'It may be in use by another app. Close it and try {action} again.',
      actionCreate: 'creating it',
      actionRename: 'renaming it',
      actionMove: 'moving it',
      actionCopy: 'copying it',
      actionDelete: 'deleting it',
      notFound: 'The target could not be found. It may have already been deleted.',
      invalidLocation: 'That name or location cannot be used.',
      dismissLabel: 'Close error'
    }
  },
  editor: {
    empty: {
      title: 'No File Open',
      body: 'Select a file in the Files panel to open it here.'
    },
    tabs: {
      ariaLabel: 'Open files',
      closeLabel: 'Close {name}',
      dirty: 'Unsaved',
      conflict: 'Unsaved (also changed on disk)',
      deleted: 'Unsaved (deleted from disk)',
      titleWithNote: '{path} ({note})'
    },
    saveAs: {
      button: 'Save As',
      title: 'Choose where to save this tab.',
      noticeDismissLabel: 'Close',
      followed: '{name} was saved. This tab is now editing that file.',
      outsideWorkspace:
        '{name} was saved outside the Workspace. Files outside the Workspace cannot be opened here, so this tab still points to the original file.',
      alreadyOpen:
        '{name} was saved. That location is already open in another tab, so this tab was not switched.',
      saved: '{name} was saved.'
    },
    /*
      Breakpoint の印の説明（Session 6-3）。glyph margin に hover したときに出る。

      **色だけに意味を持たせない**ためにここが要る ── 赤い丸と輪郭だけでは
      「まだ答えが来ていない」と「置けないと言われた」の区別が付かない
      （renderer/src/editor/debug/breakpointDecorations.ts）。
    */
    breakpoint: {
      pending: 'Breakpoint',
      verified: 'Breakpoint (the debugger can stop here)',
      unverified: 'Breakpoint (the debugger cannot stop here)',
      disabled: 'Breakpoint (disabled)'
    },
    document: {
      saving: 'Saving…',
      saveError: 'Could not save ({message})',
      conflictSaveBlocked: 'Not saved because the file on disk has changed.',
      loading: 'Loading…',
      preparingEditor: 'Preparing editor…',
      binary: 'This is a binary file, so it cannot be shown in the text editor ({size}).',
      tooLarge: 'This file is too large to display ({size} / limit {limit}).',
      retry: 'Retry'
    },
    conflict: {
      deletedTitle: 'This file was deleted from disk. The edited content exists only in this tab.',
      saveAsTitle: 'Choose where to save the edited content as a new file.',
      saveAsNote: 'rescue content',
      title:
        'This file was changed outside the app. Because this tab has unsaved changes, it was not updated automatically.',
      reloadTitle: 'Load the content from disk. Unsaved changes in Editor will be lost.',
      reloadNote: 'discard unsaved changes',
      compareTitle: 'Compare the content on disk with the content in Editor.',
      compareClose: 'Close',
      compareOpen: 'View diff',
      overwrite: 'Overwrite',
      overwriteTitle: 'Write the Editor content to disk. Changes on disk will be lost.',
      overwriteNote: 'discard disk changes',
      loadingDisk: 'Loading content from disk…',
      missingCompare: 'Cannot compare because the file was deleted from disk.',
      left: 'Left: content on disk',
      right: 'Right: Editor content (unsaved)',
      preparingDiff: 'Preparing diff…'
    },
    closeConfirm: {
      title: 'Save changes to {name}?',
      deletedBody:
        'This file was deleted from disk. If you close it, the edited content will be lost.',
      body: 'If you do not save, unsaved changes in this file will be lost.',
      discard: "Don't Save",
      saveAndClose: 'Save and Close',
      saving: 'Saving…',
      saveFailedConflict:
        'Could not save because the file on disk has also changed. Cancel, then choose Reload / Compare / Overwrite.',
      saveFailed: 'Could not save. Check the content and try again.'
    },
    error: {
      tabGone: 'That tab is no longer open.',
      noWritableContent: 'There is no content that can be written.',
      workspaceChanged: 'The Workspace changed.',
      notText: 'Could not read it as text.'
    }
  },
  terminal: {
    tabs: {
      ariaLabel: 'Open terminals',
      fallbackName: 'Terminal',
      closeLabel: 'Close {name}',
      newLabel: 'New Terminal',
      newTitle: 'New Terminal',
      shellMenuLabel: 'Choose a shell to open',
      settingsLabel: 'Terminal Settings',
      foreign: 'started in another folder',
      titleWithNotes: '{name} ({notes})',
      noteSeparator: ', ',
      starting: 'Starting',
      exited: 'Exited',
      exitedWithCode: 'Exited {code}',
      failed: 'Failed'
    },
    notice: {
      exited: 'Exited (code {code})',
      retry: 'Try Again',
      newTerminal: 'New Terminal'
    },
    empty: {
      message: 'No terminal is open. Use + to open a new one.'
    },
    loading: 'Preparing terminal…',
    aiCli: {
      badge: 'AI',
      toggleLabel: 'AI CLI Mode',
      titleOff:
        'Turn on AI CLI Mode (this tab only): Enter / Shift+Enter inserts a newline, Ctrl+Enter sends, Ctrl+V pastes',
      titleOn: 'Turn off AI CLI Mode (this tab only): Enter runs commands as usual again',
      tabNote: 'AI CLI Mode'
    },
    settings: {
      label: 'Terminal Settings',
      fontSize: 'Font size',
      note: 'Changes apply when you press Enter or leave the field. Scrollback lines can be changed in Settings > Terminal. Settings are kept after reopening the app.'
    },
    closeConfirm: {
      title: '{name} has something running',
      body: 'Closing this tab will also stop the running command. Stopped commands cannot be restored.',
      runningNote: 'A command is running',
      close: 'Close'
    },
    error: {
      noWorkspace: 'Open a folder before opening a terminal.',
      tooMany: 'Too many terminals are open. Close one you are not using.',
      shellFailed: 'Could not start the shell.'
    },
    unsaved: {
      tabDetail: 'Tab {index}'
    }
  },
  unsaved: {
    body: '{action} {consequence}.',
    title: {
      filesAndTerminals: 'There are unsaved changes and running terminals',
      files: 'There are unsaved changes',
      terminals: 'There are running terminals'
    },
    action: {
      closeWorkspace: 'Closing the Workspace',
      switchWorkspace: 'Switching to another Workspace',
      closeWindow: 'Exiting Fluvix Nexus'
    },
    consequence: {
      filesAndTerminals:
        'will discard unsaved changes in the following files and stop running terminals',
      files: 'will discard unsaved changes in the following files',
      terminals: 'will stop commands running in the following terminals'
    },
    discard: {
      withoutSaving: "Don't Save",
      exitWithoutSaving: 'Exit Without Saving',
      continueWithoutSaving: 'Continue Without Saving',
      exit: 'Exit',
      continue: 'Continue'
    },
    saveAll: 'Save All',
    saveFailed: 'Some files could not be saved. Check them in Editor and try again.',
    saving: 'Saving…',
    note: {
      runningTerminal: 'A command is running',
      deletedFile: 'Deleted from disk. Use "Save As" in Editor to rescue the content.'
    }
  },
  agent: {
    fileWrite: {
      title: 'FN Agent proposes a change',
      bodyExisting: 'FN Agent wants to change this file in your Workspace.',
      bodyNew: 'FN Agent wants to create this file in your Workspace.',
      pathLabel: 'File',
      newBadge: 'New file',
      diffLabel: 'Proposed change',
      noChange: 'The proposed content matches the current content.',
      counts: '+{added} / -{removed}',
      truncated: 'Only the first part of the change is shown.',
      secretMasked: 'Values that look like secrets are hidden in this view.',
      readOnlyNote:
        'This view is read-only. To change the content, cancel and let FN Agent propose it again.',
      continue: 'Continue',
      continueTitle: 'Go on to the confirmation dialog (nothing is written yet)',
      cancel: 'Cancel',
      cancelTitle: 'Do not write anything'
    },
    terminal: {
      title: 'FN Agent wants to run a command',
      body: 'FN Agent wants to run this command. It runs exactly as shown, once, without a shell.',
      commandLabel: 'Command',
      argsLabel: 'Arguments ({count})',
      noArgs: 'No arguments',
      emptyArg: '(empty argument)',
      cwdLabel: 'Folder',
      workspaceRoot: 'Workspace root',
      viaBatch:
        'This command is a batch file (.cmd / .bat), so it runs through cmd.exe. Only arguments made of safe characters are allowed.',
      secretMasked:
        'Values that look like secrets are hidden in this view (the command uses the real values).',
      privilegeNote:
        'An approved command runs with your permissions. It can read and write outside the Workspace and use the network. Continue only if you trust what it does.',
      readOnlyNote:
        'This view is read-only. To change the command, cancel and let FN Agent propose it again.',
      continue: 'Continue',
      continueTitle: 'Go on to the confirmation dialog (nothing runs yet)',
      cancel: 'Cancel',
      cancelTitle: 'Do not run anything',
      resultTitle: 'Command finished',
      status: {
        completed: 'Exited with code {code}',
        completedUnknown: 'Exited (no exit code)',
        timedOut: 'Stopped after 120 seconds',
        failed: 'Could not start the command'
      },
      outputLabel: 'Output (secrets hidden)',
      noOutput: 'No output.',
      outputTruncated:
        'Only part of the output is shown (the last lines, up to 300 characters each).',
      outputSecretMasked: 'Values that look like secrets were hidden in the output.',
      outputWithheld: 'The output could not be checked for secrets, so it is not shown.',
      close: 'Close'
    }
  },
  agentTask: {
    placeholder: 'Tell FN Agent what to do in this Workspace',
    start: 'Start',
    stop: 'Stop',
    disabledNotice: 'FN Agent is turned off in the settings.',
    noProviderNotice:
      'No AI provider is connected yet. In development builds, the Scripted Provider (not a real AI) is used.',
    loops: '{used} / {limit} turns',
    limitQuestion: 'The maximum number of turns has been reached. Do you want to continue?',
    limitContinue: 'Continue (+10)',
    limitStop: 'Stop here',
    answerTitle: 'Answer',
    status: {
      idle: 'Ready',
      awaitingContinue: 'Reached the maximum number of turns',
      stopping: 'Stopping… (waiting for the running step to finish)',
      completed: 'Done'
    },
    phase: {
      thinking: 'Deciding the next step',
      investigating: 'Investigating the Workspace',
      reading: 'Reading a file',
      searching: 'Searching',
      proposingChange: 'Proposing a change (waiting for your approval)',
      runningCommand: 'Command (waiting for your approval / running)'
    },
    end: {
      userStopped: 'Stopped',
      loopLimitDeclined: 'Stopped at the turn limit',
      agentDisabled: 'Stopped because FN Agent was turned off',
      workspaceChanged: 'Stopped because the Workspace changed',
      providerFailed: 'Stopped because the AI provider request failed',
      providerTimeout: 'Stopped because the AI provider did not respond in time',
      providerResponseTooLarge: 'Stopped because the AI provider response was too large',
      providerAuthenticationFailed:
        'Authentication with the AI provider failed. Check your API key.',
      providerAuthorizationFailed:
        'The AI provider denied access. Check your permissions for the provider.',
      contextDenied: 'Stopped because the context could not be sent safely',
      contextBudgetExceeded: 'Stopped because the context did not fit the budget',
      tooManyInvalidActions: 'Stopped because the AI kept returning actions that cannot be run',
      internalError: 'Stopped because of an unexpected error'
    },
    rejected: {
      busy: 'FN Agent is already working.',
      agentDisabled: 'FN Agent is turned off in the settings.',
      noWorkspace: 'Open a Workspace folder first.',
      providerUnavailable: 'No AI provider is available in this build.',
      invalidPrompt: 'Enter an instruction (up to 20,000 characters).'
    }
  },
  settings: {
    title: 'Settings',
    closeTitle: 'Close Settings (Esc)',
    closeLabel: 'Close Settings',
    categoryNavLabel: 'Settings categories',
    missingControl: 'This setting does not have a control yet.',
    /* User / Workspace settings (feature/settings-scope). */
    scope: {
      aria: 'Which settings to edit',
      user: 'User',
      workspace: 'Workspace',
      userDescription:
        'Editing user settings. They apply to every project you open in Fluvix Nexus.',
      workspaceDescription:
        'Editing workspace settings for “{name}”. They apply only to this project and take priority over user settings.',
      workspaceDescriptionNone:
        'Workspace settings apply only to the open project and take priority over user settings.',
      noWorkspace: {
        title: 'Open a workspace to change settings just for that project.',
        note: 'Workspace settings are saved per project and override your user settings only there. Until then, user settings apply everywhere.'
      },
      status: {
        inherited: 'Using the user setting.',
        overridden: 'Changed for this workspace',
        shadowedByWorkspace:
          'The open workspace has its own value for this, so the workspace setting is used there.',
        userOnly: 'This can only be changed in user settings.'
      },
      reset: 'Use user setting'
    },
    categories: {
      general: {
        title: 'General',
        description: 'App-wide basics.'
      },
      appearance: {
        title: 'Appearance',
        description: 'App-wide look and feel.'
      },
      editor: {
        title: 'Editor',
        description: 'When edited files are saved.'
      },
      lsp: {
        title: 'Language Server',
        description:
          'Language servers provide diagnostics for code you open. They are installed separately and are not bundled with Fluvix Nexus.'
      },
      files: {
        title: 'Files',
        description: 'How the file list is displayed.'
      },
      terminal: {
        title: 'Terminal',
        description: 'Terminal display settings. These apply to every open tab.'
      },
      mcp: {
        title: 'MCP',
        description:
          'Connect Fluvix Nexus to outside services through MCP servers. Everything here is off until you turn it on, and these settings apply to the app as a whole rather than to one project.'
      },
      keyboard: {
        title: 'Keyboard Shortcuts',
        description: 'Keys assigned to app commands. Changes are saved and take effect immediately.'
      }
    },
    items: {
      general: {
        language: {
          title: 'Language',
          description: 'Choose the display language for Fluvix Nexus.'
        },
        updates: {
          title: 'Updates',
          description: 'Check GitHub Releases for new Fluvix Nexus versions.'
        }
      },
      appearance: {
        theme: {
          title: 'Theme',
          description: 'Changes immediately and applies to Editor, Files, Terminal, and Git.'
        }
      },
      editor: {
        autoSaveMode: {
          title: 'Auto Save',
          description: 'Choose when files are saved automatically. Ctrl+S always works.'
        },
        autoSaveDelayMs: {
          title: 'Auto Save Delay',
          description: 'How long to wait after typing stops before saving.'
        }
      },
      lsp: {
        enabled: {
          title: 'Use Language Servers',
          description:
            'Turning this off stops running servers and returns to the editor built-in checks. Editing, saving, and search are unaffected.'
        },
        servers: {
          title: 'Languages',
          description:
            'Choose which languages use a language server. These have no effect while the setting above is off.'
        }
      },
      files: {
        viewMode: {
          title: 'View Mode',
          description:
            'Auto uses columns in wide panels and tree view in tall panels. Drag the boundary to change column width.'
        }
      },
      terminal: {
        fontSize: {
          title: 'Font Size',
          description: 'You can also change this from the Terminal tab bar.'
        },
        scrollback: {
          title: 'Scrollback Lines',
          description: 'Lower values discard older output immediately.'
        }
      },
      mcp: {
        enabled: {
          title: 'Use MCP',
          description:
            'The main switch for every MCP connection. While this is off, no MCP server is started and no request leaves this PC.'
        }
      }
    },
    controls: {
      language: {
        aria: 'Language'
      },
      autoSaveMode: {
        aria: 'Auto Save'
      },
      autoSaveDelay: {
        label: 'Delay',
        hintActive: '{min}-{max}ms',
        hintInactive: '{min}-{max}ms (not used by the current mode)'
      },
      lspEnabled: {
        aria: 'Use language servers'
      },
      lspServers: {
        aria: 'Languages that use a language server'
      },
      filesViewMode: {
        aria: 'Files view mode'
      },
      terminalFontSize: {
        label: 'Font size',
        unit: 'px'
      },
      terminalScrollback: {
        label: 'Scrollback lines',
        unit: 'lines'
      },
      theme: {
        aria: 'Theme'
      },
      mcpEnabled: {
        aria: 'Use MCP'
      }
    },
    values: {
      autoSave: {
        off: 'Auto Save: Off',
        afterDelay: 'Auto Save: After Delay',
        onFocusChange: 'Auto Save: On Focus Change',
        onWindowChange: 'Auto Save: On Window Change'
      },
      lsp: {
        on: 'On',
        off: 'Off'
      },
      mcp: {
        on: 'On',
        off: 'Off'
      },
      filesView: {
        auto: 'Auto',
        tree: 'Tree',
        columns: 'Columns'
      },
      theme: {
        dark: 'Dark',
        light: 'Light'
      }
    },
    /*
      Keyboard Shortcuts の一覧（Session 4-7C）。

      `sources.*` は**まだ画面に出ていない**（v1 は Source 列を持たない ──
      すべての行が Default か未割り当てで、値が1種類しかない列になる）。
      それでも先に置いてあるのは、User / Workspace の割り当てが入ったときに
      **翻訳ではなく列を足すだけで済む**ようにするため。
    */
    keyboard: {
      tableLabel: 'Keyboard shortcuts',
      searchLabel: 'Filter shortcuts',
      searchPlaceholder: 'Search by command or key',
      searchClear: 'Clear',
      noResults: 'No command matches “{query}”.',
      editNote:
        'Changed shortcuts are saved to keybindings.json. Inside the editor, the editor’s own shortcuts (such as Ctrl+F) take precedence.',
      modified: 'Modified',
      actions: {
        change: 'Change',
        assign: 'Assign',
        remove: 'Remove',
        reset: 'Reset to Default',
        resetAll: 'Reset All to Default',
        resetAllConfirm: 'Reset',
        confirm: 'Confirm',
        cancel: 'Cancel'
      },
      actionLabels: {
        change: 'Change shortcut {key} of “{command}”',
        assign: 'Assign a shortcut to “{command}”',
        remove: 'Remove shortcut {key} from “{command}”',
        reset: 'Reset shortcuts of “{command}” to default'
      },
      recorder: {
        label: 'Shortcut recorder',
        prompt: 'Press the keys to assign',
        hint: 'Enter to confirm, Esc to cancel',
        notAssignable: 'Combine with Ctrl or Alt, or use F1–F24'
      },
      /*
        Shortcuts S5.

        `conflict.*` は一覧の行（今の状態）、`preview.*` は記録中（確定したら）の文言。
        `{commands}` には相手の名前を `commandSeparator` でつないで入れる
        （ja は「A」「B」、en は “A”, “B”）。
      */
      warnings: {
        label: 'Notes on shortcut {key} of “{command}”',
        commandSeparator: '”, “',
        conflict: {
          overridden:
            '“{winner}” uses the same shortcut in the same situations, so this shortcut does nothing here.',
          wins: 'Also assigned to “{commands}”. Where both apply, this command runs.',
          loses: 'Also assigned to “{commands}”. Where both apply, “{winner}” runs.'
        },
        preview: {
          overridden:
            '“{winner}” uses the same shortcut in the same situations, so this shortcut would do nothing here.',
          wins: 'Also assigned to “{commands}”. If you confirm, this command runs where both apply.',
          loses:
            'Also assigned to “{commands}”. Even if you confirm, “{winner}” runs where both apply.'
        },
        reserved: {
          textEditing:
            'Used for text editing (copy, paste, undo, etc.). Those actions will stop working in input fields.',
          editorFind:
            'Used for Find and Replace in the editor. Inside the editor, this shortcut has no effect.',
          terminalFontSize:
            'Used to change the terminal font size. Pressing it in the terminal does both.',
          terminalClipboard:
            'Used for copy and paste in the terminal. Inside the terminal, it overlaps with those actions.',
          terminalSubmit:
            'Used by the terminal to send input (Ctrl+Enter in AI CLI mode tabs). Inside the terminal, this shortcut has no effect.',
          gitCommit:
            'Used to commit from the Git commit message box. Pressing it there does both the commit and this command.',
          filesRename:
            'Used to rename in the Files panel. Pressing it there does both the rename and this command.',
          commandPalette:
            'Reserved for the Command Palette. It will overlap with the Command Palette in a future version.',
          imeToggle:
            'On Japanese keyboards this is the Hankaku/Zenkaku key and may interfere with switching the IME.',
          windowClose: 'Windows uses this shortcut to close the window.'
        }
      },
      invalid: {
        title: 'keybindings.json has entries that could not be read and are ignored ({count}).',
        note: 'These entries are kept when you change shortcuts here (Reset All to Default removes them).',
        skipped:
          'keybindings.json has entries in an invalid format that are ignored ({count}). Changing a shortcut here removes them from the file.',
        problems: {
          unknownCommand: 'Not a command in this version',
          invalidKey: 'The key could not be read',
          whenNotSupported: 'Conditions (when) are not supported'
        }
      },
      resetAllConfirm: 'Discard all changed shortcuts and reset to default?',
      saveFailed: 'Could not save the shortcut. The change was not applied.',
      loadFailed: 'Keyboard shortcuts could not be loaded, so they cannot be changed here.',
      unreadableNote:
        'keybindings.json could not be read, so default shortcuts are in use. Saving a change here keeps the original file under a different name.',
      builtinNote:
        'Built-in shortcuts are handled directly by the editor, text fields, and the terminal, and cannot be changed.',
      /*
        Built-in shortcuts (Shortcuts S2, keybindings/builtinShortcuts.ts).
        Keys that never go through the Command Registry, listed after the commands.
      */
      builtin: {
        badge: 'Fixed',
        groups: {
          editing: 'Editing (built-in)',
          terminal: 'Terminal (built-in)'
        },
        scopes: {
          editorAndInputs: 'Editor and text fields',
          editor: 'Editor',
          terminalNormal: 'Normal tabs',
          terminalAiCli: 'AI CLI mode tabs'
        },
        actions: {
          copy: 'Copy',
          cut: 'Cut',
          paste: 'Paste',
          undo: 'Undo',
          redo: 'Redo',
          selectAll: 'Select All',
          find: 'Find',
          replace: 'Replace',
          terminalInterrupt: 'Interrupt the running process (sent to the shell)',
          terminalCopy: 'Copy selection',
          terminalPaste: 'Paste',
          terminalSendCtrlV: 'Send Ctrl+V to the shell as is (pastes only if the shell does)',
          terminalAiCliNewline: 'Insert a new line (not sent)',
          terminalAiCliSubmit: 'Send the input',
          terminalAiCliPaste: 'Paste from the clipboard',
          terminalFontSizeIncrease: 'Increase font size',
          terminalFontSizeDecrease: 'Decrease font size',
          terminalFontSizeReset: 'Reset font size'
        }
      },
      columns: {
        command: 'Command',
        shortcut: 'Shortcut'
      },
      unassigned: 'Unassigned',
      categories: {
        workspace: 'Workspace',
        editor: 'Editor',
        view: 'View',
        settings: 'Settings',
        debug: 'Debug',
        git: 'Git',
        files: 'Files'
      },
      sources: {
        default: 'Default',
        user: 'User',
        workspace: 'Workspace'
      }
    },
    /*
      MCP Server Manager の面。

      `status.*` は「今どうなっているか」の1行で、利用者の次の一手が
      それぞれ違うので分けてある（shared/mcp の `McpConfigProblem`）。
      `failure.*` は設定が揃っていたのに繋がらなかった場合になる。

      **秘密の値に触れる言い回しは1つも無い。** 出せるのは
      「保存されているか」までで、これは画面がそもそも値を受け取らない
      ことの裏返しにほかならない。
    */
    mcp: {
      status: {
        loading: 'Checking…',
        testing: 'Connecting…',
        disabled: 'Off',
        ready: 'Ready to connect',
        connected: 'Connected',
        notConfigured: 'Not set up yet',
        commandNotFound: 'The command was not found',
        argumentsUnsupported: 'Arguments containing " % ! cannot be passed to a .cmd / .bat file',
        secretMissing:
          'A secret environment variable has no value. Edit the server to enter it again'
      },
      failure: {
        spawnFailed: 'The server could not be started',
        timeout: 'The server did not answer in time',
        serverExited: 'The server stopped on its own',
        protocolError: 'The server answered in a way this version cannot read',
        unsupportedProtocol: 'The server speaks a version of MCP this app does not support',
        rejected: 'The server refused the connection'
      },
      test: 'Test connection',
      tools: 'Connected to {name}. It offers {count} tool(s).',
      unknownServer: 'the server',
      notice: {
        testFailed: 'The connection could not be tested.'
      },
      /* MCP servers the user registers in MCP Server Manager. */
      custom: {
        newServer: '+ New MCP Server',
        heading: 'Added MCP servers',
        titleNew: 'New MCP server',
        titleEdit: 'Edit MCP server',
        commandLine: 'Command: {command}',
        envSummary: '{count} environment variable(s), {secret} secret',
        transportStdio: 'stdio (runs a command on this PC)',
        enabledLabel: 'Use this server',
        fields: {
          server: 'Input',
          name: 'Name',
          enabled: 'On / off',
          transport: 'Connection type',
          command: 'Command',
          args: 'Arguments',
          env: 'Environment Variables'
        },
        placeholders: {
          name: 'e.g. GitHub',
          command: 'e.g. npx / uvx / C:\\tools\\server.exe',
          args: 'e.g.\n-y\n@modelcontextprotocol/server-github',
          envName: 'NAME',
          envValue: 'Value',
          storedSecret: 'Saved (type only to change it)'
        },
        hints: {
          command:
            'Enter a single program (an absolute path or a name on PATH). Put arguments in Arguments below.',
          args: 'One per line. Spaces inside a line do not split it. Empty lines are ignored.',
          env: 'Values marked Secret are stored encrypted on this PC and are never shown again.'
        },
        envSecret: 'Secret',
        envAdd: '+ Add environment variable',
        envRemove: 'Remove',
        save: 'Save',
        cancel: 'Cancel',
        edit: 'Edit',
        delete: 'Delete',
        deleteConfirm: 'Delete "{name}"? Its saved secret values are deleted too.',
        deleteYes: 'Delete',
        enable: 'On',
        disable: 'Off',
        cannotStoreSecrets:
          'This PC cannot store secret values securely, so a server with Secret environment variables cannot be saved.',
        invalidField: '{field}: {reason}',
        invalidAt: '{field} (#{position}): {reason}',
        invalid: {
          required: 'Required',
          tooLong: 'Too long',
          tooMany: 'Too many',
          controlCharacter: 'Line breaks and other invisible characters cannot be used',
          invalidShape: 'Not in a valid shape',
          commandHasArguments:
            'Enter only the program name, and put each argument on its own line in Arguments',
          invalidCommand: 'Enter an absolute path or the name of a program on PATH',
          invalidName: 'Use letters, digits and _ only, not starting with a digit',
          reservedName: 'This variable is set by the app and cannot be used',
          duplicateName: 'That name is already used',
          unsupportedTransport: 'This connection type is not supported yet',
          secretRequired: 'Enter the secret value'
        },
        notice: {
          saved: 'Saved. Use Test connection to check it.',
          saveFailed: 'The server could not be saved.',
          notFound: 'This server has already been deleted.',
          limitReached: 'You can add up to {max} MCP servers.',
          encryptionUnavailable:
            'This PC cannot store secret values securely, so nothing was saved.',
          deleteFailed: 'The server could not be deleted.',
          toggleFailed: 'The server could not be switched.',
          loadFailed: 'The added MCP servers could not be loaded.'
        }
      }
    }
  },
  updates: {
    currentVersion: 'Current version: {version}',
    availableVersion: 'Available version: {version}',
    source: 'Source: GitHub Releases ({owner}/{repo})',
    progress: '{percent}% ({transferred} / {total})',
    status: {
      loading: 'Loading update status…',
      idle: 'Updates have not been checked yet.',
      checking: 'Checking for updates…',
      'not-available': 'You are using the latest version.',
      available: 'A new version is available.',
      downloading: 'Downloading update…',
      downloaded: 'Update is ready. Restart when you are ready.',
      error: 'Update check failed.',
      unsupported: 'Updates are not available in this environment.'
    },
    actions: {
      check: 'Check for Updates',
      download: 'Download Update',
      install: 'Restart and Update Now'
    }
  },
  /*
    Language Server（Session 5-4）。

    `servers.*` は表の行の名前で、**製品名ではなく言語の名前**にしてある
    ── ステータスバーと設定に出るのは「その言語の機能が使えるか」であって、
    どの実装を使っているかは利用者の関心ではない（実装名は Main のログに出る）。

    `status.*` は内訳（マウスを載せたとき）、`summary.*` はまとめた1語になる。
    言い回しを分けてあるのは、前者が「TypeScript は Ready」と読めればよいのに対し、
    後者は単独で「何の話か」まで伝える必要があるため。
  */
  lsp: {
    servers: {
      typescript: 'TypeScript / JavaScript',
      python: 'Python',
      csharp: 'C#'
    },
    status: {
      disabled: 'Off',
      unavailable: 'Not installed',
      starting: 'Starting…',
      ready: 'Ready',
      failed: 'Failed',
      stopped: 'Not running'
    },
    summary: {
      disabled: 'LSP: Off',
      unavailable: 'LSP: Not installed',
      starting: 'LSP: Starting…',
      ready: 'LSP: Ready',
      failed: 'LSP: Failed',
      stopped: 'LSP: Not running'
    },
    /*
      Rename が断られたときの1行（Session 5-9）。

      出るのは Monaco の通知で、**利用者が次に何をすればよいか**が読めるように
      言い分ける ── 「その位置では変えられない」と「サーバが答えられなかった」は、
      同じ「できなかった」でも取るべき行動が違う。
    */
    rename: {
      notRenameable: 'This symbol cannot be renamed here.',
      invalidName: 'That name cannot be used.',
      unsupportedEdit: 'This rename needs file operations that Fluvix Nexus does not apply.',
      outsideWorkspace: 'This rename would change files outside the workspace folder.',
      tooManyEdits: 'This rename affects too many places to apply safely.',
      malformed: 'The language server returned a rename that could not be applied.',
      serverError: 'The language server could not rename this symbol.',
      stale: 'The file changed while renaming. Try again.',
      writeFailed: 'Some files could not be updated: {files}'
    }
  },
  debug: {
    toolbar: {
      aria: 'Debug toolbar',
      profileLabel: 'Debug Profile',
      noProfile: 'No profiles',
      addProfile: 'Add Profile',
      editProfile: 'Edit Profile',
      start: 'Start',
      continue: 'Continue',
      pause: 'Pause',
      stepOver: 'Step Over',
      stepInto: 'Step Into',
      stepOut: 'Step Out',
      stop: 'Stop',
      unavailable: 'No debug adapter is available on this machine.',
      noWorkspace: 'Open a Workspace before creating or starting a debug profile.',
      noSelectedProfile: 'Select a debug profile first.',
      loadingProfiles: 'Loading profiles…'
    },
    profile: {
      editorTitleAdd: 'Add Debug Profile',
      editorTitleEdit: 'Edit Debug Profile',
      name: 'Name',
      language: 'Language',
      programRelativePath: 'Program path',
      programRelativePathPlaceholder: 'src/main.ts',
      programArgs: 'Program arguments',
      programArgsPlaceholder: 'One argument per line',
      env: 'Environment',
      envPlaceholder: 'NAME=value',
      stopOnEntry: 'Stop on entry',
      save: 'Save Profile',
      create: 'Create Profile',
      delete: 'Delete Profile',
      cancel: 'Cancel',
      confirmDelete: 'Delete this profile?',
      empty: 'No debug profiles in this Workspace.',
      languageName: {
        node: 'Node.js',
        python: 'Python',
        csharp: 'C#'
      },
      invalidEnvLine: 'Environment entries must use NAME=value, one per line.',
      saved: 'Profile saved.',
      deleted: 'Profile deleted.',
      validation: {
        name: 'Check the profile name.',
        language: 'Choose a supported language.',
        programRelativePath: 'Enter a Workspace-relative program path.',
        programArgs: 'Check the program arguments.',
        env: 'Check the environment variables.',
        stopOnEntry: 'Check the stop-on-entry value.'
      },
      rejection: {
        noWorkspace: 'Open a Workspace before saving a profile.',
        profileNotFound: 'This profile is no longer available.',
        limitReached: 'This Workspace already has the maximum number of profiles.'
      }
    },
    operation: {
      started: 'Debug session started.',
      accepted: 'Debug command accepted.',
      rejected: {
        noWorkspace: 'Open a Workspace first.',
        profileNotFound: 'This profile is no longer available.',
        alreadyRunning: 'A debug session is already running.',
        noSession: 'No debug session is running.',
        invalidState: 'That debug command is not available right now.',
        busy: 'Another debug command is still in progress.'
      },
      failed: {
        invalidProfile: 'The saved profile is no longer valid.',
        programNotFound: 'The program file could not be found.',
        programOutsideWorkspace: 'The program must stay inside the Workspace.',
        adapterUnavailable: 'The debug adapter is not available.',
        spawnFailed: 'The debug adapter could not be started.',
        adapterRejected: 'The debug adapter rejected the command.',
        sessionEnded: 'The debug session ended before the command completed.',
        noThread: 'No debug thread is available for that command.',
        timeout: 'The debug adapter did not answer in time.'
      },
      adapterGuidance: {
        node: {
          unavailable:
            'The Node.js debug adapter is not available. Add Node.js (node.exe) to PATH and place vscode-js-debug 1.117.0 in the debug-adapters folder of the app data folder.',
          runtimeNotFound:
            'Node.js was not found. Install Node.js, add node.exe to PATH, and restart Fluvix Nexus.',
          adapterNotFound:
            'The Node.js debug adapter (vscode-js-debug 1.117.0) is not installed. Extract the official js-debug-dap-v1.117.0 release into the debug-adapters folder of the app data folder.',
          adapterNotVerified:
            'The Node.js debug adapter (vscode-js-debug 1.117.0) does not match the official release. Delete the installed folder and extract the official release again.',
          runtimeInsideWorkspace:
            'For safety, a node.exe inside the Workspace cannot be used. Put a Node.js installed outside the Workspace on PATH.',
          adapterInsideWorkspace:
            'The Node.js debug adapter cannot start because the app data folder is inside the Workspace. Open a different folder as the Workspace.'
        },
        python: {
          unavailable:
            'The Python debug adapter is not available. Add Python to PATH and install debugpy with pip install debugpy.',
          runtimeNotFound:
            'Python was not found. Install Python, add it to PATH, run pip install debugpy, and restart Fluvix Nexus.',
          adapterInsideWorkspace:
            'The Python debug adapter cannot start because the app data folder is inside the Workspace. Open a different folder as the Workspace.'
        },
        csharp: {
          unavailable:
            'The C# debug adapter is not available. Add netcoredbg to PATH, install .NET, and keep the related paths ASCII-only.',
          runtimeNotFound:
            '.NET (dotnet.exe) was not found. Install .NET and restart Fluvix Nexus.',
          adapterNotFound:
            'The C# debug adapter (netcoredbg) was not found. Extract netcoredbg into an ASCII-only folder, add that folder to PATH, and restart Fluvix Nexus.',
          adapterInsideWorkspace:
            'For safety, a netcoredbg inside the Workspace cannot be used. Put a netcoredbg placed outside the Workspace on PATH.',
          nonAsciiPath:
            'netcoredbg cannot handle paths that contain non-ASCII characters. Place netcoredbg, .NET, the target DLL, and the Workspace on ASCII-only paths.'
        }
      },
      ipcFailed: 'Debug communication failed. Try again.'
    },
    callStack: {
      aria: 'Call Stack',
      title: 'Call Stack',
      loading: 'Loading Call Stack…',
      empty: 'No stopped debug session.',
      noThreads: 'No threads.',
      noFrames: 'No stack frames.',
      notLoaded: 'Stack frames are not loaded for this thread.',
      stopped: 'stopped',
      openFrame: 'Open stack frame',
      sourceUnavailable: 'Source is outside the Workspace or unavailable.',
      invalidLocation: 'The stack frame location is not available.',
      currentFrame: 'Current'
    },
    stopReason: {
      aria: 'Why the program is paused',
      breakpoint: 'Paused at breakpoint',
      step: 'Paused after step',
      pause: 'Paused manually',
      entry: 'Paused on entry',
      exception: 'Paused on exception',
      unknown: 'Paused',
      breakModeUnhandled: 'Uncaught',
      breakModeUserUnhandled: 'Uncaught in user code',
      breakModeAlways: 'Raised',
      noExceptionDetails: 'Exception details are not available.'
    },
    executionLine: {
      current: 'Current execution location',
      selected: 'Selected stack frame'
    },
    variables: {
      aria: 'Variables',
      title: 'Variables',
      loading: 'Loading variables…',
      notStopped: 'Variables are shown while the program is paused.',
      noFrame: 'Select a stack frame to see its variables.',
      noScopes: 'This stack frame has no scopes.',
      empty: 'No variables.',
      truncated: 'Only the first items are shown.',
      stale: 'These variables are no longer current.',
      failed: 'The debug adapter could not provide these variables.',
      limit: 'Too many variables are expanded for this pause.'
    },
    evaluate: {
      aria: 'Evaluate result',
      title: 'Evaluate',
      label: 'Expression to evaluate',
      placeholder: 'Evaluate an expression…',
      submit: 'Evaluate',
      evaluating: 'Evaluating…',
      empty: 'Enter an expression to evaluate it in the selected stack frame.',
      notStopped: 'Expressions are evaluated while the program is paused.',
      noFrame: 'Select a stack frame to evaluate an expression.',
      stale: 'This result is no longer current.',
      failed: 'The debug adapter could not evaluate this expression.',
      timeout: 'The debug adapter did not answer in time.'
    },
    console: {
      aria: 'Debug Console',
      title: 'Debug Console',
      label: 'Debug Console expression',
      placeholder: 'Evaluate in selected frame…',
      clear: 'Clear',
      empty: 'No console output.',
      evaluating: 'Evaluating…',
      notStopped: 'Debug Console evaluates expressions while the program is paused.',
      noFrame: 'Select a stack frame to evaluate an expression.',
      stale: 'This result is no longer current.',
      failed: 'The debug adapter could not evaluate this expression.',
      timeout: 'The debug adapter did not answer in time.'
    },
    /*
      ステータスバーの Debug の状態（Session 6-9）。

      内部の `stopped` は「一時停止中」で、`Stopped` と書くと idle と取り違える
      ── キーは shared の語のまま、言い回しの側で Paused と書く。
    */
    status: {
      unavailable: 'Debug: Unavailable',
      idle: 'Debug: Idle',
      starting: 'Debug: Starting…',
      running: 'Debug: Running',
      stopped: 'Debug: Paused',
      terminating: 'Debug: Stopping…'
    },
    statusDetail: {
      unavailable: 'No debug adapter is available.',
      idle: 'No debug session is running.',
      starting: 'The debug adapter is starting.',
      running: 'The program is running.',
      stopped: 'The program is paused.',
      terminating: 'The debug session is ending.'
    }
  },
  /*
    フィードバックの面（feedback/FeedbackOverlay.tsx。フィードバック機能 v1）。
    種別のうち Bad / Good は日本語側でも英語のまま出す（利用者が指定した表記）。
  */
  feedback: {
    title: 'Feedback',
    description:
      'Choose a type and describe what you noticed. In this version, feedback is not sent or saved anywhere.',
    closeTitle: 'Close feedback (Esc)',
    closeLabel: 'Close feedback',
    categoryLabel: 'Type',
    categories: {
      bug: 'Bug',
      bad: 'Bad',
      good: 'Good',
      safety: 'Safety check',
      other: 'Other'
    },
    detailLabel: 'Details',
    detailPlaceholder: 'What happened, what you expected, or what you liked.',
    submit: 'Send',
    sending: 'Sending…',
    accepted: 'Your feedback has been received. Thank you!',
    failed: 'Your feedback could not be received. Your input has been kept; please try again.',
    errors: {
      categoryRequired: 'Choose a feedback type.',
      detailEmpty: 'Enter the details.',
      detailBlank: 'The details contain only spaces. Enter some content.'
    }
  },
  workspace: {
    noWorkspace: 'No Workspace',
    noWorkspaceOpen: 'No Workspace is open.',
    openFolder: 'Open Folder',
    openFolderEllipsis: 'Open Folder…',
    closeWorkspace: 'Close Workspace',
    busy: 'Working…',
    viewMenu: 'View',
    layoutMenu: 'Layout: {title}',
    modified: 'Modified',
    settingsTitle: 'Open app settings.',
    settingsButton: 'Settings',
    feedbackTitle: 'Send feedback about Fluvix Nexus.',
    feedbackButton: 'Feedback',
    resetLayout: 'Reset Layout',
    emptyDock: 'No panels. Use the View menu to show one.',
    closePanel: 'Close {title}',
    connecting: 'Connecting…',
    welcomeLead: 'Open a folder to use Files, Editor, Terminal, and Git against that workspace.',
    unavailablePrevious: 'The previous Workspace could not be found: {path}',
    panels: {
      files: 'Files',
      editor: 'Editor',
      terminal: 'Terminal',
      git: 'Git',
      debug: 'Debug',
      agent: 'Agent'
    },
    layout: {
      default: {
        title: 'Default',
        description: 'Files, Editor, and Git side by side, with Terminal below'
      }
    }
  }
} as const

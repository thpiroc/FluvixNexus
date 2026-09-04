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
      deleted: 'Unsaved (deleted from disk)'
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
  settings: {
    title: 'Settings',
    closeTitle: 'Close Settings (Esc)',
    closeLabel: 'Close Settings',
    categoryNavLabel: 'Settings categories',
    missingControl: 'This setting does not have a control yet.',
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
      files: {
        title: 'Files',
        description: 'How the file list is displayed.'
      },
      terminal: {
        title: 'Terminal',
        description: 'Terminal display settings. These apply to every open tab.'
      }
    },
    items: {
      general: {
        language: {
          title: 'Language',
          description: 'Choose the display language for Fluvix Nexus.'
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
      }
    },
    values: {
      autoSave: {
        off: 'Auto Save: Off',
        afterDelay: 'Auto Save: After Delay',
        onFocusChange: 'Auto Save: On Focus Change',
        onWindowChange: 'Auto Save: On Window Change'
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
      git: 'Git'
    },
    layout: {
      default: {
        title: 'Default',
        description: 'Files, Editor, and Git side by side, with Terminal below'
      }
    }
  }
} as const

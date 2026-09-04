export const enMessages = {
  language: {
    ja: '日本語',
    en: 'English'
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
    openFolderEllipsis: 'Open Folder...',
    closeWorkspace: 'Close Workspace',
    busy: 'Working...',
    viewMenu: 'View',
    layoutMenu: 'Layout: {title}',
    modified: 'Modified',
    settingsTitle: 'Open app settings.',
    settingsButton: 'Settings',
    resetLayout: 'Reset Layout',
    emptyDock: 'No panels. Use the View menu to show one.',
    closePanel: 'Close {title}',
    connecting: 'Connecting...',
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

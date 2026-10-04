export default defineAppConfig({
  ui: {
    colors: {
      primary: 'blue',
      secondary: 'indigo',
      neutral: 'slate',
      info: 'cyan',
      success: 'teal',
      warning: 'yellow',
      error: 'red',
      gray: 'gray',
      cyan: 'cyan',
      indigo: 'indigo',
      orange: 'orange',
      pink: 'pink',
      purple: 'purple',
      red: 'red',
      yellow: 'yellow',
      green: 'green',
      lime: 'lime',
      emerald: 'emerald',
      rose: 'rose',
      slate: 'slate',
      stone: 'stone',
      blue: 'blue',
      teal: 'teal'
    },
    icons: {
      system: 'i-lucide-monitor',
      light: 'i-lucide-sun',
      dark: 'i-lucide-moon'
    },
    dashboardToolbar: {
      slots: {
        root: 'shrink-0 flex flex-wrap sm:flex-nowrap items-center justify-between border-b border-default px-3 sm:px-6 gap-x-2 gap-y-1.5 py-2 sm:py-0 min-h-[49px] overflow-x-auto',
        left: 'flex flex-wrap items-center gap-1.5 min-w-0 flex-1',
        right: 'flex items-center gap-1.5 shrink-0 ml-auto'
      }
    }
  },
  system: {
    app_name: 'TM Trading',
    app_version: '0.1.0',
    app_description: 'Trade desk tu dong: engine tin hieu + backtest + risk gate'
  }
})

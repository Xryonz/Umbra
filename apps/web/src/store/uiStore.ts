import { create } from 'zustand'

interface UIState {
  /** Mobile drawer aberto (sidebar slide-in) */
  mobileSidebarOpen: boolean
  openMobileSidebar:  () => void
  closeMobileSidebar: () => void
  toggleMobileSidebar: () => void

  /** Command palette (Cmd+K) */
  commandPaletteOpen: boolean
  openCommandPalette:   () => void
  closeCommandPalette:  () => void
  toggleCommandPalette: () => void

  /** Right-side members + threads panel (visible em servidor, não em DM) */
  rightPanelOpen: boolean
  rightPanelTab:  'members' | 'threads'
  openRightPanel:  (tab?: 'members'|'threads') => void
  closeRightPanel: () => void
  setRightPanelTab: (tab: 'members'|'threads') => void

  /** Voice call stage (fullscreen expansion do PiP) */
  voiceStageOpen: boolean
  setVoiceStageOpen: (open: boolean) => void

  /** Sheet "Mais" da bottom nav mobile (profile/settings/logout) */
  mobileMoreOpen: boolean
  setMobileMoreOpen: (open: boolean) => void
}

export const useUIStore = create<UIState>((set) => ({
  mobileSidebarOpen: false,
  openMobileSidebar:  () => set({ mobileSidebarOpen: true }),
  closeMobileSidebar: () => set({ mobileSidebarOpen: false }),
  toggleMobileSidebar: () => set((s) => ({ mobileSidebarOpen: !s.mobileSidebarOpen })),

  commandPaletteOpen: false,
  openCommandPalette:   () => set({ commandPaletteOpen: true }),
  closeCommandPalette:  () => set({ commandPaletteOpen: false }),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),

  rightPanelOpen: false,
  rightPanelTab:  'members',
  openRightPanel:  (tab) => set({ rightPanelOpen: true, ...(tab ? { rightPanelTab: tab } : {}) }),
  closeRightPanel: () => set({ rightPanelOpen: false }),
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),

  voiceStageOpen: false,
  setVoiceStageOpen: (open) => set({ voiceStageOpen: open }),

  mobileMoreOpen: false,
  setMobileMoreOpen: (open) => set({ mobileMoreOpen: open }),
}))

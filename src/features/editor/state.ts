import { create } from 'zustand'
import type { Occ } from '../../../shared/types'

export type EditorInit =
  | { mode: 'new'; date: string; start?: number; staffId?: string; clientId?: string; repeat?: boolean }
  | { mode: 'edit'; occ: Occ }

export const useEditor = create<{ init: EditorInit | null; seq: number }>(() => ({ init: null, seq: 0 }))
export const openEditor = (init: EditorInit) => useEditor.setState((s) => ({ init, seq: s.seq + 1 }))
export const closeEditor = () => useEditor.setState({ init: null })

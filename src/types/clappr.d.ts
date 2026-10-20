/** Tipos mínimos do Clappr (@clappr/player não publica declarações). */
declare module '@clappr/player' {
  export interface ClapprContainer {
    audioTracks?: Array<{ id: string | number; language?: string; label?: string }>
    currentAudioTrack?: { id: string | number } | null
    switchAudioTrack?(id: string | number): void
    closedCaptionsTracks?: Array<{ id: number; name?: string; track?: { language?: string; label?: string } }>
    closedCaptionsTrackId?: number
    on(event: string, callback: (...args: unknown[]) => void): void
  }
  export interface ClapprCore {
    activeContainer?: ClapprContainer
  }
  export class Player {
    constructor(options: Record<string, unknown>)
    core: ClapprCore
    play(): void
    pause(): void
    stop(): void
    seek(seconds: number): void
    getCurrentTime(): number
    getDuration(): number
    isPlaying(): boolean
    on(event: string, callback: (...args: unknown[]) => void): void
    off(event: string, callback?: (...args: unknown[]) => void): void
    destroy(): void
  }
  export const Events: Record<string, string>
  const Clappr: { Player: typeof Player; Events: Record<string, string> }
  export default Clappr
}

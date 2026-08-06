export interface AudioClock {
  currentTime(): number
  reset(time: number): void
  close(): void
}

export interface AudioPipeline {
  configure(sampleRate: number, channels: number): Promise<void>
  enqueuePcm(pcm: Float32Array, timestamp: number): void
  play(): void
  pause(): void
  setVolume(value: number): void
  seek(time: number): void
  close(): void
}


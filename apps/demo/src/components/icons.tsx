import type { ReactNode } from 'react'

export interface IconProps {
  readonly size?: number | undefined
}

interface GlyphProps extends IconProps {
  readonly children: ReactNode
}

/** Stroke glyphs drawn in this repository; the demo pulls in no icon dependency. */
function Glyph({ size = 16, children }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export function SunIcon({ size }: IconProps) {
  return (
    <Glyph size={size}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
    </Glyph>
  )
}

export function MoonIcon({ size }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="M20 14.2A8.4 8.4 0 0 1 9.8 4a8.5 8.5 0 1 0 10.2 10.2Z" />
    </Glyph>
  )
}

export function ArrowRightIcon({ size }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="M4 12h15M13 6l6 6-6 6" />
    </Glyph>
  )
}

export function ArrowUpRightIcon({ size }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="M7 17 17 7M8 7h9v9" />
    </Glyph>
  )
}

export function ChevronDownIcon({ size }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="m5 9 7 7 7-7" />
    </Glyph>
  )
}

export function FileUpIcon({ size }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5M12 17v-6M9.5 13.5 12 11l2.5 2.5" />
    </Glyph>
  )
}

export function CloudIcon({ size }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="M17.2 18H7a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17.4 10a4 4 0 0 1-.2 8Z" />
    </Glyph>
  )
}

export function CopyIcon({ size }: IconProps) {
  return (
    <Glyph size={size}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15a2 2 0 0 1-1-1.7V6a2 2 0 0 1 2-2h7.3A2 2 0 0 1 15 5" />
    </Glyph>
  )
}

export function CheckIcon({ size }: IconProps) {
  return (
    <Glyph size={size}>
      <path d="m4 12.5 5 5L20 6.5" />
    </Glyph>
  )
}

export function GithubMark() {
  return (
    <svg className="github-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.05c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.33-1.76-1.33-1.76-1.09-.75.08-.74.08-.74 1.2.09 1.83 1.23 1.83 1.23 1.07 1.83 2.8 1.3 3.49.99.11-.77.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.94 0-1.31.47-2.38 1.23-3.22-.12-.3-.53-1.52.12-3.17 0 0 1-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.29-1.23 3.29-1.23.66 1.65.25 2.87.13 3.17a4.6 4.6 0 0 1 1.23 3.22c0 4.61-2.81 5.63-5.48 5.93.43.37.81 1.1.81 2.22v3.29c0 .32.22.69.83.57A12 12 0 0 0 12 .5Z"
      />
    </svg>
  )
}

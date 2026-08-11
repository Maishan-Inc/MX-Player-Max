const currentScript = typeof document === 'undefined' ? null : document.currentScript

export const mxPlayerMaxImportMetaUrl = currentScript !== null
  && 'src' in currentScript
  && typeof currentScript.src === 'string'
  && currentScript.src.length > 0
  ? currentScript.src
  : typeof location === 'undefined'
    ? 'about:blank'
    : location.href

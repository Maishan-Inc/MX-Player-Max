export const MANIFEST_SCHEMA_VERSION = 1

export function assertManifest(value) {
  if (!isRecord(value) || value.schemaVersion !== MANIFEST_SCHEMA_VERSION) throw new Error('Manifest schemaVersion is invalid')
  if (!isRecord(value.baseUrls) || !isRecord(value.urlResolution)) throw new Error('Manifest base URL rules are required')
  if (!Array.isArray(value.assets) || !Array.isArray(value.excluded)) throw new Error('Manifest assets and excluded lists are required')
  if (value.assets.some((asset) => !isRecord(asset) || asset.publishable !== true)) throw new Error('Non-publishable resource entered assets')
  if (value.excluded.some((asset) => !isRecord(asset) || asset.publishable !== false)) throw new Error('Excluded resource is missing publishable false')
  for (const asset of value.assets) {
    for (const field of ['packageName', 'packageVersion', 'path', 'type', 'mime', 'sha256', 'sha384', 'integrity']) {
      if (typeof asset[field] !== 'string' || asset[field].length === 0) throw new Error(`Manifest asset field is missing: ${field}`)
    }
    if (typeof asset.size !== 'number' || !Number.isSafeInteger(asset.size) || asset.size < 0) throw new Error('Manifest asset size is invalid')
  }
  return value
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

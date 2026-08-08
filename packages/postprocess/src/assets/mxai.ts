import type { ModelPrecision } from './manifest'

export type MxaiElementType = 'f32' | 'f16' | 'u32'

export interface MxaiTensor {
  readonly name: string
  readonly shape: readonly number[]
  readonly elementType: MxaiElementType
  readonly data: Uint8Array
}

export interface MxaiModel {
  readonly schemaVersion: number
  readonly model: string
  readonly precision: ModelPrecision
  readonly tensors: ReadonlyMap<string, MxaiTensor>
}

const MAGIC = new Uint8Array([0x4d, 0x58, 0x41, 0x49])
const MAX_TENSORS = 4096
const MAX_RANK = 8
const MAX_DIMENSION = 65_536
const HEADER_SIZE = 20
const ENTRY_SIZE = 48

export function parseMxai(bytes: Uint8Array): MxaiModel {
  if (bytes.byteLength < HEADER_SIZE) throw new Error('MXAI payload is truncated')
  for (let index = 0; index < MAGIC.length; index += 1) if (bytes[index] !== MAGIC[index]) throw new Error('Invalid MXAI magic')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const schemaVersion = view.getUint16(4, true)
  if (schemaVersion !== 1) throw new Error(`Unsupported MXAI schema ${schemaVersion}`)
  const modelLength = view.getUint16(6, true)
  const precisionCode = view.getUint8(8)
  const tensorCount = view.getUint32(12, true)
  const tableOffset = view.getUint32(16, true)
  if (tensorCount === 0 || tensorCount > MAX_TENSORS || tableOffset < HEADER_SIZE) throw new Error('Invalid MXAI tensor table')
  const precision = precisionCode === 1 ? 'f32' : precisionCode === 2 ? 'f16' : null
  if (!precision) throw new Error('Invalid MXAI precision')
  const modelStart = HEADER_SIZE
  const modelEnd = modelStart + modelLength
  if (modelEnd > bytes.byteLength || modelEnd > tableOffset) throw new Error('Invalid MXAI model name')
  const model = new TextDecoder().decode(bytes.subarray(modelStart, modelEnd))
  if (model.length === 0 || model.length > 256) throw new Error('Invalid MXAI model name')
  const tableEnd = tableOffset + tensorCount * ENTRY_SIZE
  if (!Number.isSafeInteger(tableEnd) || tableEnd > bytes.byteLength) throw new Error('MXAI tensor table exceeds payload')
  const tensors = new Map<string, MxaiTensor>()
  for (let index = 0; index < tensorCount; index += 1) {
    const offset = tableOffset + index * ENTRY_SIZE
    const nameOffset = view.getUint32(offset, true)
    const nameLength = view.getUint16(offset + 4, true)
    const rank = view.getUint8(offset + 6)
    const typeCode = view.getUint8(offset + 7)
    const dataOffset = view.getUint32(offset + 8, true)
    const dataLength = view.getUint32(offset + 12, true)
    if (rank > MAX_RANK || nameLength === 0 || nameLength > 512) throw new Error('Invalid MXAI tensor metadata')
    const nameEnd = nameOffset + nameLength
    const dataEnd = dataOffset + dataLength
    if (nameOffset < modelEnd || nameEnd > tableOffset || dataOffset < tableEnd || dataEnd > bytes.byteLength) throw new Error('MXAI tensor points outside payload')
    const name = new TextDecoder().decode(bytes.subarray(nameOffset, nameEnd))
    if (tensors.has(name)) throw new Error(`Duplicate MXAI tensor ${name}`)
    const shape: number[] = []
    let shapeProduct = 1
    for (let dimension = 0; dimension < rank; dimension += 1) {
      const value = view.getUint32(offset + 16 + dimension * 4, true)
      if (value === 0 || value > MAX_DIMENSION || !Number.isSafeInteger(shapeProduct * value)) throw new Error('Invalid MXAI tensor shape')
      shape.push(value)
      shapeProduct *= value
    }
    const elementType = typeCode === 1 ? 'f32' : typeCode === 2 ? 'f16' : typeCode === 3 ? 'u32' : null
    if (!elementType || dataLength !== shapeProduct * (elementType === 'f16' ? 2 : 4)) throw new Error(`Invalid MXAI tensor byte length for ${name}`)
    tensors.set(name, { name, shape, elementType, data: bytes.slice(dataOffset, dataEnd) })
  }
  return { schemaVersion, model, precision, tensors }
}

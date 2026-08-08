import type { RendererCapabilities } from '@mx-player-max/types'
import { ErrorCodes } from '@mx-player-max/types'
import { BaseRenderer, FILTERS, type RendererBackendOptions } from './base'
import { rendererError } from './errors'
import type { ValidatedFrame } from './validation'

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
uniform vec2 u_scale;
uniform int u_rotation;
void main() {
  vec2 position = a_position;
  if (u_rotation == 1) position = vec2(-position.y, position.x);
  else if (u_rotation == 2) position = -position;
  else if (u_rotation == 3) position = vec2(position.y, -position.x);
  position *= u_scale;
  gl_Position = vec4(position, 0.0, 1.0);
  v_uv = a_position * 0.5 + 0.5;
}`

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform sampler2D u_frame;
uniform vec4 u_crop;
uniform int u_filter;
uniform float u_amount;
in vec2 v_uv;
out vec4 outColor;
void main() {
  vec2 uv = u_crop.xy + v_uv * u_crop.zw;
  vec4 color = texture(u_frame, uv);
  if (u_filter == 1) {
    float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    color.rgb = mix(color.rgb, vec3(luma), u_amount);
  } else if (u_filter == 2) color.rgb *= u_amount;
  else if (u_filter == 3) color.rgb = (color.rgb - 0.5) * u_amount + 0.5;
  else if (u_filter == 4) {
    float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    color.rgb = mix(vec3(luma), color.rgb, u_amount);
  }
  outColor = clamp(color, 0.0, 1.0);
}`

interface GlResources {
  program: WebGLProgram
  texture: WebGLTexture
  buffer: WebGLBuffer
  vao: WebGLVertexArrayObject
  position: number
  scale: WebGLUniformLocation
  rotation: WebGLUniformLocation
  crop: WebGLUniformLocation
  filter: WebGLUniformLocation
  amount: WebGLUniformLocation
}

export class WebGL2Renderer extends BaseRenderer {
  readonly kind = 'webgl2' as const
  private context: WebGL2RenderingContext | null = null
  private resources: GlResources | null = null
  private restoreTimer: ReturnType<typeof setTimeout> | null = null
  private readonly onLost = (event: Event): void => {
    if ('preventDefault' in event) event.preventDefault()
    if (this.closed) return
    this.transition('lost', 'context-lost')
    this.deleteResources()
    this.restoreTimer = setTimeout(() => {
      this.restoreTimer = null
      if (this.closed || this.currentState !== 'lost') return
      this.reportFatal(rendererError(ErrorCodes.RENDERER_CONTEXT_UNAVAILABLE, 'The WebGL2 context was not restored', true))
    }, 1_000)
  }
  private readonly onRestored = (): void => { void this.restoreContext() }

  get capabilities(): RendererCapabilities {
    const maximum = this.context?.getParameter(this.context.MAX_TEXTURE_SIZE)
    return {
      kind: this.kind, available: this.context !== null, filters: FILTERS,
      maxTextureDimension2d: typeof maximum === 'number' ? Math.min(this.maxDimension, maximum) : this.maxDimension,
      externalTexture: false, hdr: false, lossRecovery: true,
    }
  }

  constructor(options: RendererBackendOptions = {}) { super(options) }

  protected async initialize(): Promise<void> {
    const canvas = this.requireCanvas()
    const context = this.runtime.createWebGL2Context?.(canvas)
      ?? canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, premultipliedAlpha: false })
    if (!context) throw rendererError(ErrorCodes.RENDERER_CONTEXT_UNAVAILABLE, 'WebGL2 is unavailable for the renderer target', true)
    this.context = context
    const maximum = context.getParameter(context.MAX_TEXTURE_SIZE)
    if (typeof maximum === 'number' && Number.isSafeInteger(maximum) && maximum > 0) this.maxDimension = Math.min(this.maxDimension, maximum)
    canvas.addEventListener('webglcontextlost', this.onLost)
    canvas.addEventListener('webglcontextrestored', this.onRestored)
    this.resources = createResources(context)
  }

  protected draw(frame: VideoFrame, validated: ValidatedFrame): void {
    const gl = this.context
    const resources = this.resources
    if (!gl || !resources || gl.isContextLost()) throw rendererError(ErrorCodes.RENDERER_CONTEXT_UNAVAILABLE, 'The WebGL2 context is unavailable', true)
    const crop = this.transform.crop ?? { x: 0, y: 0, width: validated.width, height: validated.height }
    const scale = fitScale(crop.width, crop.height, this.width * this.dpr, this.height * this.dpr, this.transform.fit, this.transform.rotation)
    gl.useProgram(resources.program)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.bindVertexArray(resources.vao)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, resources.texture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame)
    gl.uniform2f(resources.scale, scale.x, scale.y)
    gl.uniform1i(resources.rotation, rotationIndex(this.transform.rotation))
    gl.uniform4f(resources.crop, crop.x / validated.width, crop.y / validated.height, crop.width / validated.width, crop.height / validated.height)
    gl.uniform1i(resources.filter, filterIndex(this.filter.kind))
    gl.uniform1f(resources.amount, this.filter.amount)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)
    gl.bindTexture(gl.TEXTURE_2D, null)
  }

  protected resizeBackend(width: number, height: number): void { this.context?.viewport(0, 0, width, height) }

  protected release(): void {
    if (this.restoreTimer !== null) { clearTimeout(this.restoreTimer); this.restoreTimer = null }
    const canvas = this.canvas
    canvas?.removeEventListener('webglcontextlost', this.onLost)
    canvas?.removeEventListener('webglcontextrestored', this.onRestored)
    this.deleteResources()
    this.context = null
  }

  private async restoreContext(): Promise<void> {
    if (this.closed || this.currentState !== 'lost' || !this.context) return
    if (this.restoreTimer !== null) { clearTimeout(this.restoreTimer); this.restoreTimer = null }
    this.transition('rebuilding', 'context-restored')
    try {
      this.resources = createResources(this.context)
      this.resizeBackend(this.requireCanvas().width, this.requireCanvas().height)
      this.transition('ready', 'context-restored')
    } catch (cause) {
      this.reportFatal(rendererError(ErrorCodes.RENDERER_CONTEXT_UNAVAILABLE, 'The WebGL2 context could not be rebuilt', true, cause))
    }
  }

  private deleteResources(): void {
    const gl = this.context
    const resources = this.resources
    this.resources = null
    if (!gl || !resources) return
    gl.deleteTexture(resources.texture)
    gl.deleteBuffer(resources.buffer)
    gl.deleteVertexArray(resources.vao)
    gl.deleteProgram(resources.program)
  }
}

function createResources(gl: WebGL2RenderingContext): GlResources {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  let fragment: WebGLShader
  try { fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER) }
  catch (cause) { gl.deleteShader(vertex); throw cause }
  const program = gl.createProgram()
  if (!program) { gl.deleteShader(vertex); gl.deleteShader(fragment); throw rendererError(ErrorCodes.RENDERER_SHADER_FAILED, 'The WebGL2 program could not be created', false) }
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); throw rendererError(ErrorCodes.RENDERER_SHADER_FAILED, 'The WebGL2 program could not be linked', false) }
  const texture = gl.createTexture()
  const buffer = gl.createBuffer()
  const vao = gl.createVertexArray()
  if (!texture || !buffer || !vao) {
    if (texture) gl.deleteTexture(texture)
    if (buffer) gl.deleteBuffer(buffer)
    if (vao) gl.deleteVertexArray(vao)
    gl.deleteProgram(program)
    throw rendererError(ErrorCodes.RENDERER_OPERATION_FAILED, 'WebGL2 resources could not be allocated', true)
  }
  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'a_position')
  if (position < 0) {
    gl.deleteTexture(texture)
    gl.deleteBuffer(buffer)
    gl.deleteVertexArray(vao)
    gl.deleteProgram(program)
    throw rendererError(ErrorCodes.RENDERER_SHADER_FAILED, 'The WebGL2 position attribute is unavailable', false)
  }
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const uniform = (name: string): WebGLUniformLocation => {
    const value = gl.getUniformLocation(program, name)
    if (!value) {
      gl.deleteTexture(texture)
      gl.deleteBuffer(buffer)
      gl.deleteVertexArray(vao)
      gl.deleteProgram(program)
      throw rendererError(ErrorCodes.RENDERER_SHADER_FAILED, 'A required WebGL2 uniform is unavailable', false)
    }
    return value
  }
  return { program, texture, buffer, vao, position, scale: uniform('u_scale'), rotation: uniform('u_rotation'), crop: uniform('u_crop'), filter: uniform('u_filter'), amount: uniform('u_amount') }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw rendererError(ErrorCodes.RENDERER_SHADER_FAILED, 'A WebGL2 shader could not be created', false)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw rendererError(ErrorCodes.RENDERER_SHADER_FAILED, 'A WebGL2 shader could not be compiled', false) }
  return shader
}

function rotationIndex(value: number): number { return value === 90 ? 1 : value === 180 ? 2 : value === 270 ? 3 : 0 }
function filterIndex(value: string): number { return value === 'grayscale' ? 1 : value === 'brightness' ? 2 : value === 'contrast' ? 3 : value === 'saturate' ? 4 : 0 }
function fitScale(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number, fit: string, rotation: number): { x: number; y: number } {
  if (fit === 'fill') return { x: 1, y: 1 }
  const rotated = rotation === 90 || rotation === 270
  const width = rotated ? sourceHeight : sourceWidth
  const height = rotated ? sourceWidth : sourceHeight
  const sourceAspect = width / height
  const targetAspect = targetWidth / targetHeight
  if ((fit === 'contain' && sourceAspect > targetAspect) || (fit === 'cover' && sourceAspect < targetAspect)) return { x: 1, y: targetAspect / sourceAspect }
  return { x: sourceAspect / targetAspect, y: 1 }
}

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "vpx/vp8dx.h"
#include "vpx/vpx_decoder.h"

#define MXWF_MAGIC 0x4d585746u
#define MXWF_ABI_VERSION 1u
#define MXWF_DESCRIPTOR_BYTES 160u
#define MXWF_PIXEL_FORMAT_I420 1u
#define MXWF_FLAG_DURATION_PRESENT 1u
#define MXWF_FLAG_KEY_FRAME 2u
#define MXWF_MAX_DIMENSION 16384u
#define MXWF_MAX_FRAME_BYTES (256u * 1024u * 1024u)
#ifndef MXWF_DECODER_THREADS
#define MXWF_DECODER_THREADS 1u
#endif

typedef struct MxwfDecoder MxwfDecoder;
typedef struct MxwfFrame MxwfFrame;

struct MxwfFrame {
  uint32_t descriptor[40];
  uint32_t token;
  uint32_t allocation_bytes;
  MxwfDecoder *owner;
  MxwfFrame *queue_next;
  MxwfFrame *global_next;
};

struct MxwfDecoder {
  vpx_codec_ctx_t codec;
  uint32_t display_width;
  uint32_t display_height;
  uint32_t color_primaries;
  uint32_t color_transfer;
  uint32_t color_matrix;
  uint32_t color_range;
  MxwfFrame *queue_head;
  MxwfFrame *queue_tail;
  int initialized;
};

static MxwfFrame *mxwf_frames = NULL;
static uint32_t mxwf_next_token = 1u;
static uint32_t mxwf_live_frames = 0u;
static uint32_t mxwf_live_bytes = 0u;

static uint32_t mxwf_align_16(uint32_t value) {
  return (value + 15u) & ~15u;
}

static int mxwf_checked_multiply(uint32_t left, uint32_t right, uint32_t *result) {
  uint64_t value = (uint64_t)left * (uint64_t)right;
  if (value > UINT32_MAX) return 0;
  *result = (uint32_t)value;
  return 1;
}

static int mxwf_checked_add(uint32_t left, uint32_t right, uint32_t *result) {
  uint64_t value = (uint64_t)left + (uint64_t)right;
  if (value > UINT32_MAX) return 0;
  *result = (uint32_t)value;
  return 1;
}

static void mxwf_write_plane(uint32_t *descriptor, uint32_t index, uint32_t offset,
                             uint32_t stride, uint32_t rows, uint32_t row_bytes,
                             uint32_t byte_length) {
  uint32_t base = 24u + index * 5u;
  descriptor[base] = offset;
  descriptor[base + 1u] = stride;
  descriptor[base + 2u] = rows;
  descriptor[base + 3u] = row_bytes;
  descriptor[base + 4u] = byte_length;
}

static void mxwf_remove_global_frame(MxwfFrame *frame) {
  MxwfFrame **cursor = &mxwf_frames;
  while (*cursor != NULL) {
    if (*cursor == frame) {
      *cursor = frame->global_next;
      return;
    }
    cursor = &(*cursor)->global_next;
  }
}

static void mxwf_free_frame(MxwfFrame *frame) {
  if (frame == NULL) return;
  mxwf_remove_global_frame(frame);
  if (mxwf_live_frames > 0u) mxwf_live_frames -= 1u;
  if (mxwf_live_bytes >= frame->allocation_bytes) mxwf_live_bytes -= frame->allocation_bytes;
  else mxwf_live_bytes = 0u;
  free(frame);
}

static void mxwf_release_decoder_frames(MxwfDecoder *decoder) {
  MxwfFrame *frame = mxwf_frames;
  while (frame != NULL) {
    MxwfFrame *next = frame->global_next;
    if (frame->owner == decoder) mxwf_free_frame(frame);
    frame = next;
  }
  decoder->queue_head = NULL;
  decoder->queue_tail = NULL;
}

static void mxwf_map_colors(const MxwfDecoder *decoder, const vpx_image_t *image,
                            uint32_t *primaries, uint32_t *transfer,
                            uint32_t *matrix, uint32_t *range) {
  *primaries = decoder->color_primaries;
  *transfer = decoder->color_transfer;
  *matrix = decoder->color_matrix;
  *range = decoder->color_range;

  if (*primaries == 0u || *transfer == 0u || *matrix == 0u) {
    uint32_t mapped_primaries = 0u;
    uint32_t mapped_transfer = 0u;
    uint32_t mapped_matrix = 0u;
    switch (image->cs) {
      case VPX_CS_BT_709:
        mapped_primaries = 1u;
        mapped_transfer = 1u;
        mapped_matrix = 2u;
        break;
      case VPX_CS_BT_2020:
        mapped_primaries = 4u;
        mapped_matrix = 5u;
        break;
      case VPX_CS_SRGB:
        mapped_primaries = 1u;
        mapped_transfer = 3u;
        mapped_matrix = 1u;
        break;
      case VPX_CS_BT_601:
      case VPX_CS_SMPTE_170:
      case VPX_CS_SMPTE_240:
        mapped_primaries = 3u;
        mapped_transfer = 2u;
        mapped_matrix = 4u;
        break;
      default:
        break;
    }
    if (*primaries == 0u) *primaries = mapped_primaries;
    if (*transfer == 0u) *transfer = mapped_transfer;
    if (*matrix == 0u) *matrix = mapped_matrix;
  }

  if (*primaries == 0u) *primaries = 3u;
  if (*transfer == 0u) *transfer = 2u;
  if (*matrix == 0u) *matrix = 4u;
  if (*range == 0u) *range = image->range == VPX_CR_FULL_RANGE ? 2u : 1u;
}

static int mxwf_queue_image(MxwfDecoder *decoder, const vpx_image_t *image,
                            uint32_t timestamp_lo, uint32_t timestamp_hi,
                            uint32_t duration_lo, uint32_t duration_hi,
                            uint32_t flags) {
  uint32_t width;
  uint32_t height;
  uint32_t chroma_width;
  uint32_t chroma_height;
  uint32_t y_stride;
  uint32_t uv_stride;
  uint32_t y_bytes;
  uint32_t u_bytes;
  uint32_t v_bytes;
  uint32_t pixel_bytes;
  uint32_t allocation_bytes;
  uint32_t y_offset;
  uint32_t u_offset;
  uint32_t v_offset;
  uint32_t primaries;
  uint32_t transfer;
  uint32_t matrix;
  uint32_t range;

  if (image == NULL || image->fmt != VPX_IMG_FMT_I420) return -20;
  width = image->d_w;
  height = image->d_h;
  if (width == 0u || height == 0u || width > MXWF_MAX_DIMENSION || height > MXWF_MAX_DIMENSION) return -21;
  if (image->planes[VPX_PLANE_Y] == NULL || image->planes[VPX_PLANE_U] == NULL || image->planes[VPX_PLANE_V] == NULL) return -22;
  if (image->stride[VPX_PLANE_Y] <= 0 || image->stride[VPX_PLANE_U] <= 0 || image->stride[VPX_PLANE_V] <= 0) return -23;

  chroma_width = (width + 1u) / 2u;
  chroma_height = (height + 1u) / 2u;
  y_stride = mxwf_align_16(width);
  uv_stride = mxwf_align_16(chroma_width);
  if (!mxwf_checked_multiply(y_stride, height, &y_bytes)
      || !mxwf_checked_multiply(uv_stride, chroma_height, &u_bytes)) return -24;
  v_bytes = u_bytes;
  if (!mxwf_checked_add(y_bytes, u_bytes, &pixel_bytes)
      || !mxwf_checked_add(pixel_bytes, v_bytes, &pixel_bytes)
      || pixel_bytes > MXWF_MAX_FRAME_BYTES
      || !mxwf_checked_add((uint32_t)sizeof(MxwfFrame), pixel_bytes, &allocation_bytes)) return -25;

  MxwfFrame *frame = (MxwfFrame *)calloc(1u, allocation_bytes);
  if (frame == NULL) return -26;
  frame->owner = decoder;
  frame->allocation_bytes = allocation_bytes;
  frame->token = mxwf_next_token++;
  if (frame->token == 0u) frame->token = mxwf_next_token++;
  y_offset = (uint32_t)(uintptr_t)(frame + 1);
  u_offset = y_offset + y_bytes;
  v_offset = u_offset + u_bytes;

  uint8_t *y_destination = (uint8_t *)(uintptr_t)y_offset;
  uint8_t *u_destination = (uint8_t *)(uintptr_t)u_offset;
  uint8_t *v_destination = (uint8_t *)(uintptr_t)v_offset;
  for (uint32_t row = 0u; row < height; row += 1u) {
    memcpy(y_destination + row * y_stride,
           image->planes[VPX_PLANE_Y] + row * (uint32_t)image->stride[VPX_PLANE_Y], width);
  }
  for (uint32_t row = 0u; row < chroma_height; row += 1u) {
    memcpy(u_destination + row * uv_stride,
           image->planes[VPX_PLANE_U] + row * (uint32_t)image->stride[VPX_PLANE_U], chroma_width);
    memcpy(v_destination + row * uv_stride,
           image->planes[VPX_PLANE_V] + row * (uint32_t)image->stride[VPX_PLANE_V], chroma_width);
  }

  mxwf_map_colors(decoder, image, &primaries, &transfer, &matrix, &range);
  frame->descriptor[0] = MXWF_MAGIC;
  frame->descriptor[1] = MXWF_ABI_VERSION;
  frame->descriptor[2] = MXWF_DESCRIPTOR_BYTES;
  frame->descriptor[3] = frame->token;
  frame->descriptor[4] = MXWF_PIXEL_FORMAT_I420;
  frame->descriptor[5] = flags & (MXWF_FLAG_DURATION_PRESENT | MXWF_FLAG_KEY_FRAME);
  frame->descriptor[6] = width;
  frame->descriptor[7] = height;
  frame->descriptor[8] = 0u;
  frame->descriptor[9] = 0u;
  frame->descriptor[10] = width;
  frame->descriptor[11] = height;
  frame->descriptor[12] = decoder->display_width == 0u ? width : decoder->display_width;
  frame->descriptor[13] = decoder->display_height == 0u ? height : decoder->display_height;
  frame->descriptor[14] = timestamp_lo;
  frame->descriptor[15] = timestamp_hi;
  frame->descriptor[16] = duration_lo;
  frame->descriptor[17] = duration_hi;
  frame->descriptor[18] = primaries;
  frame->descriptor[19] = transfer;
  frame->descriptor[20] = matrix;
  frame->descriptor[21] = range;
  frame->descriptor[22] = 3u;
  frame->descriptor[23] = 0u;
  mxwf_write_plane(frame->descriptor, 0u, y_offset, y_stride, height, width, y_bytes);
  mxwf_write_plane(frame->descriptor, 1u, u_offset, uv_stride, chroma_height, chroma_width, u_bytes);
  mxwf_write_plane(frame->descriptor, 2u, v_offset, uv_stride, chroma_height, chroma_width, v_bytes);
  frame->descriptor[39] = 0u;

  frame->global_next = mxwf_frames;
  mxwf_frames = frame;
  if (decoder->queue_tail == NULL) decoder->queue_head = frame;
  else decoder->queue_tail->queue_next = frame;
  decoder->queue_tail = frame;
  mxwf_live_frames += 1u;
  mxwf_live_bytes += allocation_bytes;
  return 0;
}

static int mxwf_collect_frames(MxwfDecoder *decoder, uint32_t timestamp_lo,
                               uint32_t timestamp_hi, uint32_t duration_lo,
                               uint32_t duration_hi, uint32_t flags) {
  vpx_codec_iter_t iterator = NULL;
  vpx_image_t *image;
  while ((image = vpx_codec_get_frame(&decoder->codec, &iterator)) != NULL) {
    int result = mxwf_queue_image(decoder, image, timestamp_lo, timestamp_hi,
                                  duration_lo, duration_hi, flags);
    if (result != 0) return result;
  }
  return 0;
}

uint32_t mxwf_abi_version(void) {
  return MXWF_ABI_VERSION;
}

uint32_t mxwf_alloc(uint32_t byte_length) {
  if (byte_length == 0u || byte_length > MXWF_MAX_FRAME_BYTES) return 0u;
  return (uint32_t)(uintptr_t)malloc(byte_length);
}

void mxwf_free(uint32_t pointer) {
  free((void *)(uintptr_t)pointer);
}

uint32_t mxwf_decoder_create(uint32_t display_width, uint32_t display_height,
                             uint32_t color_primaries, uint32_t color_transfer,
                             uint32_t color_matrix, uint32_t color_range) {
  MxwfDecoder *decoder;
  vpx_codec_dec_cfg_t config;
  if (display_width > MXWF_MAX_DIMENSION || display_height > MXWF_MAX_DIMENSION) return 0u;
  decoder = (MxwfDecoder *)calloc(1u, sizeof(MxwfDecoder));
  if (decoder == NULL) return 0u;
  memset(&config, 0, sizeof(config));
  config.threads = MXWF_DECODER_THREADS;
  config.w = display_width;
  config.h = display_height;
  if (vpx_codec_dec_init(&decoder->codec, vpx_codec_vp8_dx(), &config, 0u) != VPX_CODEC_OK) {
    free(decoder);
    return 0u;
  }
  decoder->initialized = 1;
  decoder->display_width = display_width;
  decoder->display_height = display_height;
  decoder->color_primaries = color_primaries;
  decoder->color_transfer = color_transfer;
  decoder->color_matrix = color_matrix;
  decoder->color_range = color_range;
  return (uint32_t)(uintptr_t)decoder;
}

int32_t mxwf_decoder_decode(uint32_t handle, uint32_t data_pointer,
                            uint32_t data_length, uint32_t timestamp_lo,
                            uint32_t timestamp_hi, uint32_t duration_lo,
                            uint32_t duration_hi, uint32_t flags) {
  MxwfDecoder *decoder = (MxwfDecoder *)(uintptr_t)handle;
  if (decoder == NULL || !decoder->initialized || data_pointer == 0u || data_length == 0u) return -1;
  if (vpx_codec_decode(&decoder->codec, (const uint8_t *)(uintptr_t)data_pointer,
                       data_length, NULL, 0) != VPX_CODEC_OK) return -2;
  return mxwf_collect_frames(decoder, timestamp_lo, timestamp_hi,
                             duration_lo, duration_hi, flags);
}

int32_t mxwf_decoder_flush(uint32_t handle) {
  MxwfDecoder *decoder = (MxwfDecoder *)(uintptr_t)handle;
  if (decoder == NULL || !decoder->initialized) return -1;
  if (vpx_codec_decode(&decoder->codec, NULL, 0u, NULL, 0) != VPX_CODEC_OK) return -2;
  return mxwf_collect_frames(decoder, 0u, 0u, 0u, 0u, 0u);
}

int32_t mxwf_decoder_reset(uint32_t handle) {
  MxwfDecoder *decoder = (MxwfDecoder *)(uintptr_t)handle;
  vpx_codec_dec_cfg_t config;
  if (decoder == NULL || !decoder->initialized) return -1;
  mxwf_release_decoder_frames(decoder);
  if (vpx_codec_destroy(&decoder->codec) != VPX_CODEC_OK) return -2;
  memset(&config, 0, sizeof(config));
  config.threads = MXWF_DECODER_THREADS;
  config.w = decoder->display_width;
  config.h = decoder->display_height;
  if (vpx_codec_dec_init(&decoder->codec, vpx_codec_vp8_dx(), &config, 0u) != VPX_CODEC_OK) {
    decoder->initialized = 0;
    return -3;
  }
  return 0;
}

uint32_t mxwf_decoder_receive_frame(uint32_t handle) {
  MxwfDecoder *decoder = (MxwfDecoder *)(uintptr_t)handle;
  MxwfFrame *frame;
  if (decoder == NULL || !decoder->initialized || decoder->queue_head == NULL) return 0u;
  frame = decoder->queue_head;
  decoder->queue_head = frame->queue_next;
  if (decoder->queue_head == NULL) decoder->queue_tail = NULL;
  frame->queue_next = NULL;
  return (uint32_t)(uintptr_t)frame->descriptor;
}

void mxwf_frame_release(uint32_t token) {
  MxwfFrame *frame = mxwf_frames;
  while (frame != NULL) {
    if (frame->token == token) {
      mxwf_free_frame(frame);
      return;
    }
    frame = frame->global_next;
  }
}

void mxwf_decoder_destroy(uint32_t handle) {
  MxwfDecoder *decoder = (MxwfDecoder *)(uintptr_t)handle;
  if (decoder == NULL) return;
  mxwf_release_decoder_frames(decoder);
  if (decoder->initialized) vpx_codec_destroy(&decoder->codec);
  decoder->initialized = 0;
  free(decoder);
}

uint32_t mxwf_debug_live_frames(void) {
  return mxwf_live_frames;
}

uint32_t mxwf_debug_live_bytes(void) {
  return mxwf_live_bytes;
}

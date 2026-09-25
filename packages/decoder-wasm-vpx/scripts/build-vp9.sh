#!/usr/bin/env bash
set -euo pipefail
variant=$1
sdk=$(cygpath -u "$MXVPX_EMSDK")
source_dir=$(cygpath -u "$MXVPX_SOURCE")
package_dir=$(cygpath -u "$MXVPX_PACKAGE")
make_bin=$(cygpath -u "$MXVPX_MAKE")
export PATH="/usr/bin:$sdk/upstream/emscripten:$PATH"
python_bin=$(cygpath -m "$EMSDK_PYTHON")
compiler_dir=$(cygpath -m "$sdk/upstream/emscripten")
# The configure script invokes CC through shell evaluation. Use the Emscripten
# entry points on PATH rather than embedding quoted Windows paths in CC/CXX.
export CC=emcc
export CXX=em++
export AR=emar
export LD=emcc
export AS=emcc
export STRIP=emar
flags='-O3 -sSUPPORT_LONGJMP=wasm'
thread_config=--disable-multithread
thread_count=1
case "$variant" in
  single) ;;
  simd) flags="$flags -msimd128" ;;
  threaded) flags="$flags -pthread"; thread_config=--enable-multithread; thread_count=2 ;;
  *) exit 2 ;;
esac
build_dir="$package_dir/.cache/vp9/$variant"
mkdir -p "$build_dir"
cd "$build_dir"
relative_source=$(realpath --relative-to="$build_dir" "$source_dir")
bash "$relative_source/configure" --target=generic-gnu \
  --enable-vp8 --enable-vp9 --enable-vp9-highbitdepth \
  --disable-vp8-encoder --disable-vp9-encoder --disable-examples --disable-tools \
  --disable-docs --disable-unit-tests --disable-shared --disable-webm-io \
  --disable-libyuv --disable-runtime-cpu-detect "$thread_config" \
  --extra-cflags="$flags"
"$make_bin" -j"$MXVPX_JOBS" SHELL=sh libvpx.a
exports='["_mxwf_abi_version","_mxwf_alloc","_mxwf_free","_mxwf_decoder_create","_mxwf_decoder_create_codec","_mxwf_decoder_decode","_mxwf_decoder_flush","_mxwf_decoder_reset","_mxwf_decoder_receive_frame","_mxwf_frame_release","_mxwf_decoder_destroy","_mxwf_debug_live_frames","_mxwf_debug_live_bytes"]'
read -r -a compiler_flags <<< "$flags"
"$python_bin" "$compiler_dir/emcc.py" "$package_dir/native/mxwf_vpx.c" \
  "${compiler_flags[@]}" -DMXWF_DECODER_THREADS="$thread_count" \
  -I "$source_dir" -I . libvpx.a --no-entry -sSTANDALONE_WASM=1 \
  -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=0 -sINITIAL_MEMORY=268435456 \
  -sMALLOC=emmalloc "-sEXPORTED_FUNCTIONS=$exports" \
  -o "$package_dir/wasm/libvpx-vp9-$variant.wasm"
sha256sum "$package_dir/wasm/libvpx-vp9-$variant.wasm"

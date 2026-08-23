$ErrorActionPreference = 'Stop'
$output = Join-Path $PSScriptRoot '..\..\tests\media\fixtures'
New-Item -ItemType Directory -Force $output | Out-Null

function Invoke-Fixture([string[]] $Arguments) {
  & ffmpeg -hide_banner -loglevel error @Arguments
  if ($LASTEXITCODE -ne 0) { throw "FFmpeg fixture generation failed with exit code $LASTEXITCODE" }
}

$video = 'testsrc2=size=320x180:rate=30:duration=3'
$audio = 'sine=frequency={0}:sample_rate=48000:duration=3'
Invoke-Fixture @('-f','lavfi','-i',$video,'-f','lavfi','-i',($audio -f 880),'-map_metadata','-1','-c:v','libx264','-preset','medium','-profile:v','baseline','-level','3.0','-pix_fmt','yuv420p','-x264-params','threads=1:lookahead_threads=1:sliced_threads=0','-c:a','aac','-b:a','96k','-movflags','+faststart','-shortest','-y',(Join-Path $output 'mp4-h264-baseline-8bit-aac.mp4'))
Invoke-Fixture @('-f','lavfi','-i',$video,'-f','lavfi','-i',($audio -f 660),'-map_metadata','-1','-c:v','libvpx','-deadline','good','-cpu-used','4','-threads','1','-pix_fmt','yuv420p','-b:v','350k','-c:a','libopus','-b:a','64k','-shortest','-y',(Join-Path $output 'webm-vp8-p0-8bit-opus.webm'))
Invoke-Fixture @('-f','lavfi','-i',$video,'-map_metadata','-1','-c:v','libvpx','-deadline','good','-cpu-used','4','-threads','1','-pix_fmt','yuv420p','-b:v','350k','-an','-y',(Join-Path $output 'webm-vp8-p0-8bit-video-only.webm'))
Invoke-Fixture @('-f','lavfi','-i',$video,'-f','lavfi','-i',($audio -f 550),'-map_metadata','-1','-c:v','libvpx-vp9','-deadline','good','-cpu-used','4','-row-mt','0','-threads','1','-pix_fmt','yuv420p','-b:v','300k','-c:a','libopus','-b:a','64k','-shortest','-y',(Join-Path $output 'webm-vp9-p0-8bit-opus.webm'))
Invoke-Fixture @('-f','lavfi','-i',$video,'-f','lavfi','-i',($audio -f 440),'-map_metadata','-1','-c:v','libvpx-vp9','-deadline','good','-cpu-used','4','-row-mt','0','-threads','1','-profile:v','2','-pix_fmt','yuv420p10le','-b:v','350k','-c:a','libopus','-b:a','64k','-shortest','-y',(Join-Path $output 'webm-vp9-p2-10bit-opus.webm'))
Invoke-Fixture @('-f','lavfi','-i',$video,'-f','lavfi','-i',($audio -f 770),'-map_metadata','-1','-c:v','libaom-av1','-cpu-used','8','-threads','1','-row-mt','0','-pix_fmt','yuv420p','-b:v','260k','-c:a','aac','-b:a','96k','-movflags','+faststart','-shortest','-y',(Join-Path $output 'mp4-av1-main-8bit-aac.mp4'))
Invoke-Fixture @('-f','lavfi','-i',$video,'-f','lavfi','-i',($audio -f 330),'-map_metadata','-1','-c:v','libx265','-preset','medium','-profile:v','main10','-pix_fmt','yuv420p10le','-x265-params','pools=1:frame-threads=1:log-level=error','-tag:v','hvc1','-b:v','350k','-c:a','aac','-b:a','96k','-movflags','+faststart','-shortest','-y',(Join-Path $output 'mp4-hevc-main10-10bit-aac.mp4'))
# Matroska needs -bitexact: without it the muxer writes a random SegmentUID and the file hash
# changes on every run, which the corpus verification would reject.
Invoke-Fixture @('-f','lavfi','-i',$video,'-f','lavfi','-i',($audio -f 990),'-map_metadata','-1','-bitexact','-c:v','libx264','-preset','medium','-profile:v','baseline','-level','3.0','-pix_fmt','yuv420p','-x264-params','threads=1:lookahead_threads=1:sliced_threads=0','-c:a','aac','-b:a','96k','-shortest','-y',(Join-Path $output 'mkv-h264-baseline-8bit-aac.mkv'))
Invoke-Fixture @('-f','lavfi','-i',$video,'-f','lavfi','-i',($audio -f 220),'-map_metadata','-1','-bitexact','-c:v','libvpx','-deadline','good','-cpu-used','4','-threads','1','-pix_fmt','yuv420p','-b:v','350k','-c:a','libopus','-b:a','64k','-shortest','-y',(Join-Path $output 'mkv-vp8-p0-8bit-opus.mkv'))
Write-Host 'Fixtures regenerated. Run pnpm quality:media and review every hash before committing.'

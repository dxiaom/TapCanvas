import { FFmpeg } from '@ffmpeg/ffmpeg'

// wasm 二进制 30MB+，超过 EdgeOne Pages 单文件 25MiB 上限，生产环境需外置托管
// （如 API 域名的 /assets/local/ffmpeg/ffmpeg-core.wasm），默认仍走同源 public 目录。
const wasmURL =
  typeof import.meta.env.VITE_FFMPEG_WASM_URL === 'string' &&
  import.meta.env.VITE_FFMPEG_WASM_URL.trim()
    ? import.meta.env.VITE_FFMPEG_WASM_URL.trim()
    : '/ffmpeg/ffmpeg-core.wasm'

let ffmpegInstance: FFmpeg | null = null
let loadPromise: Promise<FFmpeg> | null = null

export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    const ffmpeg = new FFmpeg()
    await ffmpeg.load({
      coreURL: '/ffmpeg/ffmpeg-core.js',
      wasmURL,
      classWorkerURL: '/ffmpeg/ffmpeg.worker.js',
    })
    ffmpegInstance = ffmpeg
    return ffmpeg
  })()
  try {
    return await loadPromise
  } catch (e) {
    loadPromise = null
    throw e
  }
}

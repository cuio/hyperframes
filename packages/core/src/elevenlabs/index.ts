export {
  loadElevenLabsKey,
  getElevenLabsKeyStatus,
  writeElevenLabsKeyToEnvFile,
  ELEVENLABS_KEY_NAME,
} from "./env.js";
export { readTtsSettings, readDefaultVoiceId, writeTtsSettings } from "./projectSettings.js";
export type { TtsProjectSettings } from "./projectSettings.js";
export type { ElevenLabsKeySource, ElevenLabsKeyStatus } from "./env.js";
export {
  listVoices,
  fetchVoicePreview,
  synthesize,
  fileExtensionForFormat,
  ElevenLabsError,
} from "./client.js";
export type { ElevenLabsVoice, SynthesizeOptions } from "./client.js";
export { generateSoundEffect, clampSfxDuration, SFX_BOUNDS } from "./sfx.js";
export type { GenerateSfxOptions, GenerateSfxResult } from "./sfx.js";
export {
  generateMusic,
  generateMusicAndWait,
  getMusicJob,
  downloadMusic,
  clampMusicDuration,
  MUSIC_BOUNDS,
} from "./music.js";
export type { GenerateMusicOptions, MusicJob, MusicJobStatus } from "./music.js";


export enum ProcessingStep {
  IDLE = 'IDLE',
  UPLOADING = 'UPLOADING',
  ANALYZING = 'ANALYZING',
  TRANSLATING = 'TRANSLATING',
  GENERATING_VOICE = 'GENERATING_VOICE',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export type SettingsMode = 'auto' | 'manual';
export type Gender = 'male' | 'female';
export type Mood = 'natural' | 'cheerful' | 'excited' | 'soft' | 'serious' | 'isan';
export type SpeechSpeed = 'normal' | 'sync';

export interface VoiceSettings {
  mode: SettingsMode;
  gender: Gender;
  mood: Mood;
  speed: SpeechSpeed;
}

export interface TranslationResult {
  originalText: string;
  thaiTranslation: string;
}

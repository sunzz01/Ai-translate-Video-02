
import { GoogleGenAI, Modality } from "@google/genai";
import { VoiceSettings } from "../types";

const moodToEnglish = (mood: string) => {
  switch (mood) {
    case 'cheerful': return 'cheerfully';
    case 'excited': return 'excitedly';
    case 'soft': return 'softly and gently';
    case 'serious': return 'seriously and formally';
    case 'isan': return 'with a friendly Isan (Northeastern Thai) dialect and accent';
    default: return 'naturally';
  }
};

export const translateVideoContent = async (
  videoBase64: string, 
  mimeType: string,
  settings: VoiceSettings,
  duration?: number
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const speedInstruction = settings.speed === 'sync' && duration 
    ? `The video duration is ${duration.toFixed(1)} seconds. Ensure the translation is concise enough to be spoken naturally within this time limit.` 
    : "Translate naturally without strict time constraints.";

  const dialectInstruction = settings.mood === 'isan' 
    ? "Translate the spoken words into Isan dialect (Northeastern Thai). Use Isan vocabulary and particle words like 'เด้อ', 'น้อ', 'จ้า' naturally."
    : "Translate spoken words into standard Thai.";

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        {
          inlineData: {
            data: videoBase64,
            mimeType: mimeType
          }
        },
        {
          text: `Analyze the audio/visual content. 
          1. Detect the source language. 
          2. ${dialectInstruction}
          Tone/Style: ${moodToEnglish(settings.mood)}.
          Target Gender of Speaker: ${settings.gender}.
          Timing: ${speedInstruction}
          Return ONLY the translated text for text-to-speech.`
        }
      ]
    },
    config: {
      temperature: 0.7,
    }
  });

  return response.text || '';
};

export const generateThaiHook = async (
  currentText: string,
  settings: VoiceSettings
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const dialectContext = settings.mood === 'isan' ? "in Isan dialect" : "in Thai";

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Rewrite this text ${dialectContext} to be a high-engagement social media hook (like for TikTok/Reels). 
    The first 3 seconds must be extremely catchy and stop the scroll. 
    Keep the core meaning but make it punchy, emotional, or intriguing.
    Current Text: "${currentText}"
    Return ONLY the improved text.`
  });

  return response.text || currentText;
};

export const generateIsanHook = async (
  currentText: string
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Rewrite this text to be an extremely catchy social media hook (TikTok/Reels style) using PURE Isan (Northeastern Thai) dialect. 
    Every word must be translated into Isan dialect (e.g., use 'เบิ่ง' instead of 'ดู', 'แซ่บ' instead of 'อร่อย', 'เด้อ' particles). 
    Make it funny, spicy (zabb), and highly engaging.
    Current Text: "${currentText}"
    Return ONLY the improved PURE Isan text.`
  });

  return response.text || currentText;
};

export const generateThaiSpeech = async (
  text: string, 
  settings: VoiceSettings,
  duration?: number
): Promise<Uint8Array> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const moodPrompt = moodToEnglish(settings.mood);
  const voiceName = settings.gender === 'male' ? 'Puck' : 'Kore';
  
  const timingPrompt = settings.speed === 'sync' && duration
    ? `Adjust your speaking pace so that this entire text is spoken in exactly ${duration.toFixed(1)} seconds.`
    : "Speak at a normal natural pace.";

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: `Instruction: ${timingPrompt} Speak ${moodPrompt}. Text: ${text}` }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voiceName },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error('Failed to generate audio from Gemini TTS');
  }

  return decodeBase64(base64Audio);
};

function decodeBase64(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodePCMData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

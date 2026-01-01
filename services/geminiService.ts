
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

/**
 * ล้างข้อความเพื่อให้พร้อมสำหรับการพากย์เสียง 
 * (ลบ Markdown, ลบเครื่องหมายคำพูดส่วนเกิน และลบข้อความอธิบายที่ AI อาจแถมมา)
 */
const cleanTextForSpeech = (text: string): string => {
  let cleaned = text
    .replace(/[*_#`~]/g, '') // ลบ Markdown
    .replace(/^["']|["']$/g, '') // ลบเครื่องหมายคำพูดที่หัว/ท้าย
    .replace(/\[.*?\]/g, '') // ลบคำอธิบายในวงเล็บเหลี่ยมเช่น [Music], [Sound]
    .replace(/\(.*?\)/g, '') // ลบคำอธิบายในวงเล็บกลม
    .trim();
    
  // จำกัดความยาวข้อความสำหรับ TTS เพื่อป้องกัน Error 500 (Internal Error) ในรุ่นทดลอง
  if (cleaned.length > 800) {
    cleaned = cleaned.substring(0, 797) + "...";
  }
  
  return cleaned;
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
          Return ONLY the translated text for text-to-speech. Do not include any meta-talk like 'Here is the translation'.`
        }
      ]
    },
    config: {
      temperature: 0.7,
    }
  });

  return cleanTextForSpeech(response.text || '');
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
    Return ONLY the improved text. Do not add any explanation or notes.`
  });

  return cleanTextForSpeech(response.text || currentText);
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

  return cleanTextForSpeech(response.text || currentText);
};

export const generateThaiSpeech = async (
  text: string, 
  settings: VoiceSettings,
  duration?: number,
  retryAttempt: number = 0
): Promise<Uint8Array> => {
  const cleanedText = cleanTextForSpeech(text);
  
  if (!cleanedText) {
    throw new Error('Text for speech is empty after cleaning');
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const moodDesc = moodToEnglish(settings.mood);
  const voiceName = settings.gender === 'male' ? 'Puck' : 'Kore';
  const speedDesc = settings.speed === 'sync' ? "moderately fast" : "natural";

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      // ใช้ Prompt ที่เรียบง่ายที่สุดเพื่อเลี่ยง Error 500
      contents: [{ 
        parts: [{ 
          text: `Speak ${moodDesc} at a ${speedDesc} pace: ${cleanedText}` 
        }] 
      }],
      config: {
        // นำ systemInstruction ออกเพื่อความเสถียรของรุ่น Preview
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voiceName },
          },
        },
      },
    });

    const candidate = response.candidates?.[0];
    
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
      const reason = candidate.finishReason;
      if (retryAttempt === 0) {
        console.warn(`TTS error ${reason}, retrying with simplified mood...`);
        return generateThaiSpeech(cleanedText, { ...settings, mood: 'natural', speed: 'normal' }, undefined, 1);
      }
      throw new Error(`TTS failed with reason: ${reason}. Please try simplifying the text or using a shorter version.`);
    }

    let base64Audio: string | undefined;
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.inlineData?.data) {
          base64Audio = part.inlineData.data;
          break;
        }
      }
    }

    if (!base64Audio) {
      throw new Error('Failed to generate audio data from Gemini.');
    }

    return decodeBase64(base64Audio);
  } catch (error: any) {
    console.error('Gemini TTS Error:', error);
    
    // หากเกิด Error 500 หรืออื่นๆ ให้ลองใหม่ 1 ครั้งด้วยค่าที่เซฟที่สุด
    if (retryAttempt === 0) {
       console.log('Internal error encountered, attempting fallback...');
       return generateThaiSpeech(cleanedText, { ...settings, mood: 'natural', speed: 'normal' }, undefined, 1);
    }
    
    throw new Error(error.message || 'Gemini TTS Service is temporarily unavailable (Internal Error 500). Please try again or use shorter text.');
  }
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
  const dataInt16 = new Int16Array(
    data.buffer, 
    data.byteOffset, 
    Math.floor(data.byteLength / 2)
  );
  
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

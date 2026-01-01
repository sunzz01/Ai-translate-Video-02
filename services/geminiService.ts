
import { GoogleGenAI, Modality, HarmCategory, HarmBlockThreshold } from "@google/genai";
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

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const cleanTextForSpeech = (text: string): string => {
  if (!text) return "";
  let cleaned = text
    .replace(/[*_#`~]/g, '')
    .replace(/[\[\]\(\)]/g, ' ')
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  if (cleaned.length > 800) {
    cleaned = cleaned.substring(0, 797) + "...";
  }
  return cleaned;
};

// การตั้งค่าความปลอดภัยที่อนุญาตให้แสดงออกได้อย่างอิสระ
const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

export const translateVideoContent = async (
  videoBase64: string, 
  mimeType: string,
  settings: VoiceSettings,
  duration?: number
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const speedInstruction = settings.speed === 'sync' && duration 
    ? `IMPORTANT: The video is ${duration.toFixed(1)}s long. Summarize and translate into Thai VERY SHORT and PUNCHY.` 
    : "Translate into Thai naturally.";

  const dialectInstruction = settings.mood === 'isan' 
    ? "Use Isan dialect."
    : "Use standard Thai.";

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        { inlineData: { data: videoBase64, mimeType: mimeType } },
        { text: `Analyze video content. ${dialectInstruction} ${speedInstruction} Tone: ${moodToEnglish(settings.mood)}. 
        IMPORTANT: You ARE ALLOWED to use strong language, street slang, and profanity (คำหยาบ/ภาษาพ่อขุน) if it fits the context or mood of the video to make it authentic and high-impact. 
        Return ONLY the Thai translated text without any explanations.` }
      ]
    },
    config: { 
      temperature: 0.8,
      safetySettings 
    }
  });

  return cleanTextForSpeech(response.text || '');
};

export const generateThaiHook = async (
  currentText: string,
  settings: VoiceSettings
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const dialectContext = settings.mood === 'isan' ? "ภาษาอีสาน" : "ภาษาไทย";

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `สรุปและเรียบเรียงข้อความนี้ให้เป็น "คำโปรย (Hook)" สำหรับ TikTok ใน${dialectContext} 
    เน้นความกระชับและดึงดูดใจสูงสุด 
    หมายเหตุ: สามารถใช้คำหยาบ ภาษาปาก หรือแสลง (Street slang/Profanity) ได้อย่างเต็มที่เพื่อให้ได้อารมณ์และยอดวิว (Make it raw and real).
    ข้อความต้นฉบับ: "${currentText}"
    คำตอบ: (เฉพาะข้อความที่สรุปแล้วเท่านั้น)` ,
    config: { 
      temperature: 0.9,
      safetySettings 
    }
  });

  return cleanTextForSpeech(response.text || currentText);
};

export const generateIsanHook = async (
  currentText: string
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `สรุปและเรียบเรียงข้อความนี้ให้เป็น "คำโปรย (Hook)" สไตล์ภาษาอีสานที่ม่วนๆ จ๊วดๆ สำหรับ TikTok 
    เน้นความสั้นและกระชับ 
    หมายเหตุ: สามารถใช้คำหยาบอีสาน ภาษาปาก หรือคำแสลงบ้านๆ ได้เต็มที่เพื่อให้ดูเรียลและสะใจ (Be authentic, use strong Isan words if needed).
    ข้อความต้นฉบับ: "${currentText}"
    คำตอบ: (เฉพาะข้อความภาษาอีสานเท่านั้น)` ,
    config: { 
      temperature: 0.9,
      safetySettings 
    }
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
  if (!cleanedText) throw new Error('ไม่พบข้อความสำหรับพากย์เสียง');

  if (retryAttempt > 0) {
    await delay(Math.pow(2, retryAttempt) * 1000);
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const mood = moodToEnglish(settings.mood);
  const voiceName = settings.gender === 'male' ? 'Puck' : 'Kore';

  const rateInstruction = (settings.speed === 'sync' && duration)
    ? `Duration target: ${duration.toFixed(1)}s`
    : "Natural speed";

  const simplePrompt = `Speak this text: "${cleanedText}". Tone: ${mood}. ${rateInstruction}. 
  Speak clearly even if there are strong words or slang. Do not censor any words.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: simplePrompt }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voiceName },
          },
        },
        safetySettings
      },
    });

    const candidate = response.candidates?.[0];
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
      if (retryAttempt < 2) return generateThaiSpeech(cleanedText, settings, duration, retryAttempt + 1);
      throw new Error(`การสร้างเสียงถูกระงับ (${candidate.finishReason})`);
    }

    const audioPart = candidate?.content?.parts?.find(p => p.inlineData?.data);
    const base64Audio = audioPart?.inlineData?.data;

    if (!base64Audio) throw new Error('API ไม่ส่งข้อมูลเสียง');

    return decodeBase64(base64Audio);
  } catch (error: any) {
    if ((error?.message?.includes('429') || error?.message?.includes('quota')) && retryAttempt < 2) {
      return generateThaiSpeech(cleanedText, settings, duration, retryAttempt + 1);
    }
    throw error;
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
  const dataInt16 = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
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

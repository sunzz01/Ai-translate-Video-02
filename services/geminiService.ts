
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

// การตั้งค่าความปลอดภัยที่อนุญาตให้เจ็นคำหยาบและภาษาดุเดือดได้เต็มที่
const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE, // อนุญาตคำที่ดูเหมือนการคุกคาม/ดุดัน
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE, // อนุญาตคำแสลงดุๆ
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE, // ป้องกันการเข้าใจผิดในคำกำกวม (เช่น ลึกๆ, ยัน)
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
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

  const intensityInstruction = settings.intensity === 'polite'
    ? "Use extremely polite and formal Thai (incl. krup/ka). NO PROFANITY."
    : settings.intensity === 'rude'
      ? "Use high-impact street slang, profanity (คำหยาบ/ภาษาพ่อขุน) and strong language to make it raw and authentic."
      : "Use natural, everyday Thai.";

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
      parts: [
        { inlineData: { data: videoBase64, mimeType: mimeType } },
        {
          text: `Analyze video content. ${dialectInstruction} ${speedInstruction} Tone: ${moodToEnglish(settings.mood)}. 
        ${intensityInstruction}
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
  settings: VoiceSettings,
  duration?: number
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const dialectContext = settings.mood === 'isan' ? "ภาษาอีสาน" : "ภาษาไทย";

  const speedInstruction = duration
    ? `วิดีโอมีความยาว/เป้าหมายเวลาคือ ${duration.toFixed(1)} วินาที ดังนั้นต้องสรุปและเรียบเรียงให้ประโยคมีความยาว "สัมพันธ์" กับเวลาดังกล่าว (เมื่อพูดออกมาแล้วควรมีระยะเวลาใกล้เคียง ${duration.toFixed(1)} วินาที)`
    : "เน้นความน่าสนใจและดึงดูดใจ";

  const intensityInstruction = settings.intensity === 'polite'
    ? "เน้นความสุภาพ อ่อนโยน และไม่ใช้คำหยาบ"
    : settings.intensity === 'rude'
      ? "ใช้คำที่ดุดัน มีพลัง (Impact) ใช้แสลงหรือคำหยาบ (Profanity) ได้เต็มที่เพื่อให้เป็นที่จดจำ"
      : "เน้นความเป็นกันเองและดูเป็นธรรมชาติ";

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `สรุปและเรียบเรียงข้อความนี้ให้เป็น "คำโปรย (Hook)" สำหรับ TikTok ใน ${dialectContext} 
    ${speedInstruction}
    ${intensityInstruction}
    เน้นความน่าสนใจ มีพลัง (Impact) และดึงดูดใจสูงสุด 
    ให้นำเสนอดูเป็นธรรมชาติ มีจังหวะที่น่าตื่นเต้น (Edgy and Engaging) 
    ข้อความต้นฉบับ: "${currentText}"
    คำตอบ: (เฉพาะข้อความที่เรียบเรียงแล้วเท่านั้น ไม่ต้องสั้นมากเกินไปยกเว้นกรณีจำกัดเวลา)` ,
    config: {
      temperature: 0.9,
      safetySettings
    }
  });

  return cleanTextForSpeech(response.text || currentText);
};

export const generateIsanHook = async (
  currentText: string,
  settings: VoiceSettings,
  duration?: number
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const speedInstruction = duration
    ? `วิดีโอมีความยาว/เป้าหมายเวลาคือ ${duration.toFixed(1)} วินาที ดังนั้นต้องสรุปและเรียบเรียงภาษาอีสานให้มีความยาว "สัมพันธ์" กับเวลาดังกล่าว (เมื่อพูดออกมาแล้วควรมีระยะเวลาใกล้เคียง ${duration.toFixed(1)} วินาที)`
    : "เน้นความม่วนซื่นและดึงดูดใจ";

  const intensityInstruction = settings.intensity === 'polite'
    ? "เน้นความสุภาพ อ่อนเย็น (มีคำว่า จ้า, น้อ) และไม่ใช้คำหยาบเลย"
    : settings.intensity === 'rude'
      ? "เน้นความม่วนซื่น ความดิบ และความเป็นกันเองแบบถึงพริกถึงขิง ใช้คำหยาบอีสานหรือคำแสลงบ้านๆ ได้เต็มที่เพื่อให้ดูสะใจ"
      : "เน้นภาษาอีสานที่เป็นกันเอง ดูเป็นธรรมชาติ เหมือนคนบ้านเดียวกันคุยกัน";

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `สรุปและเรียบเรียงข้อความนี้ให้เป็น "คำโปรย (Hook)" สไตล์ภาษาอีสานที่ม่วนๆ และมีพลังสำหรับ TikTok 
    ${speedInstruction}
    ${intensityInstruction}
    ข้อความต้นฉบับ: "${currentText}"
    คำตอบ: (เฉพาะข้อความภาษาอีสานที่เรียบเรียงแล้วเท่านั้น ไม่ต้องสั้นมากเกินไปเอาที่จ๊วดๆตามระดับความแรงที่กำหนด)` ,
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

  const intensityInstruction = settings.intensity === 'polite'
    ? "Speak politely and clearly. No rough words."
    : settings.intensity === 'rude'
      ? "Speak with high energy and raw emotion. Do not censor any words including slang or strong language."
      : "Speak naturally.";

  const simplePrompt = `Speak this text: "${cleanedText}". Tone: ${mood}. ${rateInstruction}. 
  ${intensityInstruction}`;

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
      console.warn(`[Gemini TTS] การสร้างเสียงหยุดทำงานกะทันหัน: ${candidate.finishReason}`);
      console.warn(`[Gemini TTS] ข้อความที่เป็นสาเหตุ: "${cleanedText}"`);

      if (retryAttempt < 2) {
        console.log(`[Gemini TTS] กำลังลองพยายามครั้งใหม่ (ครั้งที่ ${retryAttempt + 1})...`);
        return generateThaiSpeech(cleanedText, settings, duration, retryAttempt + 1);
      }

      const errorMessage = candidate.finishReason === 'OTHER'
        ? `การสร้างเสียงถูกระงับ (OTHER) - เป็นไปได้ว่าในข้อความมีคำที่ระบบความปลอดภัยของ AI ปฏิเสธที่จะออกเสียง (แม้จะปิด Filter แล้วก็ตาม)`
        : `การสร้างเสียงถูกระงับ (${candidate.finishReason})`;

      throw new Error(errorMessage);
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

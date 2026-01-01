
import React, { useState, useRef, useEffect } from 'react';
import { ProcessingStep, VoiceSettings, SettingsMode, Gender, Mood, SpeechSpeed } from './types';
import { translateVideoContent, generateThaiSpeech, decodePCMData, generateThaiHook, generateIsanHook } from './services/geminiService';

const App: React.FC = () => {
  const [step, setStep] = useState<ProcessingStep>(ProcessingStep.IDLE);
  const [progress, setProgress] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoBase64, setVideoBase64] = useState<string | null>(null);
  const [videoMimeType, setVideoMimeType] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [translatedText, setTranslatedText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isHooking, setIsHooking] = useState(false);
  const [isIsanHooking, setIsIsanHooking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [hasApiKey, setHasApiKey] = useState<boolean>(false);
  
  const [currentAudioBuffer, setCurrentAudioBuffer] = useState<AudioBuffer | null>(null);
  
  const [settings, setSettings] = useState<VoiceSettings>({
    mode: 'auto',
    gender: 'female',
    mood: 'natural',
    speed: 'normal'
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const processingAbortController = useRef<AbortController | null>(null);

  useEffect(() => {
    // ตรวจสอบสถานะ API Key เมื่อโหลด Component
    const checkApiKey = async () => {
      try {
        if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
          const hasKey = await window.aistudio.hasSelectedApiKey();
          setHasApiKey(hasKey);
        }
      } catch (e) {
        console.error("Failed to check API key status", e);
      }
    };
    checkApiKey();
  }, []);

  useEffect(() => {
    let interval: number;
    if (step !== ProcessingStep.IDLE && step !== ProcessingStep.COMPLETED && step !== ProcessingStep.ERROR) {
      interval = window.setInterval(() => {
        setProgress(prev => {
          let target = 0;
          if (step === ProcessingStep.UPLOADING) target = 10;
          if (step === ProcessingStep.ANALYZING) target = 60;
          if (step === ProcessingStep.GENERATING_VOICE) target = 95;
          if (prev < target) return prev + 0.5;
          return prev;
        });
      }, 50);
    } else if (step === ProcessingStep.COMPLETED) {
      setProgress(100);
    } else {
      setProgress(0);
    }
    return () => clearInterval(interval);
  }, [step]);

  const handleSelectApiKey = async () => {
    try {
      if (window.aistudio && typeof window.aistudio.openSelectKey === 'function') {
        await window.aistudio.openSelectKey();
        setHasApiKey(true); // สมมติว่าสำเร็จตาม Guideline
      }
    } catch (e) {
      console.error("Failed to open key selector", e);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 20 * 1024 * 1024) {
      setErrorMessage("ไฟล์มีขนาดใหญ่เกินไป (จำกัด 20MB)");
      return;
    }

    setErrorMessage(null);
    setFileName(file.name);
    
    const reader = new FileReader();
    reader.onload = async () => {
      const b64 = (reader.result as string).split(',')[1];
      setVideoBase64(b64);
      setVideoMimeType(file.type);
      const objUrl = URL.createObjectURL(file);
      setVideoUrl(objUrl);

      const tempVideo = document.createElement('video');
      tempVideo.src = objUrl;
      tempVideo.onloadedmetadata = () => {
        setVideoDuration(tempVideo.duration);
      };
    };
    reader.readAsDataURL(file);
  };

  const handleCancel = () => {
    if (processingAbortController.current) {
      processingAbortController.current.abort();
    }
    setStep(ProcessingStep.IDLE);
    setErrorMessage(null);
    setProgress(0);
    setIsHooking(false);
    setIsIsanHooking(false);
    setIsRegenerating(false);
    setCurrentAudioBuffer(null);
  };

  const startProcessing = async () => {
    if (!videoBase64 || !videoMimeType) {
      setErrorMessage("กรุณาเลือกไฟล์วิดีโอก่อน");
      return;
    }

    const controller = new AbortController();
    processingAbortController.current = controller;

    try {
      setStep(ProcessingStep.ANALYZING);
      const text = await translateVideoContent(videoBase64, videoMimeType, settings, videoDuration);
      if (controller.signal.aborted) return;
      setTranslatedText(text);
      
      setStep(ProcessingStep.GENERATING_VOICE);
      await refreshVoice(text, videoDuration, undefined, controller);
      if (controller.signal.aborted) return;
      
      setStep(ProcessingStep.COMPLETED);
    } catch (error: any) {
      if (error.name === 'AbortError' || controller.signal.aborted) return;
      setErrorMessage(error.message || "เกิดข้อผิดพลาดในการประมวลผล");
      setStep(ProcessingStep.ERROR);
    }
  };

  const applyAIHook = async () => {
    if (!translatedText || isHooking) return;
    setIsHooking(true);
    setCurrentAudioBuffer(null);
    setErrorMessage(null);
    
    const controller = new AbortController();
    processingAbortController.current = controller;

    try {
      const hookedText = await generateThaiHook(translatedText, settings);
      if (controller.signal.aborted) return;
      setTranslatedText(hookedText);
      await refreshVoice(hookedText, undefined, undefined, controller);
    } catch (e: any) {
      if (e.name !== 'AbortError') setErrorMessage(e.message || "ไม่สามารถสร้าง Hook ได้");
    } finally {
      setIsHooking(false);
    }
  };

  const applyIsanHook = async () => {
    if (!translatedText || isIsanHooking) return;
    setIsIsanHooking(true);
    setCurrentAudioBuffer(null);
    setErrorMessage(null);
    
    const isanSettings: VoiceSettings = { ...settings, mood: 'isan' };
    setSettings(isanSettings);

    const controller = new AbortController();
    processingAbortController.current = controller;

    try {
      const hookedText = await generateIsanHook(translatedText);
      if (controller.signal.aborted) return;
      setTranslatedText(hookedText);
      await refreshVoice(hookedText, undefined, isanSettings, controller);
    } catch (e: any) {
      if (e.name !== 'AbortError') setErrorMessage(e.message || "ไม่สามารถสร้าง Hook อิสานได้");
    } finally {
      setIsIsanHooking(false);
    }
  };

  const refreshVoice = async (textToUse: string, customDuration?: number, overrideSettings?: VoiceSettings, controller?: AbortController) => {
    setIsRegenerating(true);
    setCurrentAudioBuffer(null);
    setErrorMessage(null);
    
    const durationToUse = customDuration !== undefined ? customDuration : videoDuration;
    const settingsToUse = overrideSettings || settings;

    try {
      const pcmData = await generateThaiSpeech(textToUse, settingsToUse, durationToUse);
      if (controller?.signal.aborted) return;
      
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      
      const audioBuffer = await decodePCMData(pcmData, audioContextRef.current);
      setCurrentAudioBuffer(audioBuffer);
    } catch (e: any) {
      console.error(e);
      if (controller?.signal.aborted) return;
      
      // กรณี Error ที่ระบุว่า Entity not found มักเกิดจาก API Key มีปัญหา
      if (e.message?.includes("Requested entity was not found")) {
        setHasApiKey(false);
        setErrorMessage("API Key ที่เลือกไม่ถูกต้องหรือไม่มีสิทธิ์ใช้งาน กรุณาเลือกใหม่");
      } else {
        setErrorMessage(e.message || "ไม่สามารถสร้างเสียงใหม่ได้ กรุณาลองใหม่อีกครั้ง");
      }
    } finally {
      setIsRegenerating(false);
    }
  };

  const playTranslation = async () => {
    if (!audioContextRef.current || !currentAudioBuffer) return;
    
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }

    if (audioSourceRef.current) {
      try { audioSourceRef.current.stop(); } catch(e) {}
    }

    const source = audioContextRef.current.createBufferSource();
    source.buffer = currentAudioBuffer;
    source.connect(audioContextRef.current.destination);
    
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play();
    }

    source.onended = () => {
      setIsPlaying(false);
      if (videoRef.current) videoRef.current.pause();
    };

    source.start();
    audioSourceRef.current = source;
    setIsPlaying(true);
  };

  const stopTranslation = () => {
    if (audioSourceRef.current) {
      try { audioSourceRef.current.stop(); } catch(e) {}
    }
    if (videoRef.current) {
      try { videoRef.current.pause(); } catch(e) {}
    }
    setIsPlaying(false);
  };

  const downloadVoice = () => {
    if (!currentAudioBuffer) return;
    const wavBlob = audioBufferToWav(currentAudioBuffer);
    const url = URL.createObjectURL(wavBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `vocalbridge-voice-${Date.now()}.wav`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const downloadVideo = async () => {
    if (!videoRef.current || !currentAudioBuffer || !audioContextRef.current) return;
    
    setIsRecording(true);
    const stream = (videoRef.current as any).captureStream();
    const dest = audioContextRef.current.createMediaStreamDestination();
    
    const source = audioContextRef.current.createBufferSource();
    source.buffer = currentAudioBuffer;
    source.connect(dest);
    
    const combinedStream = new MediaStream([
      ...stream.getVideoTracks(),
      ...dest.stream.getAudioTracks()
    ]);

    const recorder = new MediaRecorder(combinedStream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `vocalbridge-video-${Date.now()}.webm`;
      link.click();
      URL.revokeObjectURL(url);
      setIsRecording(false);
    };

    recorder.start();
    source.start();
    videoRef.current.currentTime = 0;
    videoRef.current.play();
    
    source.onended = () => {
      recorder.stop();
      if (videoRef.current) videoRef.current.pause();
    };
  };

  const shareContent = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'VocalBridge Translation',
          text: `คำแปลภาษาไทย: ${translatedText}`,
          url: window.location.href,
        });
      } else {
        await navigator.clipboard.writeText(translatedText);
        alert('คัดลอกคำแปลลงในคลิปบอร์ดแล้ว');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleStartOver = () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setStep(ProcessingStep.IDLE);
    setFileName(null);
    setVideoBase64(null);
    setVideoUrl(null);
    setCurrentAudioBuffer(null);
    setTranslatedText("");
    setErrorMessage(null);
    setProgress(0);
  };

  const audioBufferToWav = (buffer: AudioBuffer) => {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const arrayBuffer = new ArrayBuffer(length);
    const view = new DataView(arrayBuffer);
    const channels = [];
    let offset = 0;
    let pos = 0;

    const setUint16 = (data: number) => { view.setUint16(pos, data, true); pos += 2; };
    const setUint32 = (data: number) => { view.setUint32(pos, data, true); pos += 4; };

    setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157);
    setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
    setUint32(buffer.sampleRate); setUint32(buffer.sampleRate * 2 * numOfChan);
    setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164);
    setUint32(length - pos - 4);

    for (let i = 0; i < numOfChan; i++) channels.push(buffer.getChannelData(i));
    while (pos < length) {
      for (let i = 0; i < numOfChan; i++) {
        let sample = Math.max(-1, Math.min(1, channels[i][offset]));
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
        view.setInt16(pos, sample, true);
        pos += 2;
      }
      offset++;
    }
    return new Blob([arrayBuffer], { type: "audio/wav" });
  };

  const updateSettings = (key: keyof VoiceSettings, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const moodLabels: Record<Mood, string> = {
    natural: 'ปกติ', cheerful: 'ร่าเริง', excited: 'ตื่นเต้น', soft: 'นุ่มนวล', serious: 'จริงจัง', isan: 'อิสาน'
  };

  return (
    <div className="min-h-screen flex flex-col items-center py-12 px-4 bg-slate-50 relative">
      {/* API Key Selector Button (Top Right) */}
      <div className="absolute top-4 right-4 z-[60] flex flex-col items-end gap-2">
        <button 
          onClick={handleSelectApiKey}
          className={`flex items-center gap-2 px-4 py-2 rounded-full font-bold text-xs transition-all shadow-md ${hasApiKey ? 'bg-white text-green-600 border border-green-100 hover:bg-green-50' : 'bg-orange-500 text-white hover:bg-orange-600'}`}
        >
          <div className={`w-2 h-2 rounded-full animate-pulse ${hasApiKey ? 'bg-green-500' : 'bg-white'}`}></div>
          {hasApiKey ? 'API KEY: ACTIVE' : 'SET API KEY'}
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
        </button>
        {!hasApiKey && (
          <a 
            href="https://ai.google.dev/gemini-api/docs/billing" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-[10px] text-slate-400 underline hover:text-blue-500 transition-colors"
          >
            Learn about API Billing
          </a>
        )}
      </div>

      <header className="max-w-4xl w-full text-center mb-8">
        <h1 className="text-4xl font-bold text-slate-900 mb-2 bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent uppercase tracking-tight">
          VocalBridge
        </h1>
        <p className="text-slate-600 font-medium">แปลวิดีโอเป็นเสียงพากย์ไทยด้วยพลัง Gemini AI</p>
      </header>

      <main className="max-w-5xl w-full bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden relative">
        {isRecording && (
          <div className="absolute inset-0 z-50 bg-black/80 flex flex-col items-center justify-center text-white p-6 text-center">
            <div className="w-16 h-16 border-4 border-red-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <h3 className="text-2xl font-bold mb-2">กำลังบันทึกและประมวลผลวิดีโอ...</h3>
            <p className="opacity-70 italic text-sm">กรุณาอย่าปิดหน้าต่างนี้จนกว่าจะเสร็จสิ้น</p>
          </div>
        )}

        {step === ProcessingStep.IDLE || step === ProcessingStep.ERROR ? (
          <div className="p-8">
            <div className="mb-8 p-6 bg-slate-50 rounded-2xl border border-slate-100">
              <h4 className="font-bold text-slate-800 mb-4 flex items-center uppercase text-sm tracking-widest">
                <svg className="w-5 h-5 mr-2 text-blue-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" /></svg>
                ตั้งค่าพากย์เสียง (VOICE SETTINGS)
              </h4>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div>
                  <label className="text-sm font-semibold text-slate-500 block mb-2">โหมดการทำงาน</label>
                  <div className="flex bg-white p-1 rounded-xl border border-slate-200">
                    <button onClick={() => updateSettings('mode', 'auto')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${settings.mode === 'auto' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}>อัตโนมัติ</button>
                    <button onClick={() => updateSettings('mode', 'manual')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${settings.mode === 'manual' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}>กำหนดเอง</button>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-semibold text-slate-500 block mb-2">เพศของเสียง</label>
                  <div className="flex bg-white p-1 rounded-xl border border-slate-200">
                    <button onClick={() => updateSettings('gender', 'male')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${settings.gender === 'male' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}>ชาย</button>
                    <button onClick={() => updateSettings('gender', 'female')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${settings.gender === 'female' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}>หญิง</button>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-semibold text-slate-500 block mb-2">ความไวการพูด</label>
                  <div className="flex bg-white p-1 rounded-xl border border-slate-200">
                    <button onClick={() => updateSettings('speed', 'normal')} className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${settings.speed === 'normal' ? 'bg-orange-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}>ไวปกติ</button>
                    <button onClick={() => updateSettings('speed', 'sync')} className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${settings.speed === 'sync' ? 'bg-orange-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}>สัมพันธ์วิดีโอ</button>
                  </div>
                </div>
                {settings.mode === 'manual' && (
                  <div className="md:col-span-2 lg:col-span-3">
                    <label className="text-sm font-semibold text-slate-500 block mb-2">อารมณ์/สำเนียง (Mood/Dialect)</label>
                    <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                      {(Object.keys(moodLabels) as Mood[]).map((m) => (
                        <button key={m} onClick={() => updateSettings('mood', m)} className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all ${settings.mood === m ? 'bg-green-100 border-green-300 text-green-700' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}>{moodLabels[m]}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className={`flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-12 transition-all ${videoBase64 ? 'border-green-400 bg-green-50/20' : 'border-slate-200 hover:border-blue-400 hover:bg-blue-50/30'}`}>
              <label className="cursor-pointer bg-blue-600 text-white px-10 py-4 rounded-full font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 mb-4 flex items-center">
                <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0l-4-4m4 4V4" /></svg>
                {videoBase64 ? 'เปลี่ยนวิดีโอ' : 'อัปโหลดวิดีโอ'}
                <input type="file" className="hidden" accept="video/*" onChange={handleFileUpload} />
              </label>
              {fileName ? (
                <div className="text-center">
                  <p className="text-slate-800 font-bold mb-1 flex items-center justify-center">
                    <svg className="w-4 h-4 mr-1 text-green-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                    {fileName}
                  </p>
                  <p className="text-slate-400 text-xs italic">ความยาว: {videoDuration.toFixed(1)} วินาที</p>
                </div>
              ) : (
                <p className="text-slate-400 text-sm italic">รองรับไฟล์วิดีโอทั่วไป (สูงสุด 20MB)</p>
              )}
              {errorMessage && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm font-medium animate-pulse text-center">
                  <p className="font-bold mb-1 uppercase tracking-tight">⚠️ เกิดข้อผิดพลาด</p>
                  <p>{errorMessage}</p>
                </div>
              )}
            </div>

            {videoBase64 && (
              <div className="mt-10 flex justify-center">
                <button 
                  onClick={startProcessing}
                  className="group relative flex items-center bg-gradient-to-r from-blue-600 to-indigo-700 text-white px-16 py-5 rounded-2xl font-bold text-xl hover:scale-105 transition-all shadow-2xl shadow-blue-200 active:scale-95"
                >
                  <span className="mr-3">เริ่มประมวลผล</span>
                  <div className="bg-white/20 p-2 rounded-lg group-hover:bg-white/30 transition-colors">
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>
                  </div>
                </button>
              </div>
            )}
          </div>
        ) : step !== ProcessingStep.COMPLETED ? (
          <div className="p-12 flex flex-col items-center min-h-[400px] justify-center text-center">
            <div className="w-full max-w-md bg-slate-100 h-6 rounded-full overflow-hidden mb-6 p-1 border border-slate-200">
              <div className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-all duration-300 ease-out rounded-full" style={{ width: `${progress}%` }}></div>
            </div>
            <div className="text-5xl font-black text-blue-600 mb-4 tracking-tighter">{Math.floor(progress)}%</div>
            <h3 className="text-2xl font-bold text-slate-800 text-center uppercase tracking-widest animate-pulse">
              {step === ProcessingStep.ANALYZING && "กำลังแปลและวิเคราะห์วิดีโอ..."}
              {step === ProcessingStep.GENERATING_VOICE && "กำลังสร้างเสียง AI พากย์ไทย..."}
            </h3>
            <p className="text-slate-400 mt-4 text-sm font-medium">กรุณารอสักครู่ ระบบกำลังทำงานอย่างเต็มกำลัง</p>
            
            <button 
              onClick={handleCancel}
              className="mt-10 flex items-center text-slate-500 hover:text-red-500 font-bold transition-all border border-slate-200 hover:border-red-100 hover:bg-red-50 px-8 py-3 rounded-full group"
            >
              <svg className="w-5 h-5 mr-2 transition-transform group-hover:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              ยกเลิกการทำงาน
            </button>
          </div>
        ) : (
          <div className="p-8 grid lg:grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="space-y-4">
              <h4 className="font-bold text-slate-700 flex items-center">
                <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" /></svg>
                วิดีโอต้นฉบับ ({videoDuration.toFixed(1)}s)
              </h4>
              <div className="aspect-video bg-black rounded-2xl overflow-hidden shadow-inner relative group border border-slate-200">
                <video ref={videoRef} src={videoUrl || ""} className="w-full h-full object-contain" muted playsInline />
              </div>
              
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-4">
                <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">ปรับแต่งพากย์ใหม่ (Quick-tune)</h5>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 mb-1 block">เพศเสียง</label>
                    <div className="flex bg-white p-1 rounded-lg border border-slate-200">
                      <button onClick={() => updateSettings('gender', 'male')} className={`flex-1 py-1 text-[10px] rounded ${settings.gender === 'male' ? 'bg-indigo-500 text-white' : 'text-slate-500'}`}>ชาย</button>
                      <button onClick={() => updateSettings('gender', 'female')} className={`flex-1 py-1 text-[10px] rounded ${settings.gender === 'female' ? 'bg-indigo-500 text-white' : 'text-slate-500'}`}>หญิง</button>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 mb-1 block">ความไว</label>
                    <div className="flex bg-white p-1 rounded-lg border border-slate-200">
                      <button onClick={() => updateSettings('speed', 'normal')} className={`flex-1 py-1 text-[10px] rounded ${settings.speed === 'normal' ? 'bg-orange-500 text-white' : 'text-slate-500'}`}>ปกติ</button>
                      <button onClick={() => updateSettings('speed', 'sync')} className={`flex-1 py-1 text-[10px] rounded ${settings.speed === 'sync' ? 'bg-orange-500 text-white' : 'text-slate-500'}`}>สัมพันธ์</button>
                    </div>
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] font-bold text-slate-400 mb-1 block">อารมณ์/สำเนียง</label>
                    <div className="flex bg-white p-1 rounded-lg border border-slate-200 overflow-x-auto scrollbar-hide">
                      {(Object.keys(moodLabels) as Mood[]).map((m) => (
                        <button key={m} onClick={() => updateSettings('mood', m)} className={`px-3 py-1 text-[10px] whitespace-nowrap rounded ${settings.mood === m ? 'bg-green-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>{moodLabels[m]}</button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <button onClick={shareContent} className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all">
                  <svg className="w-5 h-5 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
                  <span className="text-[10px] font-bold uppercase">แชร์ผลลัพธ์</span>
                </button>
                <button onClick={downloadVoice} disabled={!currentAudioBuffer} className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all disabled:opacity-30">
                  <svg className="w-5 h-5 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                  <span className="text-[10px] font-bold uppercase">โหลดเสียง</span>
                </button>
                <button onClick={downloadVideo} disabled={!currentAudioBuffer} className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all disabled:opacity-30">
                  <svg className="w-5 h-5 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  <span className="text-[10px] font-bold uppercase">โหลดวิดีโอ</span>
                </button>
              </div>

              <button onClick={handleStartOver} className="text-slate-400 hover:text-slate-600 text-sm flex items-center py-2"><svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M11 15l-3-3m0 0l3-3m-3 3h8M3 12a9 9 0 1118 0 9 9 0 01-18 0z" /></svg>เริ่มใหม่ทั้งหมด</button>
            </div>

            <div className="flex flex-col">
              <h4 className="font-bold text-slate-700 mb-4 flex justify-between items-center">
                <span>แก้ไขคำแปล & เล่นเสียง</span>
                {isRegenerating && <span className="text-xs text-blue-500 animate-pulse bg-blue-50 px-2 py-1 rounded-full">กำลังอัพเดทเสียงพากย์...</span>}
              </h4>
              <textarea value={translatedText} onChange={(e) => setTranslatedText(e.target.value)} className="flex-1 w-full bg-slate-50 border border-slate-200 rounded-2xl p-5 text-slate-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none resize-none mb-4 leading-relaxed text-lg" placeholder="พิมพ์คำแปลที่ต้องการแก้ไขที่นี่..." />
              
              {errorMessage && (
                <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm font-medium animate-in fade-in slide-in-from-top-2">
                  <p className="font-bold mb-1 uppercase tracking-tight">⚠️ เกิดข้อผิดพลาด</p>
                  <p>{errorMessage}</p>
                </div>
              )}

              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <button 
                    onClick={applyAIHook} 
                    disabled={isHooking || isIsanHooking || isRegenerating}
                    className="flex-1 bg-gradient-to-r from-orange-500 to-red-600 text-white py-4 px-2 rounded-2xl font-black text-sm hover:shadow-xl hover:shadow-orange-200 hover:scale-[1.02] transition-all flex items-center justify-center group disabled:opacity-50"
                  >
                    {isHooking ? (
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                    ) : (
                      <svg className="w-5 h-5 mr-2 group-hover:animate-bounce" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-1.516-1.555-3.497z" clipRule="evenodd" /></svg>
                    )}
                    {isHooking ? 'กำลังปรุง...' : 'TikTok AI Hook'}
                  </button>

                  <button 
                    onClick={applyIsanHook} 
                    disabled={isIsanHooking || isHooking || isRegenerating}
                    className="flex-1 bg-gradient-to-r from-yellow-500 to-amber-700 text-white py-4 px-2 rounded-2xl font-black text-sm hover:shadow-xl hover:shadow-yellow-200 hover:scale-[1.02] transition-all flex items-center justify-center group disabled:opacity-50"
                  >
                    {isIsanHooking ? (
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                    ) : (
                      <svg className="w-5 h-5 mr-2 group-hover:rotate-12 transition-transform" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-5-9h10v2H7z"/></svg>
                    )}
                    {isIsanHooking ? 'เบิ่งแน...' : 'Hook สไตล์อิสาน'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button onClick={() => refreshVoice(translatedText)} disabled={isRegenerating || isHooking || isIsanHooking} className="bg-slate-100 text-slate-700 py-4 rounded-2xl font-bold hover:bg-slate-200 transition-all disabled:opacity-50 flex flex-col items-center justify-center leading-tight text-center">
                    <span>เจ็นเสียงพากย์ใหม่</span>
                    <span className="text-[10px] font-normal opacity-60">(หลังแก้คำแปล)</span>
                  </button>
                  <button 
                    onClick={isPlaying ? stopTranslation : playTranslation} 
                    disabled={isRegenerating || isHooking || isIsanHooking || !currentAudioBuffer}
                    className={`${isPlaying ? 'bg-red-500' : 'bg-indigo-600'} text-white py-4 rounded-2xl font-bold hover:opacity-90 transition-all shadow-lg flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed`}
                  >
                    {isPlaying ? (<><svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>หยุดเล่น</>) : (<><svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" /></svg>พรีวิวพากย์ไทย</>)}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
      <footer className="mt-8 text-slate-400 text-xs text-center font-medium opacity-60 uppercase tracking-widest">
        <p>VocalBridge • AI Video Dubbing Engine</p>
      </footer>
    </div>
  );
};

export default App;

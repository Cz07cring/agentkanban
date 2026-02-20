/**
 * Voice recognition utilities using Web Speech API.
 */

export interface SpeechRecognitionResult {
  transcript: string;
  confidence: number;
  isFinal: boolean;
}

// Web Speech API type declarations
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult2;
  [index: number]: SpeechRecognitionResult2;
}

interface SpeechRecognitionResult2 {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event & { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}

export function isSpeechSupported(): boolean {
  if (typeof window === "undefined") return false;
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function createSpeechRecognition(options: {
  lang?: string;
  continuous?: boolean;
  onResult: (result: SpeechRecognitionResult) => void;
  onError: (error: string) => void;
  onEnd: () => void;
  onStart: () => void;
}): { start: () => void; stop: () => void } | null {
  if (!isSpeechSupported()) return null;

  const SpeechRecognitionClass =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognitionClass();

  recognition.continuous = options.continuous ?? true;
  recognition.interimResults = true;
  recognition.lang = options.lang ?? "zh-CN";

  recognition.onstart = () => {
    options.onStart();
  };

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    let transcript = "";
    let isFinal = false;
    let confidence = 0;

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      transcript += result[0].transcript;
      confidence = result[0].confidence;
      if (result.isFinal) {
        isFinal = true;
      }
    }

    options.onResult({ transcript, confidence, isFinal });
  };

  recognition.onerror = (event) => {
    options.onError(event.error);
  };

  recognition.onend = () => {
    options.onEnd();
  };

  return {
    start: () => recognition.start(),
    stop: () => recognition.stop(),
  };
}

"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { isSpeechSupported, createSpeechRecognition } from "@/lib/speech";

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  buttonLabel?: string;
  className?: string;
}

export default function VoiceInput({ onTranscript, buttonLabel, className = "" }: VoiceInputProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [supported, setSupported] = useState(false);
  const recognitionRef = useRef<{ start: () => void; stop: () => void } | null>(
    null
  );

  useEffect(() => {
    setSupported(isSpeechSupported());
  }, []);

  const startRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }

    const recognition = createSpeechRecognition({
      lang: "zh-CN",
      continuous: true,
      onResult: (result) => {
        if (result.isFinal) {
          onTranscript(result.transcript);
          setInterimText("");
        } else {
          setInterimText(result.transcript);
        }
      },
      onError: (error) => {
        if (error !== "aborted") {
          console.error("Speech recognition error:", error);
        }
        setIsRecording(false);
        setInterimText("");
      },
      onEnd: () => {
        setIsRecording(false);
        setInterimText("");
      },
      onStart: () => {
        setIsRecording(true);
      },
    });

    if (recognition) {
      recognitionRef.current = recognition;
      recognition.start();
    }
  }, [onTranscript]);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);
  }, []);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  const buttonBaseClass = `relative flex items-center justify-center gap-1.5 rounded-full transition-all ${
    buttonLabel ? "px-3 h-9 text-xs font-medium" : "w-8 h-8"
  }`;

  if (!supported) {
    return (
      <div className={`flex items-center gap-2 ${className}`.trim()}>
        <button
          type="button"
          disabled
          className={`${buttonBaseClass} cursor-not-allowed border border-slate-700/60 bg-slate-900/60 text-slate-500`}
          title="当前浏览器不支持语音输入"
          aria-label="当前浏览器不支持语音输入"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 15a3 3 0 003-3V5a3 3 0 00-6 0v7a3 3 0 003 3z"
            />
          </svg>
          {buttonLabel ? <span>{buttonLabel}</span> : null}
        </button>
        <span className="text-xs text-amber-400">当前浏览器不支持语音输入，请改用文字输入。</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className}`.trim()}>
      <button
        onClick={toggleRecording}
        className={`${buttonBaseClass} ${
          isRecording
            ? "bg-red-500/20 text-red-400 border border-red-500/30"
            : "bg-slate-800/50 text-slate-400 border border-slate-700/30 hover:text-slate-300 hover:border-slate-600/50"
        }`}
        title={isRecording ? "停止录音" : "语音输入"}
      >
        {/* Mic icon */}
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 15a3 3 0 003-3V5a3 3 0 00-6 0v7a3 3 0 003 3z"
          />
        </svg>
        {isRecording && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        )}
        {buttonLabel ? <span>{isRecording ? "停止语音" : buttonLabel}</span> : null}
      </button>

      {/* Interim text display */}
      {isRecording && interimText && (
        <span className="text-xs text-slate-400 italic max-w-48 truncate">
          {interimText}
        </span>
      )}

      {isRecording && !interimText && (
        <span className="text-xs text-red-400 animate-pulse">
          正在听...
        </span>
      )}
    </div>
  );
}

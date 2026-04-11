const MODEL_ID = "Xenova/whisper-tiny.en";

class VoiceTranscriber {
  constructor({ sendToRenderer }) {
    this._sendToRenderer = sendToRenderer;
    this._transcriberPromise = null;
  }

  async warmup() {
    await this._getTranscriber();
    return { ready: true, modelId: MODEL_ID };
  }

  async transcribe({ samples, options = {} }) {
    if (!samples) {
      throw new Error("No audio samples provided for transcription.");
    }

    const transcriber = await this._getTranscriber();
    const audio = samples instanceof Float32Array ? samples : new Float32Array(samples);

    this._emitStatus("transcribing", {
      sampleCount: audio.length,
      durationSeconds: Number((audio.length / 16000).toFixed(2))
    });

    const result = await transcriber(audio, {
      chunk_length_s: 20,
      stride_length_s: 4,
      ...options
    });

    const text = typeof result?.text === "string" ? result.text.trim() : "";

    this._emitStatus("transcribed", {
      textLength: text.length
    });

    return { text };
  }

  async _getTranscriber() {
    if (!this._transcriberPromise) {
      this._transcriberPromise = this._loadTranscriber().catch(error => {
        this._transcriberPromise = null;
        this._emitStatus("error", {
          stage: "load",
          message: error?.message || String(error)
        });
        throw error;
      });
    }

    return this._transcriberPromise;
  }

  async _loadTranscriber() {
    this._emitStatus("loading-model", { modelId: MODEL_ID });

    const { pipeline } = await import("@huggingface/transformers");
    const transcriber = await pipeline("automatic-speech-recognition", MODEL_ID, {
      progress_callback: progress => {
        this._emitStatus("loading-progress", progress);
      }
    });

    this._emitStatus("ready", { modelId: MODEL_ID });
    return transcriber;
  }

  _emitStatus(status, details = {}) {
    this._sendToRenderer("voice:status", { status, details });
    const serialized = (() => {
      try {
        return JSON.stringify(details);
      } catch {
        return String(details);
      }
    })();
    console.log(`[voice:${status}] ${serialized}`);
  }
}

module.exports = {
  VoiceTranscriber
};

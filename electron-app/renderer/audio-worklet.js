/**
 * Gateway Protocol V3c — AudioWorklet processors
 * ──────────────────────────────────────────────────────────────
 * Replaces the deprecated ScriptProcessorNode pink-noise generator
 * with a proper AudioWorkletProcessor running on the audio thread
 * (lower latency, no main-thread blocking, no deprecation warnings).
 *
 * Loaded once via `audioContext.audioWorklet.addModule('audio-worklet.js')`
 * during AMBIENT.start(). Falls back to ScriptProcessor if addModule fails.
 * ──────────────────────────────────────────────────────────────
 */

// Paul Kellet pink noise algorithm — same as the legacy ScriptProcessor
// path, but running on the audio worklet thread.
class PinkNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.b = [0, 0, 0, 0, 0, 0, 0];
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || !out[0]) return true;
    const ch0 = out[0];
    const b = this.b;
    for (let i = 0; i < ch0.length; i++) {
      const w = Math.random() * 2 - 1;
      b[0] = 0.99886 * b[0] + w * 0.0555179;
      b[1] = 0.99332 * b[1] + w * 0.0750759;
      b[2] = 0.96900 * b[2] + w * 0.1538520;
      b[3] = 0.86650 * b[3] + w * 0.3104856;
      b[4] = 0.55000 * b[4] + w * 0.5329522;
      b[5] = -0.7616  * b[5] - w * 0.0168980;
      ch0[i] = (b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + w * 0.5362) * 0.11;
      b[6] = w * 0.115926;
    }
    // Mirror to right channel if present so the noise feels centered
    if (out[1]) out[1].set(ch0);
    return true; // keep node alive across blocks
  }
}
registerProcessor('gp-pink-noise', PinkNoiseProcessor);

// 本机语音转写 Worker：transformers.js（Whisper，WebAssembly，单线程，不用 GPU）。
// 只在用户选择“本机免费转写”后才创建；库和模型首次从 CDN（jsDelivr / Hugging Face）下载，
// 之后由浏览器缓存（模型在 Cache Storage「transformers-cache」），再用不再下载。音频不离开本机。
const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.min.js';
let T = null, asr = null, loaded = '';
const post = (o, t) => self.postMessage(o, t || []);
self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'load') {
      if (!T) { T = await import(LIB); T.env.allowLocalModels = false; T.env.useBrowserCache = true; }
      const key = m.model + JSON.stringify(m.dtype);
      if (loaded !== key) {
        asr = null; const t0 = performance.now();
        asr = await T.pipeline('automatic-speech-recognition', m.model, {
          dtype: m.dtype, device: 'wasm',
          progress_callback: p => post({ type: 'dl', status: p.status, file: p.file, loaded: p.loaded, total: p.total }),
        });
        loaded = key; post({ type: 'loaded', ms: performance.now() - t0 });
      } else post({ type: 'loaded', ms: 0 });
    } else if (m.type === 'run') {
      const t0 = performance.now();
      const out = await asr(m.audio, { return_timestamps: true });
      const chunks = (out.chunks || []).map(c => ({ text: c.text, t0: c.timestamp?.[0], t1: c.timestamp?.[1] }));
      post({ type: 'result', id: m.id, text: out.text, chunks, ms: performance.now() - t0 });
    }
  } catch (e) { post({ type: 'error', id: m.id, message: String(e?.message || e) }); }
};

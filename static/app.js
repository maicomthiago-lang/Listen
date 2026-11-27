const $ = (selector) => document.querySelector(selector);

const CAPTURE_DURATION_MS = 8000;
const CONTINUOUS_DELAY_MS = 2500;
const TARGET_SAMPLE_RATE = 16000;
const SILENCE_RMS_THRESHOLD = 0.002;
const HISTORY_STORAGE_KEY = "listen.history.v1";
const PRESET_STORAGE_KEY = "listen.preset.v1";
const SESSION_TOKEN_KEY = "listen.audd_token.v1";
const MAX_HISTORY_ITEMS = 25;

const QUALITY_OPTIONS = {
  audio: ["128 kbps", "192 kbps", "320 kbps", "Lossless"],
  video: ["720p", "1080p", "1440p", "2160p (4K)"],
  both: ["720p + Áudio", "1080p + Áudio", "1440p + Áudio", "2160p (4K) + Áudio"],
};

const DEFAULT_PRESET = {
  folder: "Listen",
  layout: "separate", // separate | list
  kind: "audio", // audio | video | both
  quality: "320 kbps",
  autoCreate: true,
  openYoutube: false,
  ytPlaylist: "Listen — Offline",
  autoYoutubePlaylist: false,
};

const elements = {
  dot: $("#dot"),
  status: $("#status"),
  banner: $("#banner"),
  bannerText: $("#bannerText"),
  tokenSetup: $("#tokenSetup"),
  tokenInput: $("#tokenInput"),
  saveTokenBtn: $("#saveTokenBtn"),
  demoTokenBtn: $("#demoTokenBtn"),
  listen: $("#listen"),
  cancel: $("#cancel"),
  uploadBtn: $("#uploadBtn"),
  audioFile: $("#audioFile"),
  once: $("#once"),
  continuous: $("#continuous"),
  meterWrap: $("#meterWrap"),
  meterLabel: $("#meterLabel"),
  meterCountdown: $("#meterCountdown"),
  meterBars: $("#meterBars"),
  progressFill: $("#progressFill"),
  empty: $("#empty"),
  result: $("#result"),
  cover: $("#cover"),
  title: $("#title"),
  artist: $("#artist"),
  album: $("#album"),
  releaseDate: $("#releaseDate"),
  previewWrap: $("#previewWrap"),
  previewAudio: $("#previewAudio"),
  addToYtPlaylistBtn: $("#addToYtPlaylistBtn"),
  applyPresetNow: $("#applyPresetNow"),
  save: $("#save"),
  copy: $("#copy"),
  youtubeLink: $("#youtubeLink"),
  official: $("#official"),
  spotifyLink: $("#spotifyLink"),
  appleLink: $("#appleLink"),
  auddLink: $("#auddLink"),
  pickBaseDir: $("#pickBaseDir"),
  presetFolder: $("#presetFolder"),
  presetLayout: $("#presetLayout"),
  presetKind: $("#presetKind"),
  presetQuality: $("#presetQuality"),
  presetAutoCreate: $("#presetAutoCreate"),
  presetOpenYoutube: $("#presetOpenYoutube"),
  presetYtPlaylist: $("#presetYtPlaylist"),
  presetAutoYoutubePlaylist: $("#presetAutoYoutubePlaylist"),
  ytStatus: $("#ytStatus"),
  ytConnectBtn: $("#ytConnectBtn"),
  ytDisconnectBtn: $("#ytDisconnectBtn"),
  ytPlaylistLinks: $("#ytPlaylistLinks"),
  openYtPlaylist: $("#openYtPlaylist"),
  openYtMusicPlaylist: $("#openYtMusicPlaylist"),
  baseDirStatus: $("#baseDirStatus"),
  saveForm: $("#saveform"),
  kind: $("#kind"),
  qualityWrap: $("#qualitywrap"),
  quality: $("#quality"),
  folder: $("#folder"),
  source: $("#source"),
  saveNotes: $("#saveNotes"),
  saveSubmit: $("#saveSubmit"),
  history: $("#history"),
  downloadHistory: $("#downloadHistory"),
  clearHistory: $("#clearHistory"),
  toast: $("#toast"),
};

const state = {
  mode: "once",
  phase: "idle", // idle | listening | recognizing
  sessionId: 0,
  stream: null,
  recorder: null,
  chunks: [],
  captureTimer: null,
  continuousTimer: null,
  meterRaf: null,
  captureStartedAt: 0,
  abortController: null,
  toastTimer: null,
  currentSong: null,
  history: [],
  preset: { ...DEFAULT_PRESET },
  baseDirHandle: null,
  youtubeConfigured: false,
  youtubeConnected: false,
};

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.remove("hidden");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    elements.toast.classList.add("hidden");
  }, 3800);
}

function setStatus(text, tone = "idle") {
  elements.status.textContent = text;
  elements.dot.classList.remove("on", "busy", "error");
  if (tone === "listening") elements.dot.classList.add("on");
  if (tone === "busy") elements.dot.classList.add("busy");
  if (tone === "error") elements.dot.classList.add("error");
}

function getSessionToken() {
  try {
    return (sessionStorage.getItem(SESSION_TOKEN_KEY) || "").trim();
  } catch {
    return "";
  }
}

function setSessionToken(token) {
  try {
    const clean = token.trim();
    if (clean) {
      sessionStorage.setItem(SESSION_TOKEN_KEY, clean);
    } else {
      sessionStorage.removeItem(SESSION_TOKEN_KEY);
    }
  } catch {
    // Ignore storage errors.
  }
}

function showBanner(message, tone = "", showSetup = false) {
  if (!message) {
    elements.banner.classList.add("hidden");
    elements.tokenSetup.classList.add("hidden");
    return;
  }
  elements.bannerText.textContent = message;
  elements.banner.className = `banner${tone ? ` ${tone}` : ""}`;
  elements.tokenSetup.classList.toggle("hidden", !showSetup);
}

function updateControls() {
  const isListening = state.phase === "listening";
  const isRecognizing = state.phase === "recognizing";
  const isBusy = isListening || isRecognizing;

  elements.listen.disabled = isBusy;
  elements.uploadBtn.disabled = isBusy;
  elements.cancel.classList.toggle("hidden", !isBusy);
  elements.meterWrap.classList.toggle("hidden", !isListening);

  if (isListening) {
    elements.listen.textContent = "◉  Ouvindo…";
  } else if (isRecognizing) {
    elements.listen.textContent = "◌  Identificando…";
  } else {
    elements.listen.textContent = "◉  Ouvir agora";
  }
}

function setMode(nextMode) {
  state.mode = nextMode;
  elements.once.classList.toggle("active", nextMode === "once");
  elements.continuous.classList.toggle("active", nextMode === "continuous");
  elements.once.setAttribute("aria-pressed", String(nextMode === "once"));
  elements.continuous.setAttribute("aria-pressed", String(nextMode === "continuous"));

  if (nextMode === "continuous") {
    toast("Escuta contínua ativa. Deixe esta aba aberta.");
    if (state.phase === "idle") {
      startCapture();
    }
  } else {
    cancelActiveWork("Pronto para ouvir");
  }
}

function releaseAudioResources() {
  clearTimeout(state.captureTimer);
  state.captureTimer = null;

  if (state.meterRaf) {
    cancelAnimationFrame(state.meterRaf);
    state.meterRaf = null;
  }

  if (state.recorder) {
    state.recorder.state = "inactive";
    try {
      state.recorder.processor.disconnect();
      state.recorder.source.disconnect();
      state.recorder.analyser.disconnect();
      state.recorder.context.close();
    } catch {
      // Ignore cleanup errors on already-closed nodes.
    }
    state.recorder = null;
  }

  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }
}

function cancelActiveWork(statusText = "Captura cancelada") {
  state.sessionId += 1;
  clearTimeout(state.continuousTimer);
  state.continuousTimer = null;

  if (state.abortController) {
    state.abortController.abort();
    state.abortController = null;
  }

  releaseAudioResources();
  state.chunks = [];
  state.phase = "idle";
  updateControls();
  setStatus(statusText, "idle");
}

function buildMeterBars() {
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < 16; i += 1) {
    fragment.appendChild(document.createElement("span"));
  }
  elements.meterBars.replaceChildren(fragment);
}

function animateMeter() {
  if (state.phase !== "listening" || !state.recorder) return;

  const { analyser, freqData } = state.recorder;
  analyser.getByteFrequencyData(freqData);

  const bars = elements.meterBars.children;
  const step = Math.max(1, Math.floor(freqData.length / bars.length));
  for (let i = 0; i < bars.length; i += 1) {
    const value = freqData[i * step] || 0;
    const height = Math.max(4, Math.round((value / 255) * 28));
    bars[i].style.height = `${height}px`;
  }

  const elapsed = Date.now() - state.captureStartedAt;
  const remainingSec = Math.max(0, (CAPTURE_DURATION_MS - elapsed) / 1000);
  const progress = Math.min(100, (elapsed / CAPTURE_DURATION_MS) * 100);
  elements.meterCountdown.textContent = `${remainingSec.toFixed(1)}s`;
  elements.progressFill.style.width = `${progress}%`;

  state.meterRaf = requestAnimationFrame(animateMeter);
}

async function startCapture() {
  if (state.phase !== "idle") return;

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus("Microfone não suportado", "error");
    toast("Este navegador não oferece suporte à captura de microfone. Use “Enviar áudio”.");
    return;
  }

  clearTimeout(state.continuousTimer);
  state.continuousTimer = null;

  const currentSession = ++state.sessionId;
  state.phase = "listening";
  updateControls();
  setStatus("Solicitando microfone…", "listening");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    if (currentSession !== state.sessionId) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const context = new AudioCtx();
    await context.resume();

    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 64;
    const processor = context.createScriptProcessor(4096, 1, 1);

    state.stream = stream;
    state.chunks = [];
    state.captureStartedAt = Date.now();
    state.recorder = {
      state: "recording",
      context,
      source,
      analyser,
      processor,
      sampleRate: context.sampleRate,
      freqData: new Uint8Array(analyser.frequencyBinCount),
    };

    processor.onaudioprocess = (event) => {
      if (state.recorder?.state === "recording") {
        state.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      }
      event.outputBuffer.getChannelData(0).fill(0);
    };

    source.connect(analyser);
    analyser.connect(processor);
    processor.connect(context.destination);

    setStatus("Ouvindo pelo microfone…", "listening");
    elements.meterLabel.textContent = "Captando áudio ambiente";
    elements.progressFill.style.width = "0%";
    animateMeter();

    state.captureTimer = setTimeout(() => finishCapture(currentSession), CAPTURE_DURATION_MS);
  } catch (err) {
    releaseAudioResources();
    state.phase = "idle";
    updateControls();
    setStatus("Microfone indisponível", "error");
    const denied = err && (err.name === "NotAllowedError" || err.name === "PermissionDeniedError");
    toast(
      denied
        ? "Permita o acesso ao microfone no navegador para identificar músicas."
        : "Não foi possível acessar o microfone. Verifique o dispositivo ou envie um arquivo de áudio."
    );
    if (state.mode === "continuous") {
      setMode("once");
    }
  }
}

function mergeAndDownsample(parts, sourceRate, targetRate) {
  const totalLength = parts.reduce((acc, chunk) => acc + chunk.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }

  if (sourceRate <= targetRate) {
    return { samples: merged, sampleRate: sourceRate };
  }

  const ratio = sourceRate / targetRate;
  const newLength = Math.round(totalLength / ratio);
  const downsampled = new Float32Array(newLength);

  for (let i = 0; i < newLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(totalLength, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j += 1) {
      sum += merged[j];
      count += 1;
    }
    downsampled[i] = count > 0 ? sum / count : 0;
  }

  return { samples: downsampled, sampleRate: targetRate };
}

function computeRms(samples) {
  if (!samples.length) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sumSq += samples[i] * samples[i];
  }
  return Math.sqrt(sumSq / samples.length);
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 32768 : clamped * 32767, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

async function finishCapture(expectedSession) {
  if (expectedSession !== state.sessionId || !state.recorder) return;

  const sourceRate = state.recorder.sampleRate;
  const recordedChunks = state.chunks;
  state.chunks = [];
  releaseAudioResources();

  const { samples, sampleRate } = mergeAndDownsample(recordedChunks, sourceRate, TARGET_SAMPLE_RATE);
  const rms = computeRms(samples);

  if (rms < SILENCE_RMS_THRESHOLD) {
    state.phase = "idle";
    updateControls();
    setStatus("Nenhum som detectado", "idle");
    toast("O microfone captou apenas silêncio. Aproxime a fonte sonora e tente novamente.");
    scheduleContinuousIfNeeded(expectedSession);
    return;
  }

  const wavBlob = encodeWav(samples, sampleRate);
  await recognizeAudio(wavBlob, "sample.wav", expectedSession);
}

function scheduleContinuousIfNeeded(expectedSession) {
  if (state.mode === "continuous" && expectedSession === state.sessionId) {
    clearTimeout(state.continuousTimer);
    state.continuousTimer = setTimeout(() => {
      if (state.mode === "continuous" && state.phase === "idle") {
        startCapture();
      }
    }, CONTINUOUS_DELAY_MS);
  }
}

async function recognizeAudio(blob, filename, expectedSession) {
  if (expectedSession !== state.sessionId) return;

  state.phase = "recognizing";
  state.abortController = new AbortController();
  updateControls();
  setStatus("Identificando faixa…", "busy");

  try {
    const formData = new FormData();
    formData.append("audio", blob, filename);

    const headers = {};
    const sessionToken = getSessionToken();
    if (sessionToken) {
      headers["X-AudD-Token"] = sessionToken;
    }

    const response = await fetch("/api/recognize", {
      method: "POST",
      headers,
      body: formData,
      signal: state.abortController.signal,
    });
    const payload = await response.json().catch(() => ({}));

    if (expectedSession !== state.sessionId) return;

    if (!response.ok) {
      throw new Error(
        payload.error ||
          (response.status === 503
            ? "Configure AUDD_API_TOKEN no servidor."
            : "Não foi possível reconhecer o áudio.")
      );
    }

    if (!payload.title) {
      setStatus("Nenhuma faixa encontrada", "idle");
      toast("Não encontramos uma música reconhecível neste trecho.");
      return;
    }

    const songRecord = {
      ...payload,
      detectedAt: new Date().toISOString(),
    };
    addToHistory(songRecord);
    renderSong(songRecord);
    setStatus("Música identificada", "listening");
    await handleAutoActions(songRecord);
  } catch (err) {
    if (err && err.name === "AbortError") {
      return;
    }
    setStatus("Reconhecimento indisponível", "error");
    const message = err?.message || "Erro ao reconhecer áudio.";
    toast(
      message.includes("Failed to fetch")
        ? "Inicie o servidor local (python server.py) para reconhecer músicas."
        : message
    );
  } finally {
    if (expectedSession === state.sessionId) {
      state.abortController = null;
      state.phase = "idle";
      updateControls();
      scheduleContinuousIfNeeded(expectedSession);
    }
  }
}

function formatDate(isoOrDate) {
  if (!isoOrDate) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrDate)) {
    const [year, month, day] = isoOrDate.split("-");
    return `${day}/${month}/${year}`;
  }
  return isoOrDate;
}

function formatTime(isoString) {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(isoString));
  } catch {
    return "";
  }
}

function sanitizeFolderName(name) {
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\.+$/g, "")
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") {
    return "Musica_Identificada";
  }
  return cleaned;
}

function isSafeHttpUrl(rawUrl) {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function configureExternalLink(anchor, url) {
  if (isSafeHttpUrl(url)) {
    anchor.href = url;
    anchor.classList.remove("hidden");
  } else {
    anchor.removeAttribute("href");
    anchor.classList.add("hidden");
  }
}

function formatKindLabel(kind, quality) {
  if (kind === "both") return `Ambos — Áudio + Vídeo (${quality})`;
  if (kind === "video") return `Vídeo (${quality})`;
  return `Áudio (${quality})`;
}

function buildYoutubeSearchUrl(song, preset = state.preset) {
  const baseTerms = `${song.artist || ""} ${song.title || ""}`.trim();
  let extra = "official audio";
  if (preset.kind === "video") extra = `official video ${preset.quality || ""}`.trim();
  if (preset.kind === "both") extra = "official";
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${baseTerms} ${extra}`.trim())}`;
}

function populatePresetQuality(kind, selectedValue) {
  const options = QUALITY_OPTIONS[kind] || QUALITY_OPTIONS.audio;
  const fragment = document.createDocumentFragment();
  for (const label of options) {
    const opt = document.createElement("option");
    opt.value = label;
    opt.textContent = label;
    fragment.appendChild(opt);
  }
  elements.presetQuality.replaceChildren(fragment);
  elements.presetQuality.value = options.includes(selectedValue) ? selectedValue : options[0];
}

function loadPreset() {
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    state.preset = { ...DEFAULT_PRESET, ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch {
    state.preset = { ...DEFAULT_PRESET };
  }

  elements.presetFolder.value = state.preset.folder;
  elements.presetLayout.value = state.preset.layout;
  elements.presetKind.value = state.preset.kind;
  populatePresetQuality(state.preset.kind, state.preset.quality);
  state.preset.quality = elements.presetQuality.value;
  elements.presetAutoCreate.checked = Boolean(state.preset.autoCreate);
  elements.presetOpenYoutube.checked = Boolean(state.preset.openYoutube);
  elements.presetYtPlaylist.value = state.preset.ytPlaylist || DEFAULT_PRESET.ytPlaylist;
  elements.presetAutoYoutubePlaylist.checked = Boolean(state.preset.autoYoutubePlaylist);
  syncManualFormFromPreset();
  updateBaseDirStatus();
}

function savePresetFromUi() {
  const selectedKind = ["audio", "video", "both"].includes(elements.presetKind.value)
    ? elements.presetKind.value
    : "audio";
  state.preset = {
    folder: elements.presetFolder.value.trim() || DEFAULT_PRESET.folder,
    layout: elements.presetLayout.value === "list" ? "list" : "separate",
    kind: selectedKind,
    quality: elements.presetQuality.value,
    autoCreate: elements.presetAutoCreate.checked,
    openYoutube: elements.presetOpenYoutube.checked,
    ytPlaylist: elements.presetYtPlaylist.value.trim() || DEFAULT_PRESET.ytPlaylist,
    autoYoutubePlaylist: elements.presetAutoYoutubePlaylist.checked,
  };
  try {
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(state.preset));
  } catch {
    // Ignore storage quota errors.
  }
  syncManualFormFromPreset();
  if (state.currentSong) {
    elements.youtubeLink.href = buildYoutubeSearchUrl(state.currentSong, state.preset);
  }
}

function syncManualFormFromPreset() {
  const manualKind = state.preset.kind === "audio" ? "audio" : "video";
  elements.kind.value = manualKind;
  elements.qualityWrap.classList.toggle("hidden", manualKind !== "video");
  if (manualKind === "video" && QUALITY_OPTIONS.video.includes(state.preset.quality)) {
    elements.quality.value = state.preset.quality;
  }
}

function updateBaseDirStatus() {
  if (typeof window.showDirectoryPicker !== "function") {
    elements.baseDirStatus.textContent = "Navegador sem acesso direto a pastas (usará download .txt)";
    elements.baseDirStatus.classList.remove("ready");
    elements.pickBaseDir.classList.add("hidden");
    return;
  }

  if (state.baseDirHandle) {
    elements.baseDirStatus.textContent = `Pasta base ativa: ${state.baseDirHandle.name}`;
    elements.baseDirStatus.classList.add("ready");
    elements.pickBaseDir.textContent = "Trocar pasta base…";
  } else {
    elements.baseDirStatus.textContent = "Escolha uma pasta base para criação automática";
    elements.baseDirStatus.classList.remove("ready");
    elements.pickBaseDir.textContent = "Escolher pasta base…";
  }
}

async function ensureBaseDirectory(promptIfMissing = true) {
  if (typeof window.showDirectoryPicker !== "function") return null;
  if (state.baseDirHandle) return state.baseDirHandle;
  if (!promptIfMissing) return null;

  const picked = await window.showDirectoryPicker({ mode: "readwrite" }).catch(() => null);
  if (picked) {
    state.baseDirHandle = picked;
    updateBaseDirStatus();
  }
  return state.baseDirHandle;
}

async function appendLineToFile(dirHandle, filename, line) {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const existingFile = await fileHandle.getFile();
  const existingText = await existingFile.text();
  const writable = await fileHandle.createWritable();
  const prefix = existingText && !existingText.endsWith("\n") ? "\n" : "";
  await writable.write(`${existingText}${prefix}${line}\n`);
  await writable.close();
}

async function organizeSongWithPreset(song, { promptDir = false } = {}) {
  const preset = state.preset;
  const rootFolderName = sanitizeFolderName(preset.folder || DEFAULT_PRESET.folder);
  const trackFolderName = sanitizeFolderName(`${song.artist || "Artista"} - ${song.title || "Faixa"}`);
  const ytUrl = buildYoutubeSearchUrl(song, preset);
  const summaryText = buildMetadataText(song, preset.layout === "list" ? rootFolderName : `${rootFolderName}/${trackFolderName}`, {
    kind: preset.kind,
    quality: preset.quality,
    layout: preset.layout,
    youtubeUrl: ytUrl,
  });

  if (typeof window.showDirectoryPicker !== "function") {
    downloadTextFallback(`${trackFolderName}.txt`, summaryText);
    toast(`Resumo “${trackFolderName}.txt” baixado (seu navegador não cria pastas diretamente).`);
    return true;
  }

  const baseDir = await ensureBaseDirectory(promptDir);
  if (!baseDir) {
    toast("Selecione uma “Pasta base” na Pré-configuração para criar pastas automaticamente.");
    return false;
  }

  try {
    const rootDir = await baseDir.getDirectoryHandle(rootFolderName, { create: true });
    const listEntry = `[${new Date(song.detectedAt || Date.now()).toLocaleString("pt-BR")}] ${song.artist || "Artista"} - ${song.title || "Faixa"} | ${preset.kind === "video" ? `Vídeo (${preset.quality})` : `Áudio (${preset.quality})`} | YouTube: ${ytUrl}`;

    if (preset.layout === "list") {
      await appendLineToFile(rootDir, "lista.txt", listEntry);
      toast(`Adicionada à lista em “${rootFolderName}/lista.txt”.`);
    } else {
      const songDir = await rootDir.getDirectoryHandle(trackFolderName, { create: true });
      const fileHandle = await songDir.getFileHandle("detalhes.txt", { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(summaryText);
      await writable.close();
      await appendLineToFile(rootDir, "lista.txt", listEntry);
      toast(`Pasta “${rootFolderName}/${trackFolderName}” criada automaticamente.`);
    }
    return true;
  } catch {
    toast("Não foi possível gravar na pasta base. Clique em “Trocar pasta base…” para conceder permissão.");
    return false;
  }
}

function updateYoutubeStatusUi() {
  if (!state.youtubeConfigured) {
    elements.ytStatus.textContent = "Configure GOOGLE_CLIENT_ID no servidor";
    elements.ytStatus.classList.remove("ready");
    elements.ytConnectBtn.classList.remove("hidden");
    elements.ytDisconnectBtn.classList.add("hidden");
  } else if (state.youtubeConnected) {
    elements.ytStatus.textContent = "YouTube conectado";
    elements.ytStatus.classList.add("ready");
    elements.ytConnectBtn.classList.add("hidden");
    elements.ytDisconnectBtn.classList.remove("hidden");
  } else {
    elements.ytStatus.textContent = "YouTube desconectado";
    elements.ytStatus.classList.remove("ready");
    elements.ytConnectBtn.classList.remove("hidden");
    elements.ytDisconnectBtn.classList.add("hidden");
  }
}

async function addSongToYoutubePlaylist(song) {
  if (!state.youtubeConnected) {
    toast(
      state.youtubeConfigured
        ? "Clique em “Conectar YouTube” na Pré-configuração para adicionar à playlist."
        : "Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no servidor/.env para usar a playlist do YouTube."
    );
    return false;
  }

  try {
    const response = await fetch("/api/youtube/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: song.title,
        artist: song.artist,
        playlist_name: state.preset.ytPlaylist || DEFAULT_PRESET.ytPlaylist,
        kind: state.preset.kind,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        state.youtubeConnected = false;
        updateYoutubeStatusUi();
      }
      toast(payload.error || "Não foi possível adicionar à playlist do YouTube.");
      return false;
    }

    if (isSafeHttpUrl(payload.playlist_url)) {
      elements.openYtPlaylist.href = payload.playlist_url;
      elements.openYtMusicPlaylist.href = payload.music_playlist_url || payload.playlist_url;
      elements.ytPlaylistLinks.classList.remove("hidden");
    }

    const count = Array.isArray(payload.added) ? payload.added.length : 1;
    toast(
      `${count} item(ns) adicionado(s) à playlist “${payload.playlist_name}”. Ative Download offline no YouTube/YT Music.`
    );
    return true;
  } catch {
    toast("Falha ao comunicar com o servidor para atualizar a playlist do YouTube.");
    return false;
  }
}

async function handleAutoActions(song) {
  if (state.preset.autoCreate) {
    await organizeSongWithPreset(song, { promptDir: false });
  }
  if (state.preset.autoYoutubePlaylist) {
    await addSongToYoutubePlaylist(song);
  }
  if (state.preset.openYoutube) {
    window.open(buildYoutubeSearchUrl(song, state.preset), "_blank", "noopener,noreferrer");
  }
}

function renderSong(song) {
  state.currentSong = song;
  elements.empty.classList.add("hidden");
  elements.result.classList.remove("hidden");

  elements.title.textContent = song.title || "Faixa sem título";
  elements.artist.textContent = song.artist || "Artista desconhecido";
  elements.album.textContent = song.album || "";
  elements.releaseDate.textContent = song.release_date ? `Lançamento: ${formatDate(song.release_date)}` : "";

  elements.cover.replaceChildren();
  if (isSafeHttpUrl(song.cover_url)) {
    const img = document.createElement("img");
    img.src = song.cover_url;
    img.alt = `Capa de ${song.title || "faixa"}`;
    img.onerror = () => {
      elements.cover.textContent = "♫";
    };
    elements.cover.appendChild(img);
  } else {
    elements.cover.textContent = "♫";
  }

  if (isSafeHttpUrl(song.preview_url)) {
    elements.previewAudio.src = song.preview_url;
    elements.previewWrap.classList.remove("hidden");
  } else {
    elements.previewAudio.pause();
    elements.previewAudio.removeAttribute("src");
    elements.previewWrap.classList.add("hidden");
  }

  const query = encodeURIComponent(`${song.title || ""} ${song.artist || ""} official`.trim());
  elements.official.href = `https://www.google.com/search?q=${query}`;
  elements.youtubeLink.href = buildYoutubeSearchUrl(song, state.preset);
  configureExternalLink(elements.spotifyLink, song.spotify_url);
  configureExternalLink(elements.appleLink, song.apple_music_url);
  configureExternalLink(elements.auddLink, song.links);

  elements.folder.value = `${song.artist || "Artista"} - ${song.title || "Faixa"}`;
  renderHistory();
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    state.history = Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY_ITEMS) : [];
  } catch {
    state.history = [];
  }
  renderHistory();
}

function persistHistory() {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(state.history));
  } catch {
    // Ignore storage quota errors.
  }
}

function addToHistory(song) {
  const first = state.history[0];
  if (
    first &&
    (first.title || "").toLowerCase() === (song.title || "").toLowerCase() &&
    (first.artist || "").toLowerCase() === (song.artist || "").toLowerCase()
  ) {
    state.history[0] = song;
  } else {
    state.history.unshift(song);
    if (state.history.length > MAX_HISTORY_ITEMS) {
      state.history.length = MAX_HISTORY_ITEMS;
    }
  }
  persistHistory();
  renderHistory();
}

async function downloadHistoryItem(item) {
  const trackName = sanitizeFolderName(`${item.artist || "Artista"} - ${item.title || "Faixa"}`);
  const ytUrl = buildYoutubeSearchUrl(item, state.preset);
  const summaryText = buildMetadataText(item, trackName, {
    kind: state.preset.kind,
    quality: state.preset.quality,
    layout: state.preset.layout,
    youtubeUrl: ytUrl,
  });

  if (state.baseDirHandle) {
    await organizeSongWithPreset(item, { promptDir: false });
  }
  downloadTextFallback(`${trackName}.txt`, summaryText);
  toast(`Download iniciado: “${trackName}.txt”.`);
}

function downloadAllHistory() {
  if (!state.history.length) return;
  const blocks = state.history.map((item) => {
    const title = item.title || "Faixa sem título";
    const artist = item.artist || "Artista desconhecido";
    const time = formatTime(item.detectedAt);
    return time ? `${title}\n${artist} — ${time}` : `${title}\n${artist}`;
  });
  downloadTextFallback("lista_identificacoes.txt", blocks.join("\n\n") + "\n");
  toast(`Lista baixada com ${state.history.length} faixa(s).`);
}

function renderHistory() {
  const isEmpty = state.history.length === 0;
  elements.clearHistory.classList.toggle("hidden", isEmpty);
  elements.downloadHistory.classList.toggle("hidden", isEmpty);

  if (isEmpty) {
    elements.history.innerHTML = '<div class="empty" style="height:120px">Sua lista aparecerá aqui.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of state.history) {
    const row = document.createElement("div");
    row.className = "track";
    if (state.currentSong && state.currentSong.detectedAt === item.detectedAt) {
      row.classList.add("active");
    }

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = "track-select";

    const main = document.createElement("div");
    main.className = "track-main";

    const title = document.createElement("span");
    title.className = "track-title";
    title.textContent = item.title || "Faixa sem título";

    const artist = document.createElement("small");
    artist.textContent = item.artist || "Artista desconhecido";

    main.append(title, artist);
    selectBtn.appendChild(main);
    selectBtn.addEventListener("click", () => renderSong(item));

    const side = document.createElement("div");
    side.className = "track-side";

    const time = document.createElement("time");
    time.dateTime = item.detectedAt || "";
    time.textContent = formatTime(item.detectedAt);

    const ytBtn = document.createElement("button");
    ytBtn.type = "button";
    ytBtn.className = "track-yt";
    ytBtn.textContent = "+ YT";
    ytBtn.title = "Adicionar esta faixa à playlist offline do YouTube";
    ytBtn.addEventListener("click", () => addSongToYoutubePlaylist(item));

    const downloadBtn = document.createElement("button");
    downloadBtn.type = "button";
    downloadBtn.className = "track-download";
    downloadBtn.textContent = "⬇ Download";
    downloadBtn.title = "Baixar detalhes e links desta música";
    downloadBtn.addEventListener("click", () => downloadHistoryItem(item));

    side.append(time, ytBtn, downloadBtn);
    row.append(selectBtn, side);
    fragment.appendChild(row);
  }

  elements.history.replaceChildren(fragment);
}

function buildMetadataText(song, folderName, options = {}) {
  const kind = options.kind || elements.kind.value;
  const quality = options.quality || (kind === "video" ? elements.quality.value : state.preset.quality);
  const layoutLabel =
    options.layout === "list"
      ? "Lista única (mesma pasta)"
      : options.layout === "separate"
      ? "Pasta separada por música"
      : null;
  const youtubeUrl = options.youtubeUrl || buildYoutubeSearchUrl(song, state.preset);

  const lines = [
    `Faixa: ${song.title || "Desconhecida"}`,
    `Artista: ${song.artist || "Desconhecido"}`,
    song.album ? `Álbum: ${song.album}` : null,
    song.release_date ? `Lançamento: ${formatDate(song.release_date)}` : null,
    `Pasta: ${folderName}`,
    layoutLabel ? `Organização: ${layoutLabel}` : null,
    `Formato preferido: ${formatKindLabel(kind, quality)}`,
    `Busca no YouTube: ${youtubeUrl}`,
    song.links ? `Link AudD: ${song.links}` : null,
    song.spotify_url ? `Spotify: ${song.spotify_url}` : null,
    song.apple_music_url ? `Apple Music: ${song.apple_music_url}` : null,
    elements.source.value.trim() ? `Link oficial informado: ${elements.source.value.trim()}` : null,
    `Identificado em: ${new Date(song.detectedAt || Date.now()).toLocaleString("pt-BR")}`,
  ];
  return lines.filter(Boolean).join("\n") + "\n";
}

function downloadTextFallback(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function checkServerStatus() {
  try {
    const response = await fetch("/api/status");
    if (!response.ok) return;
    const info = await response.json();
    state.youtubeConfigured = Boolean(info.youtube_configured);
    state.youtubeConnected = Boolean(info.youtube_connected);
    updateYoutubeStatusUi();

    const sessionToken = getSessionToken();

    if (!info.configured) {
      if (sessionToken) {
        showBanner(
          sessionToken === "test"
            ? "Modo de demonstração ativo nesta sessão (token público test, limite de 10 chamadas/dia)."
            : "Token AudD configurado apenas para esta sessão.",
          "warn",
          false
        );
      } else {
        showBanner(
          "AUDD_API_TOKEN não está configurado no servidor (Vercel/ambiente). Configure a variável de ambiente ou ative um token abaixo para esta sessão:",
          "error",
          true
        );
      }
    } else if (info.demo_mode) {
      showBanner(
        "Modo de demonstração ativo (AUDD_API_TOKEN=test). Esse token público é limitado a 10 chamadas por dia.",
        "warn",
        false
      );
    } else {
      showBanner("");
    }
  } catch {
    showBanner("Não foi possível conectar ao servidor local. Inicie com `python server.py`.", "error", false);
  }
}

function bindEvents() {
  elements.saveTokenBtn.addEventListener("click", () => {
    const token = elements.tokenInput.value.trim();
    if (!token) {
      toast("Informe um token válido do AudD.");
      return;
    }
    setSessionToken(token);
    elements.tokenInput.value = "";
    toast("Token salvo para esta sessão.");
    checkServerStatus();
  });

  elements.demoTokenBtn.addEventListener("click", () => {
    setSessionToken("test");
    toast("Modo demonstração ativado para esta sessão.");
    checkServerStatus();
  });

  elements.once.addEventListener("click", () => setMode("once"));
  elements.continuous.addEventListener("click", () => setMode("continuous"));
  elements.listen.addEventListener("click", () => startCapture());
  elements.cancel.addEventListener("click", () => {
    if (state.mode === "continuous") {
      setMode("once");
    } else {
      cancelActiveWork("Captura cancelada");
    }
  });

  elements.uploadBtn.addEventListener("click", () => elements.audioFile.click());
  elements.audioFile.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast("O arquivo excede o limite de 10 MB.");
      return;
    }
    const session = ++state.sessionId;
    await recognizeAudio(file, file.name || "audio.wav", session);
  });

  elements.pickBaseDir.addEventListener("click", async () => {
    const dir = await window.showDirectoryPicker({ mode: "readwrite" }).catch(() => null);
    if (!dir) {
      toast("Seleção de pasta base cancelada.");
      return;
    }
    state.baseDirHandle = dir;
    updateBaseDirStatus();
    toast(`Pasta base “${dir.name}” configurada para criação automática.`);
  });

  elements.presetFolder.addEventListener("input", savePresetFromUi);
  elements.presetLayout.addEventListener("change", savePresetFromUi);
  elements.presetKind.addEventListener("change", () => {
    populatePresetQuality(elements.presetKind.value, state.preset.quality);
    savePresetFromUi();
  });
  elements.presetQuality.addEventListener("change", savePresetFromUi);
  elements.presetAutoCreate.addEventListener("change", savePresetFromUi);
  elements.presetOpenYoutube.addEventListener("change", savePresetFromUi);
  elements.presetYtPlaylist.addEventListener("input", savePresetFromUi);
  elements.presetAutoYoutubePlaylist.addEventListener("change", savePresetFromUi);

  elements.ytConnectBtn.addEventListener("click", () => {
    if (!state.youtubeConfigured) {
      toast("Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no servidor/.env primeiro.");
      return;
    }
    window.location.href = "/api/youtube/auth";
  });

  elements.ytDisconnectBtn.addEventListener("click", async () => {
    await fetch("/api/youtube/logout", { method: "POST" }).catch(() => null);
    state.youtubeConnected = false;
    updateYoutubeStatusUi();
    toast("Conta do YouTube desconectada.");
  });

  elements.addToYtPlaylistBtn.addEventListener("click", async () => {
    if (!state.currentSong) return;
    await addSongToYoutubePlaylist(state.currentSong);
  });

  elements.applyPresetNow.addEventListener("click", async () => {
    if (!state.currentSong) return;
    await organizeSongWithPreset(state.currentSong, { promptDir: true });
  });

  elements.save.addEventListener("click", () => {
    elements.saveForm.classList.toggle("hidden");
  });

  elements.copy.addEventListener("click", async () => {
    if (!state.currentSong) return;
    const text = `${state.currentSong.artist || "Artista"} - ${state.currentSong.title || "Faixa"}`;
    try {
      await navigator.clipboard.writeText(text);
      toast(`Copiado: ${text}`);
    } catch {
      toast("Não foi possível copiar para a área de transferência.");
    }
  });

  elements.kind.addEventListener("change", () => {
    elements.qualityWrap.classList.toggle("hidden", elements.kind.value !== "video");
  });

  elements.downloadHistory.addEventListener("click", downloadAllHistory);

  elements.clearHistory.addEventListener("click", () => {
    state.history = [];
    persistHistory();
    renderHistory();
    toast("Histórico limpo.");
  });

  elements.saveForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.currentSong) return;

    const safeName = sanitizeFolderName(elements.folder.value);
    const sourceUrl = elements.source.value.trim();

    if (sourceUrl && !isSafeHttpUrl(sourceUrl)) {
      toast("Informe um link oficial válido começando com http:// ou https://.");
      return;
    }

    const summaryText = buildMetadataText(state.currentSong, safeName);

    if (typeof window.showDirectoryPicker === "function") {
      const dir = await window.showDirectoryPicker({ mode: "readwrite" }).catch(() => null);
      if (!dir) {
        toast("Seleção de pasta cancelada.");
        return;
      }
      try {
        const subDir = await dir.getDirectoryHandle(safeName, { create: true });
        if (elements.saveNotes.checked) {
          const fileHandle = await subDir.getFileHandle("detalhes.txt", { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(summaryText);
          await writable.close();
        }
        toast(
          `Pasta “${safeName}” criada.${
            sourceUrl ? " Abrindo link oficial." : " Use os links oficiais para acessar a faixa."
          }`
        );
        if (sourceUrl) {
          window.open(sourceUrl, "_blank", "noopener,noreferrer");
        }
        elements.saveForm.classList.add("hidden");
      } catch {
        toast("Não foi possível criar a pasta selecionada.");
      }
    } else {
      downloadTextFallback(`${safeName}.txt`, summaryText);
      toast(`Seu navegador não cria pastas diretamente. Baixamos “${safeName}.txt” com os detalhes.`);
      if (sourceUrl) {
        window.open(sourceUrl, "_blank", "noopener,noreferrer");
      }
      elements.saveForm.classList.add("hidden");
    }
  });

  document.addEventListener("keydown", (event) => {
    const tag = event.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (event.code === "Space" && !event.repeat) {
      event.preventDefault();
      if (state.phase === "idle") {
        startCapture();
      } else {
        cancelActiveWork("Captura cancelada");
      }
    }
  });
}

function handleYoutubeRedirectFeedback() {
  const params = new URLSearchParams(window.location.search);
  const yt = params.get("youtube");
  if (!yt) return;
  if (yt === "connected") {
    toast("Conta do YouTube conectada! Agora você pode adicionar faixas à sua playlist offline.");
  } else if (yt === "denied") {
    toast("Autorização do YouTube cancelada.");
  } else {
    toast("Não foi possível concluir a conexão com o YouTube.");
  }
  params.delete("youtube");
  const cleanUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
  window.history.replaceState({}, "", cleanUrl);
}

function init() {
  buildMeterBars();
  if (typeof window.showDirectoryPicker !== "function") {
    elements.saveSubmit.textContent = "Baixar resumo da faixa (.txt)";
  }
  loadPreset();
  bindEvents();
  loadHistory();
  updateControls();
  handleYoutubeRedirectFeedback();
  checkServerStatus();
}

init();

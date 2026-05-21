(function () {
  "use strict";

  const ANALYSIS_FPS = 25;
  const FRAME_DT = 1 / ANALYSIS_FPS;
  const ANALYSIS_WIDTH = 128;
  const ANALYSIS_HEIGHT = 72;
  const PIXEL_STRIDE = 3;
  const GRID_COLS = 6;
  const GRID_ROWS = 4;
  const INTRO_SKIP_SEC = 10;
  const INTRO_SKIP_FRAMES = INTRO_SKIP_SEC * ANALYSIS_FPS;

  const $ = (id) => document.getElementById(id);

  const videoInput = $("video-input");
  const dropZone = $("drop-zone");
  const video = $("video");
  const canvas = $("analysis-canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const fileMeta = $("file-meta");
  const controls = $("controls");
  const sensitivity = $("sensitivity");
  const sensitivityVal = $("sensitivity-val");
  const minGap = $("min-gap");
  const minGapVal = $("min-gap-val");
  const btnAnalyze = $("btn-analyze");
  const btnCancel = $("btn-cancel");
  const btnExportCsv = $("btn-export-csv");
  const btnExportJson = $("btn-export-json");
  const btnAddCurrent = $("btn-add-current");
  const btnCopyTimecodes = $("btn-copy-timecodes");
  const progressWrap = $("progress-wrap");
  const progressFill = $("progress-fill");
  const progressText = $("progress-text");
  const resultsBody = $("results-body");
  const cutCount = $("cut-count");
  const currentHint = $("current-hint");
  const videoPlaceholder = $("video-placeholder");
  const videoStage = document.querySelector(".video-stage");

  canvas.width = ANALYSIS_WIDTH;
  canvas.height = ANALYSIS_HEIGHT;

  let objectUrl = null;
  let loadedFile = null;
  let cuts = [];
  let abortFlag = false;
  let loadedFileName = "";
  let lastSilenceRegions = [];

  function formatTimecodeFromFrame(frameIndex) {
    const ff = frameIndex % ANALYSIS_FPS;
    const totalSec = Math.floor(frameIndex / ANALYSIS_FPS);
    const ss = totalSec % 60;
    const mm = Math.floor(totalSec / 60) % 60;
    const hh = Math.floor(totalSec / 3600);
    const pad = (n, len = 2) => String(n).padStart(len, "0");
    return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
  }

  function frameToSeconds(frameIndex) {
    return frameIndex * FRAME_DT;
  }

  function formatSeconds(seconds) {
    return seconds.toFixed(3);
  }

  function secondsToFrameIndex(seconds) {
    const maxFrame = Number.isFinite(video.duration)
      ? Math.max(0, Math.floor(video.duration * ANALYSIS_FPS) - 1)
      : Infinity;
    return Math.min(Math.max(0, Math.round(seconds * ANALYSIS_FPS)), maxFrame);
  }

  function cutFromFrameIndex(frameIndex, manual = false) {
    const time = frameToSeconds(frameIndex);
    return {
      frameIndex,
      time,
      timecode: formatTimecodeFromFrame(frameIndex),
      seconds: time,
      manual,
    };
  }

  function syncResultActionButtons() {
    const hasCuts = cuts.length > 0;
    const hasVideo = Boolean(video.src);
    btnAddCurrent.disabled = !hasVideo;
    btnCopyTimecodes.disabled = !hasCuts;
    btnExportCsv.disabled = !hasCuts;
    btnExportJson.disabled = !hasCuts;
  }

  function flashButtonLabel(btn, label, ms = 1500) {
    const prev = btn.textContent;
    btn.textContent = label;
    setTimeout(() => {
      btn.textContent = prev;
    }, ms);
  }

  function copyToClipboard(text) {
    return navigator.clipboard.writeText(text);
  }

  function minGapFrames() {
    return Math.max(1, Math.round(minGapSeconds() * ANALYSIS_FPS));
  }

  function minGapSeconds() {
    return Number(minGap.value) / 10;
  }

  /** 越高 → 静音判定越宽松（更多帧算静音） */
  function silenceThresholdRatio() {
    const v = Number(sensitivity.value);
    return 0.04 + ((100 - v) / 100) * 0.14;
  }

  /** 画面切换最低分（静音段内） */
  function visualMinScore() {
    const v = Number(sensitivity.value);
    return 0.04 - (v / 100) * 0.03;
  }

  function minSilenceFrames() {
    return Math.max(2, Math.floor(ANALYSIS_FPS * 0.1));
  }

  function filterSilenceRegions(regions) {
    return regions;
  }

  function revokeObjectUrl() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  function syncVideoStageUI() {
    const has = Boolean(video.src);
    videoStage?.classList.toggle("has-video", has);
    if (videoPlaceholder) videoPlaceholder.hidden = has;
  }

  function loadVideoFile(file) {
    if (!file || !file.type.startsWith("video/")) {
      alert("请选择有效的视频文件");
      return;
    }
    revokeObjectUrl();
    loadedFile = file;
    loadedFileName = file.name;
    objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;
    syncVideoStageUI();
    cuts = [];
    lastSilenceRegions = [];
    renderResults([]);
    fileMeta.hidden = false;
    controls.hidden = false;
    syncResultActionButtons();
    updateFileMeta();
    video.addEventListener(
      "loadedmetadata",
      () => {
        updateFileMeta();
      },
      { once: true }
    );
  }

  function updateFileMeta() {
    const dur = video.duration;
    const w = video.videoWidth;
    const h = video.videoHeight;
    const totalFrames = Number.isFinite(dur) ? Math.floor(dur * ANALYSIS_FPS) : 0;
    fileMeta.textContent = [
      `文件：${loadedFileName}`,
      w && h ? `分辨率：${w}×${h}` : "",
      Number.isFinite(dur) ? `时长：${formatSeconds(dur)} 秒` : "时长：加载中…",
      `分析帧率：${ANALYSIS_FPS} fps`,
      `模式：静音段内画面切换（一段静音可含多个切镜）· 开头 ${INTRO_SKIP_SEC} 秒不计`,
      totalFrames ? `总帧数约：${totalFrames} 帧` : "",
      lastSilenceRegions.length ? `上次检测静音段：${lastSilenceRegions.length} 处` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  function waitSeek(targetTime) {
    return new Promise((resolve, reject) => {
      if (abortFlag) {
        reject(new Error("aborted"));
        return;
      }
      const onSeeked = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("seek failed"));
      };
      const cleanup = () => {
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
      };
      video.addEventListener("seeked", onSeeked);
      video.addEventListener("error", onError);
      const t = Math.min(Math.max(0, targetTime), Math.max(0, video.duration - 0.0001));
      if (Math.abs(video.currentTime - t) < 0.0005) {
        cleanup();
        resolve();
        return;
      }
      video.currentTime = t;
    });
  }

  function getMonoSample(audioBuffer, index, channels) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += audioBuffer.getChannelData(c)[index];
    return s / channels;
  }

  async function decodeAudioEnergies(duration) {
    const frameCount = Math.max(1, Math.floor(duration * ANALYSIS_FPS));
    const energies = new Float32Array(frameCount);
    if (!loadedFile) return { energies, ok: false };

    try {
      const arrayBuffer = await loadedFile.arrayBuffer();
      const audioCtx = new AudioContext();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      await audioCtx.close();

      const sampleRate = audioBuffer.sampleRate;
      const channels = audioBuffer.numberOfChannels;
      const totalSamples = audioBuffer.length;
      const frameSamples = Math.max(1, Math.floor(sampleRate / ANALYSIS_FPS));

      for (let f = 0; f < frameCount; f++) {
        const start = Math.min(totalSamples - 1, Math.floor((f * sampleRate) / ANALYSIS_FPS));
        const end = Math.min(totalSamples, start + frameSamples);
        let sum = 0;
        const n = Math.max(1, end - start);
        for (let i = start; i < end; i++) {
          const s = getMonoSample(audioBuffer, i, channels);
          sum += s * s;
        }
        energies[f] = Math.sqrt(sum / n);
      }
      return { energies, ok: true };
    } catch (err) {
      console.warn("音频解码失败", err);
      return { energies, ok: false };
    }
  }

  function computeSilenceThreshold(energies) {
    const sorted = Array.from(energies).sort((a, b) => a - b);
    const len = sorted.length;
    const p5 = sorted[Math.floor(len * 0.05)] || 0;
    const p50 = sorted[Math.floor(len * 0.5)] || 0;
    const p90 = sorted[Math.floor(len * 0.9)] || 1;
    const maxE = sorted[len - 1] || 1;

    const ratio = silenceThresholdRatio();
    const relative = p50 * ratio;
    const fromPeak = maxE * (ratio * 0.35);
    const noise = p5 * 2.5;

    return Math.max(noise, Math.min(relative, fromPeak, p90 * 0.15));
  }

  function findSilenceRegions(energies, threshold) {
    const minLen = minSilenceFrames();
    const regions = [];
    let start = -1;

    for (let i = 0; i < energies.length; i++) {
      if (energies[i] <= threshold) {
        if (start < 0) start = i;
      } else if (start >= 0) {
        const end = i - 1;
        if (end - start + 1 >= minLen) {
          regions.push({
            startFrame: start,
            endFrame: end,
            startTime: frameToSeconds(start),
            endTime: frameToSeconds(end),
          });
        }
        start = -1;
      }
    }

    if (start >= 0) {
      const end = energies.length - 1;
      if (end - start + 1 >= minLen) {
        regions.push({
          startFrame: start,
          endFrame: end,
          startTime: frameToSeconds(start),
          endTime: frameToSeconds(end),
        });
      }
    }

    return regions;
  }

  function captureBlockSignature() {
    ctx.drawImage(video, 0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
    const { data, width, height } = ctx.getImageData(0, 0, ANALYSIS_WIDTH, ANALYSIS_HEIGHT);
    const blockCount = GRID_COLS * GRID_ROWS;
    const lum = new Float32Array(blockCount);
    const edge = new Float32Array(blockCount);
    const blockPixels = new Uint16Array(blockCount);
    const cellW = width / GRID_COLS;
    const cellH = height / GRID_ROWS;

    function lumAt(px) {
      return (data[px] * 77 + data[px + 1] * 150 + data[px + 2] * 29) >> 8;
    }

    for (let y = 0; y < height; y += PIXEL_STRIDE) {
      const row = y * width * 4;
      const gy = Math.min(GRID_ROWS - 1, (y / cellH) | 0);
      for (let x = 0; x < width; x += PIXEL_STRIDE) {
        const i = row + x * 4;
        const gx = Math.min(GRID_COLS - 1, (x / cellW) | 0);
        const bi = gy * GRID_COLS + gx;
        const l = lumAt(i);
        lum[bi] += l;
        const xl = x >= PIXEL_STRIDE ? lumAt(i - PIXEL_STRIDE * 4) : l;
        const yl = y >= PIXEL_STRIDE ? lumAt(i - width * PIXEL_STRIDE * 4) : l;
        edge[bi] += Math.abs(l - xl) + Math.abs(l - yl);
        blockPixels[bi] += 1;
      }
    }

    for (let i = 0; i < blockCount; i++) {
      if (blockPixels[i] > 0) {
        lum[i] /= blockPixels[i];
        edge[i] /= blockPixels[i] * 255;
      }
    }
    return { lum, edge };
  }

  function visualChangeScore(sigA, sigB) {
    const n = sigA.lum.length;
    const diffs = [];
    for (let i = 0; i < n; i++) {
      const lumD = Math.abs(sigA.lum[i] - sigB.lum[i]) / 255;
      const edgeD = Math.abs(sigA.edge[i] - sigB.edge[i]);
      diffs.push(lumD * 0.5 + edgeD * 0.5);
    }
    diffs.sort((a, b) => b - a);
    const topN = Math.max(3, Math.ceil(n * 0.4));
    let topSum = 0;
    for (let i = 0; i < topN; i++) topSum += diffs[i];
    return topSum / topN;
  }

  /**
   * 在峰值后向前延展：过渡可能持续数帧，取「高差异区」最后一帧作为切换前一帧。
   */
  function refineCutFrame(boundaries, peakIdx) {
    const peak = boundaries[peakIdx];
    const tailRatio = 0.38;
    let cutFrame = peak.cutFrame;
    let cutIdx = peakIdx;

    for (let i = peakIdx + 1; i < boundaries.length; i++) {
      if (boundaries[i].score >= peak.score * tailRatio) {
        cutFrame = boundaries[i].cutFrame;
        cutIdx = i;
      } else {
        break;
      }
    }

    return { cutFrame, score: boundaries[cutIdx].score };
  }

  function pickLocalVisualPeaks(boundaries) {
    const minScore = visualMinScore();
    const peaks = [];

    for (let i = 0; i < boundaries.length; i++) {
      const cur = boundaries[i];
      if (cur.score < minScore) continue;

      const prev = boundaries[i - 1]?.score ?? 0;
      const next = boundaries[i + 1]?.score ?? 0;
      const isLocalMax = cur.score >= prev && cur.score >= next;
      if (!isLocalMax) continue;

      const refined = refineCutFrame(boundaries, i);
      peaks.push({
        frameIndex: refined.cutFrame,
        score: refined.score,
      });
    }

    if (peaks.length === 0 && boundaries.length > 0) {
      let bestIdx = 0;
      for (let i = 1; i < boundaries.length; i++) {
        if (boundaries[i].score > boundaries[bestIdx].score) bestIdx = i;
      }
      if (boundaries[bestIdx].score >= minScore) {
        const refined = refineCutFrame(boundaries, bestIdx);
        peaks.push({
          frameIndex: refined.cutFrame,
          score: refined.score,
        });
      }
    }

    return peaks;
  }

  async function findCutsInSilenceRegion(region) {
    const { startFrame, endFrame } = region;
    if (endFrame <= startFrame) return [];

    const boundaries = [];
    let prevSig = null;

    await waitSeek(frameToSeconds(startFrame));
    prevSig = captureBlockSignature();

    for (let f = startFrame + 1; f <= endFrame; f++) {
      if (abortFlag) throw new Error("aborted");
      await waitSeek(frameToSeconds(f));
      const sig = captureBlockSignature();
      const score = visualChangeScore(prevSig, sig);
      boundaries.push({ cutFrame: f - 1, score });
      prevSig = sig;
    }

    const peaks = pickLocalVisualPeaks(boundaries);
    return peaks.map((p) => ({ ...p, region }));
  }

  function filterFinalCuts(hits) {
    const list = hits.filter((h) => h.frameIndex >= INTRO_SKIP_FRAMES);
    return mergeCutsByGap(list.map((h) => h.frameIndex));
  }

  function mergeCutsByGap(cutFrames) {
    const gap = minGapFrames();
    const sorted = cutFrames.slice().sort((a, b) => a - b);
    const merged = [];

    for (const frame of sorted) {
      const last = merged[merged.length - 1];
      if (last !== undefined && frame - last < gap) continue;
      merged.push(frame);
    }
    return merged;
  }

  function buildCutList(cutFrames) {
    return cutFrames.map((frameIndex) => cutFromFrameIndex(frameIndex, false));
  }

  async function detectCuts() {
    abortFlag = false;
    btnAnalyze.disabled = true;
    btnCancel.hidden = false;
    progressWrap.hidden = false;
    cuts = [];
    renderResults([]);

    await new Promise((r) => {
      if (video.readyState >= 1) r();
      else video.addEventListener("loadedmetadata", r, { once: true });
    });

    const duration = video.duration;
    const t0 = performance.now();

    progressFill.style.width = "10%";
    progressText.textContent = "第 1 步：分析音量，查找静音段…";

    const { energies, ok } = await decodeAudioEnergies(duration);
    if (abortFlag) {
      btnAnalyze.disabled = false;
      btnCancel.hidden = true;
      return;
    }

    if (!ok) {
      alert("无法解码视频音频，请换用 MP4 等常见格式后重试。");
      btnAnalyze.disabled = false;
      btnCancel.hidden = true;
      return;
    }

    const threshold = computeSilenceThreshold(energies);
    let allRegions = findSilenceRegions(energies, threshold);
    let regions = filterSilenceRegions(allRegions);
    lastSilenceRegions = regions;

    progressFill.style.width = "35%";
    progressText.textContent = `找到 ${regions.length} 处静音段，逐段查找画面切换…`;

    if (regions.length === 0) {
      const relaxed = threshold * 1.8;
      allRegions = findSilenceRegions(energies, relaxed);
      regions = filterSilenceRegions(allRegions);
      lastSilenceRegions = regions;
      progressText.textContent = `放宽后有效静音段 ${regions.length} 处…`;
    }

    if (regions.length === 0) {
      renderResults([]);
      progressText.textContent = "未检测到静音段，请提高灵敏度后重试";
      btnAnalyze.disabled = false;
      btnCancel.hidden = true;
      return;
    }

    video.pause();
    const cutHits = [];

    for (let r = 0; r < regions.length; r++) {
      if (abortFlag) break;

      const pct = 35 + ((r + 1) / regions.length) * 55;
      progressFill.style.width = `${pct}%`;
      progressText.textContent = `第 2 步：静音段 ${r + 1}/${regions.length} 内找画面切换…`;

      const hits = await findCutsInSilenceRegion(regions[r]);
      cutHits.push(...hits);
    }

    if (abortFlag) {
      btnAnalyze.disabled = false;
      btnCancel.hidden = true;
      return;
    }

    const cutFrames = filterFinalCuts(cutHits);
    let detected = buildCutList(cutFrames);

    progressFill.style.width = "95%";
    progressText.textContent = `检出 ${detected.length} 处切镜…`;

    cuts = detected;
    renderResults(cuts);
    updateFileMeta();

    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    progressText.textContent = abortFlag
      ? "已取消"
      : `完成 · ${regions.length} 处静音段 → ${cuts.length} 处切镜 · 用时 ${elapsed} 秒`;
    progressFill.style.width = "100%";

    btnAnalyze.disabled = false;
    btnCancel.hidden = true;
    syncResultActionButtons();
  }

  function seekToTime(seconds, autoplay) {
    if (!video.src) return;
    video.pause();
    video.currentTime = Math.max(0, Math.min(seconds, Math.max(0, video.duration - 0.001)));
    if (autoplay) video.play().catch(() => {});
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  }

  function copyAllTimecodes() {
    if (cuts.length === 0) return;
    const text = cuts.map((c) => c.timecode).join("\n");
    copyToClipboard(text).then(
      () => flashButtonLabel(btnCopyTimecodes, "已复制"),
      () => alert("复制失败，请检查浏览器剪贴板权限")
    );
  }

  function addCurrentTimecode() {
    if (!video.src) return;
    video.pause();
    const frameIndex = secondsToFrameIndex(video.currentTime);
    const timecode = formatTimecodeFromFrame(frameIndex);

    copyToClipboard(timecode).catch(() => {
      alert("复制失败，请检查浏览器剪贴板权限");
    });

    const existing = cuts.findIndex((c) => c.frameIndex === frameIndex);
    if (existing >= 0) {
      renderResults(cuts);
      seekToTime(cuts[existing].time, false);
      currentHint.hidden = false;
      currentHint.textContent = `该时间码已标记 @ ${timecode}`;
      flashButtonLabel(btnAddCurrent, "已标记");
      syncResultActionButtons();
      return;
    }

    cuts.push(cutFromFrameIndex(frameIndex, true));
    cuts.sort((a, b) => a.frameIndex - b.frameIndex);
    renderResults(cuts);
    currentHint.hidden = false;
    currentHint.textContent = `已标记 @ ${timecode}`;
    flashButtonLabel(btnAddCurrent, "已标记");
    syncResultActionButtons();
  }

  function removeCutAt(index) {
    if (index < 0 || index >= cuts.length) return;
    cuts.splice(index, 1);
    renderResults(cuts);
    syncResultActionButtons();
    if (cuts.length === 0) {
      currentHint.hidden = true;
    } else {
      currentHint.textContent = `已删除，当前剩余 ${cuts.length} 处切镜`;
      currentHint.hidden = false;
    }
  }

  function renderResults(list) {
    cutCount.textContent = String(list.length);
    syncResultActionButtons();
    if (list.length === 0) {
      resultsBody.innerHTML =
        '<tr class="empty-row"><td colspan="5">未检出切镜：请提高灵敏度，或缩短「最短镜头间隔」</td></tr>';
      return;
    }

    resultsBody.innerHTML = list
      .map(
        (c, i) => `
      <tr class="${c.manual ? "row-manual" : ""}" data-time="${c.time}" data-index="${i}">
        <td>${i + 1}</td>
        <td>${c.timecode}</td>
        <td>${formatSeconds(c.seconds)}</td>
        <td>${c.frameIndex}</td>
        <td class="col-actions">
          <button type="button" class="btn-delete" data-index="${i}" title="删除此时间点" aria-label="删除">×</button>
        </td>
      </tr>`
      )
      .join("");

    resultsBody.querySelectorAll("tr[data-time]").forEach((row) => {
      row.addEventListener("click", (e) => {
        if (e.target.closest(".btn-delete")) return;
        const t = Number(row.dataset.time);
        seekToTime(t, false);
        currentHint.hidden = false;
        currentHint.textContent = `预览 @ ${row.querySelector("td:nth-child(2)").textContent}`;
      });
    });

    resultsBody.querySelectorAll(".btn-delete").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const index = Number(btn.dataset.index);
        removeCutAt(index);
      });
    });
  }

  function exportCsv() {
    const header = "序号,时间码,秒,帧号\n";
    const rows = cuts
      .map((c, i) => `${i + 1},"${c.timecode}",${formatSeconds(c.seconds)},${c.frameIndex}`)
      .join("\n");
    downloadBlob("\uFEFF" + header + rows, "text/csv;charset=utf-8", "cut-points.csv");
  }

  function exportJson() {
    const payload = {
      file: loadedFileName,
      fps: ANALYSIS_FPS,
      mode: "silence-then-visual-cut",
      note: "静音段内画面切换的前一帧",
      silenceRegions: lastSilenceRegions.map((r, i) => ({
        index: i + 1,
        start: formatTimecodeFromFrame(r.startFrame),
        end: formatTimecodeFromFrame(r.endFrame),
      })),
      cuts: cuts.map((c, i) => ({
        index: i + 1,
        timecode: c.timecode,
        seconds: Number(formatSeconds(c.seconds)),
        frameIndex: c.frameIndex,
        manual: Boolean(c.manual),
      })),
    };
    downloadBlob(JSON.stringify(payload, null, 2), "application/json", "cut-points.json");
  }

  function downloadBlob(content, mime, filename) {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  dropZone.addEventListener("click", (e) => {
    if (e.target.tagName === "LABEL" || e.target.closest("label")) return;
    videoInput.click();
  });

  videoInput.addEventListener("change", () => {
    const file = videoInput.files?.[0];
    if (file) loadVideoFile(file);
  });

  ["dragenter", "dragover"].forEach((ev) => {
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.add("drag-over");
    });
  });

  ["dragleave", "drop"].forEach((ev) => {
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.remove("drag-over");
    });
  });

  dropZone.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) loadVideoFile(file);
  });

  sensitivity.addEventListener("input", () => {
    sensitivityVal.textContent = sensitivity.value;
  });

  minGap.addEventListener("input", () => {
    minGapVal.textContent = String(minGapSeconds());
  });

  btnAnalyze.addEventListener("click", () => {
    if (!video.src) return;
    detectCuts().catch((err) => {
      if (err.message !== "aborted") console.error(err);
      btnAnalyze.disabled = false;
      btnCancel.hidden = true;
    });
  });

  btnCancel.addEventListener("click", () => {
    abortFlag = true;
    video.pause();
  });

  btnExportCsv.addEventListener("click", exportCsv);
  btnExportJson.addEventListener("click", exportJson);
  btnAddCurrent.addEventListener("click", addCurrentTimecode);
  btnCopyTimecodes.addEventListener("click", copyAllTimecodes);

  document.addEventListener("keydown", (e) => {
    if (isTypingTarget(e.target)) return;
    if (!video.src) return;

    if (e.code === "Space") {
      e.preventDefault();
      if (video.paused) video.play().catch(() => {});
      else video.pause();
      return;
    }

    if (e.code === "ArrowLeft") {
      e.preventDefault();
      seekToTime(video.currentTime - FRAME_DT, false);
      return;
    }

    if (e.code === "ArrowRight") {
      e.preventDefault();
      seekToTime(video.currentTime + FRAME_DT, false);
      return;
    }

    if (e.key === "，" || e.key === "," || e.code === "Comma") {
      e.preventDefault();
      seekToTime(video.currentTime - 3, false);
      return;
    }

    if (e.key === "。" || e.key === "." || e.code === "Period") {
      e.preventDefault();
      seekToTime(video.currentTime + 3, false);
    }
  });

  window.addEventListener("beforeunload", revokeObjectUrl);
})();

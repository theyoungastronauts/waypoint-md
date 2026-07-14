"use client";

import { useEffect, useRef } from "react";

/**
 * A compact live waveform for the listening state (adapted from Liminal Shift's
 * `DictationWaveform`, shrunk for an inline field and re-tinted to the app's
 * theme). Draws frequency bars from an {@link AnalyserNode}; it reads its own
 * resolved `currentColor` so it inherits the surrounding text color and works in
 * both light and dark themes rather than hardcoding hues.
 */

const BAR_COUNT = 20;
const BAR_GAP = 2;
const MIN_BAR_HEIGHT = 2;

export function DictationWaveform({ analyser }: { analyser: AnalyserNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const data = new Uint8Array(analyser.frequencyBinCount);
    let rafId = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      analyser.getByteFrequencyData(data);
      ctx.clearRect(0, 0, width, height);

      const color = getComputedStyle(canvas).color || "currentColor";
      const barWidth = Math.max(2, (width - (BAR_COUNT - 1) * BAR_GAP) / BAR_COUNT);
      const binSize = Math.max(1, Math.floor(data.length / BAR_COUNT));
      const centerY = height / 2;

      for (let i = 0; i < BAR_COUNT; i++) {
        let sum = 0;
        for (let j = 0; j < binSize; j++) sum += data[i * binSize + j];
        const normalized = sum / binSize / 255;
        const barHeight = Math.max(MIN_BAR_HEIGHT, normalized * height * 0.85);
        const x = i * (barWidth + BAR_GAP);
        const y = centerY - barHeight / 2;
        ctx.globalAlpha = 0.4 + normalized * 0.6;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, Math.min(barWidth / 2, 2));
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      rafId = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    rafId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, [analyser]);

  return <canvas ref={canvasRef} aria-hidden className="h-5 w-24 text-primary" />;
}

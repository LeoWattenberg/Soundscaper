import React, { useRef, useEffect } from 'react';
import { Icon } from '../Icon';
import { generateSpeechWaveform } from '../utils/waveform';
import './AudioFileThumbnail.css';

export interface AudioFileThumbnailProps {
  /**
   * Audio file name
   */
  title?: string;
  /**
   * Date/timestamp text (e.g., "TODAY", "YESTERDAY")
   */
  dateText?: string;
  /**
   * Duration text (e.g., "3:45")
   */
  duration?: string;
  /**
   * Whether this is a cloud audio file (shows cloud icon badge)
   */
  isCloudFile?: boolean;
  /**
   * Click handler
   */
  onClick?: () => void;
  /**
   * Context menu button click handler
   */
  onContextMenu?: (e: React.MouseEvent) => void;
  /**
   * Optional className for custom styling
   */
  className?: string;
  /**
   * Seed for unique waveform generation (use title hash or unique ID)
   */
  waveformSeed?: number;
}

// Canvas-based waveform visualization matching project style
const WaveformVisual = ({ seed = 0 }: { seed?: number }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size (HiDPI-aware)
    const width = 280;
    const height = 170;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    // Generate realistic speech waveform data with seeded randomness
    // Create seeded random number generator
    let seedState = seed;
    const seededRandom = () => {
      seedState = (seedState * 9301 + 49297) % 233280;
      return seedState / 233280;
    };

    // Use seed to vary the fundamental characteristics of the waveform DRAMATICALLY
    const phaseOffset = (seed % 10000) / 100; // 0-100 (huge phase variation)
    const frequencyMod = 0.5 + ((seed % 2000) / 1000); // 0.5-2.5x (very wide frequency range)
    const amplitudeMod = 0.3 + ((seed % 700) / 1000); // 0.3-1.0 (big amplitude variation)
    const densityMod = 1 + ((seed % 1500) / 1000); // 1.0-2.5x (syllable density variation)

    const duration = 3;
    const samplesPerSecond = 50000;
    const sampleCount = Math.floor(duration * samplesPerSecond);
    const waveformData: number[] = [];

    for (let i = 0; i < sampleCount; i++) {
      const t = i / sampleCount;

      // Speech envelope with DRAMATIC seeded variation
      const speechEnvelope =
        Math.abs(Math.sin(t * Math.PI * 3 * frequencyMod * densityMod + phaseOffset + seededRandom() * 2)) *
        (0.2 + Math.abs(Math.sin(t * Math.PI * 0.5 * frequencyMod)) * 0.8) *
        (0.3 + seededRandom() * 0.7) *
        amplitudeMod;

      // High-frequency content with seed variation
      const voiceContent =
        Math.sin(t * Math.PI * 200 * frequencyMod + phaseOffset + seededRandom() * 2) * 0.4 +
        Math.sin(t * Math.PI * 500 * frequencyMod + phaseOffset * 2 + seededRandom() * 3) * 0.3 +
        Math.sin(t * Math.PI * 1200 * frequencyMod + phaseOffset * 3 + seededRandom() * 5) * 0.2 +
        (seededRandom() - 0.5) * 0.3;

      const value = voiceContent * speechEnvelope;
      waveformData.push(Math.max(-1, Math.min(1, value)));
    }

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw waveform
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.lineWidth = 1;

    const centerY = height / 2;
    const samplesPerPixel = Math.floor(waveformData.length / width);

    ctx.beginPath();
    ctx.moveTo(0, centerY);

    // Draw positive half
    for (let x = 0; x < width; x++) {
      const startIdx = x * samplesPerPixel;
      const endIdx = startIdx + samplesPerPixel;

      let max = 0;
      for (let i = startIdx; i < endIdx && i < waveformData.length; i++) {
        const value = Math.abs(waveformData[i]);
        if (value > max) max = value;
      }

      const y = centerY - (max * (height / 2) * 0.9);
      ctx.lineTo(x, y);
    }

    // Draw negative half
    for (let x = width - 1; x >= 0; x--) {
      const startIdx = x * samplesPerPixel;
      const endIdx = startIdx + samplesPerPixel;

      let max = 0;
      for (let i = startIdx; i < endIdx && i < waveformData.length; i++) {
        const value = Math.abs(waveformData[i]);
        if (value > max) max = value;
      }

      const y = centerY + (max * (height / 2) * 0.9);
      ctx.lineTo(x, y);
    }

    ctx.closePath();
    ctx.fill();
  }, [seed]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%' }}
      aria-hidden="true"
    />
  );
};

/**
 * AudioFileThumbnail component
 * - Shows audio file with waveform visualization
 * - Fixed dimensions: 280px × 170px
 */
export function AudioFileThumbnail({
  title = 'Audio File',
  dateText = 'TODAY',
  duration = '0:00',
  isCloudFile = false,
  onClick,
  onContextMenu,
  className = '',
  waveformSeed,
}: AudioFileThumbnailProps) {
  // Generate seed from title if not provided - use better hash function
  const seed = waveformSeed ?? (() => {
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
      const char = title.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  })();

  return (
    <div className={`audio-file-thumbnail ${className}`}>
      <button
        className="audio-file-thumbnail__button"
        onClick={onClick}
        type="button"
      >
        <div className="audio-file-thumbnail__image">
          <WaveformVisual seed={seed} />
          {isCloudFile && (
            <div className="audio-file-thumbnail__cloud-badge">
              <Icon name="cloud-filled" size={16} />
            </div>
          )}
          {onContextMenu && (
            <button
              className="audio-file-thumbnail__context-btn"
              onClick={(e) => {
                e.stopPropagation();
                onContextMenu(e);
              }}
              type="button"
              aria-label="More options"
            >
              <Icon name="menu" size={16} />
            </button>
          )}
          <div className="audio-file-thumbnail__duration">
            {duration}
          </div>
        </div>
        <div className="audio-file-thumbnail__info">
          <div className="audio-file-thumbnail__title">{title}</div>
          <div className="audio-file-thumbnail__date">{dateText}</div>
        </div>
      </button>
    </div>
  );
}

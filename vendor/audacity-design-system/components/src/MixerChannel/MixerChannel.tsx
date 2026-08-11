import React from 'react';
import { useTheme } from '../ThemeProvider';
import { MixerFader } from '../MixerFader';
import { MixerEffect } from '../MixerEffect';
import { Knob } from '../Knob';
import './MixerChannel.css';

export type MixerChannelVariant = 'mono' | 'stereo';

export interface MixerChannelEffect {
  /** Effect name */
  name: string;
  /** Whether the effect is enabled */
  enabled: boolean;
  /** Called when the power button is toggled */
  onToggle?: () => void;
  /** Called when the dropdown is clicked */
  onDropdownClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** Called when "Remove effect" is selected */
  onRemoveEffect?: () => void;
  /** Called when a different effect is selected */
  onReplaceEffect?: (effectName: string) => void;
  /** Called when the effect name is clicked */
  onClick?: () => void;
}

export interface MixerChannelProps {
  /**
   * Track name displayed in the colored bar at the bottom
   */
  trackName?: string;
  /**
   * Track color for the name bar (any CSS color)
   */
  trackColor?: string;
  /**
   * Mono or stereo channel
   * @default 'mono'
   */
  variant?: MixerChannelVariant;
  /**
   * Fader value in dB
   * @default -6
   */
  volume?: number;
  /**
   * Pan value (-100 to 100)
   * @default 0
   */
  pan?: number;
  /**
   * Whether the channel is muted
   * @default false
   */
  muted?: boolean;
  /**
   * Whether the channel is soloed
   * @default false
   */
  soloed?: boolean;
  /**
   * Left channel meter level (0-100)
   * @default 0
   */
  meterLeft?: number;
  /**
   * Right channel meter level (0-100, only used in stereo)
   * @default 0
   */
  meterRight?: number;
  /**
   * Callbacks
   */
  onVolumeChange?: (value: number) => void;
  onVolumeChangeEnd?: (value: number) => void;
  onPanChange?: (value: number) => void;
  onMuteToggle?: () => void;
  onSoloToggle?: () => void;
  /**
   * Effects displayed in the effect stack (up to 5 slots).
   * Each entry has a name, enabled state, and callbacks.
   */
  effects?: MixerChannelEffect[];
  /**
   * Called when the empty effect slot dropdown is clicked (to add a new effect)
   */
  onAddEffect?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /**
   * Total number of effect slots to display (including empty ones).
   * Used to keep all channels the same height when one has more effects.
   * @default 1
   */
  effectSlotCount?: number;
  /**
   * Additional CSS classes
   */
  className?: string;
}

/** dB labels for the left ruler */
const LEFT_RULER_LABELS = [12, 6, 0, -6, -12, -18, -24, -30, -36, -42, -54, -Infinity];
/** dB labels for the right (meter) ruler */
const RIGHT_RULER_LABELS = [0, 6, 12, 18, 24, 30, 36, 42, 54, 60];

const FADER_MIN = -60;
const FADER_MAX = 12;

/**
 * MixerChannel - A complete mixer channel strip
 *
 * Contains: effect slot, pan knob + value, volume input, dB ruler,
 * fader, VU meter(s), mute/solo buttons, and track name bar.
 */
export const MixerChannel: React.FC<MixerChannelProps> = ({
  trackName = 'Audio 1',
  trackColor,
  variant = 'mono',
  volume = -6,
  pan = 0,
  muted = false,
  soloed = false,
  meterLeft = 0,
  meterRight = 0,
  onVolumeChange,
  onVolumeChangeEnd,
  onPanChange,
  onMuteToggle,
  onSoloToggle,
  effects = [],
  onAddEffect,
  effectSlotCount = 1,
  className = '',
}) => {
  const { theme } = useTheme();

  const resolvedTrackColor = trackColor ?? theme.audio.clip.green.header;

  const style = {
    '--mc-surface': theme.background.surface.default,
    '--mc-input-bg': theme.background.control.input.idle,
    '--mc-input-border': theme.border.input.idle,
    '--mc-text': theme.foreground.text.primary,
    '--mc-text-secondary': theme.foreground.text.secondary,
    '--mc-tick-major': theme.audio.timeline.tickMajor,
    '--mc-tick-minor': '#A9B0BD',
    '--mc-meter-bg': theme.background.control.meter.background,
    '--mc-meter-fill': theme.background.control.meter.fill,
    '--mc-meter-peak': theme.background.control.meter.peak,
    '--mc-btn-bg': 'rgba(194, 196, 207, 0.7)',
    '--mc-btn-active-mute': theme.semantic.warning.background,
    '--mc-btn-active-solo': theme.semantic.success.background,
    '--mc-border': theme.border.default,
    '--mc-track-color': resolvedTrackColor,
  } as React.CSSProperties;

  const volumeDisplay = volume <= FADER_MIN ? '-∞' : Math.round(volume).toString();

  return (
    <div className={`mixer-channel ${className}`} style={style}>
        {/* Effect stack */}
        <div className="mixer-channel__effect-slot">
          {effects.map((effect, i) => (
            <MixerEffect
              key={i}
              effectName={effect.name}
              enabled={effect.enabled}
              trackColor={resolvedTrackColor}
              onToggle={effect.onToggle}
              onDropdownClick={effect.onDropdownClick}
              onRemoveEffect={effect.onRemoveEffect}
              onReplaceEffect={effect.onReplaceEffect}
              onClick={effect.onClick}
            />
          ))}
          {/* Fill remaining slots with empties to match effectSlotCount */}
          {Array.from({ length: Math.max(0, effectSlotCount - effects.length) }, (_, i) => (
            <MixerEffect key={`empty-${i}`} onDropdownClick={onAddEffect} />
          ))}
        </div>

        {/* Pan control */}
        <div className="mixer-channel__pan-row">
          <Knob
            value={pan}
            min={-100}
            max={100}
            mode="bipolar"
            label="Pan"
            onChange={onPanChange}
          />
          <div className="mixer-channel__number-input">
            <span className="mixer-channel__number-value">{pan}</span>
          </div>
        </div>

        {/* Volume display */}
        <div className="mixer-channel__volume-row">
          <div className="mixer-channel__number-input mixer-channel__number-input--wide">
            <span className="mixer-channel__number-value">{volumeDisplay}</span>
          </div>
        </div>

        {/* Fader + meters section */}
        <div className="mixer-channel__fader-section">
          {/* Left ruler (dB scale) + fader */}
          <div className="mixer-channel__volume-control">
            <div className="mixer-channel__ruler mixer-channel__ruler--left">
              {LEFT_RULER_LABELS.map((db, i) => {
                const isLabeled = [12, 6, 0, -6, -12, -18, -24, -30, -36, -42, -54].includes(db) || db === -Infinity;
                const isMajor = isLabeled;
                return (
                  <div key={i} className="mixer-channel__ruler-tick-row">
                    {isLabeled && (
                      <span className="mixer-channel__ruler-label mixer-channel__ruler-label--left">
                        {db === -Infinity ? '-∞' : db}
                      </span>
                    )}
                    <span
                      className={`mixer-channel__ruler-tick mixer-channel__ruler-tick--right ${
                        isMajor ? 'mixer-channel__ruler-tick--major' : 'mixer-channel__ruler-tick--minor'
                      }`}
                    />
                  </div>
                );
              })}
            </div>
            <MixerFader
              value={volume}
              min={FADER_MIN}
              max={FADER_MAX}
              onChange={onVolumeChange}
              onChangeEnd={onVolumeChangeEnd}
              ariaLabel={`${trackName} volume`}
            />
          </div>

          {/* Meters + right ruler */}
          <div className="mixer-channel__meter-section">
            <div className="mixer-channel__meters">
              {variant === 'stereo' ? (
                <>
                  <MeterBar level={meterLeft} theme={theme} />
                  <MeterBar level={meterRight} theme={theme} />
                </>
              ) : (
                <MeterBar level={meterLeft} theme={theme} mono />
              )}
            </div>
            <div className="mixer-channel__ruler mixer-channel__ruler--right">
              {RIGHT_RULER_LABELS.map((db, i) => {
                const isMajor = [0, 6, 12, 18, 24, 30, 36, 42, 54, 60].includes(db);
                return (
                  <div key={i} className="mixer-channel__ruler-tick-row">
                    <span
                      className={`mixer-channel__ruler-tick mixer-channel__ruler-tick--left ${
                        isMajor ? 'mixer-channel__ruler-tick--major' : 'mixer-channel__ruler-tick--minor'
                      }`}
                    />
                    <span className="mixer-channel__ruler-label mixer-channel__ruler-label--right">
                      {db}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Mute / Solo buttons */}
        <div className="mixer-channel__mute-solo-row">
          <button
            className={`mixer-channel__toggle-btn ${muted ? 'mixer-channel__toggle-btn--mute-active' : ''}`}
            onClick={onMuteToggle}
            aria-label="Mute"
            aria-pressed={muted}
          >
            M
          </button>
          <button
            className={`mixer-channel__toggle-btn ${soloed ? 'mixer-channel__toggle-btn--solo-active' : ''}`}
            onClick={onSoloToggle}
            aria-label="Solo"
            aria-pressed={soloed}
          >
            S
          </button>
        </div>

        {/* Track name bar */}
        <div className="mixer-channel__track-name">
          <span className="mixer-channel__track-name-text">{trackName}</span>
        </div>
    </div>
  );
};

/** Internal meter bar sub-component */
interface MeterBarProps {
  level: number;
  theme: ReturnType<typeof useTheme>['theme'];
  /** When true, meter uses full stereo width (13px) instead of single channel (6px) */
  mono?: boolean;
}

const MeterBar: React.FC<MeterBarProps> = ({ level, mono }) => {
  const clampedLevel = Math.max(0, Math.min(100, level));
  const fillPercent = 100 - clampedLevel;
  const isClipping = clampedLevel >= 95;

  return (
    <div className={`mixer-channel__meter-bar ${mono ? 'mixer-channel__meter-bar--mono' : ''}`}>
      <div
        className={`mixer-channel__meter-clip ${isClipping ? 'mixer-channel__meter-clip--active' : ''}`}
      />
      <div
        className="mixer-channel__meter-fill"
        style={{ top: `${fillPercent}%` }}
      />
    </div>
  );
};

export default MixerChannel;

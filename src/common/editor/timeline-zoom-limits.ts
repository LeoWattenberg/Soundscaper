/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The deepest horizontal zoom the timeline offers, matching Audacity's own
 * ceiling. It is deliberately far past the point where one sample spans a
 * pixel: the waveform only becomes a row of stems at four pixels per sample,
 * and drawing a sample by hand needs room between neighbours. The timeline
 * caps the surface width it lays out for itself, so this ceiling does not
 * depend on how long the project is.
 */
export const AUDIO_EDITOR_MAX_PIXELS_PER_SECOND = 6_000_000;

export const AUDIO_EDITOR_DEFAULT_PIXELS_PER_SECOND = 120;

/** Audacity's global horizontal zoom floor, including dynamic fit presets. */
export const AUDIO_EDITOR_MIN_PIXELS_PER_SECOND = 0.001;

/** Audacity's coarsest fixed preset: five pixels represent one minute. */
export const AUDIO_EDITOR_MINUTES_PRESET_PIXELS_PER_SECOND = 5 / 60;

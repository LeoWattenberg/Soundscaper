/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	DELIVERY_PRESET_SETTINGS,
	type DeliveryPreset,
	type DeliveryPresetKind,
} from '../delivery-preset.ts';
import { DEFAULT_VIDEO_DELIVERY_QUALITY } from '../video-delivery-quality.ts';

/**
 * Translation between the export dialog's flat string settings and the typed
 * preset record.
 *
 * The dialog holds every control as a string because that is what the inputs
 * produce; a preset holds real values. Keeping the conversion here means the
 * dialog never hand-rolls it per control and a preset never carries a stray
 * dialog-only field such as the metadata editors' state.
 */

export const PRESET_SETTING_KEYS: Readonly<Record<DeliveryPresetKind, readonly string[]>> = Object.freeze({
	audio: Object.freeze([
		'sampleRate', 'channelMapping', 'sampleFormat', 'dither',
		'bitRate', 'quality', 'compressionLevel', 'mode', 'includeTail',
	]),
	// The video canvas is nested rather than flat, so it is translated below
	// rather than copied across; nothing else in the dialog is a video setting.
	video: Object.freeze([]),
});

/**
 * A key the dialog exports that a preset cannot hold makes saving throw at the
 * moment the user presses save, which is exactly what a video preset used to do
 * with `includeTail`. Checking the two lists against each other here turns that
 * into a startup failure the tests catch instead.
 */
for (const kind of Object.keys(PRESET_SETTING_KEYS) as DeliveryPresetKind[]) {
	for (const key of PRESET_SETTING_KEYS[kind]) {
		if (!DELIVERY_PRESET_SETTINGS[kind].includes(key)) {
			throw new RangeError(`The export dialog exports a ${kind} setting no preset admits: ${key}.`);
		}
	}
}

const NUMERIC_KEYS: readonly string[] = Object.freeze([
	'sampleRate', 'bitRate', 'quality', 'compressionLevel',
]);

const CANVAS_FIT_DEFAULT = 'contain';
const VIDEO_QUALITY_DEFAULT = DEFAULT_VIDEO_DELIVERY_QUALITY;

/** The preset-worthy subset of the dialog's settings, with numbers as numbers. */
export function presetSettingsFromDialog(
	settings: Readonly<Record<string, unknown>>,
	kind: DeliveryPresetKind,
): Readonly<Record<string, unknown>> {
	const result: Record<string, unknown> = {};
	for (const key of PRESET_SETTING_KEYS[kind]) {
		const value = settings?.[key];
		if (value === undefined || value === '') continue;
		if (NUMERIC_KEYS.includes(key)) {
			const numeric = Number(value);
			if (Number.isFinite(numeric)) result[key] = numeric;
			continue;
		}
		result[key] = value;
	}
	if (kind === 'video') {
		Object.assign(result, statedVideoCanvas(settings));
		const quality = statedVideoQuality(settings);
		if (quality) result.quality = quality;
	}
	return Object.freeze(result);
}

/**
 * The delivery quality tier a video dialog is asking for, or nothing.
 *
 * `balanced` is the tier every delivery used before quality could be chosen, so
 * it is left unstated for the same reason `contain` is: a preset saved from an
 * untouched dialog must not start pinning a value it never asked for.
 *
 * The dialog holds this as `videoQuality` because `quality` is already the
 * Vorbis quality control; the preset spells it `quality` because a video preset
 * has only the one.
 */
export function statedVideoQuality(
	settings: Readonly<Record<string, unknown>> | undefined,
): string | null {
	const quality = settings?.videoQuality;
	if (typeof quality !== 'string' || !quality || quality === VIDEO_QUALITY_DEFAULT) return null;
	return quality;
}

/**
 * The canvas a video dialog is asking for, or nothing at all.
 *
 * A canvas needs both extents to mean anything, and `contain` is what every
 * delivery did before a fit could be chosen, so neither is written down unless
 * it was actually asked for: an untouched dialog must leave existing deliveries
 * byte-identical rather than start stating their geometry.
 */
export function statedVideoCanvas(
	settings: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> {
	const width = Number(settings?.canvasWidth);
	const height = Number(settings?.canvasHeight);
	const fit = settings?.canvasFit;
	const frameRate = Number(settings?.canvasFrameRate);
	const backgroundColor = settings?.canvasBackgroundColor;
	const stated: Record<string, unknown> = {};
	if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
		stated.size = Object.freeze({ width, height });
	}
	if (typeof fit === 'string' && fit && fit !== CANVAS_FIT_DEFAULT) stated.fit = fit;
	if (settings?.canvasFrameRate !== '' && Number.isFinite(frameRate) && frameRate > 0) {
		stated.frameRate = frameRate;
	}
	if (typeof backgroundColor === 'string' && backgroundColor) stated.backgroundColor = backgroundColor;
	return Object.freeze(stated);
}

/** The dialog patch a preset implies. Numbers become strings again for the inputs. */
export function dialogSettingsFromPreset(
	preset: DeliveryPreset,
): Readonly<Record<string, unknown>> {
	const patch: Record<string, unknown> = { format: preset.format };
	for (const [key, value] of Object.entries(preset.settings ?? {})) {
		if (key === 'size') {
			const size = value as Readonly<{ width?: unknown; height?: unknown }> | null;
			patch.canvasWidth = size?.width == null ? '' : String(size.width);
			patch.canvasHeight = size?.height == null ? '' : String(size.height);
			continue;
		}
		if (key === 'fit') {
			patch.canvasFit = String(value);
			continue;
		}
		if (key === 'frameRate') {
			// A preset may state an exact rational; the dialog holds the decimal it
			// round-trips through, which is how every other rate reaches the plan.
			const rational = value as Readonly<{ num?: unknown; den?: unknown }> | null;
			patch.canvasFrameRate = rational && typeof rational === 'object'
				? String(Number(rational.num) / Number(rational.den))
				: String(value);
			continue;
		}
		if (key === 'backgroundColor') {
			patch.canvasBackgroundColor = String(value);
			continue;
		}
		if (key === 'quality' && preset.kind === 'video') {
			patch.videoQuality = String(value);
			continue;
		}
		patch[key] = NUMERIC_KEYS.includes(key) ? String(value) : value;
	}
	return Object.freeze(patch);
}

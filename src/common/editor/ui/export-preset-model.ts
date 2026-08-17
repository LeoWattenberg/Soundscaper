/* SPDX-License-Identifier: AGPL-3.0-only */

import { type DeliveryPreset, type DeliveryPresetKind } from '../delivery-preset.ts';

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
	video: Object.freeze(['includeTail']),
});

const NUMERIC_KEYS: readonly string[] = Object.freeze([
	'sampleRate', 'bitRate', 'quality', 'compressionLevel',
]);

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
	return Object.freeze(result);
}

/** The dialog patch a preset implies. Numbers become strings again for the inputs. */
export function dialogSettingsFromPreset(
	preset: DeliveryPreset,
): Readonly<Record<string, unknown>> {
	const patch: Record<string, unknown> = { format: preset.format };
	for (const [key, value] of Object.entries(preset.settings ?? {})) {
		patch[key] = NUMERIC_KEYS.includes(key) ? String(value) : value;
	}
	return Object.freeze(patch);
}

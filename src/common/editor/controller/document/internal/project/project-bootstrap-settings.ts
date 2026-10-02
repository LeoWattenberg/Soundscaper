/* SPDX-License-Identifier: AGPL-3.0-only */

import { DELIVERY_PRESETS_SETTING_KEY } from '../../../export/delivery-preset-service.ts';
import { EFFECT_MACRO_LIBRARY_SETTING_KEY } from '../../../effects/effect-macro-library-service.ts';
import { MACRO_SCRIPT_LIBRARY_SETTING_KEY } from '../../../effects/macro-script-library-service.ts';

interface BootstrapSettingsStore {
	loadSetting(key: string, fallback: unknown): Promise<unknown>;
}

/** Start independent I/O together, retaining each read's own failure policy. */
export function prefetchProjectBootstrapSettings(
	store: BootstrapSettingsStore,
	productSettingKey: (key: string) => string,
	audioDevicePreferencesSettingKey: string,
	recordingInputGainDefault: number,
): (key: string, fallback: unknown) => Promise<unknown> {
	// Pass each real fallback into the store: its default parameter converts
	// explicit undefined into null, which would erase true-valued defaults.
	const settings: readonly (readonly [string, unknown])[] = [
		['audio-editor-effect-presets-v1', null],
		[EFFECT_MACRO_LIBRARY_SETTING_KEY, null],
		[MACRO_SCRIPT_LIBRARY_SETTING_KEY, null],
		[DELIVERY_PRESETS_SETTING_KEY, null],
		['input-monitor', false], ['microphone-metering', false],
		['recording-input-gain', recordingInputGainDefault],
		['recording-latency-offset-ms', 0], ['recording-lead-in', false],
		...([
			['waveform-show-rms', false], ['timeline-show-vertical-rulers', true],
			['timeline-update-while-playing', true], ['timeline-pinned-playhead', false],
			['timeline-ruler-playback', true], ['transport-metronome', false],
			['selection-follows-loop', false], [audioDevicePreferencesSettingKey, null],
		] as const).map(([key, fallback]) => [productSettingKey(key), fallback] as const),
	];
	const reads = new Map(settings.map(([key, fallback]) => [key,
		Promise.resolve().then(() => store.loadSetting(key, fallback)).then(
			(value): PromiseSettledResult<unknown> => ({ status: 'fulfilled', value }),
			(error: unknown): PromiseSettledResult<unknown> => ({ status: 'rejected', reason: error }),
		),
	]));
	return async (key, fallback) => {
		const read = reads.get(key);
		if (!read) throw new Error(`Unplanned bootstrap setting: ${key}`);
		const result = await read;
		if (result.status === 'rejected') throw result.reason;
		return result.value === undefined ? fallback : result.value;
	};
}

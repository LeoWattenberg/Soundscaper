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
): (key: string, fallback: unknown) => Promise<unknown> {
	const keys = [
		'audio-editor-effect-presets-v1',
		EFFECT_MACRO_LIBRARY_SETTING_KEY,
		MACRO_SCRIPT_LIBRARY_SETTING_KEY,
		DELIVERY_PRESETS_SETTING_KEY,
		'input-monitor', 'microphone-metering', 'recording-input-gain',
		'recording-latency-offset-ms', 'recording-lead-in',
		...[
			'waveform-show-rms', 'timeline-show-vertical-rulers',
			'timeline-update-while-playing', 'timeline-pinned-playhead',
			'timeline-ruler-playback', 'transport-metronome', 'selection-follows-loop',
			audioDevicePreferencesSettingKey,
		].map(productSettingKey),
	];
	const reads = new Map(keys.map((key) => [key,
		Promise.resolve().then(() => store.loadSetting(key, undefined)).then(
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

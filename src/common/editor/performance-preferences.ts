/* SPDX-License-Identifier: AGPL-3.0-only */

export type AudioEditorOptimizationMode = 'memory' | 'speed';

export interface AudioEditorPerformancePreferences {
	readonly optimizeFor: AudioEditorOptimizationMode;
}

export const AUDIO_EDITOR_DEFAULT_OPTIMIZE_FOR: AudioEditorOptimizationMode = 'memory';

const PERFORMANCE_PREFERENCE_FIELDS = Object.freeze(['optimizeFor'] as const);

export function normalizeAudioEditorPerformancePreferences(value: unknown): AudioEditorPerformancePreferences {
	if (value === undefined) return Object.freeze({ optimizeFor: AUDIO_EDITOR_DEFAULT_OPTIMIZE_FOR });
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('performance preferences must be a plain data object.');
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('performance preferences must be a plain data object.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string'
		|| !PERFORMANCE_PREFERENCE_FIELDS.includes(key as 'optimizeFor'))) {
		throw new TypeError('performance preferences contain an unsupported field.');
	}
	const descriptor = Object.getOwnPropertyDescriptor(value, 'optimizeFor');
	if (descriptor && (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))) {
		throw new TypeError('performance.optimizeFor must be an enumerable data property.');
	}
	const optimizeFor = descriptor?.value ?? AUDIO_EDITOR_DEFAULT_OPTIMIZE_FOR;
	if (optimizeFor !== 'memory' && optimizeFor !== 'speed') {
		throw new RangeError('performance.optimizeFor must be memory or speed.');
	}
	return Object.freeze({ optimizeFor });
}

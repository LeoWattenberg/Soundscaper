/* SPDX-License-Identifier: AGPL-3.0-only */

export type AudioEditorOptimizationMode = 'memory' | 'speed';

export interface AudioEditorPerformancePreferences {
	readonly optimizeFor: AudioEditorOptimizationMode;
}

export const AUDIO_EDITOR_DEFAULT_OPTIMIZE_FOR: AudioEditorOptimizationMode = 'memory';

export function normalizeAudioEditorPerformancePreferences(value: unknown): AudioEditorPerformancePreferences {
	if (value === undefined) return { optimizeFor: AUDIO_EDITOR_DEFAULT_OPTIMIZE_FOR };
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('performance preferences must be an object.');
	}
	const candidate = value as Readonly<Record<string, unknown>>;
	const optimizeFor = candidate.optimizeFor ?? AUDIO_EDITOR_DEFAULT_OPTIMIZE_FOR;
	if (optimizeFor !== 'memory' && optimizeFor !== 'speed') {
		throw new RangeError('performance.optimizeFor must be memory or speed.');
	}
	return { optimizeFor };
}

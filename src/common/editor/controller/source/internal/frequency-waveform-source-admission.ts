/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FrequencyWaveformRuntimeSource,
	RequiredFrequencyWaveformSource,
} from '../frequency-waveform-source-service.ts';

export function requiredAudioSource(
	value: FrequencyWaveformRuntimeSource | null | undefined,
): RequiredFrequencyWaveformSource | null {
	if (!value || value.kind === 'video' || value.kind === 'image' || value.kind === 'still') return null;
	return typeof value.id === 'string'
		&& Number.isSafeInteger(value.frameCount) && Number(value.frameCount) >= 0
		&& Number.isSafeInteger(value.channelCount) && Number(value.channelCount) > 0
		&& Number.isSafeInteger(value.sampleRate) && Number(value.sampleRate) > 0
		? value as RequiredFrequencyWaveformSource
		: null;
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { AUDIO_SELECTION_EFFECT_DEFINITIONS } from '../../../../effects.js';
import { selectionEffectSpectralScratchBytes } from '../../../../selection-effect-spectral-context-contract.ts';

export interface MacroSpectralSelection extends Readonly<Record<string, unknown>> {
	readonly minimumFrequency: number;
	readonly maximumFrequency: number;
	readonly windowSize: number;
}

/** Resolve the same authored band and length admission as a menu effect. */
export function macroSpectralContext(
	frequencyRange: Readonly<{ minimumFrequency: number; maximumFrequency: number }> | null | undefined,
	target: Readonly<{ durationFrames: number; channelCount: number; track: Readonly<Record<string, unknown>> }>,
	effects: readonly Readonly<{ type: string }>[],
	lengthChangingError: () => Error,
): Readonly<{ selection: MacroSpectralSelection; peakBytes: number }> | null {
	if (!frequencyRange || effects.every(effect => effect.type === 'eq')) return null;
	const definitions = AUDIO_SELECTION_EFFECT_DEFINITIONS as Readonly<Record<string, Readonly<{ lengthChanging?: boolean }> | undefined>>;
	if (effects.some(effect => definitions[effect.type]?.lengthChanging)) throw lengthChangingError();
	const display = target.track.spectrogram as Readonly<{ windowSize?: number }> | undefined;
	const selection = { ...frequencyRange, windowSize: display?.windowSize ?? 2048 };
	return { selection, peakBytes: selectionEffectSpectralScratchBytes(target.durationFrames, target.channelCount, selection.windowSize) };
}

/** Keep FFT execution in its existing optional owner until a band is applied. */
export async function composeMacroSpectralResult(
	input: readonly Float32Array[], processed: readonly Float32Array[], sampleRate: number,
	spectralSelection: MacroSpectralSelection,
): Promise<readonly Float32Array[]> {
	const { applySelectionEffectSpectralContext } = await import('../../../../selection-effect-spectral-context.ts');
	return applySelectionEffectSpectralContext(input, processed, sampleRate, { spectralSelection });
}

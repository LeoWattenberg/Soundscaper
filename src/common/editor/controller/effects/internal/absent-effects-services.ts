/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAbsentSubsystemRefusal,
	createAsyncAbsentSubsystemRefusal,
	type AbsentSubsystemContext,
} from '../../shared/absent-subsystem.ts';

/** Replaces the selection-effect worker service when its worker domain is absent. */
export function createAbsentSelectionEffectWorkerService(context: AbsentSubsystemContext) {
	const reject = createAsyncAbsentSubsystemRefusal(context, 'selection effect worker');
	return Object.freeze({
		cancelWorkers: (): void => undefined,
		runSelectionEffectWorker: reject,
		runSpectralEditWorker: reject,
	});
}

/** Replaces the Nyquist host service when the effect domain is absent. */
export function createAbsentNyquistHostService(context: AbsentSubsystemContext) {
	const reject = createAsyncAbsentSubsystemRefusal(context, 'Nyquist host');
	return Object.freeze({
		cancelNyquistEvaluation: (): boolean => false,
		nyquistHostProperties: createAbsentSubsystemRefusal(context, 'Nyquist host'),
		persistNyquistLabels: reject,
		playNyquistPreview: reject,
	});
}

/** Replaces the Nyquist generated-audio service when the effect domain is absent. */
export function createAbsentNyquistGeneratedAudioService(context: AbsentSubsystemContext) {
	return Object.freeze({
		persistNyquistGeneratedAudio: createAsyncAbsentSubsystemRefusal(context, 'Nyquist generated audio'),
	});
}

/** Replaces the effect macro service when the macro domain is absent. */
export function createAbsentEffectMacroService(context: AbsentSubsystemContext) {
	return Object.freeze({
		runEffectMacro: createAsyncAbsentSubsystemRefusal(context, 'effect macro'),
		cancelEffectMacro: (): boolean => false,
	});
}

/** Replaces the selection-effect execution service when the effect domain is absent. */
export function createAbsentSelectionEffectExecutionService(context: AbsentSubsystemContext) {
	const reject = createAsyncAbsentSubsystemRefusal(context, 'selection effect');
	return Object.freeze({
		applySelectedAudacityEffect: reject,
		previewAudacityEffectFromController: reject,
		runNyquistEvaluation: reject,
	});
}

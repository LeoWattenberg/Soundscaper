/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Stand-in shapes for the audio subsystems a product's composition decision
 * leaves unbuilt.
 *
 * A product that does not compose a domain still exposes the actions that reach
 * it: menus keep working and a shortcut stays bound, exactly as they do for a
 * command listed in `shortcuts.disabledCommandIds`. What must not happen is a
 * crash on an undefined service. Each shape here therefore answers with the
 * same refusal the action facade's capability guard raises — a `RangeError`
 * naming the product and the domain — while the cancel-shaped members stay
 * silent no-ops, because cancelling work that was never started is not an
 * error and the controller's teardown calls them unconditionally.
 *
 * The shapes mirror `take-cycle-app-composition.ts`'s `unavailableComposition()`
 * and are kept method-for-method in step with the services they replace.
 */

export interface AbsentSubsystemContext {
	/** The product's display name, so a refusal reads the way a capability refusal does. */
	readonly productName: string;
}

function refuse(context: AbsentSubsystemContext, domain: string): never {
	throw new RangeError(`${context.productName} does not compose the ${domain} subsystem.`);
}

function refusal(context: AbsentSubsystemContext, domain: string) {
	return (..._args: readonly unknown[]): never => refuse(context, domain);
}

function asyncRefusal(context: AbsentSubsystemContext, domain: string) {
	return async (..._args: readonly unknown[]): Promise<never> => refuse(context, domain);
}

/** Replaces `createDeferredAudioAnalysisService` when the analysis domain is absent. */
export function createAbsentAnalysisService(context: AbsentSubsystemContext) {
	const reject = asyncRefusal(context, 'analysis');
	return Object.freeze({
		run: reject,
		plotSpectrum: reject,
		findClipping: reject,
		captureContrast: reject,
		measureLoudness: reject,
		repeatLast: reject,
		cancel: (): void => undefined,
	});
}

/** Replaces `createSelectionEffectWorkerService` when neither effects nor spectral editing is composed. */
export function createAbsentSelectionEffectWorkerService(context: AbsentSubsystemContext) {
	const reject = asyncRefusal(context, 'selection effect worker');
	return Object.freeze({
		cancelWorkers: (): void => undefined,
		runSelectionEffectWorker: reject,
		runSpectralEditWorker: reject,
	});
}

/** Replaces `createNyquistHostService` when the effect domain is absent. */
export function createAbsentNyquistHostService(context: AbsentSubsystemContext) {
	const reject = asyncRefusal(context, 'Nyquist host');
	return Object.freeze({
		cancelNyquistEvaluation: (): boolean => false,
		nyquistHostProperties: refusal(context, 'Nyquist host'),
		persistNyquistLabels: reject,
		playNyquistPreview: reject,
	});
}

/** Replaces `createNyquistGeneratedAudioService` when the effect domain is absent. */
export function createAbsentNyquistGeneratedAudioService(context: AbsentSubsystemContext) {
	return Object.freeze({
		persistNyquistGeneratedAudio: asyncRefusal(context, 'Nyquist generated audio'),
	});
}

/** Replaces `createEffectMacroService` when the macro domain is absent. */
export function createAbsentEffectMacroService(context: AbsentSubsystemContext) {
	return Object.freeze({
		runEffectMacro: asyncRefusal(context, 'effect macro'),
		cancelEffectMacro: (): boolean => false,
	});
}

/** Replaces `createSelectionEffectExecutionService` when the effect domain is absent. */
export function createAbsentSelectionEffectExecutionService(context: AbsentSubsystemContext) {
	const reject = asyncRefusal(context, 'selection effect');
	return Object.freeze({
		applySelectedAudacityEffect: reject,
		previewAudacityEffectFromController: reject,
		runNyquistEvaluation: reject,
	});
}

/** Replaces `createAudioGeneratorService` when the generator domain is absent. */
export function createAbsentAudioGeneratorService(context: AbsentSubsystemContext) {
	const reject = asyncRefusal(context, 'audio generator');
	return Object.freeze({
		generateLabeledSilence: reject,
		generateSelectionSilence: reject,
		generateSignal: reject,
		repeatLast: reject,
	});
}

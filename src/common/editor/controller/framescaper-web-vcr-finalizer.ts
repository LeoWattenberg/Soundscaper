/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CapturePhase } from '../framescaper-capture-domain.ts';

export interface FramescaperWebVcrFinalizerOptions {
	readonly capturePhase: () => CapturePhase;
	readonly enterHostFinalizing: () => PromiseLike<void> | void;
	readonly stopCapture: () => PromiseLike<void> | void;
	readonly sealCapture: () => PromiseLike<void> | void;
	readonly enterHostRecovery: () => PromiseLike<void> | void;
	readonly enterHostReady: () => PromiseLike<void> | void;
	readonly restorePreview: () => PromiseLike<void> | void;
}

export interface FramescaperWebVcrStartFailureOptions {
	readonly failure: unknown;
	readonly capturePhase: () => CapturePhase;
	readonly sealCapture: () => PromiseLike<void> | void;
	readonly enterHostRecovery: () => PromiseLike<void> | void;
	readonly enterHostReady: () => PromiseLike<void> | void;
}

const ACTIVE_CAPTURE_PHASES: ReadonlySet<CapturePhase> = new Set([
	'permission-pending', 'armed', 'countdown', 'recording', 'paused', 'finalizing',
]);

/** Host coordination can fail, but it never owns or suppresses the durable 8A finalizer. */
export async function finalizeFramescaperWebVcrCapture(
	options: Readonly<FramescaperWebVcrFinalizerOptions>,
): Promise<void> {
	const failures: unknown[] = [];
	let hostRecoveryRequired = false;
	try { await options.enterHostFinalizing(); }
	catch (error) { failures.push(error); hostRecoveryRequired = true; }
	try { await options.stopCapture(); }
	catch (error) {
		failures.push(error);
		hostRecoveryRequired = true;
		if (ACTIVE_CAPTURE_PHASES.has(options.capturePhase())) {
			try { await options.sealCapture(); }
			catch (sealError) { failures.push(sealError); }
		}
	}
	if (options.capturePhase() === 'recovery') hostRecoveryRequired = true;
	let hostRecovered = false;
	if (hostRecoveryRequired) {
		try { await options.enterHostRecovery(); hostRecovered = true; }
		catch (error) { failures.push(error); }
	}
	let hostReady = false;
	if ((!hostRecoveryRequired || hostRecovered) && captureSettled(options.capturePhase())) {
		try { await options.enterHostReady(); hostReady = true; }
		catch (error) { failures.push(error); }
	}
	if (hostReady && options.capturePhase() === 'inactive') {
		try { await options.restorePreview(); }
		catch (error) { failures.push(error); }
	}
	const failure = finalizationFailure(failures);
	if (failure) throw failure;
}

/** Seals any take started before a rejected host transition, then reconciles host ownership. */
export async function recoverFramescaperWebVcrStartFailure(
	options: Readonly<FramescaperWebVcrStartFailureOptions>,
): Promise<never> {
	const failures: unknown[] = [options.failure];
	if (ACTIVE_CAPTURE_PHASES.has(options.capturePhase())) {
		try { await options.sealCapture(); }
		catch (error) { failures.push(error); }
	}
	let hostRecovered = false;
	try { await options.enterHostRecovery(); hostRecovered = true; }
	catch (error) { failures.push(error); }
	if (hostRecovered && captureSettled(options.capturePhase())) {
		try { await options.enterHostReady(); }
		catch (error) { failures.push(error); }
	}
	throw finalizationFailure(failures)!;
}

function captureSettled(phase: CapturePhase): boolean {
	return phase !== 'recovery' && !ACTIVE_CAPTURE_PHASES.has(phase);
}

function finalizationFailure(failures: readonly unknown[]): Error | null {
	if (failures.length === 0) return null;
	if (failures.length === 1) {
		const failure = failures[0];
		return failure instanceof Error ? failure : new Error(String(failure));
	}
	return new AggregateError(failures, 'Web VCR capture finalization failed.');
}

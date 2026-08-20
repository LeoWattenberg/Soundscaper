/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createCaptureRuntimeAvailability,
	normalizeCaptureDestination,
	normalizeCaptureFailure,
	normalizeCaptureSelectedSources,
	normalizeCaptureSourceRoles,
	type CaptureDestination,
	type CaptureDirectUserAction,
	type CaptureFailure,
	type CapturePhase,
	type CaptureRuntimeAvailability,
	type CaptureSelectedSource,
	type CaptureSourceRole,
} from '../framescaper-capture-domain.ts';

export const FRAMESCAPER_CAPTURE_DEFAULT_COUNTDOWN_MS = 3_000;
export const FRAMESCAPER_CAPTURE_MAXIMUM_COUNTDOWN_MS = 10_000;

export interface FramescaperCaptureArmOptions {
	readonly destination: CaptureDestination;
	readonly countdownMs: number;
}

export interface FramescaperCaptureRecoveryOptions {
	readonly sources: readonly Readonly<CaptureSelectedSource>[];
	readonly destination: CaptureDestination;
	readonly failure: Readonly<CaptureFailure>;
}

export interface FramescaperCaptureStateSnapshot {
	readonly phase: CapturePhase;
	readonly availability: CaptureRuntimeAvailability;
	readonly requestedRoles: readonly CaptureSourceRole[];
	readonly sources: readonly Readonly<CaptureSelectedSource>[];
	readonly sourcesFrozen: boolean;
	readonly destination: CaptureDestination | null;
	readonly countdownMs: number | null;
	readonly permissionRequestGeneration: number | null;
	readonly failure: Readonly<CaptureFailure> | null;
}

export interface FramescaperCaptureStateMachine {
	readonly snapshot: Readonly<FramescaperCaptureStateSnapshot>;
	setRuntimeAvailability(value: CaptureRuntimeAvailability): Readonly<FramescaperCaptureStateSnapshot>;
	issueDirectGesture(): Readonly<CaptureDirectUserAction>;
	requestPreview(
		gesture: Readonly<CaptureDirectUserAction>,
		requestedRoles: readonly CaptureSourceRole[],
	): number;
	previewReady(
		requestGeneration: number,
		sources: readonly Readonly<CaptureSelectedSource>[],
	): Readonly<FramescaperCaptureStateSnapshot>;
	previewFailed(
		requestGeneration: number,
		failure: Readonly<CaptureFailure>,
	): Readonly<FramescaperCaptureStateSnapshot>;
	releasePreview(): Readonly<FramescaperCaptureStateSnapshot>;
	arm(options: Readonly<FramescaperCaptureArmOptions>): Readonly<FramescaperCaptureStateSnapshot>;
	disarm(): Readonly<FramescaperCaptureStateSnapshot>;
	beginCountdown(): Readonly<FramescaperCaptureStateSnapshot>;
	startRecording(): Readonly<FramescaperCaptureStateSnapshot>;
	pause(): Readonly<FramescaperCaptureStateSnapshot>;
	resume(): Readonly<FramescaperCaptureStateSnapshot>;
	stop(): Readonly<FramescaperCaptureStateSnapshot>;
	completeFinalization(): Readonly<FramescaperCaptureStateSnapshot>;
	enterRecovery(failure: Readonly<CaptureFailure>): Readonly<FramescaperCaptureStateSnapshot>;
	restoreRecovery(options: Readonly<FramescaperCaptureRecoveryOptions>): Readonly<FramescaperCaptureStateSnapshot>;
	beginRecoveryFinalization(): Readonly<FramescaperCaptureStateSnapshot>;
	completeRecovery(): Readonly<FramescaperCaptureStateSnapshot>;
	fail(failure: Readonly<CaptureFailure>): Readonly<FramescaperCaptureStateSnapshot>;
	resetFailure(): Readonly<FramescaperCaptureStateSnapshot>;
}

export interface FramescaperCaptureStateMachineOptions {
	readonly availability?: CaptureRuntimeAvailability;
}

/** Owns capture authority and rejects every transition outside the closed graph. */
export function createFramescaperCaptureStateMachine(
	options: FramescaperCaptureStateMachineOptions = {},
): FramescaperCaptureStateMachine {
	let phase: CapturePhase = 'inactive';
	let availability = createCaptureRuntimeAvailability(options.availability);
	let requestedRoles: readonly CaptureSourceRole[] = Object.freeze([]);
	let sources: readonly Readonly<CaptureSelectedSource>[] = Object.freeze([]);
	let sourcesFrozen = false;
	let destination: CaptureDestination | null = null;
	let countdownMs: number | null = null;
	let permissionRequestGeneration: number | null = null;
	let failure: Readonly<CaptureFailure> | null = null;
	let gestureGeneration = 0;
	let issuedGesture: Readonly<CaptureDirectUserAction> | null = null;

	function createSnapshot(): Readonly<FramescaperCaptureStateSnapshot> {
		return Object.freeze({
			phase,
			availability,
			requestedRoles,
			sources,
			sourcesFrozen,
			destination,
			countdownMs,
			permissionRequestGeneration,
			failure,
		});
	}

	function requirePhase(action: string, allowed: readonly CapturePhase[]): void {
		if (!allowed.includes(phase)) {
			throw new Error(`Capture cannot ${action} while ${phase}.`);
		}
	}

	function setRuntimeAvailability(
		value: CaptureRuntimeAvailability,
	): Readonly<FramescaperCaptureStateSnapshot> {
		requirePhase('change runtime availability', ['inactive']);
		availability = createCaptureRuntimeAvailability(value);
		issuedGesture = null;
		return createSnapshot();
	}

	function issueDirectGesture(): Readonly<CaptureDirectUserAction> {
		requirePhase('issue a direct gesture', ['inactive', 'previewing']);
		if (availability.status !== 'available') {
			throw new Error('Framescaper capture runtime is not available.');
		}
		gestureGeneration += 1;
		if (!Number.isSafeInteger(gestureGeneration)) {
			throw new RangeError('Capture direct-gesture generation is exhausted.');
		}
		issuedGesture = Object.freeze({
			kind: 'framescaper-capture-direct-user-action',
			generation: gestureGeneration,
		});
		return issuedGesture;
	}

	function requestPreview(
		gesture: Readonly<CaptureDirectUserAction>,
		requestedSourceRoles: readonly CaptureSourceRole[],
	): number {
		requirePhase('request preview', ['inactive', 'previewing']);
		if (availability.status !== 'available') {
			throw new Error('Framescaper capture runtime is not available.');
		}
		if (gesture !== issuedGesture) {
			throw new Error(
				'Capture direct gesture is stale or was not issued by this capture controller.',
			);
		}
		issuedGesture = null;
		const normalizedRoles = normalizeCaptureSourceRoles(requestedSourceRoles);
		for (const role of normalizedRoles) {
			if (!availability.sourceRoles.includes(role)) {
				throw new Error(`Capture runtime does not support the requested ${role} source.`);
			}
		}
		const requestGeneration = gesture.generation;
		phase = 'permission-pending';
		requestedRoles = normalizedRoles;
		sources = Object.freeze([]);
		sourcesFrozen = false;
		destination = null;
		countdownMs = null;
		permissionRequestGeneration = requestGeneration;
		failure = null;
		return requestGeneration;
	}

	function previewReady(
		requestGeneration: number,
		selectedSources: readonly Readonly<CaptureSelectedSource>[],
	): Readonly<FramescaperCaptureStateSnapshot> {
		requirePhase('complete preview', ['permission-pending']);
		assertCurrentPreviewRequest(requestGeneration);
		const normalizedSources = normalizeCaptureSelectedSources(selectedSources);
		const actualRoles = new Set(normalizedSources.map(({ role }) => role));
		for (const role of requestedRoles) {
			if (role !== 'system-audio' && !actualRoles.has(role)) {
				throw new Error(`Capture preview did not return the required ${role} source.`);
			}
		}
		for (const role of actualRoles) {
			const optionalReturnedSystemAudio = role === 'system-audio'
				&& requestedRoles.includes('display');
			if (!requestedRoles.includes(role) && !optionalReturnedSystemAudio) {
				throw new Error(`Capture preview returned an unrequested ${role} source.`);
			}
			if (availability.status !== 'available' || !availability.sourceRoles.includes(role)) {
				throw new Error(`Capture runtime does not support the returned ${role} source.`);
			}
		}
		phase = 'previewing';
		sources = normalizedSources;
		permissionRequestGeneration = null;
		return createSnapshot();
	}

	function previewFailed(
		requestGeneration: number,
		previewFailure: Readonly<CaptureFailure>,
	): Readonly<FramescaperCaptureStateSnapshot> {
		requirePhase('fail preview', ['permission-pending']);
		assertCurrentPreviewRequest(requestGeneration);
		return enterFailedState(normalizeCaptureFailure(previewFailure));
	}

	function assertCurrentPreviewRequest(requestGeneration: number): void {
		if (!Number.isSafeInteger(requestGeneration)
			|| requestGeneration !== permissionRequestGeneration) {
			throw new Error('Received a stale capture preview completion.');
		}
	}

	function releasePreview(): Readonly<FramescaperCaptureStateSnapshot> {
		requirePhase('release preview', ['previewing']);
		resetSession();
		return createSnapshot();
	}

	function arm(value: Readonly<FramescaperCaptureArmOptions>): Readonly<FramescaperCaptureStateSnapshot> {
		requirePhase('arm', ['previewing']);
		const normalized = normalizeArmOptions(value);
		if (sources.length === 0) throw new Error('Capture cannot arm without preview sources.');
		phase = 'armed';
		sourcesFrozen = true;
		destination = normalized.destination;
		countdownMs = normalized.countdownMs;
		issuedGesture = null;
		return createSnapshot();
	}

	function disarm(): Readonly<FramescaperCaptureStateSnapshot> {
		requirePhase('disarm', ['armed']);
		phase = 'previewing';
		sourcesFrozen = false;
		destination = null;
		countdownMs = null;
		return createSnapshot();
	}

	function beginCountdown(): Readonly<FramescaperCaptureStateSnapshot> {
		requirePhase('begin countdown', ['armed']);
		phase = 'countdown';
		return createSnapshot();
	}

	function startRecording(): Readonly<FramescaperCaptureStateSnapshot> {
		requirePhase('start recording', ['countdown']);
		phase = 'recording';
		return createSnapshot();
	}

	function pause(): Readonly<FramescaperCaptureStateSnapshot> {
		requirePhase('pause', ['recording']);
		phase = 'paused';
		return createSnapshot();
	}

	function resume(): Readonly<FramescaperCaptureStateSnapshot> {
		requirePhase('resume', ['paused']);
		phase = 'recording';
		return createSnapshot();
	}

	function stop(): Readonly<FramescaperCaptureStateSnapshot> {
		requirePhase('stop', ['countdown', 'recording', 'paused']);
		phase = 'finalizing';
		return createSnapshot();
	}

	function completeFinalization(): Readonly<FramescaperCaptureStateSnapshot> {
		requirePhase('complete finalization', ['finalizing']);
		resetSession();
		return createSnapshot();
	}

	function enterRecovery(
		recoveryFailure: Readonly<CaptureFailure>,
	): Readonly<FramescaperCaptureStateSnapshot> {
		requirePhase('enter recovery', ['countdown', 'recording', 'paused', 'finalizing']);
		failure = normalizeCaptureFailure(recoveryFailure);
		phase = 'recovery';
		sourcesFrozen = true;
		return createSnapshot();
	}

	function completeRecovery(): Readonly<FramescaperCaptureStateSnapshot> {
		requirePhase('complete recovery', ['recovery']);
		resetSession();
		return createSnapshot();
	}

	function beginRecoveryFinalization(): Readonly<FramescaperCaptureStateSnapshot> {
		requirePhase('finalize recovery', ['recovery']);
		phase = 'finalizing';
		return createSnapshot();
	}

	function restoreRecovery(
		options: Readonly<FramescaperCaptureRecoveryOptions>,
	): Readonly<FramescaperCaptureStateSnapshot> {
		requirePhase('restore recovery', ['inactive']);
		const restoredSources = normalizeCaptureSelectedSources(options?.sources);
		phase = 'recovery';
		sources = restoredSources;
		requestedRoles = Object.freeze(restoredSources.map(({ role }) => role));
		sourcesFrozen = true;
		destination = normalizeCaptureDestination(options?.destination);
		countdownMs = null;
		permissionRequestGeneration = null;
		failure = normalizeCaptureFailure(options?.failure);
		issuedGesture = null;
		return createSnapshot();
	}

	function fail(captureFailure: Readonly<CaptureFailure>): Readonly<FramescaperCaptureStateSnapshot> {
		if (['countdown', 'recording', 'paused', 'finalizing'].includes(phase)) {
			throw new Error('Capture must enter recovery instead of failing an active capture.');
		}
		requirePhase('fail', ['inactive', 'permission-pending', 'previewing', 'armed']);
		return enterFailedState(normalizeCaptureFailure(captureFailure));
	}

	function enterFailedState(normalizedFailure: Readonly<CaptureFailure>): Readonly<FramescaperCaptureStateSnapshot> {
		phase = 'failed';
		requestedRoles = Object.freeze([]);
		sources = Object.freeze([]);
		sourcesFrozen = false;
		destination = null;
		countdownMs = null;
		permissionRequestGeneration = null;
		failure = normalizedFailure;
		issuedGesture = null;
		return createSnapshot();
	}

	function resetFailure(): Readonly<FramescaperCaptureStateSnapshot> {
		requirePhase('reset failure', ['failed']);
		resetSession();
		return createSnapshot();
	}

	function resetSession(): void {
		phase = 'inactive';
		requestedRoles = Object.freeze([]);
		sources = Object.freeze([]);
		sourcesFrozen = false;
		destination = null;
		countdownMs = null;
		permissionRequestGeneration = null;
		failure = null;
		issuedGesture = null;
	}

	return Object.freeze({
		get snapshot(): Readonly<FramescaperCaptureStateSnapshot> { return createSnapshot(); },
		setRuntimeAvailability,
		issueDirectGesture,
		requestPreview,
		previewReady,
		previewFailed,
		releasePreview,
		arm,
		disarm,
		beginCountdown,
		startRecording,
		pause,
		resume,
		stop,
		completeFinalization,
		enterRecovery,
		restoreRecovery,
		beginRecoveryFinalization,
		completeRecovery,
		fail,
		resetFailure,
	});
}

function normalizeArmOptions(value: unknown): Readonly<FramescaperCaptureArmOptions> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError('Capture arm options must be a closed data record.');
	}
	const record = value as Record<PropertyKey, unknown>;
	if (Reflect.ownKeys(record).length !== 2
		|| !Object.hasOwn(record, 'destination') || !Object.hasOwn(record, 'countdownMs')) {
		throw new TypeError('Capture arm options have an invalid closed shape.');
	}
	const destination = normalizeCaptureDestination(record.destination);
	const countdownMs = record.countdownMs;
	if (!Number.isSafeInteger(countdownMs) || Number(countdownMs) < 0
		|| Number(countdownMs) > FRAMESCAPER_CAPTURE_MAXIMUM_COUNTDOWN_MS) {
		throw new RangeError(
			`Capture countdown must be a safe integer from 0 to ${String(FRAMESCAPER_CAPTURE_MAXIMUM_COUNTDOWN_MS)} milliseconds.`,
		);
	}
	return Object.freeze({ destination, countdownMs: Number(countdownMs) });
}

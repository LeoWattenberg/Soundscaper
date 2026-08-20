/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createCaptureRuntimeAvailability,
	type CaptureFailure,
	type CapturePacket,
	type CaptureSourceRole,
} from '../framescaper-capture-domain.ts';
import type {
	CapturePreviewLease,
	CapturePreviewSource,
} from '../platform/capture-source-port.ts';
import type {
	FramescaperCaptureOriginAuthority,
} from './framescaper-capture-origin-guard.ts';
import { createFramescaperCaptureActiveTimeClock } from './framescaper-capture-active-time-clock.ts';
import { createFramescaperCaptureMetrics } from './framescaper-capture-metrics.ts';
import {
	createFramescaperCaptureStateMachine,
	type FramescaperCaptureArmOptions,
} from './framescaper-capture-state-machine.ts';
import type {
	FramescaperCaptureDurableSession,
	FramescaperCaptureRecorder,
	FramescaperCaptureSessionActions,
	FramescaperCaptureSessionService,
	FramescaperCaptureSessionServiceOptions,
	FramescaperCaptureStreamIdentity,
} from './framescaper-capture-session-types.ts';

interface ActiveRecorder<Stream, Track> {
	readonly source: Readonly<CapturePreviewSource<Stream, Track>>;
	readonly identity: Readonly<FramescaperCaptureStreamIdentity>;
	readonly recorder: FramescaperCaptureRecorder;
}

/** Owns one whole-session capture graph; sources and recorders settle together. */
export function createFramescaperCaptureSessionService<Stream = unknown, Track = unknown>(
	options: FramescaperCaptureSessionServiceOptions<Stream, Track>,
): FramescaperCaptureSessionService {
	const machine = createFramescaperCaptureStateMachine();
	const now = options.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
	const createId = options.createId ?? ((prefix) => `${prefix}-${globalThis.crypto.randomUUID()}`);
	const waitCountdown = options.waitCountdown ?? abortableDelay;
	let previewLease: CapturePreviewLease<Stream, Track> | null = null;
	let recorders: readonly ActiveRecorder<Stream, Track>[] = Object.freeze([]);
	let durableSession: FramescaperCaptureDurableSession | null = null;
	let clock: ReturnType<typeof createFramescaperCaptureActiveTimeClock> | null = null;
	let metrics: ReturnType<typeof createFramescaperCaptureMetrics> | null = null;
	let originAuthority: Readonly<FramescaperCaptureOriginAuthority> | null = null;
	let countdownAbort: AbortController | null = null;
	let startPromise: Promise<void> | null = null;
	let stopPromise: Promise<void> | null = null;
	let recoveryPromise: Promise<void> | null = null;
	let initializePromise: Promise<void> | null = null;
	let monitoring = false;
	let inputGain = 1;
	let captureGeneration = 0;
	let disposed = false;
	let sourceEndCleanups: readonly (() => void)[] = Object.freeze([]);

	function snapshot(): Readonly<Record<string, unknown>> {
		const state = machine.snapshot;
		const elapsedTimeMs = clock && state.phase !== 'inactive'
			? clock.snapshot(now()).activeTimeMs
			: 0;
		const richSources = previewLease?.sources.map((source) => Object.freeze({
			sourceId: source.sourceId,
			role: source.role,
			label: trackLabel(source.track),
			settings: source.settings,
			capabilities: source.capabilities,
		})) ?? state.sources;
		return Object.freeze({
			...state,
			sources: Object.freeze(richSources),
			monitoring,
			inputGain,
			elapsedTimeMs,
			metrics: state.phase === 'inactive' ? Object.freeze([]) : metrics?.snapshot ?? Object.freeze([]),
		});
	}

	function notify(): void {
		try { options.onChange?.(); } catch { /* UI observers cannot own capture. */ }
	}

	function initialize(): Promise<void> {
		if (initializePromise) return initializePromise;
		initializePromise = (async () => {
			const controller = new AbortController();
			let availability = options.enabled
				? await options.sourcePort.probe({ signal: controller.signal, embedded: options.embedded })
				: createCaptureRuntimeAvailability({
					status: 'unavailable', reason: 'unsupported-platform', detail: null,
				});
			availability = createCaptureRuntimeAvailability(
				await options.completeRuntimeProbe?.(availability) ?? availability,
			);
			machine.setRuntimeAvailability(availability);
			const origin = safeCaptureOrigin();
			const recovery = origin
				? await options.durable.findRecovery(origin.projectFence.projectId)
				: null;
			if (recovery) restoreRecovery(recovery);
			notify();
		})();
		return initializePromise;
	}

	async function requestPreview(roles: readonly CaptureSourceRole[]): Promise<void> {
		assertActive();
		const previous = previewLease;
		previewLease = null;
		const previousDisposal = previous?.dispose() ?? Promise.resolve();
		const gesture = machine.issueDirectGesture();
		const requestGeneration = machine.requestPreview(gesture, roles);
		options.authorizeUserAction?.(gesture.generation);
		const opening = options.sourcePort.openPreview({
			signal: new AbortController().signal,
			userActionGeneration: gesture.generation,
			roles,
		});
		notify();
		try {
			await previousDisposal;
			const lease = await opening;
			previewLease = lease;
			machine.previewReady(requestGeneration, lease.sources.map(({ sourceId, role }) => ({ sourceId, role })));
			notify();
		} catch (error) {
			void opening.then((lease) => lease.dispose(), () => undefined);
			machine.previewFailed(requestGeneration, captureFailure(error, 'permission-denied'));
			notify();
			throw error;
		}
	}

	async function release(): Promise<void> {
		assertActive();
		if (machine.snapshot.phase === 'armed') machine.disarm();
		machine.releasePreview();
		const lease = previewLease;
		previewLease = null;
		notify();
		await lease?.dispose();
	}

	function configure(changes: Readonly<Record<string, unknown>>): void {
		assertActive();
		if (machine.snapshot.phase !== 'previewing') {
			throw new Error('Capture setup can change only while previewing.');
		}
		const keys = Object.keys(changes);
		if (!keys.length || keys.some((key) => key !== 'monitoring' && key !== 'inputGain')) {
			throw new TypeError('Capture setup changes have an invalid closed shape.');
		}
		if (Object.hasOwn(changes, 'monitoring')) monitoring = Boolean(changes.monitoring);
		if (Object.hasOwn(changes, 'inputGain')) inputGain = captureInputGain(changes.inputGain);
		notify();
	}

	function arm(armOptions: Readonly<FramescaperCaptureArmOptions>): void {
		assertActive();
		machine.arm(armOptions);
		notify();
	}

	function start(): Promise<void> {
		assertActive();
		const state = machine.snapshot;
		if (state.phase !== 'armed' || !previewLease) throw new Error('Capture is not armed.');
		const captured = requiredCaptureOrigin();
		originAuthority = options.originGuard.bind({
			...captured.projectFence,
			sequenceId: captured.origin.sequenceId,
			playheadMicroseconds: captured.origin.playheadMicroseconds,
		});
		machine.beginCountdown();
		countdownAbort = new AbortController();
		notify();
		startPromise = beginRecording(captured, countdownAbort.signal);
		return startPromise;
	}

	async function beginRecording(
		captured: ReturnType<typeof requiredCaptureOrigin>,
		signal: AbortSignal,
	): Promise<void> {
		try {
			await waitCountdown(machine.snapshot.countdownMs ?? 0, signal);
			if (signal.aborted || machine.snapshot.phase !== 'countdown') return;
			const lease = previewLease;
			if (!lease) throw new Error('Capture preview ownership was released before record start.');
			const sessionId = createId('framescaper-capture-session');
			const identities = lease.sources.map((source) => Object.freeze({
				streamId: createId(`${source.role}-capture-stream`),
				sourceId: createId(`${source.role}-capture-source`),
				role: source.role,
			}));
			clock = createFramescaperCaptureActiveTimeClock(now());
			metrics = createFramescaperCaptureMetrics(identities);
			const created: ActiveRecorder<Stream, Track>[] = [];
			for (let index = 0; index < lease.sources.length; index += 1) {
				const source = lease.sources[index]!;
				const identity = identities[index]!;
				const recorder = await options.createRecorder({
					sessionId, ...identity, source, monitoring, inputGain,
					onPacket,
					onError: reportActiveFailure,
					onBackpressure: () => reportActiveFailure(new Error('Capture storage backpressure exceeded its bound.')),
				});
				created.push(Object.freeze({ source, identity, recorder }));
			}
			recorders = Object.freeze(created);
			captureGeneration += 1;
			const destination = machine.snapshot.destination!;
			durableSession = await options.durable.prepare({
				sessionId,
				generation: captureGeneration,
				sources: Object.freeze(identities),
				destination,
				projectFence: captured.projectFence,
				origin: Object.freeze({ ...captured.origin, destination }),
				monotonicOriginMicroseconds: Math.round(clock.snapshot(now()).startedAtMs * 1_000),
				streams: Object.freeze(created.map(({ identity, recorder }) => Object.freeze({
					...identity, required: true as const, format: recorder.format,
				}))),
			});
			sourceEndCleanups = installSourceEndWatchers(lease.sources, () => {
				reportActiveFailure(new Error('A required capture source ended.'));
			});
			for (const entry of recorders) await entry.recorder.start();
			machine.startRecording();
			notify();
		} catch (error) {
			if (signal.aborted && machine.snapshot.phase === 'finalizing') return;
			if (durableSession) await recoverActive(error, 'encoder-failed');
			else await failBeforeDurability(error);
			throw error;
		}
	}

	async function onPacket(packet: Readonly<CapturePacket>): Promise<void> {
		if (!durableSession || !clock || !metrics) throw new Error('Capture packet arrived before durable admission.');
		const phase = machine.snapshot.phase;
		if (!['recording', 'paused', 'finalizing'].includes(phase)) {
			throw new Error(`Capture packet arrived while ${phase}.`);
		}
		const next = await options.durable.append(durableSession, packet);
		durableSession = next;
		metrics.observe(packet, clock.snapshot(now()).activeTimeUs);
		notify();
	}

	async function pause(): Promise<void> {
		assertActive();
		machine.pause();
		if (!clock) throw new Error('Capture clock is unavailable.');
		clock.pause(now());
		await Promise.all(recorders.map(({ recorder }) => recorder.pause()));
		notify();
	}

	async function resume(): Promise<void> {
		assertActive();
		machine.resume();
		if (!clock || !durableSession) throw new Error('Capture recovery evidence is unavailable.');
		const clockSnapshot = clock.resume(now());
		const span = clockSnapshot.pauseSpans.at(-1)!;
		durableSession = await options.durable.recordPauseSpan(durableSession, {
			startMicroseconds: Math.round((span.startedAtMs - clockSnapshot.startedAtMs) * 1_000),
			endMicroseconds: Math.round((span.endedAtMs - clockSnapshot.startedAtMs) * 1_000),
		});
		await Promise.all(recorders.map(({ recorder }) => recorder.resume()));
		notify();
	}

	function stop(): Promise<void> {
		assertActive();
		if (stopPromise) return stopPromise;
		machine.stop();
		countdownAbort?.abort(new DOMException('Capture countdown stopped.', 'AbortError'));
		notify();
		stopPromise = stopAndFinalize();
		return stopPromise;
	}

	async function stopAndFinalize(): Promise<void> {
		try {
			await Promise.resolve(startPromise).catch(() => undefined);
			if (machine.snapshot.phase === 'recovery') return;
			if (!durableSession) {
				await releaseCaptureResources();
				machine.completeFinalization();
				releaseOrigin('stopped');
				notify();
				return;
			}
			clock?.stop(now());
			const recorderFailures = await releaseCaptureResources();
			if (recorderFailures.length) throw new AggregateError(recorderFailures, 'Capture recorders failed to stop.');
			durableSession = await options.durable.seal(durableSession);
			await options.finalize({
				session: durableSession,
				metrics: metrics?.snapshot ?? Object.freeze([]),
				provenance: 'live',
			});
			machine.completeFinalization();
			releaseOrigin('stopped');
			clearSettledSession();
			notify();
		} catch (error) {
			await recoverActive(error, 'finalization-failed');
			throw error;
		}
	}

	function reportActiveFailure(error: unknown): void {
		if (disposed || recoveryPromise) return;
		recoveryPromise = recoverActive(error, 'encoder-failed');
		void recoveryPromise.catch(() => undefined);
	}

	async function recoverActive(error: unknown, code: CaptureFailure['code']): Promise<void> {
		const phase = machine.snapshot.phase;
		if (!['countdown', 'recording', 'paused', 'finalizing'].includes(phase)) return;
		machine.enterRecovery(captureFailure(error, code));
		countdownAbort?.abort(error);
		notify();
		if (clock) safeStopClock(clock, now());
		await releaseCaptureResources();
		if (durableSession) {
			try { durableSession = await options.durable.seal(durableSession); }
			catch { /* The last acknowledged manifest remains recovery truth. */ }
		}
		notify();
	}

	async function failBeforeDurability(error: unknown): Promise<void> {
		if (machine.snapshot.phase === 'countdown') machine.stop();
		await releaseCaptureResources();
		if (machine.snapshot.phase === 'finalizing') machine.completeFinalization();
		machine.fail(captureFailure(error, 'encoder-failed'));
		releaseOrigin('stopped');
		notify();
	}

	async function finalizeRecovery(provenance: 'recovered' | 'import-as-is'): Promise<void> {
		assertActive();
		if (!durableSession) throw new Error('No recoverable Framescaper capture is selected.');
		machine.beginRecoveryFinalization();
		notify();
		try {
			await options.finalize({
				session: durableSession,
				metrics: metrics?.snapshot ?? Object.freeze([]),
				provenance,
			});
			machine.completeFinalization();
			releaseOrigin('stopped');
			clearSettledSession();
			notify();
		} catch (error) {
			machine.enterRecovery(captureFailure(error, 'finalization-failed'));
			notify();
			throw error;
		}
	}

	async function discard(): Promise<void> {
		assertActive();
		if (machine.snapshot.phase !== 'recovery' || !durableSession) {
			throw new Error('No recoverable Framescaper capture is selected.');
		}
		await options.durable.discard(durableSession);
		machine.completeRecovery();
		releaseOrigin('discarded');
		clearSettledSession();
		notify();
	}

	function restoreRecovery(session: FramescaperCaptureDurableSession): void {
		durableSession = session;
		machine.restoreRecovery({
			sources: session.sources.map(({ sourceId, role }) => ({ sourceId, role })),
			destination: session.destination,
			failure: { code: 'runtime-lost', message: 'A recoverable capture session is available.' },
		});
		originAuthority = options.originGuard.bind({
			...session.projectFence,
			sequenceId: session.origin.sequenceId,
			playheadMicroseconds: session.origin.playheadMicroseconds,
		});
	}

	async function releaseCaptureResources(): Promise<unknown[]> {
		const activeRecorders = recorders;
		const stopResults = activeRecorders.map(({ recorder }) => {
			try { return Promise.resolve(recorder.stop()); }
			catch (error) { return Promise.reject(error); }
		});
		const lease = previewLease;
		previewLease = null;
		await lease?.dispose().catch(() => undefined);
		for (const cleanup of sourceEndCleanups) cleanup();
		sourceEndCleanups = Object.freeze([]);
		const settled = await Promise.allSettled(stopResults);
		await Promise.allSettled(activeRecorders.map(({ recorder }) => Promise.resolve(recorder.dispose())));
		recorders = Object.freeze([]);
		return settled.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
	}

	function clearSettledSession(): void {
		durableSession = null;
		clock = null;
		metrics = null;
		countdownAbort = null;
		startPromise = null;
		stopPromise = null;
		recoveryPromise = null;
	}

	function releaseOrigin(outcome: 'stopped' | 'discarded'): void {
		if (originAuthority) options.originGuard.release(originAuthority, outcome);
		originAuthority = null;
	}

	function resetFailure(): void {
		assertActive();
		machine.resetFailure();
		notify();
	}

	async function settled(): Promise<void> {
		await Promise.all([
			Promise.resolve(startPromise).catch(() => undefined),
			Promise.resolve(stopPromise).catch(() => undefined),
			Promise.resolve(recoveryPromise).catch(() => undefined),
		]);
	}

	async function dispose(): Promise<void> {
		if (disposed) return;
		disposed = true;
		countdownAbort?.abort(new DOMException('Capture controller disposed.', 'AbortError'));
		if (['countdown', 'recording', 'paused', 'finalizing'].includes(machine.snapshot.phase)) {
			await recoverActive(new Error('Capture runtime closed.'), 'runtime-lost');
		} else if (previewLease) {
			await previewLease.dispose();
			previewLease = null;
		}
	}

	function assertActive(): void {
		if (disposed) throw new Error('Framescaper capture is disposed.');
	}

	function safeCaptureOrigin() {
		try { return options.captureOrigin(); }
		catch { return null; }
	}

	function requiredCaptureOrigin() {
		const value = safeCaptureOrigin();
		if (!value) throw new Error('Framescaper capture requires an open origin project.');
		return value;
	}

	const actions: Readonly<FramescaperCaptureSessionActions> = Object.freeze({
		openSetup: () => undefined,
		requestPreview,
		release,
		configure,
		arm,
		start,
		pause,
		resume,
		stop,
		recover: () => finalizeRecovery('recovered'),
		importAsIs: () => finalizeRecovery('import-as-is'),
		discard,
		resetFailure,
	});

	return Object.freeze({
		get snapshot() { return snapshot(); },
		actions,
		initialize,
		settled,
		dispose,
	});
}

function installSourceEndWatchers<Stream, Track>(
	sources: readonly Readonly<CapturePreviewSource<Stream, Track>>[],
	onEnded: () => void,
): readonly (() => void)[] {
	return Object.freeze(sources.flatMap(({ track }) => {
		const eventTarget = track as Readonly<{
			addEventListener?: (type: string, listener: () => void, options?: unknown) => void;
			removeEventListener?: (type: string, listener: () => void) => void;
		}>;
		if (typeof eventTarget.addEventListener !== 'function') return [];
		eventTarget.addEventListener('ended', onEnded, { once: true });
		return [() => eventTarget.removeEventListener?.('ended', onEnded)];
	}));
}

function trackLabel(value: unknown): string {
	if (!value || typeof value !== 'object') return '';
	const label = (value as { readonly label?: unknown }).label;
	return typeof label === 'string' ? label : '';
}

function captureFailure(error: unknown, fallback: CaptureFailure['code']): Readonly<CaptureFailure> {
	const name = error && typeof error === 'object' ? (error as { readonly name?: unknown }).name : null;
	const code = name === 'NotAllowedError'
		? 'permission-denied'
		: name === 'AbortError' ? 'permission-dismissed' : fallback;
	const message = error instanceof Error ? error.message : String(error || 'Capture failed.');
	return Object.freeze({ code, message: message.slice(0, 1_024) || 'Capture failed.' });
}

function captureInputGain(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 2) {
		throw new RangeError('Capture input gain must be between zero and two.');
	}
	return value;
}

function safeStopClock(
	clock: ReturnType<typeof createFramescaperCaptureActiveTimeClock>,
	now: number,
): void {
	try { clock.stop(now); } catch { /* A concurrent stop already closed the clock. */ }
}

function abortableDelay(durationMs: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.reject(signal.reason);
	if (durationMs <= 0) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const timer = globalThis.setTimeout(resolve, durationMs);
		signal.addEventListener('abort', () => {
			globalThis.clearTimeout(timer);
			reject(signal.reason);
		}, { once: true });
	});
}

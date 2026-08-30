/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCaptureRuntimeAvailability, type CaptureFailure, type CapturePacket, type CaptureRuntimeAvailability, type CaptureSourceRole } from '../framescaper-capture-domain.ts';
import type { CapturePreviewLease, CapturePreviewSource } from '../platform/capture-source-port.ts';
import type { FramescaperCaptureOriginAuthority } from './framescaper-capture-origin-guard.ts';
import { createFramescaperCaptureActiveTimeClock } from './framescaper-capture-active-time-clock.ts';
import { createFramescaperCaptureDisplaySelection } from './framescaper-capture-display-selection.ts';
import { createFramescaperCaptureMetrics } from './framescaper-capture-metrics.ts';
import { findFramescaperCaptureRecovery } from './framescaper-capture-recovery-admission.ts';
import { applyCaptureSourceSettings, capturePreviewSourceSnapshots, createFramescaperCapturePreviewResources,
	disposeCapturePreviewOwnership, selectedCaptureDevices,
	type FramescaperCapturePreviewResources } from './framescaper-capture-preview-resources.ts';
import { captureSessionFailure, captureSessionInputGain, installCaptureSourceEndWatchers,
	safelyStopCaptureClock, waitForCaptureCountdown } from './framescaper-capture-session-runtime.ts';
import { createFramescaperCaptureStateMachine, type FramescaperCaptureArmOptions } from './framescaper-capture-state-machine.ts';
import type {
	FramescaperCaptureDurableSession, FramescaperCaptureRecorder, FramescaperCaptureSessionActions,
	FramescaperCaptureSessionService, FramescaperCaptureSessionServiceOptions,
	FramescaperCaptureSessionSnapshot, FramescaperCaptureSourceSettings, FramescaperCaptureStreamIdentity,
} from './framescaper-capture-session-types.ts';
interface ActiveRecorder<Stream, Track> {
	readonly source: Readonly<CapturePreviewSource<Stream, Track>>; readonly identity: Readonly<FramescaperCaptureStreamIdentity>;
	readonly recorder: FramescaperCaptureRecorder;
}

/** Owns one whole-session capture graph; sources and recorders settle together. */
export function createFramescaperCaptureSessionService<Stream = unknown, Track = unknown>(
	options: FramescaperCaptureSessionServiceOptions<Stream, Track>): FramescaperCaptureSessionService {
	const machine = createFramescaperCaptureStateMachine();
	const now = options.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
	const createId = options.createId ?? ((prefix) => `${prefix}-${globalThis.crypto.randomUUID()}`);
	const waitCountdown = options.waitCountdown ?? waitForCaptureCountdown;
	let previewLease: CapturePreviewLease<Stream, Track> | null = null;
	let previewResources: FramescaperCapturePreviewResources | null = null;
	let recorders: readonly ActiveRecorder<Stream, Track>[] = Object.freeze([]);
	let durableSession: FramescaperCaptureDurableSession | null = null;
	let clock: ReturnType<typeof createFramescaperCaptureActiveTimeClock> | null = null;
	let metrics: ReturnType<typeof createFramescaperCaptureMetrics> | null = null;
	let originAuthority: Readonly<FramescaperCaptureOriginAuthority> | null = null;
	let countdownAbort: AbortController | null = null;
	let startPromise: Promise<void> | null = null; let stopPromise: Promise<void> | null = null;
	let recoveryPromise: Promise<void> | null = null; let recoveryFinalizationPromise: Promise<void> | null = null;
	let initializePromise: Promise<void> | null = null; let disposePromise: Promise<void> | null = null;
	const pendingOperations = new Set<Promise<unknown>>();
	let monitoring = false; let inputGain = 1;
	let captureGeneration = 0; let disposed = false;
	let sourceEndCleanups: readonly (() => void)[] = Object.freeze([]);
	let devices: FramescaperCaptureSessionSnapshot['devices'] = Object.freeze([]);
	let selectedDeviceIds: FramescaperCaptureSessionSnapshot['selectedDeviceIds'] = Object.freeze({});
	const displaySelection = createFramescaperCaptureDisplaySelection(options.displaySelection, notify);
	function snapshot(): Readonly<FramescaperCaptureSessionSnapshot> {
		const state = machine.snapshot;
		const elapsedTimeMs = clock && state.phase !== 'inactive' ? clock.snapshot(now()).activeTimeMs : 0;
		const richSources = previewLease ? capturePreviewSourceSnapshots(previewLease.sources, previewResources) : state.sources;
		return Object.freeze({
			...state, sources: Object.freeze(richSources), devices, selectedDeviceIds,
			displaySelectionMode: displaySelection.mode, ...displaySelection.snapshot,
			monitoring, inputGain, elapsedTimeMs, setupDefaults: options.setupDefaults?.snapshot ?? Object.freeze({ destination: 'both' as const, countdownMs: 3_000 }),
			metrics: state.phase === 'inactive' ? Object.freeze([]) : metrics?.snapshot ?? Object.freeze([]),
		});
	}
	function notify(): void {
		try { options.onChange?.(); } catch { /* UI observers cannot own capture. */ }
	}
	function trackOperation<T>(operation: Promise<T>): Promise<T> {
		pendingOperations.add(operation);
		void operation.finally(() => { pendingOperations.delete(operation); }).catch(() => undefined);
		return operation;
	}
	function trackAction<T>(action: () => Promise<T>): Promise<T> { return trackOperation(Promise.resolve().then(action)); }
	async function joinOperations(): Promise<void> {
		await Promise.resolve();
		while (pendingOperations.size) await Promise.allSettled([...pendingOperations]);
	}
	function initialize(): Promise<void> {
		if (initializePromise) return initializePromise;
		assertActive();
		initializePromise = trackOperation((async () => {
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
			const recovery = await findFramescaperCaptureRecovery(
				options.durable, origin?.projectFence.projectId ?? null, options.recoveryProjectIds,
			);
			if (recovery) { await options.prepareRecoveryOrigin?.(recovery.projectFence.projectId); restoreRecovery(recovery); }
			notify();
		})());
		return initializePromise;
	}
	async function requestPreview(roles: readonly CaptureSourceRole[]): Promise<void> {
		assertActive();
		const sourceToken = await displaySelection.renewToken(roles);
		const previous = previewLease;
		const previousResources = previewResources;
		previewLease = null;
		previewResources = null;
		const previousDisposal = disposeCapturePreviewOwnership(previous, previousResources);
		const gesture = machine.issueDirectGesture();
		const requestGeneration = machine.requestPreview(gesture, roles);
		options.authorizeUserAction?.(gesture.generation);
		const previewRequest = {
			signal: new AbortController().signal,
			userActionGeneration: gesture.generation,
			roles,
			cameraDeviceId: selectedDeviceIds.camera,
			microphoneDeviceId: selectedDeviceIds.microphone,
		};
		const opening = options.displaySelection
			? Promise.resolve(options.displaySelection.authorize({
				generation: gesture.generation, roles, sourceToken,
			})).then(() => options.sourcePort.openPreview(previewRequest))
			: options.sourcePort.openPreview(previewRequest);
		notify();
		let openedLease: CapturePreviewLease<Stream, Track> | null = null;
		let openedResources: FramescaperCapturePreviewResources | null = null;
		try {
			await previousDisposal;
			openedLease = await opening;
			openedResources = await createFramescaperCapturePreviewResources(openedLease.sources, {
				createPreviewSurface: options.createPreviewSurface,
				createLevelMonitor: options.createLevelMonitor,
				onLevel: notify,
			});
			previewLease = openedLease;
			previewResources = openedResources;
			machine.previewReady(requestGeneration, openedLease.sources.map(({ sourceId, role }) => ({ sourceId, role })));
			selectedDeviceIds = selectedCaptureDevices(openedLease.sources, selectedDeviceIds);
			displaySelection.consume(sourceToken);
			notify();
			await refreshDeviceInventory(openedLease);
		} catch (error) {
			if (!openedLease) await opening.then((lease) => Promise.resolve(lease.dispose()).catch(() => undefined), () => undefined);
			else await disposeCapturePreviewOwnership(openedLease, openedResources).catch(() => undefined);
			if (previewLease === openedLease) previewLease = null;
			if (previewResources === openedResources) previewResources = null;
			clearDeviceInventory();
			machine.previewFailed(requestGeneration, captureSessionFailure(error, 'permission-denied'));
			notify();
			throw error;
		}
	}
	async function listDisplaySources(): Promise<void> {
		assertActive();
		if (!['inactive', 'previewing'].includes(machine.snapshot.phase)
			|| displaySelection.mode !== 'source-list') {
			throw new Error('Capture display source listing is unavailable.');
		}
		await displaySelection.list();
	}
	function selectDisplaySource(sourceToken: string): void {
		assertActive();
		if (!['inactive', 'previewing'].includes(machine.snapshot.phase)) {
			throw new Error('The selected display source is not in the current inventory.');
		}
		displaySelection.select(sourceToken);
	}
	async function selectDevice(role: 'camera' | 'microphone', deviceId: string): Promise<void> {
		assertActive();
		if (machine.snapshot.phase !== 'previewing') throw new Error('Capture devices can change only while previewing.');
		if (!devices.some((device) => device.kind === role && device.id === deviceId)) {
			throw new Error('The selected capture device is not in the permission-returned inventory.');
		}
		selectedDeviceIds = Object.freeze({ ...selectedDeviceIds, [role]: deviceId });
		await requestPreview(machine.snapshot.requestedRoles);
	}
	async function refreshDeviceInventory(owner: CapturePreviewLease<Stream, Track>): Promise<void> {
		try {
			const inventory = await options.sourcePort.enumerate({
				signal: new AbortController().signal,
				permissionGranted: true,
			});
			if (previewLease !== owner || machine.snapshot.phase !== 'previewing') return;
			devices = Object.freeze(inventory.devices.map((device) => Object.freeze({ ...device })));
			selectedDeviceIds = selectedCaptureDevices(owner.sources, selectedDeviceIds);
			notify();
		} catch {
			if (previewLease !== owner || machine.snapshot.phase !== 'previewing') return;
			devices = Object.freeze([]);
			notify();
		}
	}
	function clearDeviceInventory(): void {
		devices = Object.freeze([]);
		selectedDeviceIds = Object.freeze({});
		displaySelection.clear();
	}
	async function configureSource(
		sourceId: string,
		settings: Readonly<FramescaperCaptureSourceSettings>,
	): Promise<void> {
		assertActive();
		if (machine.snapshot.phase !== 'previewing' || !previewLease) {
			throw new Error('Capture source settings can change only while previewing.');
		}
		const source = previewLease.sources.find((candidate) => candidate.sourceId === sourceId);
		if (!source) throw new Error('The selected capture source is not active.');
		await applyCaptureSourceSettings(source.track, settings);
		notify();
	}
	async function release(): Promise<void> {
		assertActive();
		if (machine.snapshot.phase === 'armed') machine.disarm();
		machine.releasePreview();
		const lease = previewLease;
		const resources = previewResources;
		previewLease = null;
		previewResources = null;
		clearDeviceInventory();
		notify();
		await disposeCapturePreviewOwnership(lease, resources);
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
		if (Object.hasOwn(changes, 'inputGain')) inputGain = captureSessionInputGain(changes.inputGain);
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
		startPromise = trackOperation(beginRecording(captured, countdownAbort.signal));
		notify();
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
				sourceId: options.createSourceIdentity?.(source, createId) ?? createId(`${source.role}-capture-source`),
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
				recorders = Object.freeze([...created]);
			}
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
			sourceEndCleanups = installCaptureSourceEndWatchers(lease.sources, () => {
				reportActiveFailure(new Error('A required capture source ended.'));
			});
			const sharedStartActiveTimeUs = clock.snapshot(now()).activeTimeUs;
			machine.startRecording();
			for (const entry of recorders) await entry.recorder.start(sharedStartActiveTimeUs);
			notify();
		} catch (error) {
			if (signal.aborted && machine.snapshot.phase === 'finalizing') {
				const abandoned = durableSession;
				if (abandoned) {
					await options.durable.discard(abandoned);
					if (durableSession === abandoned) durableSession = null;
				}
				return;
			}
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
		const observedActiveTimeUs = clock.snapshot(now()).activeTimeUs;
		const next = await options.durable.append(durableSession, packet);
		durableSession = next;
		metrics.observe(packet, observedActiveTimeUs);
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
		await Promise.all(recorders.map(({ recorder }) => recorder.resume(Math.round(span.durationMs * 1_000))));
		notify();
	}
	function stop(): Promise<void> {
		assertActive();
		if (stopPromise) return stopPromise;
		machine.stop();
		countdownAbort?.abort(new DOMException('Capture countdown stopped.', 'AbortError'));
		stopPromise = trackOperation(stopAndFinalize());
		notify();
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
				clearSettledSession();
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
		if (disposed || recoveryPromise || stopPromise) return;
		recoveryPromise = recoverActive(error, 'encoder-failed');
		void recoveryPromise.catch(() => undefined);
	}
	function recoverActive(error: unknown, code: CaptureFailure['code']): Promise<void> {
		if (recoveryPromise) return recoveryPromise;
		const phase = machine.snapshot.phase;
		if (!['countdown', 'recording', 'paused', 'finalizing'].includes(phase)) return Promise.resolve();
		machine.enterRecovery(captureSessionFailure(error, code));
		countdownAbort?.abort(error);
		recoveryPromise = trackOperation(Promise.resolve().then(completeActiveRecovery));
		notify();
		return recoveryPromise;
	}
	async function completeActiveRecovery(): Promise<void> {
		if (clock) safelyStopCaptureClock(clock, now());
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
		machine.fail(captureSessionFailure(error, 'encoder-failed'));
		releaseOrigin('stopped');
		notify();
	}
	function finalizeRecovery(provenance: 'recovered' | 'import-as-is'): Promise<void> {
		assertActive();
		if (recoveryFinalizationPromise) return recoveryFinalizationPromise;
		if (!durableSession) throw new Error('No recoverable Framescaper capture is selected.');
		machine.beginRecoveryFinalization();
		recoveryFinalizationPromise = trackOperation(
			Promise.resolve().then(() => completeRecoveryFinalization(provenance)));
		notify();
		return recoveryFinalizationPromise;
	}

	async function completeRecoveryFinalization(provenance: 'recovered' | 'import-as-is'): Promise<void> {
		try {
			if (!durableSession) throw new Error('No recoverable Framescaper capture is selected.');
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
			machine.enterRecovery(captureSessionFailure(error, 'finalization-failed'));
			recoveryFinalizationPromise = null;
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
		const resources = previewResources;
		previewLease = null;
		previewResources = null;
		clearDeviceInventory();
		await disposeCapturePreviewOwnership(lease, resources).catch(() => undefined);
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
		recoveryFinalizationPromise = null;
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
		await joinOperations();
	}

	function dispose(): Promise<void> {
		if (disposePromise) return disposePromise;
		disposed = true;
		countdownAbort?.abort(new DOMException('Capture controller disposed.', 'AbortError'));
		disposePromise = disposeSession();
		return disposePromise;
	}

	async function disposeSession(): Promise<void> {
		await joinOperations();
		if (['countdown', 'recording', 'paused', 'finalizing'].includes(machine.snapshot.phase)) {
			await recoverActive(new Error('Capture runtime closed.'), 'runtime-lost');
		} else if (previewLease) {
			await disposeCapturePreviewOwnership(previewLease, previewResources);
			previewLease = null;
			previewResources = null;
			clearDeviceInventory();
		}
		await joinOperations();
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
		requestPreview: (roles: readonly CaptureSourceRole[]) => trackAction(() => requestPreview(roles)),
		listDisplaySources: () => trackAction(listDisplaySources),
		selectDisplaySource,
		selectDevice: (role: 'camera' | 'microphone', deviceId: string) => trackAction(() => selectDevice(role, deviceId)),
		configureSource: (sourceId: string, settings: Readonly<FramescaperCaptureSourceSettings>) => trackAction(() => configureSource(sourceId, settings)),
		release: () => trackAction(release),
		configure, setSetupDefaults: (changes: Parameters<FramescaperCaptureSessionActions['setSetupDefaults']>[0]) => options.setupDefaults?.update(changes),
		arm,
		start,
		pause: () => trackAction(pause),
		resume: () => trackAction(resume),
		stop,
		recover: () => finalizeRecovery('recovered'),
		importAsIs: () => finalizeRecovery('import-as-is'),
		discard: () => trackAction(discard),
		resetFailure, sealForShutdown: () => recoverActive(new Error('Capture runtime is shutting down.'), 'runtime-lost'),
	});
	return Object.freeze({
		get snapshot() { return snapshot(); },
		actions,
		setRuntimeAvailability(value: CaptureRuntimeAvailability) { machine.setRuntimeAvailability(value); notify(); },
		initialize,
		settled,
		dispose,
	});
}

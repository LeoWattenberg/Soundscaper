/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CaptureDestination, CapturePhase } from '../framescaper-capture-domain.ts';
import { constrainWebVcrCropToAspect } from '../web-vcr-geometry.ts';
import {
	WEB_VCR_RESOLUTIONS,
	normalizeWebVcrAspect,
	normalizeWebVcrCommandV1,
	normalizeWebVcrNormalizedCrop,
	normalizeWebVcrResolution,
	normalizeWebVcrSnapshot,
	type WebVcrAspect,
	type WebVcrCapability,
	type WebVcrDimensions,
	type WebVcrLifecyclePhase,
	type WebVcrNormalizedCrop,
	type WebVcrResolution,
	type WebVcrSnapshot,
} from '../web-vcr-domain.ts';
import { isWebVcrRecoveryOwner } from './framescaper-capture-source-adapter-router.ts';
import { clearFramescaperWebVcrBrowserData } from './framescaper-web-vcr-data-clear.ts';
import { finalizeFramescaperWebVcrCapture, recoverFramescaperWebVcrStartFailure } from './framescaper-web-vcr-finalizer.ts';
import { evaluateFramescaperWebVcrTakeObservation, freezeFramescaperWebVcrTake,
	type FramescaperWebVcrFrozenTake } from './framescaper-web-vcr-take-authority.ts';
import { createFramescaperWebVcrUiSnapshot } from './framescaper-web-vcr-ui-snapshot.ts';
import type {
	FramescaperWebVcrActions,
	FramescaperWebVcrCaptureAuthority,
	FramescaperWebVcrController,
	FramescaperWebVcrControllerOptions,
	FramescaperWebVcrUiSnapshot,
	WebVcrCaptureState,
	WebVcrCommandInput,
	WebVcrDispatchResult,
	WebVcrSessionReference,
} from './framescaper-web-vcr-controller-types.ts';
import type { WebVcrAudioMonitor } from './web-vcr-audio-monitor.ts';
import { createFramescaperWebVcrSnapshotOrder } from './framescaper-web-vcr-snapshot-order.ts';
export type {
	FramescaperWebVcrActions,
	FramescaperWebVcrBridgeV1,
	FramescaperWebVcrCaptureAdapterControl,
	FramescaperWebVcrCaptureAuthority,
	FramescaperWebVcrController,
	FramescaperWebVcrControllerOptions,
	FramescaperWebVcrUiSnapshot,
} from './framescaper-web-vcr-controller-types.ts';

/** Coordinates the remote guest with one existing 8A capture-session authority. */
export function createFramescaperWebVcrController(
	options: FramescaperWebVcrControllerOptions,
): Readonly<FramescaperWebVcrController> {
	const bridge = options.bridge ?? null;
	const snapshotOrder = createFramescaperWebVcrSnapshotOrder();
	let capability: WebVcrCapability = Object.freeze({ status: 'checking' });
	let host: Readonly<WebVcrSnapshot> | null = null;
	let modeActive = false;
	let opening = false;
	let localFailure: string | null = null;
	let monitor: Readonly<WebVcrAudioMonitor> | null = null;
	let dimensions: Readonly<{ readonly inputSize: Readonly<WebVcrDimensions>; readonly outputSize: Readonly<WebVcrDimensions> }> | null = null;
	let initialized = false;
	let disposed = false;
	let unsubscribe: (() => void) | null = null;
	let activatePromise: Promise<void> | null = null;
	let recordPromise: Promise<void> | null = null;
	let stopPromise: Promise<void> | null = null;
	let sealPromise: Promise<void> | null = null;
	let hostRecoveryPromise: Promise<void> | null = null;
	let hostRecoveryRequested = false;
	let recoveryObserved = false;
	let recoveryCleanupPromise: Promise<void> | null = null;
	let frozen: Readonly<FramescaperWebVcrFrozenTake> | null = null;
	function notify(): void {
		try { options.onChange?.(); } catch { /* UI observers cannot own capture. */ }
	}
	function capture() { return options.getCapture(); }
	function recoveryOwned(): boolean {
		const value = capture().snapshot;
		return value.phase === 'recovery' && value.sources.length > 0
			&& value.sources.every(({ sourceId }) => isWebVcrRecoveryOwner(sourceId));
	}
	function activeCapturePhase(): CapturePhase {
		return capture().snapshot.phase;
	}
	function uiPhase(): WebVcrLifecyclePhase {
		const phase = activeCapturePhase();
		if (recoveryOwned()) return 'recovery';
		if (modeActive) {
			if (frozen && phase === 'previewing') return 'preparing';
			if (phase === 'permission-pending' || phase === 'armed' || phase === 'countdown') return 'preparing';
			if (phase === 'recording' || phase === 'paused') return 'recording';
			if (phase === 'finalizing') return 'finalizing';
			if (phase === 'recovery') return 'recovery';
			if (phase === 'failed') return 'failed';
		}
		if (opening) return 'opening';
		if (localFailure || host?.phase === 'failed') return 'failed';
		return modeActive && host ? 'ready' : 'closed';
	}
	function uiSnapshot(): Readonly<FramescaperWebVcrUiSnapshot> {
		const source = modeActive
			? capture().snapshot.sources.find(({ role }) => role === 'display')
			: undefined;
		return createFramescaperWebVcrUiSnapshot({
			capability,
			phase: uiPhase(),
			modeActive: modeActive || recoveryOwned(),
			host,
			dimensions,
			previewStream: source?.previewStream,
			failure: localFailure ?? host?.failure
				?? (modeActive ? capture().snapshot.failure?.message ?? null : null),
		});
	}

	async function initialize(): Promise<void> {
		if (initialized) return;
		initialized = true;
		if (!options.enabled) capability = unavailable('roadmap-gate');
		else if (!bridge) capability = unavailable('desktop-bridge-unavailable');
		else if (!options.cropRuntimeAvailable) capability = unavailable('crop-pipeline-unavailable');
		else {
			try {
				const handshake = await bridge.handshake();
				if (handshake.version !== 1 || handshake.capability.status === 'checking') {
					throw new Error('Web VCR desktop handshake is incomplete.');
				}
				capability = handshake.capability.status === 'available'
					? Object.freeze({
						status: 'available',
						resolutions: Object.freeze(handshake.capability.resolutions.filter((value) => (
							WEB_VCR_RESOLUTIONS.includes(value)
						))),
					})
					: handshake.capability;
				unsubscribe = bridge.subscribe(receiveHostSnapshot);
			} catch (error) {
				capability = unavailable('desktop-bridge-unavailable', errorMessage(error));
				warn(error);
			}
		}
		recoveryObserved = recoveryOwned();
		notify();
	}

	function activate(): Promise<void> {
		assertOperational();
		if (activatePromise) return activatePromise;
		const operation = activateReserved();
		activatePromise = operation;
		void operation.finally(() => { if (activatePromise === operation) activatePromise = null; }).catch(() => undefined);
		return operation;
	}

	async function activateReserved(): Promise<void> {
		assertAvailable();
		if (recoveryOwned()) {
			modeActive = true;
			options.showPanel?.();
			notify();
			return;
		}
		if (modeActive && host) {
			options.showPanel?.();
			await dispatch({ kind: 'set-visibility', visible: true });
			if (activeCapturePhase() === 'inactive') {
				options.adapter.select('web-vcr');
				await capture().actions.requestPreview(['display', 'system-audio']);
			}
			return;
		}
		const phase = activeCapturePhase();
		if (phase === 'previewing') await capture().actions.release();
		else if (phase !== 'inactive') throw new Error('Web VCR cannot replace active capture work.');
		options.adapter.select('web-vcr');
		modeActive = true;
		opening = true;
		localFailure = null;
		dimensions = null;
		options.showPanel?.();
		notify();
		try {
			host = normalizeWebVcrSnapshot(await bridge!.open({ resolution: '1080p' }));
			await capture().actions.requestPreview(['display', 'system-audio']);
		} catch (error) {
			localFailure = errorMessage(error);
			warn(error);
			throw error;
		} finally {
			opening = false;
			notify();
		}
	}

	async function close(): Promise<void> {
		assertOperational();
		if (!modeActive && !recoveryOwned()) return;
		if (captureWorkActive(activeCapturePhase()) || recoveryOwned()) {
			if (host) await dispatch({ kind: 'set-visibility', visible: false });
			options.hidePanel?.();
			notify();
			return;
		}
		if (activeCapturePhase() === 'previewing') await capture().actions.release();
		const reference = sessionReference();
		if (reference) await bridge?.dispose(reference);
		options.adapter.select('devices');
		modeActive = false;
		host = null;
		dimensions = null;
		frozen = null;
		monitor = null;
		options.hidePanel?.();
		notify();
	}

	function record(): Promise<void> {
		assertOperational();
		if (recordPromise) return recordPromise;
		let resolve!: () => void;
		let reject!: (error: unknown) => void;
		const operation = new Promise<void>((accept, decline) => { resolve = accept; reject = decline; });
		recordPromise = operation;
		void recordReserved().then(resolve, reject);
		void operation.finally(() => { if (recordPromise === operation) recordPromise = null; }).catch(() => undefined);
		return operation;
	}

	async function recordReserved(): Promise<void> {
		assertAvailable();
		if (!modeActive || !host || host.navigation.isLoading || uiPhase() !== 'ready' || activeCapturePhase() !== 'previewing') {
			throw new Error('Web VCR is not ready to record.');
		}
		if (host.autoCrop && !host.target) {
			throw new Error('Web VCR automatic crop requires an exact page media target.');
		}
		if (host.target?.mediaState === 'ended') throw new Error('Web VCR media has already ended.');
		const admission = options.startAdmission.begin('background');
		let captureAdmissionStarted = false;
		try {
			frozen = freezeFramescaperWebVcrTake(host, requiredSessionReference());
			options.adapter.freezeCrop(host.crop);
			const defaults = capture().snapshot.setupDefaults;
			const destination: CaptureDestination = defaults?.destination ?? 'both';
			hostRecoveryRequested = false;
			notify();
			await admission.prepare();
			if (!host || evaluateFramescaperWebVcrTakeObservation(frozen, host, activeCapturePhase()) === 'authority-changed') {
				throw new Error('Web VCR guest authority changed during start admission.');
			}
			captureAdmissionStarted = true;
			await setHostCaptureState('preparing', frozen.recordingToken);
			capture().actions.arm({ destination, countdownMs: defaults?.countdownMs ?? 3_000 });
			await capture().actions.start();
			if (activeCapturePhase() === 'recording') await setHostCaptureState('recording');
		} catch (error) {
			if (!captureAdmissionStarted) {
				frozen = null;
				notify();
				throw error;
			}
			await recoverFramescaperWebVcrStartFailure({
				failure: error, capturePhase: activeCapturePhase,
				sealCapture: () => capture().actions.sealForShutdown(),
				enterHostRecovery: ensureHostRecovery,
				async enterHostReady() { await setHostCaptureState('ready'); hostRecoveryRequested = false; },
			}).finally(() => { frozen = null; notify(); });
		} finally { admission.release(); }
		notify();
	}

	function stopAndImport(): Promise<void> {
		assertOperational();
		if (stopPromise) return stopPromise;
		const operation = stopReserved();
		stopPromise = operation;
		void operation.finally(() => { if (stopPromise === operation) stopPromise = null; }).catch(() => undefined);
		return operation;
	}

	async function stopReserved(): Promise<void> {
		if (!['countdown', 'recording', 'paused'].includes(activeCapturePhase())) {
			throw new Error('Web VCR has no active recording to stop.');
		}
		try {
			await finalizeFramescaperWebVcrCapture({
				capturePhase: activeCapturePhase,
				enterHostFinalizing: () => setHostCaptureState('finalizing'),
				stopCapture: () => capture().actions.stop(),
				sealCapture: () => capture().actions.sealForShutdown(),
				enterHostRecovery: ensureHostRecovery,
				async enterHostReady() { await setHostCaptureState('ready'); hostRecoveryRequested = false; },
				restorePreview: () => modeActive && host?.visible !== false
					? capture().actions.requestPreview(['display', 'system-audio']) : undefined,
			});
		} finally {
			frozen = null;
			dimensions = null;
			notify();
		}
	}

	async function clearBrowserData(): Promise<void> {
		assertReadyControls();
		const resolution = host!.resolution;
		const reference = requiredSessionReference();
		await clearFramescaperWebVcrBrowserData({
			resolution,
			releasePreview: () => activeCapturePhase() === 'previewing'
				? capture().actions.release() : Promise.resolve(),
			async requestConfirmation() {
				const result = await dispatchResult({ kind: 'request-data-clear' });
				if (result.kind !== 'data-clear-confirmation') throw new Error('Web VCR did not return a browser-data confirmation.');
				return result.nonce;
			},
			invalidateGuest() { host = null; dimensions = null; monitor?.dispose(); monitor = null; },
			async clear(nonce) {
				const command = normalizeWebVcrCommandV1({ ...reference, kind: 'clear-browser-data', confirmationNonce: nonce });
				const result = await bridge!.dispatch(command);
				if (result.kind !== 'snapshot') throw new Error('Web VCR browser-data clear did not return a snapshot.');
				return result.snapshot;
			},
			async reopen(value) { modeActive = true; options.adapter.select('web-vcr'); return bridge!.open({ resolution: value }); },
			accept: receiveHostSnapshot,
			restorePreview: restorePreviewAfterControlFailure,
			warn,
		});
	}

	async function setResolution(resolutionValue: WebVcrResolution): Promise<void> {
		assertReadyControls();
		const resolution = normalizeWebVcrResolution(resolutionValue);
		if (capability.status !== 'available' || resolution === '4k'
			|| !capability.resolutions.includes(resolution)) {
			throw new Error('Web VCR resolution is unavailable.');
		}
		const previous = host!.resolution;
		if (resolution === previous) return;
		if (activeCapturePhase() === 'previewing') await capture().actions.release();
		try {
			await dispatch({ kind: 'set-resolution', resolution });
			await capture().actions.requestPreview(['display', 'system-audio']);
		} catch (error) {
			if (activeCapturePhase() === 'failed') capture().actions.resetFailure();
			try {
				if (host?.resolution !== previous) await dispatch({ kind: 'set-resolution', resolution: previous });
				await restorePreviewAfterControlFailure();
			} catch (rollbackError) { warn(rollbackError); }
			throw error;
		}
	}
	async function setAspect(value: WebVcrAspect): Promise<void> {
		assertReadyControls();
		if (host!.autoCrop) throw new Error('Web VCR aspect is locked during automatic crop.');
		const aspect = normalizeWebVcrAspect(value);
		await dispatch({ kind: 'set-crop', crop: constrainWebVcrCropToAspect(host!.crop, aspect, host!.captureSurface), aspect });
	}
	async function setCrop(value: Readonly<WebVcrNormalizedCrop>): Promise<void> {
		assertReadyControls();
		if (host!.autoCrop) throw new Error('Web VCR manual crop is locked during automatic crop.');
		await dispatch({ kind: 'set-crop', crop: normalizeWebVcrNormalizedCrop(value), aspect: host!.aspect });
	}

	async function restorePreviewAfterControlFailure(): Promise<void> {
		if (activeCapturePhase() === 'failed') capture().actions.resetFailure();
		if (modeActive && host?.sessionId && activeCapturePhase() === 'inactive') {
			await capture().actions.requestPreview(['display', 'system-audio']);
		}
	}
	async function dispatch(
		value: WebVcrCommandInput,
	): Promise<void> {
		const result = await dispatchResult(value);
		if (result.kind !== 'snapshot') throw new Error('Web VCR command did not return a snapshot.');
		receiveHostSnapshot(result.snapshot);
	}

	async function dispatchResult(value: WebVcrCommandInput): Promise<Readonly<WebVcrDispatchResult>> {
		assertOperational();
		if (!bridge) throw new Error('Web VCR desktop bridge is unavailable.');
		const command = normalizeWebVcrCommandV1({ ...requiredSessionReference(), ...value });
		return bridge.dispatch(command);
	}

	function receiveHostSnapshot(value: Readonly<WebVcrSnapshot>): void {
		if (disposed) return;
		let next: Readonly<WebVcrSnapshot>;
		try { next = normalizeWebVcrSnapshot(value); }
		catch (error) { reportFailure(error); return; }
		if (!snapshotOrder.accept(next)) return;
		const active = frozen;
		if (active && captureWorkActive(activeCapturePhase())) {
			const observation = evaluateFramescaperWebVcrTakeObservation(active, next, activeCapturePhase());
			if (observation === 'authority-changed') {
				sealActive('Web VCR guest authority changed during capture.');
			}
			else if (observation === 'exact-ended') void stopAndImport().catch(warn);
		}
		if (next.phase === 'closed') {
			host = null;
			dimensions = null;
			monitor?.dispose();
			monitor = null;
			if (!captureWorkActive(activeCapturePhase()) && !recoveryOwned()) {
				modeActive = false;
				frozen = null;
				options.adapter.select('devices');
			}
		} else {
			host = next;
			options.adapter.setMonitorMuted?.(next.monitorMuted);
		}
		notify();
	}
	function sealActive(message: string): void {
		if (sealPromise || !captureWorkActive(activeCapturePhase())) return;
		localFailure = message;
		sealPromise = sealForShutdown()
			.catch(warn)
			.finally(() => { sealPromise = null; notify(); });
	}
	function reportFailure(error: unknown): void {
		localFailure = errorMessage(error);
		if (captureWorkActive(activeCapturePhase())) sealActive(localFailure);
		warn(error);
		notify();
	}

	function warn(error: unknown): void {
		try { options.onWarning?.(error); } catch { /* Warning sinks cannot own capture. */ }
	}
	function attachMonitor(value: Readonly<WebVcrAudioMonitor>): () => void {
		monitor = value;
		value.setMuted(host?.monitorMuted ?? false);
		return () => { if (monitor === value) monitor = null; };
	}

	function reportDimensions(value: Readonly<{ readonly inputSize: Readonly<WebVcrDimensions>;
		readonly outputSize: Readonly<WebVcrDimensions> }>): void {
		if (!frozen || value.inputSize.width !== frozen.surface.width
			|| value.inputSize.height !== frozen.surface.height
			|| value.outputSize.width !== frozen.output.width
			|| value.outputSize.height !== frozen.output.height) {
			throw new Error('Web VCR first frame does not match the frozen capture surface and crop geometry.');
		}
		dimensions = Object.freeze({ inputSize: Object.freeze({ ...value.inputSize }), outputSize: Object.freeze({ ...value.outputSize }) });
		notify();
	}

	async function prepareCapture(): Promise<void> {
		assertReadyReference();
		await bridge!.prepareCapture(requiredSessionReference());
	}

	async function setHostCaptureState(
		state: WebVcrCaptureState,
		recordingToken?: string,
	): Promise<void> {
		if (!bridge) throw new Error('Web VCR desktop bridge is unavailable.');
		if (state === 'preparing' && !recordingToken) throw new Error('Web VCR recording token is unavailable.');
		const reference = requiredSessionReference();
		const accepted = state === 'preparing'
			? await bridge.setCaptureState({ ...reference, state, recordingToken: recordingToken! })
			: await bridge.setCaptureState({ ...reference, state });
		if (!accepted) throw new Error(`Web VCR desktop host rejected the ${state} capture transition.`);
	}

	function ensureHostRecovery(): Promise<void> {
		if (hostRecoveryRequested) return hostRecoveryPromise ?? Promise.resolve();
		hostRecoveryRequested = true;
		hostRecoveryPromise = setHostCaptureState('recovery')
			.catch((error) => { hostRecoveryRequested = false; throw error; })
			.finally(() => { hostRecoveryPromise = null; });
		return hostRecoveryPromise;
	}

	function synchronizeCapture(): void {
		const ownedRecovery = recoveryOwned();
		if (ownedRecovery) {
			recoveryObserved = true;
			if (modeActive && host) void ensureHostRecovery().catch(warn);
		}
		if (!recoveryObserved || activeCapturePhase() !== 'inactive' || recoveryCleanupPromise) return;
		recoveryObserved = false;
		recoveryCleanupPromise = cleanupResolvedRecovery().finally(() => {
			recoveryCleanupPromise = null;
			notify();
		});
	}

	async function cleanupResolvedRecovery(): Promise<void> {
		const reference = sessionReference();
		if (reference) {
			await setHostCaptureState('ready').catch(warn);
			hostRecoveryRequested = false;
			await bridge?.dispose(reference);
		}
		options.adapter.select('devices');
		modeActive = false;
		host = null;
		frozen = null;
		dimensions = null;
	}

	async function sealForShutdown(): Promise<void> {
		await capture().actions.sealForShutdown();
		if (recoveryOwned() && modeActive && host) await ensureHostRecovery();
	}

	async function dispose(): Promise<void> {
		if (disposed) return;
		disposed = true;
		unsubscribe?.();
		unsubscribe = null;
		monitor?.dispose();
		monitor = null;
		const reference = sessionReference();
		if (reference) await bridge?.dispose(reference);
	}

	function assertReadyReference(): void {
		assertAvailable();
		if (!modeActive || !host) throw new Error('Web VCR guest is not open.');
	}
	function assertReadyControls(): void {
		assertReadyReference();
		if (uiPhase() !== 'ready') throw new Error('Web VCR controls are locked during capture.');
	}
	function sessionReference(): WebVcrSessionReference | null {
		return host?.sessionId ? Object.freeze({ version: 1, sessionId: host.sessionId, generation: host.generation }) : null;
	}
	function requiredSessionReference(): WebVcrSessionReference {
		const reference = sessionReference();
		if (!reference) throw new Error('Web VCR session reference is unavailable.');
		return reference;
	}
	function assertAvailable(): void {
		if (capability.status !== 'available' || !capability.resolutions.includes('1080p')) {
			throw new Error('Web VCR is unavailable.');
		}
	}

	function assertOperational(): void {
		if (disposed) throw new Error('Web VCR controller is disposed.');
	}

	const command = (value: WebVcrCommandInput) => { assertReadyControls(); return dispatch(value); };
	const actions: Readonly<FramescaperWebVcrActions> = Object.freeze({
		activate,
		close,
		navigate: (url: string) => command({ kind: 'navigate', url }),
		back: () => command({ kind: 'go-back' }),
		forward: () => command({ kind: 'go-forward' }),
		reload: () => command({ kind: 'reload' }),
		setResolution,
		setAutoCrop: (enabled: boolean) => command({ kind: 'set-auto-crop', enabled }),
		setAspect,
		setCrop,
		async setMonitorMuted(muted: boolean) {
			assertReadyReference();
			monitor?.setMuted(muted);
			await dispatch({ kind: 'set-monitor-muted', muted });
		},
		setAutoStop: (enabled: boolean) => command({ kind: 'set-auto-stop', enabled }),
		sendPointerInput: (input: Parameters<FramescaperWebVcrActions['sendPointerInput']>[0]) => command({ kind: 'pointer-input', ...input }),
		sendKeyInput: (input: Parameters<FramescaperWebVcrActions['sendKeyInput']>[0]) => command({ kind: 'key-input', ...input }),
		record,
		stopAndImport,
		clearBrowserData,
	});
	const captureAuthority: Readonly<FramescaperWebVcrCaptureAuthority> = Object.freeze({
		prepareCapture,
		captureSurface() { if (!frozen && !host) throw new Error('Web VCR capture surface is unavailable.'); return frozen?.surface ?? host!.captureSurface; },
		attachMonitor,
		reportDimensions,
		reportFailure,
	});
	return Object.freeze({
		get snapshot() { return uiSnapshot(); },
		actions,
		captureAuthority,
		initialize,
		synchronizeCapture,
		sealForShutdown,
		dispose,
	});
}

function unavailable(reason: 'roadmap-gate' | 'desktop-bridge-unavailable' | 'crop-pipeline-unavailable', detail: string | null = null): WebVcrCapability {
	return Object.freeze({ status: 'unavailable', reason, detail });
}

function captureWorkActive(phase: CapturePhase): boolean {
	return ['armed', 'countdown', 'recording', 'paused', 'finalizing'].includes(phase);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

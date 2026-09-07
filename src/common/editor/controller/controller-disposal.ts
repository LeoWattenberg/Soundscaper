/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_PROJECT_CHANGED_CODE, type EditorControllerLifetime, type EditorControllerPhase } from './lifecycle.ts';

type Cleanup = () => unknown;
interface DisposalState {
	disposed: boolean;
	phase: EditorControllerPhase;
	exportGeneration: number;
	exportAbort: unknown;
	sourceGcTimer: number;
	audacityEffectWorker: { terminate(): void } | null;
	spectralWorker: { terminate(): void } | null;
	nyquistAbort: unknown;
	readonly projectQueue: PromiseLike<unknown>;
	readonly outputUrl: string | null;
	readonly outputCleanup: Cleanup | null;
}

export interface ControllerDisposalDependencies {
	readonly lifetime: EditorControllerLifetime;
	readonly state: DisposalState;
	readonly clearDiagnostics: Cleanup;
	readonly clearTaskProgress: Cleanup;
	readonly closeInspections: Cleanup;
	readonly drainInspections: Cleanup;
	readonly publish: Cleanup;
	readonly clearDocumentChannel: Cleanup;
	readonly clearTelemetryChannel: Cleanup;
	readonly removeDeviceChangeListener: Cleanup;
	readonly disposeCapture: Cleanup;
	readonly disposeCaptureProxy: Cleanup;
	readonly disposeOpenRecovery: Cleanup;
	readonly invalidateProject: Cleanup;
	readonly disposeVisuals: Cleanup;
	readonly unsubscribeEngineErrors: Cleanup;
	readonly cancelTimedRecording: Cleanup;
	readonly cancelRecordingStart: Cleanup;
	readonly cancelScheduledSave: Cleanup;
	readonly clearSourceGcTimer: Cleanup;
	readonly cancelPlaybackPreparation: Cleanup;
	readonly cancelPlayAtSpeedPreparation: Cleanup;
	readonly stopMetronome: Cleanup;
	readonly cancelEffectWorkers: Cleanup;
	readonly disposeNyquist: Cleanup;
	readonly cancelEffectPreview: Cleanup;
	readonly disposeMicrophoneMeter: Cleanup;
	readonly terminalFlush: Cleanup;
	readonly stopRecording: Cleanup;
	readonly disposeCapturePool: Cleanup;
	readonly releaseProjectLock: Cleanup;
	readonly revokeOutputUrl: (url: string) => unknown;
	readonly disposeProjectBin: Cleanup;
	readonly disposeAudioWarp: Cleanup;
	readonly disposeTakeComp: Cleanup;
	readonly disposeRenderEngines: Cleanup;
	readonly disposeCodec: Cleanup;
	readonly disposeNativeProject: Cleanup;
	readonly disposeTimePitchCache: Cleanup;
	readonly disposeSession: Cleanup;
	readonly disposeEngine: Cleanup;
	readonly clearSourceBuffers: Cleanup;
	readonly clearSourceProviders: Cleanup;
	readonly drainSourceProviders: Cleanup;
	readonly clearSourcePeaks: Cleanup;
	readonly clearWaveformCaches: Cleanup;
	readonly closeStore: Cleanup;
}

/** Own disposal ordering, failure isolation, and the source-reader retirement barrier. */
export function createControllerDisposal(d: ControllerDisposalDependencies): () => Promise<void> {
	let pending: Promise<void> | undefined;
	return () => {
		if (pending) return pending;
		let resolve!: () => void;
		let reject!: (reason: unknown) => void;
		const promise = new Promise<void>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
		// Publish only after caching the promise: subscribers may reenter dispose.
		pending = promise;
		let failed = false, failure: unknown, sourceRetirementBlocked = false;
		const record = (error: unknown, fencesSources = false): void => {
			if (!failed) { failed = true; failure = error; }
			if (fencesSources) sourceRetirementBlocked = true;
		};
		const cleanup = async (operation: Cleanup, fencesSources = false): Promise<void> => {
			try { await operation(); } catch (error) { record(error, fencesSources); }
		};
		const immediate = (operation: Cleanup): void => {
			try { operation(); } catch (error) { record(error); }
		};
		immediate(() => d.lifetime.beginDisposal());
		d.state.disposed = true;
		d.state.phase = d.lifetime.phase;
		immediate(d.closeInspections);
		immediate(d.clearTaskProgress);
		immediate(d.clearDiagnostics);
		immediate(d.publish);
		void run().then(resolve, reject);
		return promise;

		async function run(): Promise<void> {
			await cleanup(d.removeDeviceChangeListener);
			// Each rejection is handled independently; Promise.all cannot return
			// before the other producer finishes after one producer fails.
			await Promise.all([cleanup(d.disposeCapture, true), cleanup(d.disposeCaptureProxy, true)]);
			await cleanup(d.disposeOpenRecovery, true);
			await cleanup(d.invalidateProject);
			const visuals = cleanup(d.disposeVisuals, true);
			// Archive inspections own external file readers, not stored PCM readers.
			// Their timeout/close failures must not strand the project database.
			const inspections = cleanup(d.drainInspections);
			await cleanup(d.unsubscribeEngineErrors);
			await cleanup(d.cancelTimedRecording);
			await cleanup(d.cancelRecordingStart);
			d.state.exportGeneration += 1;
			d.state.exportAbort = null;
			await cleanup(d.cancelScheduledSave);
			await cleanup(d.clearSourceGcTimer);
			d.state.sourceGcTimer = 0;
			await cleanup(d.cancelPlaybackPreparation);
			await cleanup(d.cancelPlayAtSpeedPreparation);
			await cleanup(d.stopMetronome);
			await cleanup(d.cancelEffectWorkers, true);
			await cleanup(() => d.state.audacityEffectWorker?.terminate(), true);
			d.state.audacityEffectWorker = null;
			d.state.nyquistAbort = null;
			await cleanup(d.disposeNyquist, true);
			await cleanup(d.cancelEffectPreview, true);
			await cleanup(() => d.state.spectralWorker?.terminate(), true);
			d.state.spectralWorker = null;
			await cleanup(d.disposeMicrophoneMeter);
			await inspections;
			await cleanup(() => d.state.projectQueue, true);
			await cleanup(d.terminalFlush);
			await cleanup(async () => {
				try { await d.stopRecording(); }
				catch (error) {
					if (!error || typeof error !== 'object' || !('code' in error) || error.code !== EDITOR_PROJECT_CHANGED_CODE) throw error;
				}
			}, true);
			await cleanup(d.disposeCapturePool, true);
			await cleanup(d.releaseProjectLock);
			const outputUrl = d.state.outputUrl;
			if (outputUrl) await cleanup(() => d.revokeOutputUrl(outputUrl));
			await cleanup(() => d.state.outputCleanup?.());
			await cleanup(d.disposeProjectBin, true);
			await cleanup(d.disposeAudioWarp, true);
			await cleanup(d.disposeTakeComp, true);
			await cleanup(d.disposeRenderEngines, true);
			await cleanup(d.disposeCodec, true);
			await cleanup(d.disposeNativeProject, true);
			await cleanup(d.disposeTimePitchCache, true);
			await cleanup(d.disposeSession);
			await cleanup(d.disposeEngine, true);
			await visuals;
			if (!sourceRetirementBlocked) {
				await cleanup(d.clearSourceBuffers, true);
				await cleanup(d.clearSourceProviders, true);
				await cleanup(d.drainSourceProviders, true);
				await cleanup(d.clearSourcePeaks);
			}
			await cleanup(d.clearWaveformCaches);
			if (!sourceRetirementBlocked) await cleanup(d.closeStore);
			await cleanup(() => d.lifetime.finishDisposal());
			d.state.phase = d.lifetime.phase;
			await cleanup(d.publish);
			await cleanup(d.clearDocumentChannel);
			await cleanup(d.clearTelemetryChannel);
			if (failed) throw failure;
		}
	};
}

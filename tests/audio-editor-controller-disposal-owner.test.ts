/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createControllerDisposal, type ControllerDisposalDependencies } from '../src/common/editor/controller/composition/controller-disposal.ts';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';

function fixture() {
	const calls: string[] = [];
	const lifetime = new EditorControllerLifetime();
	const state = { disposed: false, phase: lifetime.phase, exportGeneration: 0, exportAbort: null,
		sourceGcTimer: 0, audacityEffectWorker: null, spectralWorker: null, nyquistAbort: null,
		projectQueue: Promise.resolve(), outputUrl: null, outputCleanup: null };
	const step = (name: string) => () => { calls.push(name); };
	const dependencies: ControllerDisposalDependencies = {
		lifetime, state, clearDiagnostics: step('diagnostics'), clearTaskProgress: step('progress'),
		closeInspections: step('close-inspections'), drainInspections: step('drain-inspections'),
		publish: step('publish'), clearDocumentChannel: step('document-channel'), clearTelemetryChannel: step('telemetry-channel'),
		removeDeviceChangeListener: step('devices'), disposeCapture: step('capture'), disposeCaptureProxy: step('proxy'),
		disposeOpenRecovery: step('recovery'), invalidateProject: step('invalidate'), disposeVisuals: step('visuals'),
		unsubscribeEngineErrors: step('errors'), cancelTimedRecording: step('timed'), cancelRecordingStart: step('recording-start'),
		cancelScheduledSave: step('scheduled-save'), clearSourceGcTimer: step('gc-timer'),
		cancelPlaybackPreparation: step('playback'), cancelPlayAtSpeedPreparation: step('speed'), stopMetronome: step('metronome'),
		cancelEffectWorkers: step('effects'), disposeNyquist: step('nyquist'), cancelEffectPreview: step('preview'),
		disposeMicrophoneMeter: step('microphone'), terminalFlush: step('flush'), stopRecording: step('stop-recording'),
		disposeCapturePool: step('pool'), releaseProjectLock: step('lock'), revokeOutputUrl: step('url'),
		disposeProjectBin: step('bin'), disposeAudioWarp: step('warp'), disposeTakeComp: step('comp'),
		disposeRenderEngines: step('render'), disposeCodec: step('codec'), disposeNativeProject: step('native'),
		disposeTimePitchCache: step('pitch'), disposeSession: step('session'), disposeEngine: step('engine'),
		clearSourceBuffers: step('buffers'), clearSourceProviders: step('providers'), drainSourceProviders: step('drain-providers'),
		clearSourcePeaks: step('peaks'), clearWaveformCaches: step('waveforms'), closeStore: step('store'),
	};
	return { calls, state, lifetime, dependencies };
}

test('disposal is reentrant, synchronously closes authority, and flushes before releasing storage', async () => {
	const f = fixture();
	let repeated: Promise<void> | undefined;
	const dispose = createControllerDisposal({ ...f.dependencies, publish() { repeated = dispose(); } });
	const pending = dispose();
	assert.equal(repeated, pending);
	assert.equal(f.lifetime.phase, 'disposing');
	assert.equal(f.state.disposed, true);
	assert.equal(dispose(), pending);
	await pending;
	assert.equal(f.lifetime.phase, 'disposed');
	assert.ok(f.calls.indexOf('flush') < f.calls.indexOf('lock'));
	assert.ok(f.calls.indexOf('engine') < f.calls.indexOf('providers'));
	assert.ok(f.calls.indexOf('drain-providers') < f.calls.indexOf('store'));
	assert.equal(f.calls.filter(value => value === 'engine').length, 1);
});

test('a synchronous cleanup failure cannot skip later cleanup or channel finalization', async () => {
	const f = fixture(), failure = new Error('listener removal failed');
	const dispose = createControllerDisposal({ ...f.dependencies, removeDeviceChangeListener() { throw failure; } });
	await assert.rejects(dispose(), (error: unknown) => error === failure);
	assert.ok(f.calls.includes('flush'));
	assert.ok(f.calls.includes('store'));
	assert.ok(f.calls.includes('document-channel'));
	assert.ok(f.calls.includes('telemetry-channel'));
	assert.equal(f.lifetime.phase, 'disposed');
});

test('failed source readers retain source resources and storage even when they throw a falsy value', async () => {
	const f = fixture();
	const dispose = createControllerDisposal({ ...f.dependencies, disposeEngine() { throw null; } });
	let rejected = false;
	await dispose().catch((error: unknown) => { rejected = true; assert.equal(error, null); });
	assert.ok(rejected);
	assert.ok(!f.calls.includes('buffers'));
	assert.ok(!f.calls.includes('providers'));
	assert.ok(!f.calls.includes('store'));
	assert.ok(f.calls.includes('waveforms'));
	assert.equal(f.lifetime.phase, 'disposed');
});

test('both capture producers are awaited after either fails before source retirement', async () => {
	const f = fixture(), failure = new Error('capture failure');
	let resolveProxy!: () => void;
	const proxy = new Promise<void>(resolve => { resolveProxy = resolve; });
	const dispose = createControllerDisposal({ ...f.dependencies,
		disposeCapture() { throw failure; }, disposeCaptureProxy: () => proxy,
	});
	const pending = dispose();
	await new Promise<void>(resolve => { setImmediate(resolve); });
	assert.ok(!f.calls.includes('engine'));
	resolveProxy();
	await assert.rejects(pending, (error: unknown) => error === failure);
	assert.ok(f.calls.includes('engine'));
	assert.ok(!f.calls.includes('store'));
});

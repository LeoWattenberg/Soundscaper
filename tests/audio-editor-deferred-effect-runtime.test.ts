/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	createDeferredEffectRuntime,
	type DeferredEffectModuleLoaders,
} from '../src/common/editor/controller/deferred-effect-runtime.ts';
import {
	createDeferredSpectralEditAdmissionLoader,
} from '../src/common/editor/controller/deferred-spectral-edit-admission.ts';
import {
	createDeferredEditorExportService,
	type DeferredEditorExportModule,
} from '../src/common/editor/controller/deferred-export-service.ts';

test('effect implementations load only on invocation and cache their modules and Nyquist client', async () => {
	const calls = { audacity: 0, selection: 0, pffft: 0, parametricEq: 0, spectral: 0, nyquist: 0 };
	const clientCalls: unknown[][] = [];
	const runtime = createDeferredEffectRuntime({
		audacity: async () => {
			calls.audacity += 1;
			return {
				applyAudacityEffectAsync: async (...args: unknown[]) => ['audacity', ...args],
				captureAudacityNoiseProfile: (...args: unknown[]) => ['profile', ...args],
			};
		},
		selection: async () => {
			calls.selection += 1;
			return { applyAudioSelectionEffectAsync: async (...args: unknown[]) => ['selection', ...args] };
		},
		pffft: async () => {
			calls.pffft += 1;
			return { initializePffft: async (...args: unknown[]) => ['pffft', ...args] };
		},
		parametricEq: async () => {
			calls.parametricEq += 1;
			return { loadParametricEqWasmModule: async (...args: unknown[]) => ['eq', ...args] };
		},
		spectral: async () => {
			calls.spectral += 1;
			return { applySpectralGain: async (...args: unknown[]) => ['spectral', ...args] };
		},
		nyquist: async () => {
			calls.nyquist += 1;
			return {
				NyquistEvaluationClient: class {
					constructor(options: unknown) { clientCalls.push(['construct', options]); }
					async evaluate(...args: unknown[]) { clientCalls.push(['evaluate', ...args]); return { ok: true }; }
					dispose() { clientCalls.push(['dispose']); }
				},
			};
		},
	} as unknown as DeferredEffectModuleLoaders);
	const nyquist = runtime.createNyquistClient({ worker: 'fixture' });

	assert.deepEqual(calls, { audacity: 0, selection: 0, pffft: 0, parametricEq: 0, spectral: 0, nyquist: 0 });
	assert.deepEqual(await runtime.applyAudacityEffectAsync('fade', [], 48_000), ['audacity', 'fade', [], 48_000]);
	assert.deepEqual(await runtime.captureAudacityNoiseProfile([], 48_000, {}), ['profile', [], 48_000, {}]);
	assert.equal(calls.audacity, 1);
	assert.deepEqual(await runtime.applyAudioSelectionEffectAsync('gain', [], 48_000), ['selection', 'gain', [], 48_000]);
	assert.deepEqual(await runtime.initializePffft(), ['pffft']);
	assert.deepEqual(await runtime.loadParametricEqWasmModule(), ['eq']);
	assert.deepEqual(await runtime.applySpectralGain([], { gainDb: 3 }), ['spectral', [], { gainDb: 3 }]);
	assert.deepEqual(await nyquist.evaluate({ source: '(print 1)' }), { ok: true });
	assert.deepEqual(await nyquist.evaluate({ source: '(print 2)' }), { ok: true });
	assert.equal(calls.nyquist, 1);
	nyquist.dispose();
	await Promise.resolve();
	assert.deepEqual(clientCalls, [
		['construct', { worker: 'fixture' }],
		['evaluate', { source: '(print 1)' }],
		['evaluate', { source: '(print 2)' }],
		['dispose'],
	]);
});

test('effect loader failures preserve the original rejection', async () => {
	const failure = new Error('effect loader failed');
	const runtime = createDeferredEffectRuntime({
		selection: async () => { throw failure; },
	} as Partial<DeferredEffectModuleLoaders>);
	await assert.rejects(
		runtime.applyAudioSelectionEffectAsync('fade', [], 48_000),
		(error) => error === failure,
	);
});

test('disposing during a deferred Nyquist load never evaluates a late client', async () => {
	let releaseModule!: (module: unknown) => void;
	const modulePromise = new Promise<unknown>((resolve) => { releaseModule = resolve; });
	const calls: string[] = [];
	const runtime = createDeferredEffectRuntime({
		nyquist: () => modulePromise as ReturnType<DeferredEffectModuleLoaders['nyquist']>,
	});
	const client = runtime.createNyquistClient();
	const evaluation = client.evaluate({ source: '(print 1)' });
	client.dispose();
	releaseModule({
		NyquistEvaluationClient: class {
			async evaluate() { calls.push('evaluate'); }
			dispose() { calls.push('dispose'); }
		},
	});
	await assert.rejects(evaluation, /disposed/u);
	assert.deepEqual(calls, ['dispose']);
});

test('spectral admission loads on first spectral execution and caches its module', async () => {
	let loads = 0;
	const module = Object.freeze({ marker: 'spectral-admission' });
	const loadAdmission = createDeferredSpectralEditAdmissionLoader(async () => {
		loads += 1;
		return module as never;
	});

	assert.equal(loads, 0);
	assert.equal(await loadAdmission(), module);
	assert.equal(await loadAdmission(), module);
	assert.equal(loads, 1);
});

test('export implementations load only when an export action is invoked', async () => {
	const calls: unknown[][] = [];
	let loads = 0;
	const runtime = {
		options: {},
		sourceBuffers: new Map(),
		taskProgress: null,
		createCacheAwareRenderEngine: () => ({
			loadProject: () => undefined,
			renderMix: async () => 'rendered',
			dispose: async () => undefined,
		}),
		prepareCommittedTimePitchCaches: async () => undefined,
		throwIfAborted: () => undefined,
		updateExportProgress: () => undefined,
	};
	const service = createDeferredEditorExportService(runtime, async () => {
		loads += 1;
		return {
			createEditorExportService: (receivedRuntime: unknown) => {
				calls.push(['create', receivedRuntime]);
				return {
					exportVideo: async (...args: unknown[]) => { calls.push(['video', ...args]); return 'video'; },
					handleExportAction: async (...args: unknown[]) => { calls.push(['action', ...args]); return 'audio'; },
					renderSnapshot: async () => { throw new Error('the deferred service renderer must not be used'); },
				};
			},
		} as unknown as DeferredEditorExportModule;
	});

	assert.equal(loads, 0);
	assert.equal(await service.renderSnapshot({}, {}), 'rendered');
	assert.equal(loads, 0, 'shared project rendering must not pull in delivery execution');
	assert.equal(await service.handleExportAction('start', { format: 'wav' }), 'audio');
	assert.equal(await service.exportVideo({ format: 'mp4' }), 'video');
	assert.equal(loads, 1);
	assert.equal(calls[0]?.[0], 'create');
	assert.deepEqual(calls.slice(1), [
		['action', 'start', { format: 'wav' }],
		['video', { format: 'mp4' }],
	]);
});

test('export loader failures preserve the original rejection', async () => {
	const failure = new Error('export loader failed');
	const service = createDeferredEditorExportService({
		options: {}, sourceBuffers: new Map(), taskProgress: null,
		createCacheAwareRenderEngine: () => null,
		prepareCommittedTimePitchCaches: async () => undefined,
		throwIfAborted: () => undefined,
		updateExportProgress: () => undefined,
	}, async () => { throw failure; });
	await assert.rejects(service.handleExportAction('start'), (error) => error === failure);
	await assert.rejects(service.exportVideo(), (error) => error === failure);
});

test('product-ready owners retain descriptors but not optional effect or analysis implementations', () => {
	const app = source('src/common/editor/app.js');
	for (const implementation of [
		'analysis.js',
		'audacity-effects/index.js',
		'nyquist/client.js',
		'parametric-eq/index.js',
		'pffft.js',
		'spectral-edit.js',
	]) assert.doesNotMatch(app, new RegExp(`from ['"].*${implementation.replaceAll('.', '\\.')}`), implementation);
	assert.doesNotMatch(app, /from ['"].*controller\/export-service\.ts['"]/u);
	assert.doesNotMatch(source('src/common/editor/controller/waveform-analysis.ts'), /from ['"]\.\.\/analysis\.js['"]/u);
	assert.doesNotMatch(source('src/common/editor/pffft-spectrogram.js'), /from ['"]\.\/pffft\.js['"]/u);
	for (const path of [
		'src/common/editor/controller/effect-audio-service.ts',
		'src/common/editor/controller/selection-effect-worker-service.ts',
	]) assert.doesNotMatch(source(path), /from ['"]\.\.\/spectral-edit-admission\.ts['"]/u, path);
	for (const path of [
		'src/common/editor/effects.js',
		'src/common/editor/effect-parameter-descriptors.ts',
		'src/common/editor/engine/effect-rack.ts',
		'src/common/editor/engine/effect-worklets.ts',
	]) assert.doesNotMatch(source(path), /from ['"].*audacity-effects\/live\.js['"]/u, path);
});

function source(path: string): string {
	return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

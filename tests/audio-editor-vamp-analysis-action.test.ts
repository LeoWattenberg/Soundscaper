/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createDesktopVampAnalysisAction } from '../src/common/editor/controller/analysis/vamp-analysis-action.ts';

const REQUEST = Object.freeze({
	schemaVersion: 1 as const, analyzerId: 'va' + '1'.repeat(30), stableId: 'vi' + '2'.repeat(30),
	binarySha256: 'a'.repeat(64), outputId: 'onsets', program: null,
	parameters: Object.freeze([{ id: 'threshold', value: 0.5 }]), scope: 'track' as const,
	startFrame: 4, endFrame: 12, sampleRate: 48_000,
});

function rawCatalog() {
	return [{
		analyzerId: REQUEST.analyzerId, stableId: REQUEST.stableId,
		binarySha256: REQUEST.binarySha256, name: 'Onsets', maker: 'Example', programs: [],
		parameters: [{ id: 'threshold', name: 'Threshold', description: '', unit: '', minValue: 0,
			maxValue: 1, defaultValue: 0.5, quantizeStep: null }],
		outputs: [{ id: 'onsets', name: 'Onsets', description: '', unit: '',
			sampleType: 'one-sample-per-step', sampleRate: null, hasDuration: false }],
		configuration: { inputDomain: 'time', minimumChannels: 1, maximumChannels: 2,
			preferredStepSize: 2, preferredBlockSize: 4 },
	}];
}

function nativeOutput(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		identifier: 'onsets', name: 'Onsets', description: '', unit: '', binCount: null,
		binNames: [], extents: null, quantizeStep: null, sampleType: 'one-sample-per-step',
		sampleRate: null, hasDuration: false, ...overrides,
	};
}

function configuredSession(frameCount: number, outputs: readonly unknown[] = [nativeOutput()]) {
	return {
		kind: 'analyzer-session', format: 'vamp', sessionId: 'session-1',
		analyzerId: REQUEST.analyzerId, installationId: REQUEST.stableId,
		binarySha256: REQUEST.binarySha256, state: 'configured', processedFrames: 0,
		totalFrames: frameCount, outputs,
	};
}

function harness(frameCount = 8) {
	const calls: Array<readonly [string, unknown]> = [];
	const project = { id: 'project-1', revision: 5 };
	const bridge = {
		listNativeVampAnalyzers: async () => rawCatalog(),
		startNativeVampAnalyzer: async (value: unknown) => {
			calls.push(['start', value]); return { sessionId: 'session-1' };
		},
		configureNativeVampAnalyzer: async (value: unknown) => {
			calls.push(['configure', value]); return configuredSession(frameCount);
		},
		pushNativeVampAnalyzerPcm: async (value: unknown) => {
			calls.push(['push', value]); return { features: [{ outputId: 'onsets', timestamp: null,
				duration: null, values: [0.75], label: 'onset' }] };
		},
		finishNativeVampAnalyzer: async (value: unknown) => {
			calls.push(['finish', value]); return { features: [] };
		},
		cancelNativeVampAnalyzer: async (value: unknown) => { calls.push(['cancel', value]); return true; },
	};
	const engine = {
		renderTrack: async (trackId: unknown, options: unknown) => {
			calls.push(['render-track', { trackId, options }]);
			return { channels: [Float32Array.from({ length: frameCount }, (_, index) => index / 8)] };
		},
		renderMix: async () => { throw new Error('unexpected master render'); },
	};
	const action = createDesktopVampAnalysisAction({ bridge, engine, getProject: () => project });
	return { action, bridge, calls, project };
}

test('desktop Vamp action maps the pathless native catalog to the strict renderer catalog', async () => {
	const { action } = harness();
	assert.ok(action);
	const listed = await action.list();
	assert.deepEqual(listed, rawCatalog().map(({ configuration: _configuration, ...row }) => row));
	assert.equal(Object.hasOwn(listed[0], 'configuration'), false);
});

test('desktop Vamp action renders and streams the exact selected range then returns one output', async () => {
	const { action, calls } = harness();
	assert.ok(action);
	const result = await action.analyze({
		projectId: 'project-1', projectRevision: 5, selectedTrackId: 'track-1', request: REQUEST,
	}, new AbortController().signal);
	assert.equal(calls[0]?.[0], 'render-track');
	assert.deepEqual(calls.map(([kind]) => kind),
		['render-track', 'start', 'configure', 'push', 'finish']);
	const configured = calls.find(([kind]) => kind === 'configure')?.[1] as Record<string, unknown>;
	assert.equal(configured.blockSize, 4);
	assert.equal(configured.stepSize, 2);
	const pushed = calls.find(([kind]) => kind === 'push')?.[1] as { channels: Float32Array[] };
	assert.deepEqual([...pushed.channels[0]!], [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]);
	assert.deepEqual(result.features[0]?.timestamp, { seconds: 0, nanoseconds: 0 });
	assert.equal(result.features[0]?.label, 'onset');
});

test('desktop Vamp action cancels the exact native session on abort or project-fence failure', async () => {
	const { action, bridge, calls, project } = harness();
	assert.ok(action);
	bridge.pushNativeVampAnalyzerPcm = async () => {
		project.revision += 1;
		return { features: [] };
	};
	await assert.rejects(() => action.analyze({
		projectId: 'project-1', projectRevision: 5, selectedTrackId: 'track-1', request: REQUEST,
	}, new AbortController().signal), /project changed/iu);
	assert.equal(calls.at(-1)?.[0], 'cancel');
});

test('desktop Vamp action requests cancellation while a native PCM operation is pending', async () => {
	const { action, bridge, calls } = harness();
	assert.ok(action);
	let releasePush = (_value: { features: never[] }): void => undefined;
	bridge.pushNativeVampAnalyzerPcm = (value: unknown) => {
		calls.push(['push', value]);
		return new Promise((resolve) => { releasePush = resolve; });
	};
	const controller = new AbortController();
	const operation = action.analyze({
		projectId: 'project-1', projectRevision: 5, selectedTrackId: 'track-1', request: REQUEST,
	}, controller.signal);
	while (!calls.some(([kind]) => kind === 'push')) await new Promise((resolve) => setImmediate(resolve));
	controller.abort();
	await new Promise((resolve) => setImmediate(resolve));
	const cancelledWhilePushPending = calls.some(([kind]) => kind === 'cancel');
	releasePush({ features: [] });
	await assert.rejects(operation, { name: 'AbortError' });
	assert.equal(cancelledWhilePushPending, true);
	assert.equal(calls.filter(([kind]) => kind === 'cancel').length, 1);
});

test('desktop Vamp action interprets features with the configured output descriptor', async () => {
	const { action, bridge, calls } = harness();
	assert.ok(action);
	bridge.configureNativeVampAnalyzer = async (value: unknown) => {
		calls.push(['configure', value]);
		return configuredSession(8, [nativeOutput({ sampleType: 'fixed-sample-rate', sampleRate: 12_000 })]);
	};
	bridge.pushNativeVampAnalyzerPcm = async (value: unknown) => {
		calls.push(['push', value]);
		return { features: [0.25, 0.75].map((sample) => ({
			outputId: 'onsets', timestamp: null, duration: null, values: [sample], label: '',
		})) };
	};
	const result = await action.analyze({
		projectId: 'project-1', projectRevision: 5, selectedTrackId: 'track-1', request: REQUEST,
	}, new AbortController().signal);
	assert.deepEqual(result.features[1]?.timestamp, { seconds: 0, nanoseconds: 83_333 });
});

test('desktop Vamp action rejects and cancels when configuration removes the selected output', async () => {
	const { action, bridge, calls } = harness();
	assert.ok(action);
	bridge.configureNativeVampAnalyzer = async (value: unknown) => {
		calls.push(['configure', value]);
		return configuredSession(8, [nativeOutput({ identifier: 'changed-output' })]);
	};
	await assert.rejects(() => action.analyze({
		projectId: 'project-1', projectRevision: 5, selectedTrackId: 'track-1', request: REQUEST,
	}, new AbortController().signal), /no longer available after configuration/iu);
	assert.deepEqual(calls.map(([kind]) => kind), ['render-track', 'start', 'configure', 'cancel']);
});

test('desktop Vamp action rejects aggregate native feature floods before retaining them', async () => {
	const frameCount = 65_536 * 2;
	const { action, bridge, calls } = harness(frameCount);
	assert.ok(action);
	const ignoredFeature = Object.freeze({
		outputId: 'unselected-output', timestamp: null, duration: null, values: [], label: '',
	});
	bridge.pushNativeVampAnalyzerPcm = async (value: unknown) => {
		calls.push(['push', value]);
		return { features: new Array(50_001).fill(ignoredFeature) };
	};
	await assert.rejects(() => action.analyze({
		projectId: 'project-1', projectRevision: 5, selectedTrackId: 'track-1',
		request: { ...REQUEST, endFrame: REQUEST.startFrame + frameCount },
	}, new AbortController().signal), /renderer feature limit/iu);
	assert.deepEqual(calls.map(([kind]) => kind),
		['render-track', 'start', 'configure', 'push', 'push', 'cancel']);
});

test('Vamp action stays absent when any native analyzer bridge operation is unavailable', () => {
	assert.equal(createDesktopVampAnalysisAction({
		bridge: { listNativeVampAnalyzers: async () => [] },
		engine: { renderTrack: async () => ({ channels: [] }), renderMix: async () => ({ channels: [] }) },
		getProject: () => null,
	}), null);
});

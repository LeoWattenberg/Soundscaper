/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperOpenFxFrameGraphNativeMedia as createGraph,
	type FramescaperOpenFxFrameExecutionRequestNativeMedia as ExecuteRequest,
	type FramescaperOpenFxFrameGraphNativeMedia as Graph,
} from '../src/framescaper/editor-openfx-frame-graph-native-media.ts';

type Data = Record<string, unknown>;

interface Rgba { readonly width: number; readonly height: number; readonly pixels: Uint8Array }

const SHA_A = 'a1'.repeat(32);
const SHA_B = 'b2'.repeat(32);
const SHA_C = 'c3'.repeat(32);
const SHA_D = 'd4'.repeat(32);

const FRESHNESS = Object.freeze({
	authoredStateSha256: SHA_A, inputIdentitiesSha256: SHA_B,
	renderPlanFingerprintSha256: SHA_C, nativeEffectFingerprintSha256: SHA_D,
});

const CHAINING = /chaining requires a primary plane when a target carries more than one enabled effect/u;

/** A four-by-two RGBA canvas keeps every fixture frame thirty-two bytes long. */
function rgba(fill = 0, width = 4, height = 2): Rgba {
	return { width, height, pixels: new Uint8Array(width * height * 4).fill(fill) };
}

function filled(byte: number): number[] {
	return Array.from({ length: 32 }, () => byte);
}

function effect(overrides: Data = {}): Data {
	return {
		schemaVersion: 1, instanceId: 'ofx-1', pluginId: 'net.example.Filter', binarySha256: SHA_A,
		context: 'filter', attachment: { kind: 'filter', targetId: 'clip-out' },
		inputs: [{ name: 'Source', sourceRef: 'plane-a' }], parameters: [], customEncodings: {},
		enabled: true, freshness: FRESHNESS, frozenFallback: null, ...overrides,
	};
}

/** Every transition node lands on one target so the graph gathers them into one chain. */
function transitionNode(overrides: Data = {}): Data {
	return node({
		context: 'transition', attachment: { kind: 'transition', targetId: 'dissolve-1' },
		inputs: [{ name: 'SourceFrom', sourceRef: 'clip-a' }, { name: 'SourceTo', sourceRef: 'clip-b' }],
		...overrides,
	});
}

function node(state: Data = {}): Data {
	return { kind: 'openfx', nodeId: `node-${String(state.instanceId ?? 'ofx-1')}`, state: effect(state) };
}

function plan(nodes: readonly Data[]): Data {
	return {
		version: 14, strategy: 'framescaper-unified-exact-v1', nodes,
		output: {
			frameRate: { num: 24, den: 1 }, frameCount: 4, quality: 'balanced',
			canvas: { width: 4, height: 2, fit: 'contain', pixelFormat: 'yuv420p', backgroundColor: '#000000' },
			includeAudio: false, audioLayout: null,
		},
	};
}

function rendered(frame: Rgba): Data {
	return { mode: 'render', rgba: frame, backend: 'cpu', retriedOnCpu: false, reportsDegradation: false };
}

function graph(nodes: readonly Data[], execute: (value: ExecuteRequest) => Promise<Data>): Graph {
	return createGraph({ plan: plan(nodes), assertCurrent: () => undefined, execute } as unknown as never);
}

/** The transition path is the only production caller that applies with no primary plane. */
function transitionRequest(overrides: Data = {}): never {
	return {
		context: 'transition', targetId: 'dissolve-1', outputOrdinal: 0, primary: null,
		namedPlanes: [{ identity: 'clip-a', rgba: rgba(1) }, { identity: 'clip-b', rgba: rgba(2) }],
		transitionProgress: 0.5, signal: new AbortController().signal, ...overrides,
	} as unknown as never;
}

function recorder(bytes: readonly number[]) {
	const calls: Data[] = [];
	const execute = (value: ExecuteRequest) => {
		calls.push({
			instanceId: value.instanceId,
			inputs: value.inputs.map(({ name, sourceRef, rgba: plane }) => [name, sourceRef, plane.pixels[0]]),
		});
		return Promise.resolve(rendered(rgba(bytes[calls.length - 1])));
	};
	return { calls, execute };
}

function disposition(overrides: Data = {}): Data {
	return {
		instanceId: 'ofx-1', context: 'transition', outputOrdinal: 0, mode: 'render',
		reportsDegradation: false, backend: 'cpu', retriedOnCpu: false, ...overrides,
	};
}

test('a target carrying two enabled effects with no primary plane is refused before either one renders', async () => {
	const port = recorder([11, 22]);
	const built = graph([transitionNode(), transitionNode({ instanceId: 'ofx-2' })], port.execute);

	await assert.rejects(() => built.apply(transitionRequest()), { name: 'Error', message: CHAINING });

	assert.deepEqual(port.calls, [], 'no effect reaches the execute port once the chain cannot be expressed');
});

test('a single enabled effect beside a disabled one still applies without a primary plane', async () => {
	const port = recorder([11]);
	const built = graph(
		[transitionNode(), transitionNode({ instanceId: 'ofx-2', enabled: false })],
		port.execute,
	);

	const applied = await built.apply(transitionRequest());

	assert.deepEqual(port.calls, [{
		instanceId: 'ofx-1',
		inputs: [['SourceFrom', 'clip-a', 1], ['SourceTo', 'clip-b', 2]],
	}]);
	assert.deepEqual(applied.dispositions, [
		disposition(),
		disposition({ instanceId: 'ofx-2', mode: 'bypass', backend: null }),
	]);
	assert.deepEqual([...applied.frame.pixels], filled(11));
	assert.equal(applied.reportsDegradation, false);
});

test('a lone enabled effect on a transition target is applied with no primary plane', async () => {
	const port = recorder([11]);
	const built = graph([transitionNode()], port.execute);

	const applied = await built.apply(transitionRequest({ outputOrdinal: 2 }));

	assert.deepEqual(port.calls, [{
		instanceId: 'ofx-1',
		inputs: [['SourceFrom', 'clip-a', 1], ['SourceTo', 'clip-b', 2]],
	}]);
	assert.deepEqual(applied.dispositions, [disposition({ outputOrdinal: 2 })]);
	assert.deepEqual([...applied.frame.pixels], filled(11));
});

test('a target carrying two enabled effects still chains when a primary plane names the running output', async () => {
	const port = recorder([7, 9]);
	const built = graph([node(), node({ instanceId: 'ofx-2' })], port.execute);

	const applied = await built.apply({
		context: 'filter', targetId: 'clip-out', outputOrdinal: 0,
		primary: { identity: 'plane-a', rgba: rgba(3) }, namedPlanes: [],
		signal: new AbortController().signal,
	} as unknown as never);

	assert.deepEqual(port.calls, [
		{ instanceId: 'ofx-1', inputs: [['Source', 'plane-a', 3]] },
		{ instanceId: 'ofx-2', inputs: [['Source', 'plane-a', 7]] },
	], 'the second effect binds the frame the first one rendered');
	assert.deepEqual(applied.dispositions.map(({ instanceId, mode }) => [instanceId, mode]), [
		['ofx-1', 'render'], ['ofx-2', 'render'],
	]);
	assert.deepEqual([...applied.frame.pixels], filled(9));
});

test('a disabled effect ahead of an enabled one does not trip the no-primary refusal', async () => {
	const port = recorder([11]);
	const built = graph(
		[transitionNode({ instanceId: 'ofx-off', enabled: false }), transitionNode()],
		port.execute,
	);

	const applied = await built.apply(transitionRequest());

	assert.deepEqual(applied.dispositions.map(({ instanceId, mode }) => [instanceId, mode]), [
		['ofx-off', 'bypass'], ['ofx-1', 'render'],
	]);
	assert.deepEqual([...applied.frame.pixels], filled(11));
});

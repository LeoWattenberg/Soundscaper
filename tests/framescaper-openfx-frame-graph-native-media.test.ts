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

const FALLBACK = Object.freeze({
	externalMediaSourceId: 'source-1', renderedAssetSha256: SHA_A, frameCount: 4, freshness: FRESHNESS,
});

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

function node(state: Data = {}): Data {
	return { kind: 'openfx', nodeId: `node-${String(state.instanceId ?? 'ofx-1')}`, state: effect(state) };
}

function plan(nodes: readonly Data[] = [node()], output: Data = {}): Data {
	return {
		version: 14, strategy: 'framescaper-unified-exact-v1', nodes,
		output: {
			frameRate: { num: 24, den: 1 }, frameCount: 4, quality: 'balanced',
			canvas: { width: 4, height: 2, fit: 'contain', pixelFormat: 'yuv420p', backgroundColor: '#000000' },
			includeAudio: false, audioLayout: null, ...output,
		},
	};
}

function rendered(frame: Rgba = rgba(1), overrides: Data = {}): Data {
	return { mode: 'render', rgba: frame, backend: 'cpu', retriedOnCpu: false, reportsDegradation: false, ...overrides };
}

function frozen(overrides: Data = {}): Data {
	return { mode: 'frozen', availability: 'missing', reportsDegradation: true, frozenFallback: FALLBACK, ...overrides };
}

function disposition(overrides: Data = {}): Data {
	return {
		instanceId: 'ofx-1', context: 'filter', outputOrdinal: 0, mode: 'render',
		reportsDegradation: false, backend: 'cpu', retriedOnCpu: false, ...overrides,
	};
}

function options(overrides: Data = {}): never {
	return {
		plan: plan(), assertCurrent: () => undefined,
		execute: () => Promise.resolve(rendered()), ...overrides,
	} as unknown as never;
}

function graph(overrides: Data = {}): Graph {
	return createGraph(options(overrides));
}

function request(overrides: Data = {}): never {
	return {
		context: 'filter', targetId: 'clip-out', outputOrdinal: 0,
		primary: { identity: 'plane-a', rgba: rgba(3) }, namedPlanes: [],
		signal: new AbortController().signal, ...overrides,
	} as unknown as never;
}

function apply(built: Graph, overrides: Data = {}) {
	return built.apply(request(overrides));
}

function recorder(): Readonly<{ calls: ExecuteRequest[]; execute: (value: ExecuteRequest) => Promise<Data> }> {
	const calls: ExecuteRequest[] = [];
	const execute = (value: ExecuteRequest) => {
		calls.push(value);
		return Promise.resolve(rendered(rgba(7)));
	};
	return { calls, execute };
}

test('an enabled effect renders through the execute port and reports its disposition', async () => {
	const port = recorder();

	const applied = await apply(graph({ execute: port.execute }));

	assert.equal(port.calls.length, 1);
	assert.deepEqual(applied.dispositions, [disposition()]);
	assert.equal(applied.reportsDegradation, false);
	assert.deepEqual([...applied.frame.pixels], filled(7));
});

test('the execute port receives a frozen request carrying the admitted plan and bound inputs', async () => {
	const port = recorder();
	const bound = plan();

	await apply(graph({ plan: bound, execute: port.execute }), { outputOrdinal: 2 });

	const [call] = port.calls;
	assert.equal(Object.isFrozen(call), true);
	assert.equal(call.plan as unknown, bound);
	assert.equal(call.instanceId, 'ofx-1');
	assert.equal(call.context, 'filter');
	assert.equal(call.outputOrdinal, 2);
	assert.equal(call.requestedBackend, 'supported-preferred');
	assert.deepEqual(call.standardParameters, {});
	assert.deepEqual(
		call.inputs.map(({ name, sourceRef, rgba: plane }) => [name, sourceRef, plane.pixels[0]]),
		[['Source', 'plane-a', 3]],
	);
});

test('a disabled effect is bypassed without the execute port ever being reached', async () => {
	const port = recorder();

	const applied = await apply(graph({ plan: plan([node({ enabled: false })]), execute: port.execute }));

	assert.equal(port.calls.length, 0);
	assert.deepEqual(applied.dispositions, [disposition({ mode: 'bypass', backend: null })]);
	assert.deepEqual([...applied.frame.pixels], filled(3));
});

test('effects on one target chain so each renders over the previous output', async () => {
	const seen: number[] = [];
	const built = graph({
		plan: plan([node(), node({ instanceId: 'ofx-2' })]),
		execute: (value: ExecuteRequest) => {
			seen.push(value.inputs[0].rgba.pixels[0]);
			return Promise.resolve(rendered(rgba(seen.length === 1 ? 7 : 9)));
		},
	});

	const applied = await apply(built);

	assert.deepEqual(seen, [3, 7]);
	assert.deepEqual(applied.dispositions.map(({ instanceId }) => instanceId), ['ofx-1', 'ofx-2']);
	assert.equal(applied.frame.pixels[0], 9);
});

test('only the effects attached to the requested context and target are applied', async () => {
	const built = graph({
		plan: plan([
			node(),
			node({ instanceId: 'ofx-other', attachment: { kind: 'filter', targetId: 'clip-in' } }),
			node({ instanceId: 'ofx-retimer', context: 'retimer', attachment: { kind: 'retimer', targetId: 'clip-out' } }),
		]),
	});

	const applied = await apply(built);

	assert.deepEqual(applied.dispositions.map(({ instanceId }) => instanceId), ['ofx-1']);
});

test('an input naming no available intermediate plane is refused as a reference error', async () => {
	const built = graph({ plan: plan([node({ inputs: [{ name: 'Source', sourceRef: 'plane-missing' }] })]) });

	await assert.rejects(() => apply(built), {
		name: 'ReferenceError',
		message: /OpenFX named input Source \(plane-missing\) has no exact intermediate plane/u,
	});
});

test('each OpenFX context is held to the named inputs its contract requires', async () => {
	const refuse = async (state: Data, overrides: Data, expected: RegExp) => {
		await assert.rejects(() => apply(graph({ plan: plan([node(state)]) }), overrides), expected);
	};
	const attached = (context: string, inputs: readonly Data[]): Data => ({
		context, attachment: { kind: context, targetId: 'clip-out' }, inputs,
	});

	await refuse({ inputs: [{ name: 'Other', sourceRef: 'plane-a' }] }, {}, /OpenFX Filter requires Source/u);
	await refuse(
		attached('retimer', [{ name: 'Source', sourceRef: 'plane-a' }, { name: 'Mask', sourceRef: 'plane-a' }]),
		{ context: 'retimer', retimerSourceTime: { num: 1, den: 1 } }, /OpenFX Retimer requires Source/u,
	);
	await refuse(attached('general', []), { context: 'general' }, /OpenFX General requires explicit named inputs/u);
	await refuse(
		attached('paint', [{ name: 'Source', sourceRef: 'plane-a' }]), { context: 'paint' },
		/OpenFX Paint requires exact Source and Mask inputs/u,
	);
	await refuse(
		attached('transition', [{ name: 'SourceFrom', sourceRef: 'a' }, { name: 'SourceTo', sourceRef: 'a' }]),
		{ context: 'transition', transitionProgress: 0.5 },
		/OpenFX Transition requires distinct SourceFrom and SourceTo inputs/u,
	);
});

test('an effect that persisted a host-owned standard parameter is refused', async () => {
	for (const name of ['Transition', 'SourceTime']) {
		const built = graph({
			plan: plan([node({ parameters: [{ name, type: 'double', value: [0.5], keyframes: [] }] })]),
		});

		await assert.rejects(() => apply(built), /host-owned standard parameters cannot be persisted/u);
	}
});

function transitionGraph(overrides: Data = {}): Graph {
	return graph({
		plan: plan([node({
			context: 'transition', attachment: { kind: 'transition', targetId: 'clip-out' },
			inputs: [{ name: 'SourceFrom', sourceRef: 'from' }, { name: 'SourceTo', sourceRef: 'to' }],
		})]),
		...overrides,
	});
}

test('a transition effect is handed the host-supplied Transition progress', async () => {
	const port = recorder();

	await apply(transitionGraph({ execute: port.execute }), {
		context: 'transition', primary: null, transitionProgress: 0.25,
		namedPlanes: [{ identity: 'from', rgba: rgba(4) }, { identity: 'to', rgba: rgba(5) }],
	});

	assert.deepEqual(port.calls[0].standardParameters, { Transition: 0.25 });
	assert.deepEqual(
		port.calls[0].inputs.map(({ name, rgba: plane }) => [name, plane.pixels[0]]),
		[['SourceFrom', 4], ['SourceTo', 5]],
	);
});

test('a transition application without an in-range progress parameter is refused', async () => {
	await assert.rejects(
		() => apply(transitionGraph(), { context: 'transition' }),
		/Transition requires its exact standard parameter/u,
	);
	await assert.rejects(
		() => apply(transitionGraph(), { context: 'transition', transitionProgress: 1.5 }),
		{ name: 'RangeError', message: /Transition must be between zero and one/u },
	);
});

function retimerGraph(overrides: Data = {}): Graph {
	return graph({
		plan: plan([node({ context: 'retimer', attachment: { kind: 'retimer', targetId: 'clip-out' } })]),
		...overrides,
	});
}

test('a retimer effect is handed the host-supplied SourceTime rational', async () => {
	const port = recorder();

	await apply(retimerGraph({ execute: port.execute }), {
		context: 'retimer', retimerSourceTime: { num: 3, den: 2 },
	});

	assert.deepEqual(port.calls[0].standardParameters, { SourceTime: { num: 3, den: 2 } });
});

test('a retimer application without an exact rational source time is refused', async () => {
	await assert.rejects(
		() => apply(retimerGraph(), { context: 'retimer' }),
		{ name: 'TypeError', message: /SourceTime is missing/u },
	);
	await assert.rejects(
		() => apply(retimerGraph(), { context: 'retimer', retimerSourceTime: { num: 3, den: 0 } }),
		{ name: 'RangeError', message: /SourceTime is not an exact rational/u },
	);
});

test('a frozen result recovers the authored fallback frame when the resolver supplies one', async () => {
	const recoveries: unknown[][] = [];
	const built = graph({
		plan: plan([node({ frozenFallback: FALLBACK })]),
		execute: () => Promise.resolve(frozen()),
		resolveFrozenFrame: (...args: unknown[]) => {
			recoveries.push(args);
			return Promise.resolve(rgba(9));
		},
	});

	const applied = await apply(built, { outputOrdinal: 3 });

	assert.equal(recoveries.length, 1);
	assert.deepEqual(recoveries[0][0], FALLBACK);
	assert.equal((recoveries[0][1] as Data).instanceId, 'ofx-1');
	assert.equal(recoveries[0][2], 3);
	assert.ok(recoveries[0][3] instanceof AbortSignal);
	assert.deepEqual(applied.dispositions, [disposition({
		outputOrdinal: 3, mode: 'frozen', reportsDegradation: true, backend: null,
	})]);
	assert.equal(applied.frame.pixels[0], 9);
	assert.equal(applied.reportsDegradation, true);
});

test('a frozen result that cannot be recovered degrades to a bypass disposition', async () => {
	const frozenGraph = (overrides: Data) => graph({
		plan: plan([node({ frozenFallback: FALLBACK })]),
		execute: () => Promise.resolve(frozen()),
		...overrides,
	});

	const unrecovered = await apply(frozenGraph({ resolveFrozenFrame: () => Promise.resolve(null) }));
	// With no recovery port at all the optional call yields undefined rather than null.
	const unresolvable = await apply(frozenGraph({}));

	for (const applied of [unrecovered, unresolvable]) {
		assert.deepEqual(applied.dispositions, [
			disposition({ mode: 'bypass', reportsDegradation: true, backend: null }),
		]);
		assert.equal(applied.reportsDegradation, true);
		assert.equal(applied.frame.pixels[0], 3, 'the frame carries on unmodified through a bypass');
	}
});

test('a frozen effect that authored no fallback degrades without consulting the resolver', async () => {
	let recoveries = 0;
	const built = graph({
		execute: () => Promise.resolve(frozen()),
		resolveFrozenFrame: () => {
			recoveries += 1;
			return Promise.resolve(rgba(9));
		},
	});

	const applied = await apply(built);

	assert.equal(recoveries, 0);
	assert.deepEqual(applied.dispositions.map(({ mode }) => mode), ['bypass']);
});

test('a frozen fallback that is not the authored authority is refused outright', async () => {
	const built = graph({
		plan: plan([node({ frozenFallback: FALLBACK })]),
		execute: () => Promise.resolve(frozen({ frozenFallback: { ...FALLBACK, frameCount: 2 } })),
		resolveFrozenFrame: () => Promise.resolve(rgba(9)),
	});

	await assert.rejects(() => apply(built), /frozen recovery does not match exact authored fallback authority/u);
});

test('a bypass result carries forward the degradation the execute port reported', async () => {
	const built = graph({
		execute: () => Promise.resolve({ mode: 'bypass', availability: 'quarantined', reportsDegradation: true }),
	});

	const applied = await apply(built);

	assert.deepEqual(applied.dispositions, [
		disposition({ mode: 'bypass', reportsDegradation: true, backend: null }),
	]);
	assert.equal(applied.reportsDegradation, true);
});

test('a rendered or recovered frame that is not the exact canvas geometry is refused', async () => {
	await assert.rejects(() => apply(graph({ execute: () => Promise.resolve(rendered(rgba(1, 8, 2))) })), {
		name: 'RangeError',
		message: /OpenFX rendered frame geometry is not the exact bounded V14 RGBA canvas/u,
	});
	await assert.rejects(
		() => apply(graph({
			plan: plan([node({ frozenFallback: FALLBACK })]),
			execute: () => Promise.resolve(frozen()),
			resolveFrozenFrame: () => Promise.resolve({ width: 4, height: 2, pixels: new Uint8Array(16) }),
		})),
		/OpenFX frozen recovery frame geometry is not the exact bounded V14 RGBA canvas/u,
	);
});

test('named input planes are bounded, uniquely identified and pathless', async () => {
	const plane = (identity: string) => ({ identity, rgba: rgba(1) });

	await assert.rejects(
		() => apply(graph(), {
			namedPlanes: Array.from({ length: 17 }, (_, index) => plane(`plane-${String(index)}`)),
		}),
		{ name: 'RangeError', message: /named input planes are invalid/u },
	);
	await assert.rejects(() => apply(graph(), { namedPlanes: [plane('same'), plane('same')] }), /must be unique/u);
	await assert.rejects(() => apply(graph(), { namedPlanes: [plane('planes/one')] }), /0 identity is not pathless/u);
	await assert.rejects(() => apply(graph(), { namedPlanes: ['not-a-plane'] }), /named plane 0 is invalid/u);
	await assert.rejects(() => apply(graph(), { namedPlanes: 'planes' }), /named input planes are invalid/u);
});

test('a primary plane that is not the exact bounded RGBA canvas is refused', async () => {
	const primary = (value: unknown) => apply(graph(), { primary: { identity: 'plane-a', rgba: value } });
	const geometry = /primary plane geometry is not the exact bounded V14 RGBA canvas/u;

	await assert.rejects(() => primary('pixels'), { name: 'TypeError', message: /primary plane must be RGBA/u });
	await assert.rejects(() => primary({ width: 4, height: 2, pixels: new Uint8Array(16) }), geometry);
	await assert.rejects(() => primary({ width: 4, height: 2, pixels: filled(0) }), geometry);
	await assert.rejects(() => primary({ width: 8, height: 2, pixels: new Uint8Array(64) }), geometry);
	await assert.rejects(() => primary({ width: 0, height: 2, pixels: new Uint8Array(32) }), {
		name: 'RangeError',
		message: /primary plane width must be a bounded positive integer/u,
	});
});

test('an application with no primary plane starts from a fully transparent canvas', async () => {
	const applied = await apply(graph({ plan: plan([]) }), { primary: null });

	assert.deepEqual(applied.dispositions, []);
	assert.equal(applied.frame.width, 4);
	assert.equal(applied.frame.height, 2);
	assert.deepEqual([...applied.frame.pixels], filled(0));
});

test('the returned frame is a detached frozen copy of the pixels the port produced', async () => {
	const produced = rgba(6);

	const applied = await apply(graph({ execute: () => Promise.resolve(rendered(produced)) }));
	produced.pixels.fill(2);

	assert.equal(Object.isFrozen(applied.frame), true);
	assert.notEqual(applied.frame.pixels, produced.pixels);
	assert.equal(applied.frame.pixels[0], 6);
});

test('the requested backend is forwarded and defaults to the supported preference', async () => {
	const port = recorder();
	const built = graph({ execute: port.execute, allowRepeatedFrames: true });

	await apply(built, { requestedBackend: 'cuda' });
	await apply(built);

	assert.deepEqual(port.calls.map(({ requestedBackend }) => requestedBackend), ['cuda', 'supported-preferred']);
	await assert.rejects(() => apply(built, { requestedBackend: 'vulkan' }), /frame checkpoint is invalid/u);
});

test('an output ordinal outside the plan and a pathful target identity are refused', async () => {
	await assert.rejects(() => apply(graph(), { outputOrdinal: 4 }), /frame checkpoint is invalid/u);
	await assert.rejects(() => apply(graph(), { outputOrdinal: 1.5 }), /frame checkpoint is invalid/u);
	await assert.rejects(() => apply(graph(), { targetId: 'clips/out' }), /frame checkpoint is invalid/u);
	await assert.rejects(() => apply(graph(), { targetId: '' }), /frame checkpoint is invalid/u);
});

test('overlapping applications are refused so one graph renders one frame at a time', async () => {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const built = graph({ execute: () => gate.then(() => rendered()) });

	const first = apply(built, { outputOrdinal: 0 });
	await assert.rejects(() => apply(built, { outputOrdinal: 1 }), /frame execution cannot overlap/u);

	release();
	await first;
	await assert.doesNotReject(() => apply(built, { outputOrdinal: 1 }), 'the guard releases once the frame lands');
});

test('a cancellation raised while an effect renders stops the graph before the next one', async () => {
	const controller = new AbortController();
	const reason = new Error('the caller cancelled mid-graph');
	let calls = 0;
	const built = graph({
		plan: plan([node(), node({ instanceId: 'ofx-2' })]),
		execute: () => {
			calls += 1;
			controller.abort(reason);
			return Promise.resolve(rendered());
		},
	});

	await assert.rejects(() => apply(built, { signal: controller.signal }), (error: unknown) => {
		assert.equal(error, reason);
		return true;
	});
	assert.equal(calls, 1);
});

test('a superseded render is abandoned before its effect reaches the execute port', async () => {
	const superseded = new Error('the render is no longer current');
	const port = recorder();
	let asserted = 0;
	const built = graph({
		assertCurrent: () => {
			asserted += 1;
			if (asserted === 2) throw superseded;
		},
		execute: port.execute,
	});

	await assert.rejects(() => apply(built), (error: unknown) => {
		assert.equal(error, superseded);
		return true;
	});
	assert.equal(port.calls.length, 0);
});

test('a refused application does not consume the output ordinal it failed on', async () => {
	let calls = 0;
	const built = graph({
		execute: () => {
			calls += 1;
			return Promise.resolve(rendered(calls === 1 ? rgba(1, 8, 2) : rgba(5)));
		},
	});

	await assert.rejects(() => apply(built), /geometry is not the exact bounded V14 RGBA canvas/u);
	const applied = await apply(built);

	assert.equal(applied.frame.pixels[0], 5);
});

test('a plan whose output canvas is not a bounded positive integer is refused at construction', () => {
	const refuse = (output: Data, expected: RegExp) => {
		assert.throws(() => graph({ plan: plan([], output) }), expected);
	};

	refuse({ frameCount: 0 }, /OpenFX output frame count must be a bounded positive integer/u);
	refuse({ canvas: { width: 0, height: 2 } }, /OpenFX canvas width must be a bounded positive integer/u);
	refuse({ canvas: { width: 4, height: 70_000 } }, /OpenFX canvas height must be a bounded positive integer/u);
});

test('a plan carrying an OpenFX node whose state is not exact V26 is refused at construction', () => {
	assert.throws(() => graph({ plan: plan([node({ enabled: 'yes' })]) }), /must state whether it is enabled/u);
	assert.throws(
		() => graph({ plan: plan([node({ attachment: { kind: 'paint', targetId: 'clip-out' } })]) }),
		/attachment kind must match its effect context/u,
	);
});

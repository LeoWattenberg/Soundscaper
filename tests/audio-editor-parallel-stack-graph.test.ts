/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { compileParallelStackPlan } from '../src/common/editor/engine/parallel-stack-plan.ts';
import { createParallelStackExecutor } from '../src/common/editor/engine/parallel-stack-dsp.ts';
import { createParallelStackEffectMailbox, publishParallelStackEffectUpdate } from '../src/common/editor/engine/parallel-stack-effect-mailbox.ts';
import { createBitcrusherProcessor } from '../src/common/editor/first-party-effects/bitcrusher/dsp.js';
import type { EngineProject } from '../src/common/editor/engine/types.ts';

function strip(id: string, extra: Record<string, unknown> = {}) {
	return { id, name: id, color: '', gain: 1, pan: 0, mute: false, solo: false,
		collapsed: false, effectsActive: true, effects: [], channelCount: 2, ...extra };
}
function edge(id: string, source: Record<string, unknown>, destination: Record<string, unknown>, extra: Record<string, unknown> = {}) {
	return { id, kind: 'assignment', source, destination, position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1], ...extra };
}
function project() {
	return {
		schemaFamily: 'soundscaper', schemaVersion: 1, sampleRate: 48000, masterChannels: 2,
		tracks: [strip('a', { type: 'audio' }), strip('b', { type: 'audio' })],
		master: strip('master'),
		mixer: { schemaVersion: 1, groups: [strip('group')], sends: [], cues: [], vcas: [],
			outputs: [{ id: 'main', name: 'Main', role: 'main', channelCount: 2 }],
			edges: [edge('a-group', { kind: 'track', id: 'a' }, { kind: 'mixer-node', id: 'group' }),
				edge('b-group', { kind: 'track', id: 'b' }, { kind: 'mixer-node', id: 'group' }),
				edge('group-master', { kind: 'mixer-node', id: 'group' }, { kind: 'master' }),
				edge('master-main', { kind: 'master' }, { kind: 'output', id: 'main' })] },
	};
}
function runtime(value: EngineProject) {
	const plan = compileParallelStackPlan(value, { sampleRate: 48000, workerCount: 2 });
	const planes = Array.from({ length: plan.planeCount }, () => new Float32Array(256));
	const executors = Array.from({ length: plan.workerCount }, (_, worker) => createParallelStackExecutor(plan, worker));
	return { plan, planes, process(sequence = 0) {
		for (const index of plan.taskOrder) executors[plan.tasks[index]!.worker]!(index, planes, sequence);
	} };
}

test('compiles pinned independent stacks and dependency-ordered group, master and terminal tasks', () => {
	const { plan, planes, process } = runtime(project());
	assert.notEqual(plan.tasks[0]!.worker, plan.tasks[1]!.worker);
	assert.deepEqual(plan.tasks[2]!.dependencies, [0, 1]);
	assert.equal(plan.tasks.at(-1)!.kind, 'output');
	for (const index of plan.inputPlaneIndices[0]!) planes[index]!.fill(.125);
	for (const index of plan.inputPlaneIndices[1]!) planes[index]!.fill(.25);
	process();
	for (const index of plan.outputPlaneIndices[0]!) assert.equal(planes[index]![255], .375);
});

test('runs multiple serial effects without resetting their histories at block boundaries', () => {
	const value = project();
	const params = { bitDepth: 7, downsampling: 3.5, mix: 76, interpolation: 'linear' };
	value.tracks[0]!.effects = [{ id: 'first', type: 'bitcrusher', params }, { id: 'second', type: 'bitcrusher', params }] as never[];
	const { plan, planes, process } = runtime(value);
	const expectedInput = [new Float32Array(512), new Float32Array(512)];
	for (const input of expectedInput) for (let i = 0; i < input.length; i++) input[i] = Math.sin(i * .15) * .7;
	const scratch = expectedInput.map(() => new Float32Array(512));
	const expected = expectedInput.map(() => new Float32Array(512));
	createBitcrusherProcessor({ channelCount: 2, params }).processBlock(expectedInput, scratch, 512);
	createBitcrusherProcessor({ channelCount: 2, params }).processBlock(scratch, expected, 512);
	for (let block = 0; block < 2; block++) {
		for (let c = 0; c < 2; c++) planes[plan.inputPlaneIndices[0]![c]!]!.set(expectedInput[c]!.subarray(block * 256, block * 256 + 256));
		process(block);
		for (let c = 0; c < 2; c++) assert.deepEqual(planes[plan.outputPlaneIndices[0]![c]!]!, expected[c]!.subarray(block * 256, block * 256 + 256));
	}
});

test('live effect snapshots reach their owning workers at block boundaries without changing sibling PCM order', () => {
	const value = project();
	const initial = { bitDepth: 8, downsampling: 3.5, mix: 100, interpolation: 'linear' };
	value.tracks[0]!.effects = [{ id: 'a-crush', type: 'bitcrusher', params: initial }] as never[];
	value.tracks[1]!.effects = [{ id: 'b-crush', type: 'bitcrusher', params: initial }] as never[];
	const plan = compileParallelStackPlan(value, { sampleRate: 48000, workerCount: 2 });
	const mailbox = createParallelStackEffectMailbox(plan.tasks.reduce((sum, task) => sum + task.effects.length, 0));
	const workers = Array.from({ length: plan.workerCount }, (_, index) => createParallelStackExecutor(plan, index, {}, mailbox));
	const planes = Array.from({ length: plan.planeCount }, () => new Float32Array(256));
	const reference = [0, 1].map(() => createBitcrusherProcessor({ channelCount: 2, params: initial }));
	const aIndex = plan.tasks.slice(0, plan.tasks.findIndex((task) => task.key === 'track:a'))
		.reduce((sum, task) => sum + task.effects.length, 0);
	const bIndex = plan.tasks.slice(0, plan.tasks.findIndex((task) => task.key === 'track:b'))
		.reduce((sum, task) => sum + task.effects.length, 0);
	assert.notEqual(aIndex, bIndex);
	for (let block = 0; block < 3; block++) {
		if (block === 1) {
			const next = { ...initial, bitDepth: 3 };
			assert.equal(publishParallelStackEffectUpdate(mailbox, aIndex, { params: next }), true);
			reference[0]!.updateParams(next);
		}
		if (block === 2) {
			const next = { ...initial, bitDepth: 5 };
			assert.equal(publishParallelStackEffectUpdate(mailbox, bIndex, { params: next }), true);
			reference[1]!.updateParams(next);
		}
		const expected = [0, 1].map(() => [new Float32Array(256), new Float32Array(256)]);
		for (let track = 0; track < 2; track++) {
			const input = plan.inputPlaneIndices[track]!.map((index) => planes[index]!);
			for (let channel = 0; channel < 2; channel++) for (let frame = 0; frame < 256; frame++) {
				input[channel]![frame] = Math.sin((block * 256 + frame) * .13 + track * .3 + channel * .4) * .8;
			}
			reference[track]!.processBlock(input, expected[track]!, 256);
		}
		for (const index of plan.taskOrder) workers[plan.tasks[index]!.worker]!(index, planes, block);
		for (let track = 0; track < 2; track++) for (let channel = 0; channel < 2; channel++) {
			assert.deepEqual(planes[plan.tracks[track]!.prePlanes[channel]!]!, expected[track]![channel]!);
		}
	}
});

test('rejects unsupported kernels and authored automation instead of bypassing either', () => {
	const value = project();
	value.tracks[0]!.effects = [{ id: 'unsupported', type: 'reverb' }] as never[];
	assert.throws(() => runtime(value), /reverb/iu);
	assert.throws(() => runtime({ ...project(), automationLanes: [{}] }), /automation/iu);
	assert.throws(() => runtime({ ...project(), tracks: [{ ...project().tracks[0], envelope: [{ frame: 0, value: .4 }] }] }), /envelope/iu);
});

test('PDC aligns sidechain stages, parallel programme paths and all terminal outputs', () => {
	const value = project();
	value.tracks[0]!.effects = [{ id: 'a-limit', type: 'limiter', params: { lookahead: .005, ceiling: 0 } }] as never[];
	value.tracks[1]!.effects = [{ id: 'b-limit', type: 'limiter', params: { lookahead: .01, ceiling: 0 } }] as never[];
	value.mixer.edges.push(edge('detector', { kind: 'track', id: 'b' },
		{ kind: 'effect-sidechain', strip: { kind: 'track', id: 'a' }, effectId: 'a-limit' }, { kind: 'sidechain' }));
	value.mixer.outputs.push({ id: 'cue', name: 'Cue', role: 'cue', channelCount: 2 });
	value.mixer.edges.push(edge('b-cue', { kind: 'track', id: 'b' }, { kind: 'output', id: 'cue' }));
	const { plan, planes, process } = runtime(value);
	assert.equal(plan.latencyFrames, 720);
	assert.equal(plan.tasks[0]!.key, 'track:b');
	assert.equal(plan.tasks.find(({ key }) => key === 'track:a')!.inputDelayFrames, 480);
	assert.equal(plan.tasks.find(({ key }) => key === 'output:cue')!.outputDelayFrames, 240);
	const output = [new Float32Array(1024), new Float32Array(1024)];
	for (let block = 0; block < 4; block++) {
		for (const indexes of plan.inputPlaneIndices) for (const index of indexes) {
			planes[index]!.fill(0); if (block === 0) planes[index]![0] = .1;
		}
		process(block);
		for (let terminal = 0; terminal < 2; terminal++) output[terminal]!.set(planes[plan.outputPlaneIndices[terminal]![0]!]!, block * 256);
	}
	assert.equal(output[0]![720], Math.fround(.2));
	assert.equal(output[1]![720], Math.fround(.1));
	assert.equal(output[0]!.filter((value) => value !== 0).length, 1);
	assert.equal(output[1]!.filter((value) => value !== 0).length, 1);
});

test('pre-fader is after effects, before mono pan, mute and VCA; tap widths remain distinct', () => {
	const value = project();
	value.tracks[0] = { ...value.tracks[0]!, gain: .25, pan: 1, mute: true,
		effects: [{ id: 'crush', type: 'bitcrusher', params: { bitDepth: 8 } }] as never[] };
	value.mixer.cues.push(strip('cue') as never);
	value.mixer.vcas.push({ id: 'vca', name: 'VCA', gain: .5, mute: false, members: [{ kind: 'mixer-node', id: 'cue' }] } as never);
	value.mixer.outputs.push({ id: 'cue-output', name: 'Cue', role: 'cue', channelCount: 2 });
	value.mixer.edges.push(edge('pre-cue', { kind: 'track', id: 'a' }, { kind: 'mixer-node', id: 'cue' },
		{ kind: 'send', position: 'pre-fader', channelMap: [0, 0] }));
	value.mixer.edges.push(edge('cue-output', { kind: 'mixer-node', id: 'cue' }, { kind: 'output', id: 'cue-output' }));
	value.mixer.edges[0]!.channelMap = [0, 0];
	const { plan, planes, process } = runtime({ ...value, sources: [{ id: 'source', channelCount: 1 }],
		clips: [{ id: 'clip', sourceId: 'source' }], tracks: [{ ...value.tracks[0], clipIds: ['clip'] }, value.tracks[1]!] });
	assert.equal(plan.tracks[0]!.prePlanes.length, 1);
	assert.equal(plan.tracks[0]!.postPlanes.length, 2);
	planes[plan.inputPlaneIndices[0]![0]!]!.fill(.5);
	process();
	assert.equal(planes[plan.tracks[0]!.prePlanes[0]!]![0], .50390625);
	for (const index of plan.outputPlaneIndices[0]!) assert.equal(planes[index]![0], 0);
	for (const index of plan.outputPlaneIndices[1]!) assert.equal(planes[index]![0], .251953125);
});

test('mono hard-right post-fader routing keeps the widened channel pair', () => {
	const value = project();
	value.tracks[0]!.pan = 1;
	value.mixer.edges[0]!.channelMap = [0, 0];
	const { plan, planes, process } = runtime({ ...value, sources: [{ id: 'source', channelCount: 1 }],
		clips: [{ id: 'clip', sourceId: 'source' }], tracks: [{ ...value.tracks[0], clipIds: ['clip'] }, value.tracks[1]!] });
	planes[plan.inputPlaneIndices[0]![0]!]!.fill(.5);
	process();
	assert.ok(Math.abs(planes[plan.outputPlaneIndices[0]![0]!]![0]!) < 1e-7);
	assert.equal(planes[plan.outputPlaneIndices[0]![1]!]![0], .5);
});

test('solo follows the persisted graph and muted pre-fader dependencies still execute', () => {
	const value = project(); value.tracks[0]!.solo = true;
	const { plan, planes, process } = runtime(value);
	for (const index of plan.inputPlaneIndices[0]!) planes[index]!.fill(.125);
	for (const index of plan.inputPlaneIndices[1]!) planes[index]!.fill(.25);
	process();
	for (const index of plan.outputPlaneIndices[0]!) assert.equal(planes[index]![0], .125);
	assert.equal(plan.stripTaps.find(({ key }) => key === 'mixer-node:group')!.scope, 'group');
});

test('bounds memory before allocation and rejects repeated DSP blocks or foreign tasks', () => {
	assert.throws(() => compileParallelStackPlan(project(), { sampleRate: 48000, workerCount: 2, maximumMemoryBytes: 1024 }), /memory/iu);
	const { plan, planes, process } = runtime(project()); process();
	assert.throws(() => process(), /consecutively/iu);
	const execute = createParallelStackExecutor(plan, 1);
	assert.throws(() => execute(0, planes, 0), /wrong worker/iu);
	assert.throws(() => compileParallelStackPlan(project(), { sampleRate: 48000, workerCount: 9 }), /worker count/iu);
});

test('suspended effect slots are retained for routing but do not execute or claim DSP latency', () => {
	const value = project();
	value.tracks[0]!.effects = [{ id: 'bypassed', type: 'reverb', bypassed: true },
		{ id: 'off', type: 'limiter', enabled: false, params: { lookahead: .005 } }] as never[];
	value.mixer.edges.push(edge('inactive-detector', { kind: 'track', id: 'b' },
		{ kind: 'effect-sidechain', strip: { kind: 'track', id: 'a' }, effectId: 'off' }, { kind: 'sidechain' }));
	const { plan, planes, process } = runtime(value);
	assert.equal(plan.latencyFrames, 0);
	assert.equal(plan.tasks.find(({ key }) => key === 'track:a')!.effects.length, 0);
	for (const index of plan.inputPlaneIndices[0]!) planes[index]!.fill(.1);
	process();
	assert.equal(planes[plan.outputPlaneIndices[0]![0]!]![0], Math.fround(.1));
});

test('worker preparation rejects tampered plane ownership, dependencies and delay memory', () => {
	const plan = compileParallelStackPlan(project(), { sampleRate: 48000, workerCount: 2 });
	const replace = (changes: Record<string, unknown>) => ({ ...plan, tasks: [{ ...plan.tasks[0]!, ...changes }, ...plan.tasks.slice(1)] });
	assert.throws(() => createParallelStackExecutor(replace({ postPlanes: plan.tasks[1]!.postPlanes }), 0), /ownership/iu);
	assert.throws(() => createParallelStackExecutor(replace({ dependencies: [1] }), 0), /dependency/iu);
	assert.throws(() => createParallelStackExecutor(replace({ inputDelayFrames: -1 }), 0), /geometry/iu);
	assert.throws(() => createParallelStackExecutor({ ...plan, memoryBytes: 0 }, 0), /memory/iu);
});

test('EQ admission requires the precompiled module and worker memory reserves its exact WASM closure', async () => {
	const { readFile } = await import('node:fs/promises');
	const value = project();
	value.tracks[0]!.effects = [{ id: 'eq', type: 'parametric-eq', params: { outputGain: 0, bands: [] } }] as never[];
	assert.throws(() => compileParallelStackPlan(value, { sampleRate: 48000, workerCount: 2 }), /precompiled/iu);
	const parametricEqWasmModule = await WebAssembly.compile(await readFile(new URL('../src/common/editor/parametric-eq/parametric-eq.wasm', import.meta.url)));
	const plan = compileParallelStackPlan(value, { sampleRate: 48000, workerCount: 2, parametricEqWasmModule });
	const planes = Array.from({ length: plan.planeCount }, () => new Float32Array(256));
	for (const plane of plan.inputPlaneIndices[0]!) planes[plane]!.fill(.25);
	const executors = Array.from({ length: plan.workerCount }, (_, index) => createParallelStackExecutor(plan, index, { parametricEqWasmModule }));
	for (const index of plan.taskOrder) executors[plan.tasks[index]!.worker]!(index, planes, 0);
	assert.equal(planes[plan.outputPlaneIndices[0]![0]!]![0], .25);
	assert.throws(() => compileParallelStackPlan({ ...project(), clips: [{ warpMap: {} }] }, { sampleRate: 48000, workerCount: 2 }), /warp/iu);
});

test('implicit differing bus widths require explicit routing instead of approximating dynamic GainNode channels', () => {
	const value = project();
	value.mixer.groups[0]!.channelCount = 1;
	value.mixer.edges[0]!.channelMap = [];
	value.mixer.edges[1]!.channelMap = [];
	value.mixer.edges[2]!.channelMap = [0, 0];
	assert.throws(() => runtime(value), /explicit map/iu);
});

test('mixed mono and stereo clips on one track fall back before fixed-width ingress changes center pan', () => {
	const value = project();
	const mixed = { ...value,
		sources: [{ id: 'mono', channelCount: 1 }, { id: 'stereo', channelCount: 2 }],
		clips: [{ id: 'mono-clip', sourceId: 'mono' }, { id: 'stereo-clip', sourceId: 'stereo' }],
		tracks: [{ ...value.tracks[0]!, clipIds: ['mono-clip', 'stereo-clip'] }, value.tracks[1]!],
	};
	assert.throws(() => compileParallelStackPlan(mixed, { sampleRate: 48000, workerCount: 2 }), /mixed.*channel width/iu);
	assert.throws(() => compileParallelStackPlan({ ...mixed,
		sources: [{ id: 'mono', channelCount: 1 }, { id: 'stereo' }],
	}, { sampleRate: 48000, workerCount: 2 }), /known clip channel width/iu);
	assert.throws(() => compileParallelStackPlan({ ...mixed,
		tracks: [{ ...value.tracks[0]!, clips: mixed.clips }, value.tracks[1]!],
	}, { sampleRate: 48000, workerCount: 2 }), /canonical clip IDs/iu);
});

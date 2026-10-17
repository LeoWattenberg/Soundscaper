/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffectService, type VideoEffectProject } from '../src/common/editor/controller/clip-video/video-effect-service.ts';
import { EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing, cloneFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { applyFramescaperProjectCommandFinishing } from '../src/framescaper/editor-project-finishing-commands.ts';
import { applyVideoExactBrowserEffectsFinishing } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

const SOURCE = [64, 128, 192, 127, 255, 224, 16, 255];
function frame() { return { width: 2, height: 1, pixels: new Uint8Array(SOURCE) }; }
const LIVE = new AbortController().signal;
// The owning Frame validator authenticates these fields; its extensible type exposes them as unknown.
function authoringView(project: unknown): VideoEffectProject { return project as VideoEffectProject; }

test('the real Frame video-effect authoring service and command model feed the shared exact pixel renderer', async () => {
	let project = createFramescaperProjectFinishing(PROFILE, framescaperV20Options());
	const initial = project, generation = new EditorProjectGeneration(); generation.activate(authoringView(project).id);
	const service = createVideoEffectService({ state: { selectedClipId: 'video-clip', readOnly: false, videoEffectGestures: new Map() },
		copy: { projectReadOnly: 'Read only' }, getProject: () => authoringView(project), captureProject: () => generation.capture(authoringView(project).id),
		assertProject: token => { generation.assertCurrent(token); }, editingBlocked: () => false,
		commit: command => { project = applyFramescaperProjectCommandFinishing(PROFILE, project, command); return authoringView(project); },
		publishDocumentSnapshot() {},
	});
	service.addVideoClipEffect('video-clip', 'white-balance-v1', { id: 'warm', params: { temperature: 100 } });
	service.addVideoClipEffect('video-clip', 'tone-ladder-v1', { id: 'tone' });
	const persisted = cloneFramescaperProjectFinishing(PROFILE, project);
	const clip = authoringView(persisted).clips.find(clip => clip.id === 'video-clip'); assert.ok(clip?.kind === 'video');
	assert.equal(authoringView(initial).clips.find(clip => clip.id === 'video-clip')?.videoEffects?.length ?? 0, 0);
	assert.deepEqual(clip.videoEffects?.map(effect => effect.type), ['white-balance-v1', 'tone-ladder-v1']);
	const output = await applyVideoExactBrowserEffectsFinishing(frame(), clip.videoEffects ?? [], LIVE);
	assert.deepEqual(Array.from(output.pixels), [90, 128, 140, 127, 255, 224, 9, 255]);
	assert.equal(output.pixels.buffer === frame().pixels.buffer, false);
	service.updateVideoClipEffect('video-clip', 'warm', { params: { temperature: -100 } });
	const updated = authoringView(project).clips.find(clip => clip.id === 'video-clip'); assert.ok(updated?.kind === 'video');
	assert.deepEqual(Array.from((await applyVideoExactBrowserEffectsFinishing(frame(), updated.videoEffects ?? [], LIVE)).pixels),
		[44, 128, 255, 127, 188, 224, 26, 255]);
	assert.deepEqual(Array.from(frame().pixels), SOURCE);
});

test('Frame exact rendering preserves native opaque cancellation identity before admission', async () => {
	for (const reason of [null, 17, new Proxy({}, { get() { throw new Error('reason get'); }, getOwnPropertyDescriptor() { throw new Error('reason descriptor'); } })]) {
		const stop = new AbortController(); stop.abort(reason);
		Object.defineProperty(stop.signal, 'aborted', { get() { throw new Error('signal shadow'); } });
		const outcome = await applyVideoExactBrowserEffectsFinishing(frame(), [createVideoEffect('tone-ladder-v1')], stop.signal)
			.then(() => ({ rejected: false, reason: undefined as unknown }), failure => ({ rejected: true, reason: failure as unknown }));
		assert.equal(outcome.rejected, true); assert.equal(outcome.reason === reason, true);
	}
});

test('actual Frame dispatch refuses accessor and future global state without calling getters', async () => {
	let reads = 0, documentReads = 0; const document = Object.getOwnPropertyDescriptor(globalThis, 'document');
	const input = Object.defineProperty({ id: 'global', enabled: true, params: {} }, 'type', { enumerable: true, get() { reads++; return 'tone-ladder-v1'; } });
	const future = { ...createVideoEffect('tone-ladder-v1'), future: true };
	const params = Object.defineProperty({}, 'exposure', { enumerable: true, get() { reads++; return 1; } });
	Object.defineProperty(globalThis, 'document', { configurable: true, get() { documentReads++; throw new Error('renderer before admission'); } });
	try { for (const effects of [[input], [future], [{ ...createVideoEffect('tone-ladder-v1'), params }]]) {
		await assert.rejects(applyVideoExactBrowserEffectsFinishing(frame(), effects, LIVE));
	} } finally {
		if (document) Object.defineProperty(globalThis, 'document', document); else Reflect.deleteProperty(globalThis, 'document');
	}
	assert.equal(reads, 0); assert.equal(documentReads, 0);
});

test('yielded Frame output retains admitted geometry when the borrowed caller frame changes', async () => {
	const source = { width: 512, height: 256, pixels: new Uint8Array(512 * 256 * 4).fill(128) };
	const timer = setTimeout(() => { source.width = 2; source.height = 1; }, 0);
	try {
		const output = await applyVideoExactBrowserEffectsFinishing(source, [createVideoEffect('tone-ladder-v1', { params: { exposure: 1 } })], LIVE);
		assert.equal(output.width, 512); assert.equal(output.height, 256); assert.equal(output.pixels.length, 512 * 256 * 4);
		assert.deepEqual(Array.from(output.pixels.subarray(0, 4)), [176, 176, 176, 128]);
	} finally { clearTimeout(timer); }
});

test('a real Frame project with65 admitted global effects renders the complete authored stack', async () => {
	const options = framescaperV20Options();
	const effects = Array.from({ length: 65 }, (_, index) => createVideoEffect('white-balance-v1', {
		id: `white-${String(index)}`, params: { tint: index === 64 ? 100 : 0 },
	}));
	const clips = options.clips as Record<string, unknown>[]; clips[0]!.videoEffects = effects;
	const project = createFramescaperProjectFinishing(PROFILE, options);
	const clip = authoringView(project).clips.find(clip => clip.id === 'video-clip'); assert.equal(clip?.videoEffects?.length, 65);
	const output = await applyVideoExactBrowserEffectsFinishing(frame(), clip?.videoEffects ?? [], LIVE);
	assert.deepEqual(Array.from(output.pixels), [76, 92, 224, 127, 255, 164, 21, 255]);
});

test('mixed old/new Frame stacks execute every authored GPU pass through the maintained compositor', async () => {
	const nativeDocument = Object.getOwnPropertyDescriptor(globalThis, 'document'), nativeImage = Object.getOwnPropertyDescriptor(globalThis, 'ImageData');
	const input = frame(), effects = [createVideoEffect('white-balance-v1', { params: { temperature: 20 } }),
		createVideoEffect('pixelate', { params: { blockSize: 8 } }), createVideoEffect('tone-ladder-v1', { params: { exposure: 1 } })];
	const uploads: Uint8Array[] = []; let creates = 0, afterRead: (() => void) | null = null;
	let retainedOutput: Uint8Array | null = null;
	let readback = SOURCE;
	let cleanupFailure: Error | null = null;
	const programs: { shaders: { source: string }[] }[] = [], draws: number[] = []; let current: typeof programs[number] | undefined;
	const constants = new Map<string, number>();
	const constant = (name: string) => { if (!constants.has(name)) constants.set(name, constants.size + 100); return constants.get(name)!; };
	const calls: Record<string, unknown> = {
		getShaderParameter: () => true, getProgramParameter: () => true, getAttribLocation: () => 0, getUniformLocation: () => ({}),
		createShader: () => ({ source: '' }), shaderSource: (shader: { source: string }, source: string) => { shader.source = source; },
		createProgram: () => { const program = { shaders: [] as { source: string }[] }; programs.push(program); return program; },
		attachShader: (program: typeof programs[number], shader: { source: string }) => { program.shaders.push(shader); },
		createBuffer: () => ({}), createTexture: () => ({}), createFramebuffer: () => ({}), createVertexArray: () => ({}),
		deleteTexture: () => { if (cleanupFailure) { const failure = cleanupFailure; cleanupFailure = null; throw failure; } },
		checkFramebufferStatus: () => constant('FRAMEBUFFER_COMPLETE'), useProgram: (program: typeof programs[number]) => { current = program; },
		getError: () => constant('NO_ERROR'),
		texImage2D: (...args: unknown[]) => { if (args[8] instanceof Uint8Array) uploads.push(args[8].slice()); },
		drawArrays: () => { const source = current?.shaders.find(shader => shader.source.includes('const int u_effect ='))?.source;
			if (source) draws.push(Number(/const int u_effect = (\d+)/u.exec(source)?.[1])); },
		readPixels: (_x: number, _y: number, _width: number, _height: number, _format: number, _type: number, pixels: Uint8Array) => {
			pixels.set(readback); retainedOutput = pixels; afterRead?.();
		},
	};
	const gl = new Proxy(calls, { get(target, key) { if (typeof key !== 'string') return undefined;
		if (Object.hasOwn(target, key)) return target[key]; if (/^[A-Z][A-Z0-9_]*$/u.test(key)) return constant(key); return () => undefined; } });
	const canvas = () => ({ width: 2, height: 1, remove() {}, addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ width: 2, height: 1 }),
		getContext: (kind: string) => kind === '2d' ? { putImageData() {} } : gl });
	Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement() {
		creates++; Object.assign(input, { width: 1 }); input.pixels.fill(0); Object.assign(effects[2]!.params, { exposure: 5 }); return canvas();
	} } });
	Object.defineProperty(globalThis, 'ImageData', { configurable: true, value: class { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} } });
	try {
		const output = await applyVideoExactBrowserEffectsFinishing(input, effects, LIVE);
		assert.deepEqual(draws.filter(code => code === 18 || code === 2 || code === 19), [18, 2, 19]);
		assert.equal(programs.some(program => program.shaders.some(shader => shader.source.includes('global_develop_rgb'))), true);
		assert.equal(output.pixels.length, SOURCE.length);
		assert.equal(creates, 1); assert.deepEqual(uploads[0], new Uint8Array(SOURCE));
		assert.equal(uploads.at(-1)![128 * 4], 176, 'settings are detached before browser acquisition');
		const rows = [10, 40, 90].flatMap(value => [value, value, value, 255, value, value, value, 255]);
		readback = [90, 40, 10].flatMap(value => [value, value, value, 255, value, value, value, 255]);
		const uploadCount = uploads.length, rowInput = { width: 2, height: 3, pixels: new Uint8Array(rows) };
		const rowOutput = await applyVideoExactBrowserEffectsFinishing(rowInput, effects, LIVE);
		assert.deepEqual(uploads[uploadCount], new Uint8Array(readback), 'typed upload owns the maintained bottom-origin texture layout');
		assert.deepEqual(Array.from(rowOutput.pixels), rows, 'native bottom-origin readback returns top-origin straight bytes');
		assert.deepEqual(Array.from(rowInput.pixels), rows, 'the caller retains unchanged top-origin bytes');
		readback = SOURCE;
		const stop = new AbortController(); let traps = 0;
		const reason = new Proxy({}, { get() { traps++; throw Error(); }, getPrototypeOf() { traps++; throw Error(); },
			getOwnPropertyDescriptor() { traps++; throw Error(); } });
		afterRead = () => { stop.abort(reason); };
		const outcome = await applyVideoExactBrowserEffectsFinishing(frame(), effects, stop.signal)
			.then(() => ({ rejected: false, reason: undefined }), error => ({ rejected: true, reason: error as unknown }));
		assert.equal(outcome.rejected, true); assert.equal(outcome.reason, reason); assert.equal(traps, 0);
		assert.equal((retainedOutput as Uint8Array | null)?.every(byte => byte === 0), true, 'abandoned readback is wiped after native settlement');
		const finalStop = new AbortController(), cleanup = new Error('texture cleanup');
		afterRead = () => { cleanupFailure = cleanup; finalStop.abort(null); };
		const final = await applyVideoExactBrowserEffectsFinishing(frame(), effects, finalStop.signal)
			.then(() => ({ error: undefined as unknown }), error => ({ error: error as unknown }));
		assert.ok(final.error instanceof AggregateError); assert.deepEqual(final.error.errors, [null, cleanup]);
		assert.equal(final.error.name, 'AbortError'); assert.equal((retainedOutput as Uint8Array | null)?.every(byte => byte === 0), true);
	} finally {
		if (nativeDocument) Object.defineProperty(globalThis, 'document', nativeDocument); else Reflect.deleteProperty(globalThis, 'document');
		if (nativeImage) Object.defineProperty(globalThis, 'ImageData', nativeImage); else Reflect.deleteProperty(globalThis, 'ImageData');
	}
});

test('mixed Frame dispatch rejects legacy accessors and unknown types before browser acquisition', async () => {
	let reads = 0;
	const legacy = createVideoEffect('color-adjust');
	const accessor = { ...legacy, params: Object.defineProperty({}, 'contrast', { enumerable: true, get() { reads++; return 1; } }) };
	for (const effect of [accessor, { ...legacy, type: 'constructor' }, { ...legacy, params: { future: 0 } }]) {
		await assert.rejects(applyVideoExactBrowserEffectsFinishing(frame(), [createVideoEffect('tone-ladder-v1'), effect], LIVE));
	}
	assert.equal(reads, 0);
});

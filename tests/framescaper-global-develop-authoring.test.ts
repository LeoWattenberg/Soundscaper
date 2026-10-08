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
	const programs: { shaders: { source: string }[] }[] = [], draws: number[] = []; let current: typeof programs[number] | undefined;
	const constants = new Map<string, number>();
	const constant = (name: string) => { if (!constants.has(name)) constants.set(name, constants.size + 100); return constants.get(name)!; };
	const calls: Record<string, unknown> = {
		getShaderParameter: () => true, getProgramParameter: () => true, getAttribLocation: () => 0, getUniformLocation: () => ({}),
		createShader: () => ({ source: '' }), shaderSource: (shader: { source: string }, source: string) => { shader.source = source; },
		createProgram: () => { const program = { shaders: [] as { source: string }[] }; programs.push(program); return program; },
		attachShader: (program: typeof programs[number], shader: { source: string }) => { program.shaders.push(shader); },
		createBuffer: () => ({}), createTexture: () => ({}), createFramebuffer: () => ({}), createVertexArray: () => ({}),
		checkFramebufferStatus: () => constant('FRAMEBUFFER_COMPLETE'), useProgram: (program: typeof programs[number]) => { current = program; },
		drawArrays: () => { const source = current?.shaders.find(shader => shader.source.includes('const int u_effect ='))?.source;
			if (source) draws.push(Number(/const int u_effect = (\d+)/u.exec(source)?.[1])); },
		readPixels: (_x: number, _y: number, _width: number, _height: number, _format: number, _type: number, pixels: Uint8Array) => { pixels.set(SOURCE); },
	};
	const gl = new Proxy(calls, { get(target, key) { if (typeof key !== 'string') return undefined;
		if (Object.hasOwn(target, key)) return target[key]; if (/^[A-Z][A-Z0-9_]*$/u.test(key)) return constant(key); return () => undefined; } });
	const canvas = () => ({ width: 2, height: 1, addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ width: 2, height: 1 }),
		getContext: (kind: string) => kind === '2d' ? { putImageData() {} } : gl });
	Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: canvas } });
	Object.defineProperty(globalThis, 'ImageData', { configurable: true, value: class { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} } });
	try {
		const output = await applyVideoExactBrowserEffectsFinishing(frame(), [createVideoEffect('white-balance-v1', { params: { temperature: 20 } }),
			createVideoEffect('pixelate', { params: { blockSize: 8 } }), createVideoEffect('tone-ladder-v1', { params: { exposure: 1 } })], LIVE);
		assert.deepEqual(draws.filter(code => code === 18 || code === 2 || code === 19), [18, 2, 19]);
		assert.equal(programs.some(program => program.shaders.some(shader => shader.source.includes('global_develop_rgb'))), true);
		assert.equal(output.pixels.length, SOURCE.length);
	} finally {
		if (nativeDocument) Object.defineProperty(globalThis, 'document', nativeDocument); else Reflect.deleteProperty(globalThis, 'document');
		if (nativeImage) Object.defineProperty(globalThis, 'ImageData', nativeImage); else Reflect.deleteProperty(globalThis, 'ImageData');
	}
});

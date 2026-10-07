/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { reprobeSource, rewriteSourceMedia, updateSource } from '../src/common/editor/commands/project-source-record-runtime.js';
import { createAudioSource, createVideoSource } from '../src/common/editor/project-media-factory.ts';

function fixture(video: boolean) {
	const source = video ? createVideoSource({ id: 'target', storageKey: 'target', frameCount: 480_000,
		sampleRate: 48_000, width: 640, height: 360, frameRate: { num: 30, den: 1 }, sourceFrameCount: 300,
		hasAudio: false, videoCodec: 'vp9', audioCodec: null }) : createAudioSource({ id: 'target', storageKey: 'target',
		frameCount: 1000, channelCount: 1, sampleRate: 48_000 });
	const sources: (Record<string, unknown> & { id: string })[] = Array.from({ length: 120 }, (_, index) => (
		{ ...source, id: `other-${String(index)}` }
	));
	sources.push({ ...source });
	const clips = Array.from({ length: 120 }, (_, index) => ({ id: `clip-${String(index)}`, kind: video ? 'video' : 'audio',
		sourceId: 'target', sourceStartFrame: 0, sourceDurationFrames: 10, durationFrames: 10 }));
	return { sampleRate: 48_000, sources, clips: clips.slice(0, 60), projectBin: { clips: clips.slice(60) } };
}

for (const mode of ['reprobe', 'rewrite'] as const) void test(`${mode} resolves source identity once across dense timeline and bin bounds`, context => {
	const project = fixture(mode === 'reprobe');
	let reads = 0;
	project.sources = project.sources.map(source => new Proxy(source, { get(target, property, receiver) {
		if (property === 'id') reads++;
		return Reflect.get(target, property, receiver) as unknown;
	} }));
	const clips = [...project.clips, ...project.projectBin.clips];
	if (mode === 'reprobe') reprobeSource(project, { sourceId: 'target', changes: {},
		clips: clips.map(clip => ({ clipId: clip.id, sourceInFrame: 0, sourceFrameCount: 10 })) });
	else rewriteSourceMedia(project, { sourceId: 'target', changes: { storageKey: 'trimmed', frameCount: 100 },
		clips: clips.map(clip => ({ clipId: clip.id, sourceStartFrame: 0 })) });
	context.diagnostic(`121 sources / 120 references: ${String(reads)} source ID reads`);
	assert.ok(reads <= 900, `${String(reads)} source identity reads`);
	assert.equal(project.sources[120]!.storageKey, mode === 'reprobe' ? 'target' : 'trimmed');
	assert.equal(project.projectBin.clips.length, 60);
});

void test('rewrite reference identities fill their Set without a mapped ID array', () => {
	const project = fixture(false);
	const moves = [...project.clips, ...project.projectBin.clips].map(clip => ({ clipId: clip.id, sourceStartFrame: 0 }));
	const previous = Array.prototype.map; let calls = 0;
	Array.prototype.map = function <U>(callback: (value: unknown, index: number, array: unknown[]) => U, thisArg?: unknown): U[] {
		if (this.length === 120 && (this[0] as { sourceId?: unknown } | undefined)?.sourceId === 'target') calls++;
		return Reflect.apply(previous, this, [callback, thisArg]) as U[];
	};
	try { rewriteSourceMedia(project, { sourceId: 'target', changes: { storageKey: 'trimmed', frameCount: 100 }, clips: moves }); }
	finally { Array.prototype.map = previous; }
	assert.equal(calls, 0);
});

void test('source updates reuse their private field admission table', () => {
	const project = fixture(false); const original = globalThis.Set; let constructions = 0;
	globalThis.Set = new Proxy(original, { construct(target, args, newTarget) {
		if (Array.isArray(args[0]) && args[0][0] === 'name' && args[0].includes('mimeType')) constructions++;
		return Reflect.construct(target, args, newTarget) as Set<unknown>;
	} });
	try { updateSource(project, 'target', { name: 'renamed' }); } finally { globalThis.Set = original; }
	assert.equal(constructions, 0); assert.equal(project.sources[120]!.name, 'renamed');
});

void test('rewrite retains first source authority, duplicate clip last payload and bounds-error partial publication', () => {
	const project = fixture(false);
	project.sources.push({ ...project.sources[120]!, frameCount: 1 });
	const clips = [...project.clips, ...project.projectBin.clips];
	const moves = clips.map(clip => ({ clipId: clip.id, sourceStartFrame: 0 }));
	moves.push({ clipId: 'clip-0', sourceStartFrame: 101 });
	assert.throws(() => rewriteSourceMedia(project, { sourceId: 'target', changes: { storageKey: 'trimmed', frameCount: 100 }, clips: moves }),
		{ name: 'RangeError', message: 'Clip exceeds its source bounds.' });
	assert.equal(project.sources[120]!.storageKey, 'trimmed');
	assert.equal(project.sources[121]!.storageKey, 'target');
	assert.equal(project.clips[0]!.sourceStartFrame, 101);
	assert.equal(project.projectBin.clips[0]!.sourceStartFrame, 0);
});

for (const mode of ['reprobe', 'rewrite'] as const) void test(`${mode} payload ranges fill a Map without mapped tuple intermediates`, () => {
	const project = fixture(mode === 'reprobe');
	const clips = [...project.clips, ...project.projectBin.clips];
	const payload = clips.map(clip => mode === 'reprobe' ? { clipId: clip.id, sourceInFrame: 0, sourceFrameCount: 10 } : { clipId: clip.id, sourceStartFrame: 0 });
	const original = Array.prototype.map; let mapped = 0;
	Array.prototype.map = function <U>(callback: (value: unknown, index: number, array: unknown[]) => U, thisArg?: unknown): U[] {
		if (this === payload) mapped++; return Reflect.apply(original, this, [callback, thisArg]) as U[];
	};
	try {
		if (mode === 'reprobe') reprobeSource(project, { sourceId: 'target', changes: {}, clips: payload });
		else rewriteSourceMedia(project, { sourceId: 'target', changes: { storageKey: 'trimmed', frameCount: 100 }, clips: payload });
	} finally { Array.prototype.map = original; }
	assert.equal(mapped, 0);
});

for (const mode of ['reprobe', 'rewrite'] as const) void test(`${mode} retains the matched source from an accessor slot`, () => {
	const project = fixture(mode === 'reprobe'), initial = project.sources[120]!;
	const changed = createAudioSource({ id: 'target', storageKey: 'second', frameCount: 1000, channelCount: 1, sampleRate: 48_000 });
	project.clips = []; project.projectBin.clips = [];
	let reads = 0, stored: Record<string, unknown> | undefined;
	Object.defineProperty(project.sources, '120', { enumerable: true, configurable: true,
		get() { reads++; return stored || (reads === 1 ? initial : changed); }, set(value: Record<string, unknown>) { stored = value; } });
	if (mode === 'reprobe') reprobeSource(project, { sourceId: 'target', changes: {}, clips: [] });
	else rewriteSourceMedia(project, { sourceId: 'target', changes: { storageKey: 'trimmed', frameCount: 100 }, clips: [] });
	assert.equal(reads, 2);
	assert.equal(stored?.kind, mode === 'reprobe' ? 'video' : 'audio');
	assert.equal(stored?.storageKey, mode === 'reprobe' ? 'target' : 'trimmed');
});

for (const mode of ['reprobe', 'rewrite'] as const) void test(`${mode} publication honors an earlier source introduced by a changes getter`, () => {
	const project = fixture(mode === 'reprobe'); project.sources[0]!.storageKey = 'other';
	project.clips = []; project.projectBin.clips = [];
	const changes = Object.defineProperty({}, mode === 'reprobe' ? 'width' : 'storageKey', { enumerable: true,
		get() { project.sources[0]!.id = 'target'; return mode === 'reprobe' ? 641 : 'trimmed'; } });
	if (mode === 'reprobe') reprobeSource(project, { sourceId: 'target', changes, clips: [] });
	else rewriteSourceMedia(project, { sourceId: 'target', changes, clips: [] });
	assert.equal(project.sources[0]!.storageKey, mode === 'reprobe' ? 'target' : 'trimmed');
	assert.equal(project.sources[120]!.storageKey, 'target');
});

void test('dense reprobe bounds keep per-reference source authority for inherited/coercing bound values', () => {
	for (const inherited of [false, true]) {
		const project = fixture(true); project.sources[0]!.sourceFrameCount = 1;
		const clip = project.clips[0]!;
		if (inherited) { delete (clip as { sourceStartFrame?: unknown }).sourceStartFrame;
			Object.setPrototypeOf(clip, { get sourceStartFrame() { project.sources[0]!.id = 'target'; return 0; } }); }
		else Object.assign(clip, { sourceStartFrame: { valueOf() { project.sources[0]!.id = 'target'; return 0; } } });
		assert.throws(() => reprobeSource(project, { sourceId: 'target', changes: {}, clips: [] }), { name: 'RangeError', message: 'Clip exceeds its source bounds.' });
	}
});

void test('dense reprobe payload preserves a custom mapped-array species iterator', () => {
	const project = fixture(true), clips = [...project.clips, ...project.projectBin.clips];
	const payload = clips.map(clip => ({ clipId: clip.id, sourceInFrame: 1, sourceFrameCount: 9 }));
	Object.defineProperty(payload, 'constructor', { value: { [Symbol.species]: class extends Array<unknown> {
		[Symbol.iterator]() { return ([] as unknown[]).values(); }
	} } });
	reprobeSource(project, { sourceId: 'target', changes: {}, clips: payload });
	assert.equal(project.clips[0]!.sourceStartFrame, 0);
	assert.equal(project.projectBin.clips[0]!.sourceStartFrame, 0);
});

void test('dense reprobe bounds keep inherited source-kind and custom source find behavior', () => {
	for (const customFind of [false, true]) {
		const project = fixture(true); project.sources[0]!.sourceFrameCount = 1;
		if (customFind) { let finds = 0;
			Object.defineProperty(project.sources, 'find', { value: () => project.sources[finds++ < 2 ? 120 : 0] });
		} else { const selected = { ...project.sources[120]! }; delete selected.kind;
			Object.setPrototypeOf(selected, { get kind() { project.sources[0]!.id = 'target'; return 'video'; } });
			const payload: unknown[] = []; Object.defineProperty(payload, 'map', { value: () => { project.sources[120] = selected; return []; } });
			assert.throws(() => reprobeSource(project, { sourceId: 'target', changes: {}, clips: payload }), { name: 'RangeError', message: 'Clip exceeds its source bounds.' });
			continue; }
		assert.throws(() => reprobeSource(project, { sourceId: 'target', changes: {}, clips: [] }), { name: 'RangeError', message: 'Clip exceeds its source bounds.' });
	}
});

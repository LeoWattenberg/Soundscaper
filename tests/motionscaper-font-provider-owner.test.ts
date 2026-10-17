/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import CanvasKitInit from 'canvaskit-wasm';
import type { CanvasKit } from 'canvaskit-wasm';
import { createMotionFontProviderOwner } from '../src/common/editor/motion-canvaskit-font-owner.ts';
import { createMotionParagraph } from '../src/common/editor/motion-canvaskit-text.ts';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { createMotionPreviewRenderSession } from '../src/common/editor/controller/composition/motion-preview-render-session.ts';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
import { renderMotionCompositionFrame } from '../src/common/editor/motion-composition-renderer.ts';

const kit = await CanvasKitInit();
const bytes = new Uint8Array(await readFile(new URL('../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2', import.meta.url)));
const other = new Uint8Array(await readFile(new URL('../node_modules/@fontsource/nunito-sans/files/nunito-sans-latin-400-normal.woff2', import.meta.url)));
const input = [{ id: 'font', bytes }];
const document = { runs: [{ text: 'office Grüße', fontAssetId: 'font', fontSize: 14, color: [1, 1, 1, 1] as const, tracking: 0 }], align: 'left' as const, lineHeight: 1, boxSize: [128, 32] as const };
function observed() {
	let created = 0, deleted = 0, registrations = 0;
	const runtime: CanvasKit = { ...kit, TypefaceFontProvider: { ...kit.TypefaceFontProvider, Make() {
		created++; const value = kit.TypefaceFontProvider.Make(), remove = value.delete.bind(value), register = value.registerFont.bind(value);
		value.delete = () => { deleted++; remove(); };
		value.registerFont = (data, family) => { registrations++; register(data, family); };
		return value;
	} } };
	return { kit: runtime, snapshot: () => ({ created, deleted, registrations }) };
}
function project() {
	const digest = createHash('sha256').update(bytes).digest('hex');
	const asset = { id: 'font', name: 'Inter', kind: 'font' as const, family: 'Inter', style: 'Regular', byteLength: bytes.length, sha256: digest, storageKey: `motion-sha256:${digest}`, mimeType: 'font/woff2' };
	const base = createMotionscaperProject({ id: 'fonts', title: 'Font lease', compositionId: 'main', width: 128, height: 32, durationFrames: 200 });
	const layer = createMotionLayer({ id: 'text', name: 'Text', durationFrames: 200, content: { kind: 'text', document: {
		runs: [{ text: document.runs[0].text, fontAssetId: 'font', fontSize: motionScalar(14), color: motionColor([1, 1, 1, 1]), tracking: motionScalar(0) }], align: 'left', lineHeight: motionScalar(1), boxSize: motionVector([128, 32]),
	} } });
	return { ...base, assets: [asset], compositions: [{ ...base.compositions[0]!, layers: [layer] }] };
}

test('Motion owned paragraph fonts reuse exact bytes across copies and keep changed imported/fallback identities separate', () => {
	const seen = observed(), owner = createMotionFontProviderOwner(seen.kit);
	for (let i = 0; i < 40; i++) createMotionParagraph(seen.kit, document, [{ id: 'font', bytes: bytes.slice() }], [], owner).dispose();
	assert.deepEqual(seen.snapshot(), { created: 1, deleted: 0, registrations: 1 });
	createMotionParagraph(seen.kit, document, [{ id: 'font', bytes: other }], [], owner).dispose();
	createMotionParagraph(seen.kit, document, input, [{ id: 'fallback', bytes: other }], owner).dispose();
	assert.deepEqual(seen.snapshot(), { created: 3, deleted: 0, registrations: 4 });
	assert.equal(owner.snapshot().fontBytes, bytes.length * 2 + other.length * 2);
	owner.dispose(); owner.dispose(); assert.equal(seen.snapshot().deleted, 3);
	assert.deepEqual(owner.snapshot(), { providers: 0, fontBytes: 0, activeLeases: 0, disposed: true });
	assert.throws(() => createMotionParagraph(seen.kit, document, input, [], owner), /disposed/u);
});

test('Motion font ownership bounds live encoded closures, protects active paragraphs and deletes LRU providers', () => {
	const seen = observed(), owner = createMotionFontProviderOwner(seen.kit, { maximumProviders: 3, maximumFontBytes: bytes.length * 2 });
	const first = owner.acquire(seen.kit, input, []);
	const second = owner.acquire(seen.kit, [{ id: 'b', bytes }], []);
	assert.throws(() => owner.acquire(seen.kit, [{ id: 'c', bytes }], []), /active|budget/u);
	assert.deepEqual(seen.snapshot(), { created: 2, deleted: 0, registrations: 2 });
	first.release(); first.release();
	const third = owner.acquire(seen.kit, [{ id: 'c', bytes }], []);
	assert.equal(seen.snapshot().deleted, 1); assert.equal(owner.snapshot().fontBytes, bytes.length * 2);
	owner.dispose(); assert.equal(seen.snapshot().deleted, 1, 'live paragraphs retain their exact provider until released');
	second.release(); third.release(); assert.equal(seen.snapshot().deleted, 3); assert.equal(owner.snapshot().fontBytes, 0);
});

test('Motion font owner refuses oversized and foreign-kit acquisitions and releases failed registration/shaping', () => {
	const seen = observed(), owner = createMotionFontProviderOwner(seen.kit, { maximumProviders: 1, maximumFontBytes: bytes.length });
	assert.throws(() => owner.acquire(kit, input, []), /runtime/u);
	assert.throws(() => owner.acquire(seen.kit, input, [{ id: 'fallback', bytes }]), /budget/u);
	assert.equal(seen.snapshot().created, 0);
	assert.throws(() => createMotionParagraph(seen.kit, document, [{ id: 'font', bytes: new Uint8Array([1, 2, 3]) }], [], owner), /supported font/u);
	assert.deepEqual(seen.snapshot(), { created: 1, deleted: 1, registrations: 0 });
	assert.throws(() => createMotionParagraph(seen.kit, { ...document, runs: [{ ...document.runs[0], text: '👽' }] }, input, [], owner), /missing glyph/u);
	assert.equal(owner.snapshot().activeLeases, 0);
	owner.dispose(); assert.equal(seen.snapshot().deleted, 2);
});

test('Motion owned font rasterization preserves exact shaped pixels and bounds native allocation across duration', async () => {
	const seen = observed(), owner = createMotionFontProviderOwner(seen.kit), value = project();
	const frame = compileMotionscaperProject(value).evaluate({ compositionId: 'main', time: 0 });
	const resources = { assets: value.assets, fallbackFonts: [], loadAsset: () => Promise.resolve(bytes) };
	const reference = await renderMotionCompositionFrame(frame, { rasterizer: createCanvasKitMotionRasterizer(seen.kit, resources) });
	const rasterizer = createCanvasKitMotionRasterizer(seen.kit, { ...resources, fontProviders: owner });
	const first = await renderMotionCompositionFrame(frame, { rasterizer }); assert.deepEqual(first.pixels, reference.pixels);
	const registrations = seen.snapshot().registrations;
	const probe = () => { const memory = seen.kit.Malloc(Uint8Array, 4 * 1024 * 1024), address = memory.byteOffset; seen.kit.Free(memory); return address; };
	const before = probe();
	for (let i = 0; i < 320; i++) {
		const output = await renderMotionCompositionFrame(frame, { rasterizer });
		assert.deepEqual(output.pixels, reference.pixels);
	}
	assert.equal(seen.snapshot().registrations, registrations); assert.equal(owner.snapshot().providers, 1);
	assert.ok(Math.abs(probe() - before) < 1024 * 1024, 'the native allocation frontier remains bounded instead of retaining a fresh ~100 KiB typeface per frame');
	owner.dispose(); assert.equal(seen.snapshot().deleted, seen.snapshot().created);
});

test('Motion persistent preview owns fonts across per-frame rasterizers and releases on revision switch and disposal', async () => {
	const seen = observed(), value = project(), signal = new AbortController().signal;
	const session = createMotionPreviewRenderSession({ backend: 'host-cpu', maximumAssetBytes: 1024 * 1024, maximumWorkingBytes: 64 * 1024 * 1024,
		loadRuntime: () => Promise.resolve({ kit: seen.kit, fallbackFonts: [] }) });
	await session.setProject(value, () => Promise.resolve(bytes), signal);
	for (let index = 0; index < 8; index++) await session.render({ compositionId: 'main', time: { num: index, den: 30 }, generation: 1 }, signal);
	assert.deepEqual(seen.snapshot(), { created: 1, deleted: 0, registrations: 1 });
	await session.setProject({ ...value, revision: 1 }, () => Promise.resolve(bytes), signal);
	assert.equal(seen.snapshot().deleted, 1);
	await session.render({ compositionId: 'main', time: { num: 0, den: 1 }, generation: 2 }, signal);
	session.dispose(); assert.deepEqual(seen.snapshot(), { created: 2, deleted: 2, registrations: 2 });
});


test('Motion owner entry cap and active paragraph disposal preserve native handles until the last consumer finishes', () => {
	const seen = observed(), owner = createMotionFontProviderOwner(seen.kit, { maximumProviders: 1 });
	const paragraph = createMotionParagraph(seen.kit, document, input, [], owner);
	assert.throws(() => owner.acquire(seen.kit, [{ id: 'other', bytes }], []), /active/u);
	owner.dispose(); assert.equal(seen.snapshot().deleted, 0);
	paragraph.paragraph.layout(128); assert.ok(paragraph.paragraph.getHeight() > 0);
	paragraph.dispose(); paragraph.dispose(); assert.equal(seen.snapshot().deleted, 1);
});

test('Motion preview releases the owned provider when a later source read fails or disposal cancels an active frame', async () => {
	const seen = observed(), value = project(), signal = new AbortController().signal;
	const session = createMotionPreviewRenderSession({ backend: 'host-cpu', maximumAssetBytes: 1024 * 1024, maximumWorkingBytes: 64 * 1024 * 1024,
		loadRuntime: () => Promise.resolve({ kit: seen.kit, fallbackFonts: [] }) });
	await session.setProject(value, () => Promise.resolve(bytes), signal);
	await session.render({ compositionId: 'main', time: { num: 0, den: 1 }, generation: 1 }, signal);
	await session.setProject({ ...value, revision: 1 }, () => Promise.reject(new Error('Original unavailable')), signal);
	await assert.rejects(session.render({ compositionId: 'main', time: { num: 0, den: 1 }, generation: 2 }, signal), /Original unavailable/u);
	assert.equal(seen.snapshot().deleted, 1);
	let complete!: (value: Uint8Array) => void, started!: () => void;
	const reading = new Promise<void>(resolve => { started = resolve; });
	await session.setProject({ ...value, revision: 2 }, () => { started(); return new Promise<Uint8Array>(resolve => { complete = resolve; }); }, signal);
	const pending = session.render({ compositionId: 'main', time: { num: 0, den: 1 }, generation: 3 }, signal);
	await reading; session.dispose(); complete(bytes);
	await assert.rejects(pending, { name: 'AbortError' });
	assert.deepEqual(seen.snapshot(), { created: 1, deleted: 1, registrations: 1 });
});

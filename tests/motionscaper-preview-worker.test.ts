/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import CanvasKitInit from 'canvaskit-wasm';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createMotionPreviewWorkerRuntime } from '../src/common/editor/motion-preview-worker-runtime.ts';
import { createMotionPreviewWorkerBackend } from '../src/common/editor/controller/composition/motion-preview-worker-backend.ts';
import { createMotionPreviewRenderSession } from '../src/common/editor/controller/composition/motion-preview-render-session.ts';
import type { MotionPreviewWorkerPort, MotionPreviewWorkerScope } from '../src/common/editor/motion-preview-worker-protocol.ts';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
import { createMotionSurface } from '../src/common/editor/motion-surface.ts';
import type { MotionAsset } from '../src/common/editor/motion-asset.ts';

const runtime = CanvasKitInit().then((kit) => ({ kit, fallbackFonts: [] }));
const signal = () => new AbortController().signal;
const bytes = new Uint8Array(await readFile(new URL('../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2', import.meta.url)));
const digest = createHash('sha256').update(bytes).digest('hex');
const font: MotionAsset = { id: 'font', kind: 'font', name: 'Inter', family: 'Inter', style: 'Regular', sha256: digest, byteLength: bytes.length, storageKey: `motion-sha256:${digest}`, mimeType: 'font/woff2' };
const base = createMotionscaperProject({ id: 'project', title: 'Worker', compositionId: 'main', width: 16, height: 16 });
const text = createMotionLayer({ id: 'text', name: 'Text', durationFrames: 300, content: { kind: 'text', document: {
	runs: [{ text: 'A', fontAssetId: 'font', fontSize: motionScalar(12), color: motionColor([1, 1, 1, 1]), tracking: motionScalar(0) }],
	align: 'left', lineHeight: motionScalar(1), boxSize: motionVector([16, 16]),
} } });
const project = { ...base, assets: [font], compositions: [{ ...base.compositions[0]!, layers: [text] }] };
const request = (generation = 1) => ({ compositionId: 'main', time: { num: 0, den: 1 }, generation });

function transport(maximumAssetBytes = 64 * 1024 * 1024) {
	const host = new EventTarget(); const worker = new EventTarget(); let terminated = false;
	const scope: MotionPreviewWorkerScope = {
		postMessage(message, transfer = []) { const data = structuredClone(message, { transfer }); queueMicrotask(() => { if (!terminated) host.dispatchEvent(new MessageEvent('message', { data })); }); },
		addEventListener(type, listener) { worker.addEventListener(type, listener as EventListener); }, removeEventListener(type, listener) { worker.removeEventListener(type, listener as EventListener); },
	};
	const remote = createMotionPreviewWorkerRuntime(scope, (options) => createMotionPreviewRenderSession({ ...options, loadRuntime: () => runtime }));
	const port: MotionPreviewWorkerPort = {
		postMessage(message, transfer = []) { const data = structuredClone(message, { transfer }); queueMicrotask(() => { if (!terminated) worker.dispatchEvent(new MessageEvent('message', { data })); }); },
		addEventListener(type, listener) { host.addEventListener(type, listener as EventListener); }, removeEventListener(type, listener) { host.removeEventListener(type, listener as EventListener); },
		terminate() { terminated = true; remote.dispose(); },
	};
	return Object.assign(createMotionPreviewWorkerBackend(port, { maximumAssetBytes, maximumWorkingBytes: 16 * 1024 * 1024 }), { failTransport: () => host.dispatchEvent(new Event('error')) });
}

test('M05 preview pixels always use the display sRGB transfer even when the delivery contract is Rec.709', async () => {
	const session = createMotionPreviewRenderSession({ backend: 'host-cpu', maximumAssetBytes: 1024, maximumWorkingBytes: 1024 * 1024, loadRuntime: () => runtime });
	const solid = createMotionLayer({ id: 'gray', name: 'Gray', durationFrames: 300, content: { kind: 'solid', color: motionColor([0.5, 0.5, 0.5, 1]), size: motionVector([16, 16]) } });
	await session.setProject({ ...base, compositions: [{ ...base.compositions[0]!, color: { ...base.compositions[0]!.color, outputSpace: 'rec709' }, layers: [solid] }] }, () => Promise.reject(new Error('No asset expected')), signal());
	const frame = await session.render(request(), signal());
	assert.deepEqual([...frame.rgba.slice(0, 4)], [188, 188, 188, 255]); session.dispose();
});

test('M05 persistent worker retains digest-verified font bytes and does not detach caller-owned assets', async () => {
	const backend = transport(); let loads = 0;
	await backend.setProject(project, () => { loads++; return Promise.resolve(bytes); }, signal());
	const first = await backend.render(request(), signal()); const second = await backend.render(request(2), signal());
	assert.equal(first.backend, 'worker-cpu'); assert.equal(second.generation, 2);
	assert.deepEqual(first.rgba, second.rgba); assert.equal(loads, 1); assert.equal(bytes.length, font.byteLength);
	assert.ok(first.rgba.some((value) => value > 0)); backend.dispose(); backend.dispose();
});

test('M05 worker cancellation closes an outstanding asset request and subsequent rendering can proceed', async () => {
	const backend = transport(); let started!: () => void; const loading = new Promise<void>((resolve) => { started = resolve; }); let first = true;
	await backend.setProject(project, (_asset, sourceSignal) => {
		if (!first) return Promise.resolve(bytes); first = false; started();
		return new Promise((_resolve, reject) => sourceSignal!.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
	}, signal());
	const cancellation = new AbortController(); const pending = backend.render(request(), cancellation.signal); await loading; cancellation.abort();
	await assert.rejects(pending, { name: 'AbortError' });
	assert.ok((await backend.render(request(2), signal())).rgba.some((value) => value > 0)); backend.dispose();
});

test('M05 worker refuses oversized or corrupt assets before publishing a frame', async () => {
	const bounded = transport(1); let loads = 0;
	await bounded.setProject(project, () => { loads++; return Promise.resolve(bytes); }, signal());
	await assert.rejects(bounded.render(request(), signal()), /decode budget/iu); assert.equal(loads, 0); bounded.dispose();
	const corrupt = transport(); await corrupt.setProject(project, () => Promise.resolve(new Uint8Array([1])), signal());
	await assert.rejects(corrupt.render(request(), signal()), /length|digest/iu); corrupt.dispose();
});

test('M05 worker asks the host for exact-source-time footage pixels without transferring the media file', async () => {
	const backend = transport(); const sha256 = 'a'.repeat(64);
	const footage: MotionAsset = { id: 'video', kind: 'footage', name: 'Video', sha256, byteLength: 100_000_000, storageKey: `motion-sha256:${sha256}`, mimeType: 'video/mp4',
		width: 16, height: 16, hasAlpha: true, hasAudio: false, frameRate: { num: 30, den: 1 }, duration: { num: 2, den: 1 } };
	const video = createMotionLayer({ id: 'video', name: 'Video', durationFrames: 300, content: { kind: 'footage', assetId: 'video', audioEnabled: false, audioGain: motionScalar(1) } });
	await backend.setProject({ ...base, assets: [footage], compositions: [{ ...base.compositions[0]!, layers: [video] }] }, () => Promise.reject(new Error('Do not request the whole media file')), signal(), (asset, time) => {
		assert.equal(asset.id, 'video'); assert.deepEqual(time, { num: 1, den: 2 }); return Promise.resolve(createMotionSurface(16, 16, [1, 0, 0, 0.5]));
	});
	const result = await backend.render({ ...request(), time: { num: 1, den: 2 } }, signal());
	assert.deepEqual([...result.rgba.slice(0, 4)], [255, 0, 0, 128]); backend.dispose();
});


test('M05 worker transport failure aborts an outstanding host asset read before fallback can start', async () => {
	const backend = transport(); let started!: () => void; const loading = new Promise<void>((resolve) => { started = resolve; }); let aborted = false;
	await backend.setProject(project, (_asset, sourceSignal) => {
		started(); return new Promise((_resolve, reject) => sourceSignal!.addEventListener('abort', () => {
			aborted = true; reject(new DOMException('Cancelled', 'AbortError'));
		}, { once: true }));
	}, signal());
	const pending = backend.render(request(), signal()); await loading; backend.failTransport();
	await assert.rejects(pending, { name: 'MotionPreviewWorkerUnavailableError' }); assert.equal(aborted, true); backend.dispose();
});

/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { prepareMotionscaperAeRender } from '../src/motionscaper/editor-ae-render-export.ts';
import { createMotionscaperAeRenderPackage } from '../src/motionscaper/editor-ae-render-package.ts';
const source = () => createMotionscaperProject({ id: 'source', title: 'Exact source', compositionId: 'comp', width: 8, height: 8, durationFrames: 3 });
test('Motion AE rendered package refuses unreviewed acknowledgement, forged preparations and cancellation before reading assets', async () => {
	const prepared = prepareMotionscaperAeRender(source(), 'comp'); let reads = 0; const store = { async readAsset() { reads++; return null; } }, signal = new AbortController().signal;
	await assert.rejects(createMotionscaperAeRenderPackage(prepared, store, { acknowledgeImageOnly: false, signal }), /acknowledge/iu);
	await assert.rejects(createMotionscaperAeRenderPackage({ ...prepared }, store, { acknowledgeImageOnly: true, signal }), /review/iu);
	const abort = new AbortController(); abort.abort(); await assert.rejects(createMotionscaperAeRenderPackage(prepared, store, { acknowledgeImageOnly: true, signal: abort.signal }), { name: 'AbortError' }); assert.equal(reads, 0);
});
test('Motion AE rendered package retains full asset closure and refuses oversized custody before starting rendering', async () => {
	const project = source(), sha256 = 'a'.repeat(64); let reads = 0;
	const prepared = prepareMotionscaperAeRender({ ...project, assets: [{ kind: 'font', id: 'unused', name: 'Unused original.ttf', family: 'Original', style: 'Regular', mimeType: 'font/ttf', byteLength: 134217728, sha256, storageKey: `motion-sha256:${sha256}` }] }, 'comp');
	await assert.rejects(createMotionscaperAeRenderPackage(prepared, { async readAsset() { reads++; return null; } }, { acknowledgeImageOnly: true, signal: new AbortController().signal }), /128 MiB|memory/iu); assert.equal(reads, 0);
});

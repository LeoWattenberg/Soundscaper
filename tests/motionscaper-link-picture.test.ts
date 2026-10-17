/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import CanvasKitInit from 'canvaskit-wasm';
import { createMotionscaperProject, createMotionLayer } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { compileMotionCompositionLink } from '../src/common/editor/motion-link-rendering.ts';
import { motionCompositionLinkFrameToRgba8, renderMotionCompositionLinkPicture } from '../src/common/editor/motion-link-picture-source.ts';
import { createCanvasKitMotionRasterizer } from '../src/common/editor/motion-canvaskit-rasterizer.ts';
import { createMotionSurface, decodeMotionChannel, encodeMotionChannel } from '../src/common/editor/motion-surface.ts';
import { motionColor, motionVector } from '../src/common/editor/motion-property.ts';
const identity = { projectId: 'motion', compositionId: 'main', revisionDigest: 'a'.repeat(64) };
test('M10 picture boundary encodes straight display sRGB after unpremultiplication and explicitly quantizes alpha', () => {
	const surface = createMotionSurface(4, 1); surface.pixels.set([0.125, 0.25, 0.5, 0.5, 0, 0, 0, 0, 0.00025, 0, 0, 0.001, 0.18, 0.01, 1, 1]); const original = surface.pixels.slice();
	const picture = motionCompositionLinkFrameToRgba8({ identity, time: { num: 1, den: 30 }, surface: { ...surface, consumedOperationIds: [] } });
	assert.equal(picture.encoding, 'canvas-srgb'); assert.equal(picture.alphaMode, 'straight'); assert.equal(picture.precision, 'unorm8'); assert.equal(picture.identity.revisionDigest, identity.revisionDigest);
	assert.deepEqual([...picture.pixels.slice(0, 4)], [137, 188, 255, 128]); assert.deepEqual([...picture.pixels.slice(4, 12)], Array(8).fill(0)); assert.deepEqual(surface.pixels, original);
	for (const index of [0, 1, 2, 12, 13, 14]) { const offset = index - index % 4, alpha: number = surface.pixels[offset + 3]!; assert.ok(Math.abs(picture.pixels[index]! / 255 - encodeMotionChannel(surface.pixels[index]! / alpha, 'srgb')) <= 0.5 / 255 + 1e-7); }
	assert.ok(Math.abs(picture.pixels[3]! / 255 - 0.5) <= 0.5 / 255); assert.ok(Math.abs(decodeMotionChannel(picture.pixels[0]! / 255, 'srgb') * picture.pixels[3]! / 255 - 0.125) < 0.002);
});
test('M10 picture conversion admits combined float and byte surfaces before allocation and rejects malformed or cancelled input', () => {
	const frame = { identity, time: { num: 0, den: 1 }, surface: { ...createMotionSurface(2, 2), consumedOperationIds: [] } };
	assert.throws(() => motionCompositionLinkFrameToRgba8(frame, { maximumWorkingBytes: 79 }), /budget/iu);
	assert.equal(motionCompositionLinkFrameToRgba8(frame, { maximumWorkingBytes: 80 }).pixels.length, 16);
	const cancellation = new AbortController(); cancellation.abort(); assert.throws(() => motionCompositionLinkFrameToRgba8(frame, { signal: cancellation.signal }), { name: 'AbortError' });
	frame.surface.pixels[0] = 1; assert.throws(() => motionCompositionLinkFrameToRgba8(frame), /premultiplied/iu);
});
test('M10 linked picture source pins saved revision and converts rec709 authored output to declared display sRGB', async () => {
	const kit = await CanvasKitInit(); const rasterizer = createCanvasKitMotionRasterizer(kit, { assets: [], fallbackFonts: [], async loadAsset() { throw new Error('Unexpected asset.'); } });
	const project = createMotionscaperProject({ id: 'motion', title: 'Picture', compositionId: 'main', width: 2, height: 2 });
	const layer = createMotionLayer({ id: 'card', name: 'Card', durationFrames: 300, content: { kind: 'solid', size: motionVector([2, 2]), color: motionColor([0.25, 0.5, 1, 0.5]) } });
	const revision = createMotionscaperRevision({ ...project, revision: 3, compositions: [{ ...project.compositions[0]!, color: { ...project.compositions[0]!.color, outputSpace: 'rec709' }, layers: [layer] }] });
	const plan = compileMotionCompositionLink(createMotionCompositionOffer('main', revision)); let acquired = 0, released = 0;
	const options = { purpose: 'final' as const, acquire: async () => { acquired++; return { rasterizer, async release() { released++; } }; } };
	await assert.rejects(renderMotionCompositionLinkPicture(plan, 0, { ...options, maximumWorkingBytes: 79 }), /budget/iu); assert.equal(acquired, 0);
	const picture = await renderMotionCompositionLinkPicture(plan, { num: 1, den: 30 }, options); assert.deepEqual([...picture.pixels.slice(0, 4)], [137, 188, 255, 128]); assert.equal(picture.identity.revisionDigest, revision.digest); assert.deepEqual(picture.time, { num: 1, den: 30 }); assert.equal(acquired, 1); assert.equal(released, 1);
});

/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { prepareMotionscaperAeRender, motionAeRenderedExchange, assertPreparedMotionscaperAeRender } from '../src/motionscaper/editor-ae-render-export.ts';
import { prepareMotionAeHostImport } from '../src/common/editor/motion-ae-host-import-plan.ts';
const source = (durationFrames = 3) => createMotionscaperProject({ id: 'source', title: 'Exact source', compositionId: 'comp', width: 8, height: 8, frameRate: { num: 30000, den: 1001 }, durationFrames });
test('Motion AE rendered export pins full composition revision, rational clock and authored quality independent of work area', () => {
	const project = source(), comp = project.compositions[0]!;
	const prepared = prepareMotionscaperAeRender({ ...project, compositions: [{ ...comp, workArea: { startFrame: { num: 1, den: 1 }, endFrame: { num: 2, den: 1 } }, temporal: { shutterOpenFrames: { num: 0, den: 1 }, shutterCloseFrames: { num: 1, den: 2 }, samples: 3 }, depthOfFieldSamples: 4 }] }, 'comp');
	assert.equal(prepared.plan.firstFrame, 0); assert.equal(prepared.plan.frameCount, 3); assert.deepEqual(prepared.plan.frameRate, { num: 30000, den: 1001 }); assert.equal(prepared.plan.temporal?.samples, 3); assert.equal(prepared.plan.depthOfFieldSamples, 4); assert.equal(prepared.plan.identity.revisionDigest, prepared.revision.digest); assert.ok(Object.isFrozen(prepared));
	assert.throws(() => assertPreparedMotionscaperAeRender({ ...prepared }), /review/iu);
});
test('Motion AE rendered export refuses unavailable composition, overlong span and unsupported host dimensions before rendering', () => {
	assert.throws(() => prepareMotionscaperAeRender(source(), 'missing'), /composition/iu);
	assert.throws(() => prepareMotionscaperAeRender(source(257), 'comp'), /256/iu);
	const project = source(); assert.throws(() => prepareMotionscaperAeRender({ ...project, compositions: [{ ...project.compositions[0]!, width: 2 }] }, 'comp'), /dimensions/iu);
});
test('Motion AE complete rendered exchange admits every PNG as a one-frame muted host layer and keeps full-span limitations explicit', () => {
	const prepared = prepareMotionscaperAeRender(source(), 'comp'), frames = Array.from({ length: 3 }, (_, index) => ({ index, byteLength: 100, sha256: String(index).repeat(64) }));
	const exchange = motionAeRenderedExchange(prepared, frames), plan = prepareMotionAeHostImport(JSON.stringify(exchange));
	assert.equal(plan.muteAudio, true); assert.equal(exchange.source.revisionDigest, prepared.revision.digest); assert.equal(exchange.footage.length, 3); assert.equal(plan.compositions[0]!.layers.length, 3);
	for (let index = 0; index < 3; index++) { const layer = exchange.compositions[0]!.layers[index]!; assert.equal(layer.inPoint, index / (30000 / 1001)); assert.equal(layer.outPoint, (index + 1) / (30000 / 1001)); assert.equal(layer.sourceId, `render-frame-${index}`); assert.equal(exchange.footage[index]!.hasAudio, false); }
	assert.equal(exchange.report.filter(entry => entry.status === 'rendered').length, 3); assert.ok(exchange.report.some(entry => entry.code === 'audio-policy')); assert.ok(exchange.report.some(entry => entry.code === 'qualification')); assert.ok(exchange.report.some(entry => entry.code === 'png-precision'));
	assert.throws(() => motionAeRenderedExchange(prepared, frames.slice(1)), /complete/iu); assert.throws(() => motionAeRenderedExchange(prepared, [frames[0]!, frames[0]!, frames[2]!]), /sequential/iu);
});

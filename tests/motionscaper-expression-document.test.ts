/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bakeMotionscaperDocumentExpression } from '../src/motionscaper/editor-expression-document.ts';
import { createMotionscaperProject, createMotionLayer } from '../src/motionscaper/editor-project.ts';
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
const base = createMotionscaperProject({ id: 'p', title: 'Expressions', compositionId: 'c' });
const solid = createMotionLayer({ id: 'solid', name: 'Solid', durationFrames: 300, content: { kind: 'solid', color: motionColor([1, 0, 0, 1]), size: motionVector([20, 20]) } });
const project = { ...base, compositions: [{ ...base.compositions[0]!, layers: [{ ...solid, transform: { ...solid.transform, opacity: { ...motionScalar(1), expression: { source: 'time', enabled: true, references: [] } } } }] }] };
const options = { project, compositionId: 'c', layerId: 'solid', propertyPath: 'transform.opacity', startFrame: { num: 0, den: 1 }, endFrame: { num: 30, den: 1 }, stepFrames: { num: 1, den: 1 }, store: { readAsset: () => Promise.resolve(null) } };
test('M08 asynchronous document baking publishes only while the pinned source is still current', async () => {
	let published = 0;
	const result = await bakeMotionscaperDocumentExpression({ ...options, currentProject: () => project, onEdit: () => { published++; return Promise.resolve(); } });
	assert.equal(result.sampleCount, 30); assert.equal(published, 1);
	await assert.rejects(bakeMotionscaperDocumentExpression({ ...options, currentProject: () => ({ ...project, revision: 1 }), onEdit: () => { published++; return Promise.resolve(); } }), /changed|stale/iu);
	assert.equal(published, 1);
});
test('M08 a cancelled host-task bake cannot publish partial keyframes', async () => {
	const controller = new AbortController(); let published = false;
	const pending = bakeMotionscaperDocumentExpression({ ...options, signal: controller.signal, currentProject: () => project, onProgress: () => { setTimeout(() => controller.abort(), 0); }, onEdit: () => { published = true; return Promise.resolve(); } });
	await assert.rejects(pending, /abort/iu); assert.equal(published, false);
});
test('M08 document sampling resolves exact composition time and preserves runtime source diagnostics', async () => {
	const { evaluateMotionscaperDocumentExpression } = await import('../src/motionscaper/editor-expression-document.ts');
	const value = await evaluateMotionscaperDocumentExpression({ ...options, frame: { num: 15, den: 1 } }); assert.equal(value, 0.5);
	const invalid = { ...project, compositions: [{ ...project.compositions[0]!, layers: [{ ...project.compositions[0]!.layers[0]!, transform: { ...solid.transform, opacity: { ...motionScalar(1), expression: { source: '1 / 0', enabled: true, references: [] } } } }] }] };
	await assert.rejects(evaluateMotionscaperDocumentExpression({ ...options, project: invalid, frame: { num: 0, den: 1 } }), (error: unknown) => {
		assert.ok(error instanceof Error && 'diagnostic' in error && 'propertyPath' in error); assert.equal(error.propertyPath, 'transform.opacity'); return true;
	});
});

/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionscaperProject, createMotionLayer } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperHistory } from '../src/motionscaper/editor-project-commands.ts';
import { createMotionscaperAppearanceCommands } from '../src/motionscaper/editor-appearance-commands.ts';
import { motionColor, motionScalar, motionVector } from '../src/common/editor/motion-property.ts';
import { motionRectanglePath } from '../src/common/editor/motion-shape-primitives.ts';
import { createMotionTextAnimator } from '../src/common/editor/motion-authoring-operators.ts';
const r = (num: number) => ({ num, den: 1 });
const base = createMotionscaperProject({ id: 'p', title: 'Appearance', compositionId: 'main' });
const font = { id: 'font', kind: 'font' as const, name: 'Font', family: 'Inter', style: 'Regular', byteLength: 8, sha256: 'a'.repeat(64), storageKey: `motion-sha256:${'a'.repeat(64)}`, mimeType: 'font/woff2' };
const run = (text: string) => ({ text, fontAssetId: 'font', fontSize: motionScalar(24), color: motionColor([1, 0, 0, 1]), tracking: motionScalar(0) });
const text = createMotionLayer({ id: 'text', name: 'Text', durationFrames: 300, content: { kind: 'text', document: { runs: [run('first'), run('second')], align: 'left', lineHeight: motionScalar(1), boxSize: motionVector([400, 200]), animators: [createMotionTextAnimator('animator')] } } });
function fixture() { return { ...base, assets: [font], compositions: [{ ...base.compositions[0]!, layers: [text] }] }; }
test('M06 text style and layout edits preserve curves, expressions, other runs and text animators in one reversible edit', () => {
	if (text.kind !== 'text') throw new Error('text');
	const animated = { ...run('first'), fontSize: { ...motionScalar(24), curve: { anchors: [{ position: r(0), value: 24 }, { position: r(10), value: 48 }], segments: [{ kind: 'linear' as const }] }, expression: { source: 'value', enabled: false, references: [] } } };
	const project = { ...fixture(), compositions: [{ ...base.compositions[0]!, layers: [{ ...text, document: { ...text.document, runs: [animated, run('second')] } }] }] }; const history = createMotionscaperHistory(project);
	const next = history.commit(createMotionscaperAppearanceCommands({ project, compositionId: 'main', layerId: 'text', edit: { type: 'text-run', index: 0, text: 'changed', fontSize: 32, color: [0, 1, 0, 0.5], tracking: 2 } }));
	const layer = next.compositions[0]!.layers[0]!; if (layer.kind !== 'text') throw new Error('text');
	assert.equal(layer.document.runs[0]!.text, 'changed'); assert.deepEqual(layer.document.runs[0]!.fontSize.curve, animated.fontSize.curve); assert.deepEqual(layer.document.runs[0]!.fontSize.expression, animated.fontSize.expression);
	assert.deepEqual(layer.document.runs[1], run('second')); assert.deepEqual(layer.document.animators, text.document.animators); assert.equal(history.undo(), true);
});
test('M06 text-run movement follows expression bindings and referenced removal refuses without retargeting', () => {
	const follower = createMotionLayer({ id: 'follower', name: 'Follower', durationFrames: 300, content: { kind: 'null' } });
	const project = { ...fixture(), compositions: [{ ...base.compositions[0]!, layers: [text, { ...follower, transform: { ...follower.transform, opacity: { ...motionScalar(1), expression: { source: 'reference("size")', enabled: false, references: [{ id: 'size', layerId: 'text', propertyPath: 'document.runs.0.fontSize' }] } } } }] }] };
	const history = createMotionscaperHistory(project); const next = history.commit(createMotionscaperAppearanceCommands({ project, compositionId: 'main', layerId: 'text', edit: { type: 'move-text-run', index: 0, toIndex: 1 } }));
	assert.equal(next.compositions[0]!.layers[1]!.transform.opacity.expression!.references[0]!.propertyPath, 'document.runs.1.fontSize');
	assert.throws(() => createMotionscaperAppearanceCommands({ project: next, compositionId: 'main', layerId: 'text', edit: { type: 'remove-text-run', index: 1 } }), /referenc/iu);
});
test('M06 fill and stroke authoring validates gradient geometry and stroke width', () => {
	const shape = createMotionLayer({ id: 'shape', name: 'Shape', durationFrames: 300, content: { kind: 'shapes', shapes: [{ id: 'box', path: motionRectanglePath({ x: 0, y: 0, width: 20, height: 20 }), fill: motionColor([1, 0, 0, 1]), stroke: null }] } });
	const history = createMotionscaperHistory({ ...base, compositions: [{ ...base.compositions[0]!, layers: [shape] }] });
	const edit = (change: Parameters<typeof createMotionscaperAppearanceCommands>[0]['edit']) => history.commit(createMotionscaperAppearanceCommands({ project: history.snapshot().project, compositionId: 'main', layerId: 'shape', edit: change }));
	const gradient = edit({ type: 'fill', shapeId: 'box', kind: 'linear-gradient', start: [0, 0], end: [20, 0], stops: [{ id: 'red', offset: 0, color: [1, 0, 0, 1] }, { id: 'blue', offset: 1, color: [0, 0, 1, 1] }] });
	const layer = gradient.compositions[0]!.layers[0]!; if (layer.kind !== 'shapes') throw new Error('shape'); assert.equal(layer.shapes[0]!.fill!.kind, 'linear-gradient');
	edit({ type: 'stroke', shapeId: 'box', stroke: { color: [0, 1, 0, 1], width: 3, lineCap: 'round', lineJoin: 'bevel' } });
	assert.throws(() => edit({ type: 'fill', shapeId: 'box', kind: 'radial-gradient', radius: -1 }), /radius/iu);
	assert.throws(() => edit({ type: 'stroke', shapeId: 'box', stroke: { color: [0, 1, 0, 1], width: -1, lineCap: 'round', lineJoin: 'bevel' } }), /width/iu);
});

test('M06 appearance changes retain animated color channels and refuse destructive fill type switches', () => {
	const color = { ...motionColor([1, 0, 0, 1]), expression: { source: 'value', enabled: false, references: [] } };
	const layer = createMotionLayer({ id: 'shape', name: 'Shape', durationFrames: 300, content: { kind: 'shapes', shapes: [{ id: 'box', path: motionRectanglePath({ x: 0, y: 0, width: 20, height: 20 }), fill: color, stroke: null }] } });
	const project = { ...base, compositions: [{ ...base.compositions[0]!, layers: [layer] }] };
	const options = { project, compositionId: 'main', layerId: 'shape' };
	const history = createMotionscaperHistory(project); const changed = history.commit(createMotionscaperAppearanceCommands({ ...options, edit: { type: 'fill', shapeId: 'box', kind: 'color', color: [0, 1, 0, 1] } }));
	const next = changed.compositions[0]!.layers[0]!; if (next.kind !== 'shapes' || next.shapes[0]!.fill?.kind !== 'color') throw new Error('Expected color');
	assert.deepEqual(next.shapes[0]!.fill.expression, color.expression);
	assert.throws(() => createMotionscaperAppearanceCommands({ ...options, edit: { type: 'fill', shapeId: 'box', kind: 'linear-gradient' } }), /animation/iu);
});

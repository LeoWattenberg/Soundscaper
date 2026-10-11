/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionShapeOperator, createMotionTextAnimator } from '../src/common/editor/motion-authoring-operators.ts';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { normalizeMotionscaperProject } from '../src/motionscaper/editor-project-validation.ts';
import { createMotionscaperRevision } from '../src/motionscaper/editor-project-revision.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { createMotionscaperOperatorCommands } from '../src/motionscaper/editor-operator-commands.ts';
import { createMotionscaperHistory } from '../src/motionscaper/editor-project-commands.ts';
import { motionColor, motionScalar, motionVector, motionPropertyOfKind } from '../src/common/editor/motion-property.ts';
const r = (num: number, den = 1) => ({ num, den });
const path = { kind: 'path' as const, value: { closed: false, vertices: [{ point: [0, 0], inTangent: [0, 0], outTangent: [0, 0] }, { point: [10, 10], inTangent: [0, 0], outTangent: [0, 0] }] }, keyframes: [], segments: [], expression: null };
const base = createMotionscaperProject({ id: 'p', title: 'Operators', compositionId: 'main' });
function shapes() { return { ...base, compositions: [{ ...base.compositions[0]!, layers: [createMotionLayer({ id: 'shape', name: 'Shape', durationFrames: 300, content: { kind: 'shapes', shapes: [{ id: 'path', path: motionPropertyOfKind(path, 'path'), fill: null, stroke: null }] } })] }] }; }

test('M06 optional operator fields preserve canonical revisions of existing documents', () => {
	const project = shapes(); const normalized = normalizeMotionscaperProject(project);
	assert.equal(Object.hasOwn(normalized.compositions[0]!.layers[0]!, 'operators'), false);
	assert.deepEqual(createMotionscaperRevision(normalized), createMotionscaperRevision(project));
});

test('M06 ordered shape operators retain typed animation and mandatory source-stage ledger entries', () => {
	const before = shapes(); const layer = before.compositions[0]!.layers[0]!;
	const trim = { ...createMotionShapeOperator({ id: 'trim', kind: 'trim-paths' }), end: { ...motionScalar(1), curve: { anchors: [{ position: r(0), value: 0 }, { position: r(60), value: 1 }], segments: [{ kind: 'linear' as const }] } } };
	const repeater = { ...createMotionShapeOperator({ id: 'repeat', kind: 'repeater' }), enabled: false };
	const boolean = createMotionShapeOperator({ id: 'merge', kind: 'boolean' });
	const project = normalizeMotionscaperProject({ ...before, compositions: [{ ...before.compositions[0]!, layers: [{ ...layer, operators: [trim, repeater, boolean] }] }] });
	const frame = compileMotionscaperProject(project).evaluate({ compositionId: 'main', time: r(1) });
	assert.deepEqual(frame.layers[0]!.operations.map(({ kind, sourceId }) => `${kind}/${sourceId}`), ['source/shape', 'shape-operator/trim', 'shape-operator/merge', 'transform/shape', 'opacity/shape', 'composite/shape']);
	const state = frame.layers[0]!.state; assert.equal(state.kind === 'shapes' && state.operators?.[0]?.kind === 'trim-paths' && state.operators[0].end, 0.5);
	assert.throws(() => normalizeMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0]!, layers: [{ ...layer, operators: [trim, trim] }] }] }), /duplicate/iu);
	assert.throws(() => normalizeMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0]!, layers: [{ ...layer, operators: [{ ...trim, executable: 'code' }] }] }] }), /unsupported|unknown|field/iu);
});

test('M06 text animators retain shaping text and expose typed cluster, word and line selectors', () => {
	const font = { id: 'font', name: 'Font', kind: 'font' as const, sha256: 'a'.repeat(64), byteLength: 4, storageKey: `motion-sha256:${'a'.repeat(64)}`, mimeType: 'font/woff2', family: 'Inter', style: 'Regular' };
	const text = 'office e\u0301 العربية'; const canonical = text.normalize('NFC');
	const animator = createMotionTextAnimator('animation');
	const layer = createMotionLayer({ id: 'text', name: 'Text', durationFrames: 300, content: { kind: 'text', document: { runs: [{ text: canonical, fontAssetId: 'font', fontSize: motionScalar(32), color: motionColor([1, 1, 1, 1]), tracking: motionScalar(0) }], align: 'left', lineHeight: motionScalar(1.2), boxSize: motionVector([400, 200]), animators: [animator] } } });
	const project = normalizeMotionscaperProject({ ...base, assets: [font], compositions: [{ ...base.compositions[0]!, layers: [layer] }] });
	const frame = compileMotionscaperProject(project).evaluate({ compositionId: 'main', time: r(0) }); const state = frame.layers[0]!.state;
	assert.equal(state.kind === 'text' && state.document.runs[0]!.text, canonical); assert.equal(state.kind === 'text' && state.document.animators?.[0]?.selector.unit, 'cluster');
	assert.equal(frame.layers[0]!.operations.some(({ kind }) => kind === 'text-animator'), true);
});

test('M06 shape operator authoring is one undoable edit and rejects wrong-kind destinations', () => {
	const project = shapes(); const history = createMotionscaperHistory(project);
	const commands = createMotionscaperOperatorCommands({ project, compositionId: 'main', layerId: 'shape', target: 'shape', edit: { type: 'add', value: createMotionShapeOperator({ id: 'repeat', kind: 'repeater' }), index: 0 } });
	const changed = history.commit(commands); const layer = changed.compositions[0]!.layers[0]!;
	assert.equal(layer.kind === 'shapes' && layer.operators?.[0]?.kind, 'repeater'); assert.equal(changed.revision, 1); assert.equal(history.undo(), true); assert.deepEqual(history.snapshot().project.compositions, project.compositions);
	assert.throws(() => createMotionscaperOperatorCommands({ project, compositionId: 'main', layerId: 'shape', target: 'text', edit: { type: 'add', value: createMotionTextAnimator('animation'), index: 0 } }), /text/iu);
});

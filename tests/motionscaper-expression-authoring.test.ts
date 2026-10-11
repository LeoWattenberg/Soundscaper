/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionLayer, createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperHistory } from '../src/motionscaper/editor-project-commands.ts';
import { createMotionscaperExpressionCommands, bakeMotionscaperExpression } from '../src/motionscaper/editor-expression-commands.ts';
import { compileMotionscaperProject } from '../src/motionscaper/editor-project-evaluation.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { motionVector } from '../src/common/editor/motion-property.ts';
const r = (num: number, den = 1) => ({ num, den });
function fixture() {
	const project = createMotionscaperProject({ id: 'expressions', title: 'Expressions', compositionId: 'main' });
	const layer = createMotionLayer({ id: 'source', name: 'Source', durationFrames: 300, content: { kind: 'null' } });
	return { ...project, compositions: [{ ...project.compositions[0]!, layers: [layer] }] };
}
const address = { compositionId: 'main', layerId: 'source', propertyPath: 'transform.position' };

test('M08 expression source including syntax errors survives atomic history, disable, reopen and undo', () => {
	const history = createMotionscaperHistory(fixture()); const invalid = { source: 'value +', enabled: true, references: [] };
	const changed = history.commit(createMotionscaperExpressionCommands({ project: history.snapshot().project, ...address, expression: invalid }));
	assert.equal(changed.compositions[0]!.layers[0]!.transform.position.expression!.source, invalid.source);
	assert.throws(() => compileMotionscaperProject(changed).evaluate({ compositionId: 'main', time: r(0) }), /expression/iu);
	const disabled = history.commit(createMotionscaperExpressionCommands({ project: changed, ...address, expression: { ...invalid, enabled: false } }));
	assert.deepEqual(compileMotionscaperProject(JSON.parse(JSON.stringify(disabled)) as unknown).evaluate({ compositionId: 'main', time: r(0) }).layers[0]!.state.transform.position, [0, 0, 0]);
	assert.equal(history.undo(), true); assert.equal(history.snapshot().project.compositions[0]!.layers[0]!.transform.position.expression!.enabled, true);
});

test('M08 baking samples exact composition frames into local keys and retains disabled source for undo/re-enable', () => {
	const source = fixture(); const visual = source.compositions[0]!.layers[0]!;
	const project = { ...source, compositions: [{ ...source.compositions[0]!, layers: [{ ...visual, startFrame: r(15), transform: { ...visual.transform, position: { ...motionVector([0, 0, 0]), expression: { source: '[time * 30, frame * 2, localTime]', enabled: true, references: [] } } } }] }] };
	const revision = createMotionscaperRevision(project); const history = createMotionscaperHistory(project);
	const baked = bakeMotionscaperExpression({ project, ...address, startFrame: r(15), endFrame: r(18), stepFrames: r(1, 2) });
	assert.equal(baked.sourceRevisionDigest, revision.digest); assert.equal(baked.sampleCount, 6); assert.equal(baked.commands.length, 1);
	const next = history.commit(baked.commands); const property = next.compositions[0]!.layers[0]!.transform.position;
	assert.equal(property.expression!.enabled, false); assert.equal(property.expression!.source, '[time * 30, frame * 2, localTime]');
	assert.deepEqual(property.curves[0]!.anchors.map(({ position }) => position), [r(0), r(1, 2), r(1), r(3, 2), r(2), r(5, 2)]);
	const original = compileMotionscaperProject(project), result = compileMotionscaperProject(next);
	for (let frame = 15; frame < 18; frame += 0.5) assert.deepEqual(result.evaluate({ compositionId: 'main', time: r(frame * 2, 60) }).layers[0]!.state.transform.position, original.evaluate({ compositionId: 'main', time: r(frame * 2, 60) }).layers[0]!.state.transform.position);
	assert.equal(history.undo(), true); assert.equal(history.snapshot().project.compositions[0]!.layers[0]!.transform.position.expression!.enabled, true); assert.equal(history.snapshot().project.compositions[0]!.layers[0]!.transform.position.curves[0], null);
});

test('M08 baking refuses invalid expressions, negative local key domains, excessive keys and cancellation before publication', () => {
	const source = fixture(); const history = createMotionscaperHistory(source);
	const project = history.commit(createMotionscaperExpressionCommands({ project: source, ...address, expression: { source: '[time, 0, 0]', enabled: true, references: [] } }));
	const options = { project, ...address, startFrame: r(0), endFrame: r(300), stepFrames: r(1, 100) };
	assert.throws(() => bakeMotionscaperExpression(options), /budget|4096/iu);
	const controller = new AbortController(); controller.abort(); assert.throws(() => bakeMotionscaperExpression({ ...options, stepFrames: r(1), signal: controller.signal }), { name: 'AbortError' });
	const layer = project.compositions[0]!.layers[0]!; const shifted = { ...project, compositions: [{ ...project.compositions[0]!, layers: [{ ...layer, startFrame: r(30) }] }] };
	assert.throws(() => bakeMotionscaperExpression({ ...options, project: shifted, stepFrames: r(1) }), /local|start/iu);
	assert.equal(history.snapshot().project, project);
});

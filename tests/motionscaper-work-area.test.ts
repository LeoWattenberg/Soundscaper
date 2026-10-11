/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperHistory } from '../src/motionscaper/editor-project-commands.ts';
import { createMotionscaperWorkAreaCommands } from '../src/motionscaper/editor-work-area-commands.ts';
import { motionCompositionWorkArea } from '../src/common/editor/motion-composition-work-area.ts';
import { normalizeMotionscaperProject } from '../src/motionscaper/editor-project-validation.ts';
const r = (num: number, den = 1) => ({ num, den });
const project = createMotionscaperProject({ id: 'p', title: 'Work area', compositionId: 'main', frameRate: r(30000, 1001) });

test('M06 a fractional work area persists through normalization and one reversible history edit', () => {
	const h = createMotionscaperHistory(project); const range = { startFrame: r(3, 2), endFrame: r(601, 4) };
	const changed = h.commit(createMotionscaperWorkAreaCommands({ project, compositionId: 'main', workArea: range }));
	assert.deepEqual(motionCompositionWorkArea(changed.compositions[0]!), range);
	assert.deepEqual(normalizeMotionscaperProject(JSON.parse(JSON.stringify(changed))).compositions[0]!.workArea, range);
	assert.equal(changed.revision, 1); assert.equal(h.undo(), true); assert.equal(Object.hasOwn(h.snapshot().project.compositions[0]!, 'workArea'), false);
});

test('M06 resetting a work area restores full duration without writing default authority into old documents', () => {
	assert.deepEqual(motionCompositionWorkArea(project.compositions[0]!), { startFrame: r(0), endFrame: r(300) });
	const h = createMotionscaperHistory(project); h.commit(createMotionscaperWorkAreaCommands({ project, compositionId: 'main', workArea: { startFrame: r(10), endFrame: r(20) } }));
	const reset = h.commit(createMotionscaperWorkAreaCommands({ project: h.snapshot().project, compositionId: 'main', workArea: null }));
	assert.equal(Object.hasOwn(reset.compositions[0]!, 'workArea'), false); assert.deepEqual(reset.compositions, project.compositions);
});

test('M06 work-area edits reject empty, reversed, out-of-duration and capability-bearing ranges before publication', () => {
	const h = createMotionscaperHistory(project); const before = h.snapshot();
	for (const workArea of [{ startFrame: r(20), endFrame: r(20) }, { startFrame: r(-1), endFrame: r(20) }, { startFrame: r(0), endFrame: r(301) }]) assert.throws(() => createMotionscaperWorkAreaCommands({ project, compositionId: 'main', workArea }), /range|duration/iu);
	assert.throws(() => normalizeMotionscaperProject({ ...project, compositions: [{ ...project.compositions[0]!, workArea: { startFrame: r(0), endFrame: r(20), renderer: 'external' } }] }), /field|unsupported|unknown/iu);
	assert.deepEqual(h.snapshot(), before);
});

/* SPDX-License-Identifier: AGPL-3.0-only */
import test from 'node:test';
import assert from 'node:assert/strict';
import { motionWorkAreaOutputFrames } from '../src/common/editor/motion-work-area-output.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
const composition = createMotionscaperProject({ id: 'p', title: 'Work area', compositionId: 'c', durationFrames: 60 }).compositions[0]!;
test('M06 delivery samples precisely the integer frames contained in an exact half-open work area', () => {
	assert.deepEqual(motionWorkAreaOutputFrames(composition), { firstFrame: 0, endFrame: 60 });
	const authored = { ...composition, workArea: { startFrame: { num: 3, den: 2 }, endFrame: { num: 13, den: 4 } } };
	assert.deepEqual(motionWorkAreaOutputFrames(authored), { firstFrame: 2, endFrame: 4 });
	assert.deepEqual(authored.workArea, { startFrame: { num: 3, den: 2 }, endFrame: { num: 13, den: 4 } });
});
test('M06 a nonempty fractional preview area can contain no output-grid frame', () => {
	assert.deepEqual(motionWorkAreaOutputFrames({ ...composition, workArea: { startFrame: { num: 1, den: 4 }, endFrame: { num: 3, den: 4 } } }), { firstFrame: 1, endFrame: 1 });
});

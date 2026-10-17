/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionscaperAudioPlacementCommands } from '../src/motionscaper/editor-audio-placement-commands.ts';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperMediaCommands } from '../src/motionscaper/editor-media-authoring.ts';
import { applyMotionscaperCommands } from '../src/motionscaper/editor-project-commands.ts';
import { compileInterpolationCurve } from '../src/common/editor/interpolation-curve.ts';
import { motionScalar } from '../src/common/editor/motion-property.ts';
import { prepareMotionMedia } from '../src/common/editor/motion-media-import.ts';
import { motionWavFixture } from './helpers/motion-media-fixture.ts';

async function fixture() {
	const project = createMotionscaperProject({ id: 'project', title: 'Audio', compositionId: 'main' });
	const imported = await prepareMotionMedia(new Blob([motionWavFixture()]), { id: 'sound', name: 'Sound' });
	const placed = applyMotionscaperCommands(project, createMotionscaperMediaCommands(project, imported.asset, 'placement'));
	const composition = placed.compositions[0]!;
	return applyMotionscaperCommands(placed, [{ type: 'composition/replace', composition: { ...composition, audio: composition.audio.map((entry) => ({ ...entry,
		gain: { ...entry.gain, curve: compileInterpolationCurve({ anchors: [{ position: 0, value: 0 }, { position: 30, value: 1 }], segments: [{ kind: 'eased' }] }) },
	})) } }]);
}

test('standalone audio moves and trims on exact composition frames without changing source or gain intent', async () => {
	const project = await fixture(); const original = project.compositions[0]!.audio[0]!;
	const move = createMotionscaperAudioPlacementCommands({ project, compositionId: 'main', edit: { type: 'move', placementIds: ['placement'], deltaFrames: { num: 3, den: 2 } } });
	const moved = applyMotionscaperCommands(project, move); const placement = moved.compositions[0]!.audio[0]!;
	assert.deepEqual(placement.startFrame, { num: 3, den: 2 }); assert.deepEqual(placement.outFrame, { num: 9, den: 2 });
	assert.deepEqual(placement.sourceStart, original.sourceStart); assert.deepEqual(placement.gain, original.gain);
	const trimmed = applyMotionscaperCommands(moved, createMotionscaperAudioPlacementCommands({ project: moved, compositionId: 'main', edit: { type: 'trim', placementId: 'placement', inFrame: { num: 2, den: 1 }, outFrame: { num: 4, den: 1 } } }));
	assert.deepEqual(trimmed.compositions[0]!.audio[0]!.startFrame, { num: 3, den: 2 });
	assert.deepEqual(trimmed.compositions[0]!.audio[0]!.inFrame, { num: 2, den: 1 }); assert.equal(project.compositions[0]!.audio[0], original);
});

test('standalone audio gain, reverse source timing, mute and remove are validated atomic commands', async () => {
	let project = await fixture();
	for (const edit of [
		{ type: 'gain' as const, placementId: 'placement', gain: motionScalar(0.25) },
		{ type: 'source' as const, placementId: 'placement', sourceStart: { num: 1, den: 10 }, timeScale: { num: -1, den: 1 } },
		{ type: 'enabled' as const, placementIds: ['placement'], enabled: false },
	]) project = applyMotionscaperCommands(project, createMotionscaperAudioPlacementCommands({ project, compositionId: 'main', edit }));
	const placement = project.compositions[0]!.audio[0]!;
	assert.equal(placement.gain.value, 0.25); assert.deepEqual(placement.timeScale, { num: -1, den: 1 }); assert.equal(placement.enabled, false);
	project = applyMotionscaperCommands(project, createMotionscaperAudioPlacementCommands({ project, compositionId: 'main', edit: { type: 'remove', placementIds: ['placement'] } }));
	assert.equal(project.compositions[0]!.audio.length, 0); assert.equal(project.assets.length, 1);
});

test('standalone audio refuses invalid selections and timing without changing the project', async () => {
	const project = await fixture();
	assert.throws(() => createMotionscaperAudioPlacementCommands({ project, compositionId: 'main', edit: { type: 'remove', placementIds: ['missing'] } }), /missing/u);
	assert.throws(() => createMotionscaperAudioPlacementCommands({ project, compositionId: 'main', edit: { type: 'remove', placementIds: ['placement', 'placement'] } }), /duplicate/u);
	assert.throws(() => createMotionscaperAudioPlacementCommands({ project, compositionId: 'main', edit: { type: 'trim', placementId: 'placement', inFrame: { num: 4, den: 1 }, outFrame: { num: 3, den: 1 } } }));
	assert.equal(project.compositions[0]!.audio.length, 1); assert.deepEqual(project.compositions[0]!.audio[0]!.inFrame, { num: 0, den: 1 });
});

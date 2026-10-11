/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { trackingProject } from './helpers/motionscaper-tracking-fixture.ts';
import { createMotionTrackingSettings, createMotionTrackingResult } from '../src/common/editor/motion-tracking-contract.ts';
import { createMotionTrackingBinding } from '../src/common/editor/motion-tracking-authority.ts';
import { createMotionscaperTrackingCommands } from '../src/motionscaper/editor-tracking-commands.ts';
import { applyMotionscaperCommands } from '../src/motionscaper/editor-project-commands.ts';
import { motionTrackingReadiness } from '../src/common/editor/motion-tracking-admission.ts';
import { copyMotionArchiveProject } from '../src/motionscaper/editor-document-import.ts';
test('M02 copied projects retain tracking samples, provenance and freshness without silently repairing stale applications', () => {
	const base = trackingProject(), settings = createMotionTrackingSettings({ mode: 'point', firstFrame: 2, frameCount: 3, points: [[20, 20]] });
	const result = createMotionTrackingResult({ id: 'track', binding: createMotionTrackingBinding(base, 'comp', 'source', settings), settings,
		samples: [2, 3, 4].map((frame, index) => ({ frame, status: 'tracked', points: [[20 + index, 20 + index]], confidence: 1, error: 0 })) });
	const tracked = applyMotionscaperCommands(base, createMotionscaperTrackingCommands(base, { type: 'accept', compositionId: 'comp', result }));
	const applied = applyMotionscaperCommands(tracked, createMotionscaperTrackingCommands(tracked, { type: 'apply-point', compositionId: 'comp', analysisId: 'track', targetLayerId: 'overlay', replaceAnimation: false }));
	const copy = copyMotionArchiveProject(applied, 'independent-copy');
	assert.equal(motionTrackingReadiness(copy).length, 0); assert.deepEqual(copy.compositions[0]!.tracking![0]!.samples, result.samples);
	assert.equal(copy.compositions[0]!.tracking![0]!.binding.originRevisionDigest, result.binding.originRevisionDigest);
	assert.deepEqual(copy.assets, applied.assets); assert.equal(applied.compositions[0]!.tracking![0]!.binding.projectId, base.id);
	const corrected = applyMotionscaperCommands(applied, createMotionscaperTrackingCommands(applied, { type: 'correct', compositionId: 'comp', analysisId: 'track', frame: 3, points: [[27, 28]] }));
	assert.match(motionTrackingReadiness(copyMotionArchiveProject(corrected, 'stale-copy'))[0]!.message, /reapply/iu);
	const composition = applied.compositions[0]!;
	const retimed = applyMotionscaperCommands(applied, [{ type: 'composition/replace', composition: { ...composition, durationFrames: composition.durationFrames + 1 } }]);
	assert.match(motionTrackingReadiness(copyMotionArchiveProject(retimed, 'stale-source-copy'))[0]!.message, /reanalyze/iu);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperVideoVisualPlanFinishing } from '../src/framescaper/video-export-visual-plan-finishing.ts';

test('picture-only canvas derives from timeline order instead of project track array order', () => {
	const project = visualProject();
	const first = createFramescaperVideoVisualPlanFinishing(project as never, {
		format: 'mp4', range: 'project', includeAudio: false,
	} as never);
	const swapped = createFramescaperVideoVisualPlanFinishing({
		...project,
		tracks: [...project.tracks].reverse(),
	} as never, {
		format: 'mp4', range: 'project', includeAudio: false,
	} as never);

	assert.deepEqual([first.canvas.width, first.canvas.height], [1_280, 720]);
	assert.deepEqual(swapped.canvas, first.canvas);
});

test('picture-only canvas bounds stated rates and rejects contradictory controls', () => {
	const project = visualProject();
	const plan = (canvas: Readonly<Record<string, unknown>>) =>
		createFramescaperVideoVisualPlanFinishing(project as never, {
			format: 'mp4', range: 'project', includeAudio: false, canvas,
		} as never);

	assert.throws(
		() => plan({ frameRate: { num: 1_001, den: 1 } }),
		/at most 1000/i,
	);
	assert.throws(
		() => plan({ maximumFrameRate: { num: 1_001, den: 1 } }),
		/at most 1000/i,
	);
	assert.throws(
		() => plan({ frameRate: { num: 60, den: 1 }, maximumFrameRate: { num: 30, den: 1 } }),
		/canvas\.maximumFrameRate cannot also apply/i,
	);
	assert.throws(
		() => plan({ size: { width: 640, height: 360 }, width: 640 }),
		/canvas\.width cannot also apply/i,
	);
});

function visualProject() {
	return {
		sampleRate: 48_000,
		primarySequenceId: 'sequence',
		selection: { startFrame: 0, endFrame: 0 },
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sequences: [{
			id: 'sequence', rate: { num: 30, den: 1 }, trackIds: ['early-track', 'late-track'],
		}],
		sources: [{
			kind: 'still', id: 'late-source', storageKey: 'late-source',
			contentSha256: 'a'.repeat(64), width: 640, height: 360,
		}, {
			kind: 'still', id: 'early-source', storageKey: 'early-source',
			contentSha256: 'b'.repeat(64), width: 1_920, height: 1_080,
		}],
		clips: [{
			kind: 'still', id: 'late-clip', sourceId: 'late-source',
			sequenceStartFrame: 300, sequenceFrameCount: 30,
		}, {
			kind: 'still', id: 'early-clip', sourceId: 'early-source',
			sequenceStartFrame: 0, sequenceFrameCount: 30,
		}],
		tracks: [{
			type: 'video', id: 'late-track', clipIds: ['late-clip'],
		}, {
			type: 'video', id: 'early-track', clipIds: ['early-clip'],
		}],
	};
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applyEditorCommand } from '../src/common/editor/commands.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { normalizeVampAnalysisResult } from '../src/common/editor/vamp-analysis.ts';
import {
	MAXIMUM_VAMP_LABELS,
	planVampFeatureLabelTrack,
} from '../src/common/editor/vamp-analysis-labels.ts';

test('Vamp variable-rate features become one atomic label-track command', () => {
	const result = analysisResult([
		feature(0, 100_000_001, { seconds: 0, nanoseconds: 100_000_001 }, [0.25], ''),
		feature(0, 500_000_000, null, [], 'Snare'),
	]);
	const plan = planVampFeatureLabelTrack(result, {
		createTrackId: () => 'vamp-labels-1',
		trackName: 'Detected onsets',
		outputName: 'Onsets',
		outputUnit: 'strength',
	});

	assert.equal(plan.labelCount, 2);
	assert.equal(plan.targetTrackId, 'vamp-labels-1');
	assert.equal(plan.command.type, 'track/add');
	const project = createCurrentAudioEditorProject({ title: 'Vamp labels', sampleRate: 44_100 });
	const committed = applyEditorCommand(project, plan.command);
	const track = committed.tracks.find(({ id }) => id === 'vamp-labels-1');
	assert.equal(track?.type, 'label');
	assert.deepEqual(track?.type === 'label' ? track.labels.map((label) => ({
		title: label.title,
		startFrame: label.startFrame,
		endFrame: label.endFrame,
	})) : [], [
		{ title: 'Onsets: 0.25 strength', startFrame: 5_410, endFrame: 9_821 },
		{ title: 'Snare', startFrame: 23_050, endFrame: 23_050 },
	]);
});

test('Vamp label planning refuses empty, excessive, and nondeterministic authoring', () => {
	assert.throws(
		() => planVampFeatureLabelTrack(analysisResult([]), {
			createTrackId: () => 'track', outputName: 'Events',
		}),
		/no features/iu,
	);
	assert.throws(
		() => planVampFeatureLabelTrack(analysisResult([feature(0, 0, null, [], '')]), {
			createTrackId: () => '', outputName: 'Events',
		}),
		/non-empty/iu,
	);
	const excessive = Array.from({ length: MAXIMUM_VAMP_LABELS + 1 }, (_, index) => (
		feature(0, index, null, [], '')
	));
	assert.throws(
		() => planVampFeatureLabelTrack(analysisResult(excessive), {
			createTrackId: () => 'track', outputName: 'Events',
		}),
		/10,000-label ceiling/iu,
	);
});

function analysisResult(features: readonly ReturnType<typeof feature>[]) {
	return normalizeVampAnalysisResult({
		schemaVersion: 1,
		request: {
			schemaVersion: 1,
			analyzerId: 'installed-onsets',
			stableId: 'example:onsets',
			binarySha256: 'ab'.repeat(32),
			outputId: 'onsets',
			program: null,
			parameters: [],
			scope: 'master',
			startFrame: 1_000,
			endFrame: 45_100,
			sampleRate: 44_100,
		},
		features,
	});
}

function feature(
	seconds: number,
	nanoseconds: number,
	duration: Readonly<{ seconds: number; nanoseconds: number }> | null,
	values: readonly number[],
	label: string,
) {
	return { timestamp: { seconds, nanoseconds }, duration, values, label };
}

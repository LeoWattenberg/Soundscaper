/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createMacroCommandService } from '../src/common/editor/controller/macro-command-service.ts';
import { createMacroCommandStep } from '../src/common/editor/macro-command-steps.ts';

const SAMPLE_RATE = 100;
const PROJECT_END = 1_000;

function createHarness(selection: Record<string, unknown> = { startFrame: 200, endFrame: 400 }) {
	const applied: Array<[number, number, Record<string, unknown>]> = [];
	const project = {
		tracks: [{ id: 'track-a' }, { id: 'track-b' }, { id: 'track-c' }, { id: 'track-d' }],
		selection,
	};
	const service = createMacroCommandService({
		getProject: () => project,
		projectSampleRate: () => SAMPLE_RATE,
		timelineDurationFrames: () => PROJECT_END,
		setExactSelection: (startFrame, endFrame, details = {}) => {
			applied.push([startFrame, endFrame, details as Record<string, unknown>]);
			return project;
		},
	});
	return {
		applied,
		run: (command: string, params?: Record<string, unknown>) => service.runMacroCommand(
			createMacroCommandStep(command, { id: 'step', params }),
		),
	};
}

test('RelativeTo places each edge exactly where Audacity places it', () => {
	// The arithmetic is deliberately asymmetric upstream, and each branch measures
	// from a different thing. Seconds convert at the project rate.
	const cases: Array<[string | undefined, [number, number]]> = [
		[undefined, [100, 300]],
		['project-start', [100, 300]],
		['project', [100, PROJECT_END + 300]],
		['project-end', [PROJECT_END - 100, PROJECT_END - 300]],
		['selection-start', [300, 500]],
		['selection', [300, 700]],
		['selection-end', [300, 100]],
	];
	for (const [relativeTo, expected] of cases) {
		const harness = createHarness();
		harness.run('SelectTime', { start: 1, end: 3, ...(relativeTo ? { relativeTo } : {}) });
		assert.deepEqual(
			[harness.applied[0]?.[0], harness.applied[0]?.[1]],
			expected,
			`RelativeTo ${String(relativeTo)}`,
		);
		assert.deepEqual(harness.applied[0]?.[2], { trackIds: [] },
			'a time command leaves the track selection where it is');
	}
});

test('a time command with neither edge leaves the selection where it is', () => {
	// Upstream returns before touching anything, so a Select that only names
	// tracks does not silently collapse the range to nothing.
	const harness = createHarness();
	harness.run('Select', { track: 1, trackCount: 2 });
	assert.deepEqual(harness.applied[0]?.slice(0, 2), [200, 400]);
	assert.deepEqual(harness.applied[0]?.[2], { trackIds: ['track-b', 'track-c'] });
});

test('a track range is set, widened, or taken back out', () => {
	for (const [mode, expected] of [
		['set', ['track-b', 'track-c']],
		['add', ['track-a', 'track-b', 'track-c']],
		['remove', ['track-a']],
	] as const) {
		const harness = createHarness({ startFrame: 200, endFrame: 400, trackIds: ['track-a', 'track-b'] });
		harness.run('SelectTracks', { track: 1, trackCount: 2, mode });
		assert.deepEqual(harness.applied[0]?.[2], { trackIds: expected }, `mode ${mode}`);
	}
	// Absent parameters take Audacity's own defaults: the first track, one track,
	// and a replacing selection.
	const harness = createHarness({ startFrame: 0, endFrame: 0, trackIds: ['track-d'] });
	harness.run('SelectTracks', { mode: 'set' });
	assert.deepEqual(harness.applied[0]?.[2], { trackIds: ['track-a'] });
});

test('a frequency range keeps the edge it was not given', () => {
	const harness = createHarness({
		startFrame: 0, endFrame: 10, frequencyRange: { low: 100, high: 8_000 },
	});
	harness.run('SelectFrequencies', { low: 200 });
	assert.deepEqual(harness.applied[0]?.[2],
		{ trackIds: [], frequencyRange: { low: 200, high: 8_000 } });

	const fresh = createHarness({ startFrame: 0, endFrame: 10 });
	fresh.run('SelectFrequencies', { high: 4_000 });
	assert.deepEqual(fresh.applied[0]?.[2], { trackIds: [], frequencyRange: { low: 0, high: 4_000 } });
});

test('Select applies time, frequency and track parameters together', () => {
	const harness = createHarness({ startFrame: 0, endFrame: 0, trackIds: [] });
	harness.run('Select', { start: 1, end: 2, high: 5_000, low: 50, track: 2, trackCount: 1 });
	assert.deepEqual(harness.applied[0], [100, 200, {
		trackIds: ['track-c'],
		frequencyRange: { low: 50, high: 5_000 },
	}]);
});

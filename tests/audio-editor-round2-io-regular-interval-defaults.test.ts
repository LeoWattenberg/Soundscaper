/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { regularIntervalDialogDefaults } from '../src/common/editor/ui/regular-interval-dialog-defaults.ts';

test('regular annotation defaults resolve the actual extent of canonical video clips', () => {
	const result = regularIntervalDialogDefaults({ id: 'project', schemaVersion: 17, sampleRate: 48_000, primarySequenceId: 'main', sequences: [{ id: 'main', rate: { num: 30, den: 1 } }], clips: [{ id: 'video', kind: 'video', sequenceId: 'main', sequenceStartFrame: 30, sequenceFrameCount: 90, sourceInFrame: 0, sourceFrameCount: 72 }] });
	assert.deepEqual(result, { kind: 'marker', startFrame: 0, endFrame: 192_000, intervalFrames: 48_000, namePrefix: 'Cue' });
});

test('musical audio and an empty project use the same authoritative default range', () => {
	const result = regularIntervalDialogDefaults({ id: 'project', schemaVersion: 17, sampleRate: 48_000, primarySequenceId: 'main', tempoMap: { mode: 'musical', events: [{ beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] }, clips: [{ id: 'audio', kind: 'audio', anchor: 'musical', musicalStartBeat: { num: 4, den: 1 }, musicalExtent: 'fixedSamples', durationFrames: 48_000, sourceStartFrame: 0, sourceDurationFrames: 48_000 }] });
	assert.equal(result.endFrame, 144_000);
	assert.deepEqual(regularIntervalDialogDefaults(null), { kind: 'marker', startFrame: 0, endFrame: 1, intervalFrames: 48_000, namePrefix: 'Cue' });
});

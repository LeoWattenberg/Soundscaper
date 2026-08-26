/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAssistanceBeatProposals,
} from '../src/common/editor/assistance/beat-proposals.ts';

test('reviewed beat points become stable, ordered, initially-unchecked choices', () => {
	const proposals = createAssistanceBeatProposals({
		schemaVersion: 1,
		sampleRate: 22_050,
		points: [
			{ sample: 0, kind: 'downbeat', confidence: 0.95 },
			{ sample: 11_025, kind: 'beat', confidence: null },
			{ sample: 22_050, kind: 'beat', confidence: 0.75 },
		],
		tempoProposal: { kind: 'constant', bpm: 120 },
	});

	assert.deepEqual(proposals, [
		{
			id: 'beat-grid:downbeat:0', kind: 'downbeat', label: 'Downbeat',
			sample: 0, confidence: 0.95, selected: false,
		},
		{
			id: 'beat-grid:beat:11025', kind: 'beat', label: 'Beat',
			sample: 11_025, confidence: null, selected: false,
		},
		{
			id: 'beat-grid:beat:22050', kind: 'beat', label: 'Beat',
			sample: 22_050, confidence: 0.75, selected: false,
		},
	]);
	assert.ok(Object.isFrozen(proposals));
	assert.ok(proposals.every(Object.isFrozen));
});

test('proposal conversion repeats strict beat-grid semantic review', () => {
	assert.throws(() => createAssistanceBeatProposals({
		schemaVersion: 1,
		sampleRate: 22_050,
		points: [
			{ sample: 100, kind: 'beat', confidence: 1 },
			{ sample: 100, kind: 'downbeat', confidence: 1 },
		],
		tempoProposal: null,
	}), /strictly ordered/iu);
	assert.throws(() => createAssistanceBeatProposals({
		schemaVersion: 1,
		sampleRate: 22_050,
		points: [{ sample: 0, kind: 'beat', confidence: Number.NaN }],
		tempoProposal: null,
	}), /finite|unit interval/iu);
});

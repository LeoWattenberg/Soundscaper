/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { AssistanceProposalStaleError } from '../src/common/editor/assistance/proposal-session.ts';
import { normalizeLocalAssistanceAudioAcceptanceAuthority } from
	'../src/common/editor/controller/assistance/internal/local-assistance-audio-acceptance-authority.ts';

const FENCE = Object.freeze({
	projectId: 'project-1',
	schemaFamily: 'soundscaper' as const,
	schemaVersion: 1,
	revision: 4,
	sequenceId: 'main-sequence',
	occurrenceIds: Object.freeze(['voice-clip']),
	sourceId: 'voice-source',
	sourceSha256: 'ab'.repeat(32),
	sourceStartFrame: 36_000,
	sourceEndFrame: 84_000,
	linkMembershipSha256: 'cd'.repeat(32),
	timingAuthoritySha256: 'ef'.repeat(32),
});

const TRACK = Object.freeze({ id: 'voice-track', type: 'audio' });

function authority() {
	return Object.freeze({
		project: Object.freeze({
			id: 'project-1',
			schemaFamily: 'soundscaper' as const,
			schemaVersion: 1,
			revision: 4,
			sampleRate: 48_000,
			tracks: Object.freeze([TRACK]),
		}),
		startFrame: 48_000,
		endFrame: 96_000,
		sourceStartFrame: 36_000,
		sourceEndFrame: 84_000,
		fence: FENCE,
	});
}

test('audio acceptance authority normalizes the shared selected-media fence without aliasing inventory', () => {
	const input = authority();
	const normalized = normalizeLocalAssistanceAudioAcceptanceAuthority(
		input,
		'Test acceptance requires selected-media authority.',
	);

	assert.deepEqual(normalized, {
		fence: FENCE,
		sampleRate: 48_000,
		timelineStartFrame: 48_000,
		timelineEndFrame: 96_000,
		sourceStartFrame: 36_000,
		sourceEndFrame: 84_000,
		tracks: [TRACK],
	});
	assert.notEqual(normalized.tracks, input.project.tracks);
	assert.equal(normalized.tracks[0], TRACK);
	assert.equal(Object.isFrozen(normalized), true);
	assert.equal(Object.isFrozen(normalized.tracks), true);
});

test('audio acceptance authority preserves missing-authority and stale-fence failure classes', () => {
	assert.throws(
		() => normalizeLocalAssistanceAudioAcceptanceAuthority(
			null,
			'Test acceptance requires selected-media authority.',
		),
		/Test acceptance requires selected-media authority\./u,
	);
	assert.throws(
		() => normalizeLocalAssistanceAudioAcceptanceAuthority({
			...authority(),
			project: { ...authority().project, revision: 5 },
		}, 'unused'),
		AssistanceProposalStaleError,
	);
	assert.throws(
		() => normalizeLocalAssistanceAudioAcceptanceAuthority({
			...authority(),
			project: { ...authority().project, tracks: null },
		}, 'unused'),
		AssistanceProposalStaleError,
	);
});

test('audio acceptance authority keeps exact integer and equal-extent admission', () => {
	assert.throws(
		() => normalizeLocalAssistanceAudioAcceptanceAuthority({
			...authority(),
			project: { ...authority().project, sampleRate: 48_000.5 },
		}, 'unused'),
		/The project sample rate is invalid\./u,
	);
	assert.throws(
		() => normalizeLocalAssistanceAudioAcceptanceAuthority({
			...authority(),
			endFrame: 95_999,
		}, 'unused'),
		AssistanceProposalStaleError,
	);
});

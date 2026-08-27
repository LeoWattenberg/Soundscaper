/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { assertLocalAssistanceSelectedVideoOccurrenceSelection } from
	'../src/common/editor/controller/local-assistance-selected-video-selection.ts';

const VIDEO = Object.freeze({ id: 'video-clip', kind: 'video', avLinkId: 'linked-av' });
const AUDIO = Object.freeze({ id: 'audio-clip', kind: 'audio', avLinkId: 'linked-av' });

test('selected video admits exactly its UI-expanded linked audio peer', () => {
	assert.doesNotThrow(() => assertLocalAssistanceSelectedVideoOccurrenceSelection({
		selection: { clipIds: ['video-clip', 'audio-clip'] }, clips: [VIDEO, AUDIO],
	}, VIDEO));
	assert.doesNotThrow(() => assertLocalAssistanceSelectedVideoOccurrenceSelection({
		selection: { clipIds: ['video-clip'] }, clips: [VIDEO, AUDIO],
	}, VIDEO), 'programmatic video-only selection remains valid');
});

test('selected video refuses unrelated, grouped, duplicate, and ambiguous peers', () => {
	const OTHER = Object.freeze({ id: 'other-video', kind: 'video', avLinkId: null });
	for (const [name, clipIds, clips] of [
		['unrelated peer', ['video-clip', 'other-video'], [VIDEO, AUDIO, OTHER]],
		['expanded group', ['video-clip', 'audio-clip', 'other-video'], [VIDEO, AUDIO, OTHER]],
		['duplicate selection', ['video-clip', 'video-clip'], [VIDEO, AUDIO]],
		['missing active video', ['audio-clip'], [VIDEO, AUDIO]],
		['ambiguous audio link', ['video-clip', 'audio-clip'], [VIDEO, AUDIO,
			{ id: 'second-audio', kind: 'audio', avLinkId: 'linked-av' }]],
	] as const) {
		assert.throws(() => assertLocalAssistanceSelectedVideoOccurrenceSelection({
			selection: { clipIds }, clips,
		}, VIDEO), /one selected video occurrence/iu, name);
	}
});

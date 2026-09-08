/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperFinishingCommand } from '../src/common/editor/ui/framescaper-finishing-dialog-model.ts';

test('finishing documents ignore key-order-only collection changes', () => {
	const first = caption('caption-1', 'First');
	const second = caption('caption-2', 'Second');
	const reorderedFirst = {
		language: first.language,
		name: first.name,
		sequenceId: first.sequenceId,
		id: first.id,
		schemaVersion: first.schemaVersion,
		cues: first.cues,
		speakers: first.speakers,
		regions: first.regions,
		styles: first.styles,
	};
	const command = createFramescaperFinishingCommand('captions', {
		schemaFamily: 'framescaper', schemaVersion: 1,
		videoCaptionTracks: [first, second],
	}, JSON.stringify([reorderedFirst, { ...second, name: 'Renamed' }]));

	assert.equal(command.type, 'video-caption-track/set');
	if (command.type !== 'video-caption-track/set') assert.fail('Expected one caption command.');
	assert.equal(command.captionTrackId, 'caption-2');
	assert.equal(command.captionTrack?.name, 'Renamed');
});

function caption(id: string, name: string) {
	return Object.freeze({
		schemaVersion: 1 as const,
		id,
		sequenceId: 'main-sequence',
		name,
		language: 'und',
		styles: Object.freeze([]),
		regions: Object.freeze([]),
		speakers: Object.freeze([]),
		cues: Object.freeze([]),
	});
}

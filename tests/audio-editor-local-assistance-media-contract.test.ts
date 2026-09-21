import test from 'node:test';
import assert from 'node:assert/strict';

import {
	LOCAL_ASSISTANCE_INPUT_MEDIA_TYPES,
	LOCAL_ASSISTANCE_INPUT_ROLES,
	LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES,
	LOCAL_ASSISTANCE_OUTPUT_ROLES,
} from '../src/common/editor/assistance/local-assistance-media-contract.ts';

test('local-assistance media tables exactly cover their role contracts', () => {
	assert.deepEqual(Object.keys(LOCAL_ASSISTANCE_INPUT_MEDIA_TYPES), [...LOCAL_ASSISTANCE_INPUT_ROLES]);
	assert.deepEqual(Object.keys(LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES), [...LOCAL_ASSISTANCE_OUTPUT_ROLES]);
	for (const mediaTypes of [
		...Object.values(LOCAL_ASSISTANCE_INPUT_MEDIA_TYPES),
		...Object.values(LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES),
	]) {
		assert.equal(Object.isFrozen(mediaTypes), true);
		assert.ok(mediaTypes.length > 0);
		assert.equal(new Set(mediaTypes).size, mediaTypes.length);
	}
});

test('shared input/output roles retain the same media contract', () => {
	assert.deepEqual(
		LOCAL_ASSISTANCE_INPUT_MEDIA_TYPES['voice-activity'],
		LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES['voice-activity'],
	);
	assert.deepEqual(LOCAL_ASSISTANCE_INPUT_MEDIA_TYPES.audio, [
		'audio/wav', 'audio/x-wav', 'audio/flac',
	]);
	assert.deepEqual(LOCAL_ASSISTANCE_OUTPUT_MEDIA_TYPES['enhanced-audio'], [
		'audio/wav', 'audio/flac',
	]);
});

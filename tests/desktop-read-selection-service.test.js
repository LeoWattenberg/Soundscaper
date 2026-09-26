/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	READ_PROFILE_MATERIALIZED_V1,
	READ_PROFILE_SCAPE_RANGE_V1,
} from '../desktop/constants.js';
import {
	readProfileForSelectedPath,
	registerSelectedReadCapability,
} from '../desktop/read-selection-service.js';

const OWNER = Object.freeze({ name: 'renderer-owner' });

test('every accepted desktop selection uses a range profile', () => {
	for (const filePath of ['/projects/session.scape', '/projects/session.SCAPE']) {
		assert.equal(
			readProfileForSelectedPath('project', filePath),
			READ_PROFILE_SCAPE_RANGE_V1,
		);
	}
	for (const [purpose, filePath] of [
		['project', '/projects/session.aup3'],
		['project', '/projects/session.aup4'],
		['project', '/projects/session.dawproject'],
		['project', '/projects/session.sesx'],
		['audio', '/audio/session.mp3'],
		['video', '/video/session.mp4'],
		['media', '/media/session.webm'],
		['labels', '/labels/session.srt'],
		['lut', '/lut/session.cube'],
	]) {
		assert.equal(
			readProfileForSelectedPath(purpose, filePath),
			'selected-range-v1',
			`${purpose}:${filePath}`,
		);
	}
	assert.equal(readProfileForSelectedPath('project', '/projects/session.scape.zip'), READ_PROFILE_MATERIALIZED_V1);
});

test('trusted selection dispatches to an explicit store registration method', async () => {
	const calls = [];
	const store = {
		async registerMaterializedPath(filePath, options) {
			calls.push(['materialized', filePath, options]);
			return { readProfile: READ_PROFILE_MATERIALIZED_V1 };
		},
		async registerScapeRangePath(filePath, options) {
			calls.push(['scape-range', filePath, options]);
			return { readProfile: READ_PROFILE_SCAPE_RANGE_V1 };
		},
		async registerSelectedRangePath(filePath, options) {
			calls.push(['selected-range', filePath, options]);
			return { readProfile: 'selected-range-v1' };
		},
	};

	assert.deepEqual(
		await registerSelectedReadCapability(store, '/projects/session.scape', {
			owner: OWNER,
			purpose: 'project',
			readProfile: READ_PROFILE_MATERIALIZED_V1,
		}),
		{ readProfile: READ_PROFILE_SCAPE_RANGE_V1 },
		'a caller-supplied profile cannot downgrade the trusted selection',
	);
	assert.deepEqual(
		await registerSelectedReadCapability(store, '/projects/session.aup4', {
			owner: OWNER,
			purpose: 'project',
			readProfile: READ_PROFILE_SCAPE_RANGE_V1,
		}),
		{ readProfile: 'selected-range-v1' },
		'a caller-supplied profile cannot promote an Audacity project',
	);
	assert.deepEqual(calls, [
		['scape-range', '/projects/session.scape', { owner: OWNER }],
		['selected-range', '/projects/session.aup4', { owner: OWNER }],
	]);
	for (const [purpose, filePath] of [
		['media', '/projects/disguised.scape'],
		['unknown', '/projects/session.wav'],
	]) {
		assert.throws(
			() => registerSelectedReadCapability(store, filePath, { owner: OWNER, purpose }),
			/selected file type.*not allowed/iu,
		);
	}
	assert.equal(calls.length, 2, 'invalid purpose/path pairs never reach either store method');
});

test('trusted PCM and compressed audio selections route to the selected range capability', async () => {
	const calls = [];
	const store = { registerSelectedRangePath(path, options) { calls.push([path, options]); return 'ranged'; } };
	for (const path of ['/audio/long.wav', '/audio/long.wave', '/audio/long.RF64', '/audio/long.bw64', '/audio/long.aif', '/audio/long.aiff',
		'/audio/long.aac', '/audio/long.flac', '/audio/long.m4a', '/audio/long.mp2', '/audio/long.mp3',
		'/audio/long.oga', '/audio/long.ogg', '/audio/long.opus', '/audio/long.wv', '/audio/long.wavpack']) {
		assert.equal(readProfileForSelectedPath('audio', path), 'selected-range-v1');
		assert.equal(await registerSelectedReadCapability(store, path, { owner: OWNER, purpose: 'audio' }), 'ranged');
	}
	assert.equal(calls.length, 16);
});

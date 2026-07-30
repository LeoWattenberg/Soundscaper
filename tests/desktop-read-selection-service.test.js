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

test('only project-purpose terminal Scape paths select the range profile', () => {
	for (const filePath of ['/projects/session.scape', '/projects/session.SCAPE']) {
		assert.equal(
			readProfileForSelectedPath('project', filePath),
			READ_PROFILE_SCAPE_RANGE_V1,
		);
	}
	for (const [purpose, filePath] of [
		['project', '/projects/session.aup3'],
		['project', '/projects/session.aup4'],
		['project', '/projects/session.scape.zip'],
		['media', '/projects/session.scape'],
		['audio', '/projects/session.scape'],
	]) {
		assert.equal(
			readProfileForSelectedPath(purpose, filePath),
			READ_PROFILE_MATERIALIZED_V1,
			`${purpose}:${filePath}`,
		);
	}
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
		{ readProfile: READ_PROFILE_MATERIALIZED_V1 },
		'a caller-supplied profile cannot promote an Audacity project',
	);
	assert.deepEqual(calls, [
		['scape-range', '/projects/session.scape', { owner: OWNER }],
		['materialized', '/projects/session.aup4', { owner: OWNER }],
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

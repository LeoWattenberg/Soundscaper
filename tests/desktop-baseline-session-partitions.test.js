/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { FRAMESCAPER_PROFILE, SOUNDSCAPER_PROFILE } from '../src/common/product-profiles.js';

test('baseline editor sessions use fresh stable product partitions', async () => {
	assert.equal(SOUNDSCAPER_PROFILE.desktop.sessionPartition, 'persist:soundscaper-production');
	assert.equal(FRAMESCAPER_PROFILE.desktop.sessionPartition, 'persist:framescaper-production');
	assert.notEqual(
		SOUNDSCAPER_PROFILE.desktop.sessionPartition,
		FRAMESCAPER_PROFILE.desktop.sessionPartition,
	);

	const constants = await readFile(new URL('../desktop/constants.js', import.meta.url), 'utf8');
	assert.match(constants, /persist:soundscaper-production/u);
	assert.match(constants, /persist:framescaper-production/u);
	assert.doesNotMatch(constants, /persist:(?:soundscaper|framescaper)-v\d+/u);
});

test('project-coupled native state uses fresh baseline identities', async () => {
	const [main, nativeRegistration] = await Promise.all([
		readFile(new URL('../desktop/main.mjs', import.meta.url), 'utf8'),
		readFile(new URL('../desktop/framescaper-native-services-registration.mjs', import.meta.url), 'utf8'),
	]);
	assert.match(main, /linked-video-locators-project-v1\.json/u);
	assert.doesNotMatch(main, /linked-video-locators-v1\.json/u);
	assert.match(nativeRegistration, /framescaper-native-services-v1\.sqlite/u);
	assert.doesNotMatch(nativeRegistration, /resolve\([^\n]*framescaper-native-services\.sqlite/u);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parseM5NativeHelperCohortArguments } from '../scripts/collect-m5-native-helper-cohort.mjs';
import { parseM5bQualityCohortArguments } from '../scripts/collect-m5b-quality-cohort.mjs';

test('M5 cohort CLIs require explicit measurements and closed profile identities', async () => {
	const soundscaper = parseM5NativeHelperCohortArguments([
		'--measurement', './one.json',
		'--measurement', './two.json',
		'--output-directory', './out',
	]);
	assert.equal(soundscaper.measurementPaths.length, 2);
	assert.ok(soundscaper.measurementPaths.every((path) => path.startsWith('/')));

	const framescaper = parseM5bQualityCohortArguments([
		'--profile', 'openfx',
		'--measurement', './one.json',
	]);
	assert.equal(framescaper.profileId, 'openfx');
	assert.equal(framescaper.measurementPaths.length, 1);
	assert.throws(
		() => parseM5bQualityCohortArguments(['--profile', 'unknown']),
		/Unknown 5B quality pipeline/iu,
	);
	assert.throws(
		() => parseM5NativeHelperCohortArguments(['--publish']),
		/Unknown M5 native-helper cohort argument/iu,
	);

	const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
	assert.match(packageJson.scripts['quality:cohort:m5-native-helper'], /collect-m5-native-helper-cohort/u);
	assert.match(packageJson.scripts['quality:cohort:m5b'], /collect-m5b-quality-cohort/u);
});

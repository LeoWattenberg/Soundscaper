/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const releasePolicy = await readFile(new URL('../docs/release-policy.md', import.meta.url), 'utf8');
const soundscaperQa = await readFile(new URL('../docs/qa/soundscaper.md', import.meta.url), 'utf8');
const framescaperQa = await readFile(new URL('../docs/qa/framescaper.md', import.meta.url), 'utf8');
const packageManifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('the owner decides a release from real CI and optional manual QA', () => {
	assert.match(releasePolicy, /pushing the stable tag is the owner's\s+release decision/iu);
	assert.match(releasePolicy, /automated tests.*what actually ran/isu);
	assert.match(releasePolicy, /manual QA.*never.*CI gate/isu);
	assert.doesNotMatch(releasePolicy, /qualification matrix|admission evidence|approved waiver|requalif/iu);
});

test('both QA templates hold releases for the three non-negotiable bug classes', () => {
	for (const template of [soundscaperQa, framescaperQa]) {
		assert.match(template, /Do not release with a known data-loss, security, or primary-workflow failure/u);
		assert.match(template, /Everything else is an owner decision/u);
	}
});

test('owner commands expose QA, release preparation, and soak debugging without formal aliases', () => {
	assert.equal(packageManifest.scripts['qa:new'], 'node scripts/create-qa-run.mjs');
	assert.equal(packageManifest.scripts['release:soundscaper:prepare'],
		'node scripts/prepare-soundscaper-release.mjs');
	assert.equal(packageManifest.scripts['debug:soak'], 'node scripts/run-soundscaper-soak.mjs');
	assert.doesNotMatch(
		JSON.stringify(packageManifest.scripts),
		/release:[^" ]*(?:admission|promot)|quality:cohort|qualification-evidence|trusted-lab|milestone5a:lab-diagnostic/iu,
	);
});

test('the fixed M5A lab and cohort harness is gone', async () => {
	for (const path of [
		'../desktop/native-helper-lab-diagnostic.ts',
		'../scripts/run-m5a-native-lab-diagnostic.mjs',
		'../tests/desktop-native-helper-lab-diagnostic.test.ts',
	]) await assert.rejects(access(new URL(path, import.meta.url)), /ENOENT/u);
});

test('the deleted severity register is not runtime-integrity evidence', async () => {
	await assert.rejects(access(new URL('../config/release-severity-policy.json', import.meta.url)), /ENOENT/u);
	const manifest = JSON.parse(await readFile(
		new URL('../config/ffmpeg-runtime-manifest.json', import.meta.url), 'utf8',
	));
	assert.equal(Object.hasOwn(manifest.evidence, 'releaseSeverityPolicy'), false);
	assert.doesNotMatch(JSON.stringify(manifest), /release-severity-policy/u);
});

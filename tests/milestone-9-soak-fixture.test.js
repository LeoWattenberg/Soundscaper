/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	canonicalM9SoakFixtureBytes,
	generateM9SoakFixture,
	m9SoakScheduleSha256,
	validateM9SoakSpec,
} from '../scripts/lib/m9-soak-fixture.mjs';

const ROOT = new URL('../', import.meta.url);
const SPEC_URL = new URL('config/milestone-9-soak-spec.json', ROOT);

test('the pinned generator deterministically authors the complete eight-hour schedule', async () => {
	const spec = validateM9SoakSpec(JSON.parse(await readFile(SPEC_URL, 'utf8')));
	const first = generateM9SoakFixture(spec, 'qualification');
	const second = generateM9SoakFixture(spec, 'qualification');
	const bytes = canonicalM9SoakFixtureBytes(first);

	assert.deepEqual(first, second);
	assert.equal(first.durationSeconds, 28_800);
	assert.equal(first.qualificationEligible, true);
	assert.equal(first.generator.revision, 1);
	assert.equal(first.generator.seed, spec.generator.seed);
	assert.equal(first.schedule.length, spec.generatedArtifacts.qualification.eventCount);
	assert.equal(bytes.byteLength, spec.generatedArtifacts.qualification.byteLength);
	assert.equal(sha256(bytes), spec.generatedArtifacts.qualification.sha256);
	assert.equal(m9SoakScheduleSha256(first), spec.generatedArtifacts.qualification.scheduleSha256);
	assert.equal(new Set(first.schedule.map(({ eventId }) => eventId)).size, first.schedule.length);
	assert.deepEqual(new Set(first.projects.map(({ productId }) => productId)), new Set([
		'soundscaper', 'framescaper',
	]));
	assert.deepEqual(
		new Set(first.schedule.map(({ operationId }) => operationId)),
		new Set(spec.operations.map(({ id }) => id)),
	);
	assert.equal(spec.operations.some(({ id, kind }) => /midi/iu.test(`${id}:${kind}`)), false,
		'MIDI has no stable-1.0 soak qualification cell');
});

test('the short contract schedule covers every operation but cannot claim qualification', async () => {
	const spec = validateM9SoakSpec(JSON.parse(await readFile(SPEC_URL, 'utf8')));
	const fixture = generateM9SoakFixture(spec, 'contract');
	const bytes = canonicalM9SoakFixtureBytes(fixture);

	assert.equal(fixture.durationSeconds, 120);
	assert.equal(fixture.qualificationEligible, false);
	assert.deepEqual(
		new Set(fixture.schedule.map(({ operationId }) => operationId)),
		new Set(spec.operations.map(({ id }) => id)),
	);
	assert.equal(bytes.byteLength, spec.generatedArtifacts.contract.byteLength);
	assert.equal(sha256(bytes), spec.generatedArtifacts.contract.sha256);
	assert.equal(m9SoakScheduleSha256(fixture), spec.generatedArtifacts.contract.scheduleSha256);
});

test('the specification pins the exact generator source and rejects schedule drift', async () => {
	const source = await readFile(new URL('scripts/lib/m9-soak-fixture.mjs', ROOT));
	const spec = JSON.parse(await readFile(SPEC_URL, 'utf8'));
	assert.equal(spec.generator.sourceSha256, sha256(source));

	const changed = structuredClone(spec);
	changed.schedule[0].cadenceSeconds += 1;
	assert.throws(() => validateM9SoakSpec(changed), /generated artifact|schedule|pin/iu);
});

test('the generator CLI checks pins without writing an eight-hour artifact', async () => {
	const packageJson = JSON.parse(await readFile(new URL('package.json', ROOT), 'utf8'));
	assert.equal(
		packageJson.scripts['quality:fixture:m9-soak'],
		'node scripts/generate-m9-soak-fixture.mjs',
	);
	const output = execFileSync(
		process.execPath, ['scripts/generate-m9-soak-fixture.mjs', '--check'],
		{ cwd: new URL('.', ROOT), encoding: 'utf8' },
	);
	assert.match(output, /qualification.*1296.*contract.*9/isu);
});

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

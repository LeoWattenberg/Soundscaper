/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import { videoTimingProbeMedia } from './browser/fixtures/video-timing-probe-media.js';

const matrix = await json('config/milestone-3-timing-probe-matrix.json');
const milestone2 = await json('config/milestone-2-closure.json');
const quality = await json('config/quality-budgets.json');
const packageJson = await json('package.json');

test('WP-0.3 matrix pins the supported browser engines and keeps WebKit explicitly deferred', async () => {
	assert.equal(matrix.workPacket, 'WP-0.3');
	assert.deepEqual(
		matrix.browserRows.filter(({ status }) => status === 'automated').map(({ project }) => project),
		milestone2.platformSet.browserProjects,
	);
	assert.deepEqual(
		matrix.browserRows.filter(({ status }) => status === 'deferred').map(({ project }) => project),
		milestone2.platformSet.deferredBrowserProjects,
	);
	for (const row of matrix.browserRows) {
		const pinned = quality.softwareInputs.browsers[row.project];
		assert.equal(row.version, pinned.version);
		assert.equal(row.revision, pinned.revision);
		for (const evidence of row.evidence ?? []) await access(evidence);
	}
});

test('WP-0.3 CFR and VFR media are repository-generated, digest-pinned, and both assigned to every automated browser row', () => {
	const configured = new Map(matrix.fixtures.map((fixture) => [fixture.id, fixture]));
	assert.deepEqual([...configured.values()].map(({ kind }) => kind).sort(), ['cfr', 'vfr']);
	for (const fixture of videoTimingProbeMedia) {
		const entry = configured.get(fixture.id);
		assert.ok(entry);
		assert.match(entry.provenance, /^Generated in-repository/u);
		assert.equal(entry.sourceSha256, fixture.sourceSha256);
		assert.equal(createHash('sha256').update(fixture.file.buffer).digest('hex'), fixture.sourceSha256);
	}
	const fixtureIds = videoTimingProbeMedia.map(({ id }) => id);
	for (const row of matrix.browserRows.filter(({ status }) => status === 'automated')) {
		assert.deepEqual(row.fixtureIds, fixtureIds);
	}
});

test('WP-0.3 does not overclaim the unexecuted supported Electron matrix', () => {
	const electronVersion = packageJson.devDependencies.electron;
	const expected = milestone2.platformSet.desktopTargets.flatMap((target) => (
		['soundscaper', 'framescaper'].map((product) => `${product}:${target}`)
	)).sort();
	assert.deepEqual(
		matrix.electronRows.map(({ product, target }) => `${product}:${target}`).sort(),
		expected,
	);
	for (const row of matrix.electronRows) {
		assert.equal(row.version, electronVersion);
		assert.equal(row.status, 'pending-external');
		assert.ok(row.blocker);
	}
	assert.match(matrix.minimumFollowUp, /ordinary import path/iu);
});

async function json(path) {
	return JSON.parse(await readFile(path, 'utf8'));
}

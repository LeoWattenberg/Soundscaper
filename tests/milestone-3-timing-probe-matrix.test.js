/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import { videoSourceGeometryMedia } from './browser/fixtures/video-source-geometry-media.js';
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

test('WP-0.3 timing and geometry media are repository-generated, digest-pinned, and all assigned to every automated browser row', () => {
	const configured = new Map(matrix.fixtures.map((fixture) => [fixture.id, fixture]));
	assert.deepEqual(
		[...new Set([...configured.values()].map(({ kind }) => kind))].sort(),
		['cfr', 'geometry', 'vfr'],
	);
	for (const fixture of [...videoTimingProbeMedia, ...videoSourceGeometryMedia]) {
		const entry = configured.get(fixture.id);
		assert.ok(entry, `${fixture.id} must be configured`);
		assert.match(entry.provenance, /^Generated in-repository/u);
		assert.equal(entry.sourceSha256, fixture.sourceSha256);
		assert.equal(createHash('sha256').update(fixture.file.buffer).digest('hex'), fixture.sourceSha256);
	}
	const fixtureIds = [...videoTimingProbeMedia, ...videoSourceGeometryMedia].map(({ id }) => id);
	for (const row of matrix.browserRows.filter(({ status }) => status === 'automated')) {
		assert.deepEqual(row.fixtureIds, fixtureIds);
	}
});

test('WP-0.3 geometry fixtures state one picture under three declarations', () => {
	const codedSizes = new Set(videoSourceGeometryMedia.map(({ coded }) => `${coded.width}x${coded.height}`));
	assert.equal(codedSizes.size, 1, 'the coded picture is the constant the declarations vary against');
	for (const fixture of videoSourceGeometryMedia) {
		const turned = fixture.rotationDegrees === 90 || fixture.rotationDegrees === 270;
		const stretched = Math.round(
			(fixture.coded.width * fixture.pixelAspectRatio.num) / fixture.pixelAspectRatio.den,
		);
		assert.deepEqual(fixture.display, turned
			? { width: fixture.coded.height, height: stretched }
			: { width: stretched, height: fixture.coded.height });
		// Every engine presents some part of that geometry, never more than it.
		for (const presented of Object.values(fixture.presentedByEngine)) {
			assert.ok(presented.width <= fixture.display.width && presented.height <= fixture.display.height);
		}
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
	assert.match(matrix.minimumFollowUp, /ordinary-import timing-probe harness/iu);
	for (const row of matrix.electronRows.filter(({ target }) => target === 'linux-x64')) {
		assert.match(row.blocker, /harness exists.*runner execution.*accepted result/iu);
	}
});

async function json(path) {
	return JSON.parse(await readFile(path, 'utf8'));
}

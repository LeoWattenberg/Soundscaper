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
const milestone3Plan = await readFile('docs/milestone-3-plan.md', 'utf8');

test('WP-0.3 matrix enables every maintained browser for automated testing', async () => {
	assert.equal(matrix.workPacket, 'WP-0.3');
	assert.deepEqual(
		matrix.browserRows.filter(({ status }) => status === 'automated').map(({ project }) => project),
		milestone2.testActivation.browserProjects,
	);
	assert.deepEqual(matrix.browserRows.filter(({ status }) => status === 'deferred'), []);
	assert.equal(milestone2.testActivation.humanReviewMilestone, 9);
	assert.match(milestone2.testActivation.policy, /never disables automated testing/iu);
	assert.deepEqual(matrix.manualQualification, {
		milestone: 9,
		blocks: 'stable-1.0-release-admission',
		testActivation: 'non-blocking',
	});
	for (const row of matrix.browserRows) {
		const pinned = quality.softwareInputs.browsers[row.project];
		assert.equal(row.version, pinned.version);
		assert.equal(row.revision, pinned.revision);
		for (const evidence of row.evidence ?? []) await access(evidence);
	}
	const webkit = matrix.browserRows.find(({ project }) => project === 'webkit');
	assert.deepEqual(webkit.capabilityRequirements, ['durable-media-storage']);
	assert.equal(webkit.unsupportedDisposition, 'capability-skip');
	assert.match(
		milestone3Plan,
		/manual browser-engine qualification.*milestone 9.*stable 1\.0.*does not disable build or test/isu,
	);
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

test('WP-0.3 activates the full maintained Electron matrix without overclaiming release qualification', () => {
	const electronVersion = packageJson.devDependencies.electron;
	const expected = milestone2.testActivation.desktopTargets.flatMap((target) => (
		['soundscaper', 'framescaper'].map((product) => `${product}:${target}`)
	)).sort();
	assert.deepEqual(
		matrix.electronRows.map(({ product, target }) => `${product}:${target}`).sort(),
		expected,
	);
	for (const row of matrix.electronRows) {
		assert.equal(row.version, electronVersion);
		assert.equal(row.status, 'pending-external');
		assert.equal(row.testActivation, 'automated');
		assert.equal(row.humanReviewMilestone, 9);
		assert.ok(row.blocker);
		assert.match(row.blocker, /test.*enabled.*stable 1\.0.*pending/iu);
	}
	assert.match(matrix.minimumFollowUp, /accept.*results.*all ten.*milestone 9/iu);
});

async function json(path) {
	return JSON.parse(await readFile(path, 'utf8'));
}

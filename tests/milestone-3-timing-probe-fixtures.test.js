/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import { videoSourceGeometryMedia } from './browser/fixtures/video-source-geometry-media.js';
import { videoTimingProbeMedia } from './browser/fixtures/video-timing-probe-media.js';

const fixtures = JSON.parse(await readFile('config/milestone-3-timing-probe-fixtures.json', 'utf8'));

test('WP-0.3 keeps only digest-pinned correctness fixtures', async () => {
	assert.equal(fixtures.workPacket, 'WP-0.3');
	assert.deepEqual(Object.keys(fixtures), ['schemaVersion', 'workPacket', 'purpose', 'fixtures']);
	assert.doesNotMatch(JSON.stringify(fixtures), /qualification|admission|cohort|humanReview/iu);
	await assert.rejects(access('config/milestone-3-timing-probe-matrix.json'), { code: 'ENOENT' });

	const configured = new Map(fixtures.fixtures.map((fixture) => [fixture.id, fixture]));
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
		for (const presented of Object.values(fixture.presentedByEngine)) {
			assert.ok(presented.width <= fixture.display.width && presented.height <= fixture.display.height);
		}
	}
});

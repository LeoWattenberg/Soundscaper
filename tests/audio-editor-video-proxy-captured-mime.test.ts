/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	proveVideoProxyRelationship,
} from '../src/common/editor/video-proxy-relationship.ts';
import {
	ORIGINAL_SOURCE_ID,
	createVideoProxyFixture,
	videoProxyProject,
} from './helpers/video-proxy-relationship-fixtures.ts';

test('admits a parameterized MediaRecorder MIME type for the captured video original', async () => {
	const mimeType = 'video/webm;codecs=vp9';
	const project = videoProxyProject();
	const source = (project.sources as Record<string, unknown>[])
		.find((candidate) => candidate.id === ORIGINAL_SOURCE_ID);
	assert.ok(source);
	source.mimeType = mimeType;
	const fixture = createVideoProxyFixture({
		project,
		original: new Blob(['canonical-original'], { type: mimeType }),
		fingerprint: { mimeType },
	});

	await assert.doesNotReject(proveVideoProxyRelationship(fixture.authority, {
		sourceId: ORIGINAL_SOURCE_ID,
	}));
	assert.equal(fixture.seen.observationRequest?.mimeType, mimeType);
});

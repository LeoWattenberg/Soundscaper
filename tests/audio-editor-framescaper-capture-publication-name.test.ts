/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { framescaperCapturePublicationName } from '../src/common/editor/controller/framescaper-capture-publication-name.ts';

test('Web VCR recovery owners publish generic UTC names without browsing data', () => {
	const createdAt = Date.parse('2026-08-21T12:34:56.789Z');
	assert.equal(
		framescaperCapturePublicationName('display', 'web-vcr:opaque-display', createdAt),
		'Web Capture 2026-08-21 12-34-56 UTC',
	);
	assert.equal(
		framescaperCapturePublicationName('system-audio', 'web-vcr:opaque-audio', createdAt),
		'Web Capture 2026-08-21 12-34-56 UTC Audio',
	);
	assert.equal(framescaperCapturePublicationName('display', 'ordinary-source', createdAt), 'Screen Capture');
});

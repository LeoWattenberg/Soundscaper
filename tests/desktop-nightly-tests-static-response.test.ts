/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { pipeDesktopNightlyTestsStaticResponse } from
	'../scripts/lib/desktop-nightly-tests-static-response.mjs';

test('the nightly static server destroys a file stream when its response closes', () => {
	const stream = new PassThrough();
	const response = new PassThrough();
	pipeDesktopNightlyTestsStaticResponse(stream, response);
	response.emit('close');
	assert.equal(stream.destroyed, true);
});

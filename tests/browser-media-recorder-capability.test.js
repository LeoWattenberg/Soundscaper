/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { hasMediaRecorderCapability } from './browser/helpers/media-recorder-capability.js';

test('detects MediaRecorder from the runtime capability instead of a browser label', () => {
	assert.equal(hasMediaRecorderCapability({ MediaRecorder() {} }), true);
	assert.equal(hasMediaRecorderCapability({ MediaRecorder: class MediaRecorder {} }), true);
	assert.equal(hasMediaRecorderCapability({}), false);
	assert.equal(hasMediaRecorderCapability({ MediaRecorder: undefined }), false);
	assert.equal(hasMediaRecorderCapability({ MediaRecorder: {} }), false);
});

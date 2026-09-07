/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecordingCapturePool } from '../src/common/editor/recording-capture-pool.js';
import { RECORDING_DEFAULT_DEVICE_ID } from '../src/common/editor/recording-routing.js';
import { createRecordingCapturePoolBinding } from '../src/common/editor/controller/recording-capture-pool-binding.ts';

test('capture binding preserves an injected pool', () => {
	const pool = createRecordingCapturePool();
	assert.equal(createRecordingCapturePoolBinding({ pool, onChange() {} }), pool);
	pool.dispose();
});

test('capture binding requests the controller host with default or explicit hardware identity', async () => {
	for (const deviceId of [RECORDING_DEFAULT_DEVICE_ID, 'usb-interface']) {
		const declined = new Error('Capture declined');
		const requests: MediaStreamConstraints[] = [];
		const mediaDevices = {
			getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
				assert.equal(this, mediaDevices);
				requests.push(constraints);
				return Promise.reject(declined);
			},
		};
		const pool = createRecordingCapturePoolBinding({ mediaDevices, onChange() {} });
		await assert.rejects(pool.acquireHardware(deviceId, { channelCount: 4 }), declined);
		assert.equal(requests.length, 1);
		assert.deepEqual(requests[0]?.audio, {
			channelCount: { ideal: 4, max: 4 },
			echoCancellation: false, noiseSuppression: false, autoGainControl: false,
			...(deviceId === RECORDING_DEFAULT_DEVICE_ID ? {} : { deviceId: { exact: deviceId } }),
		});
		pool.dispose();
	}
});

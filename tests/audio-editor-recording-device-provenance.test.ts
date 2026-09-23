/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	recordedSourceProvenance,
} from '../src/common/editor/controller/recording/internal/recording-source-provenance.ts';

test('recorded source provenance keeps the actual non-default device label without its hardware id', () => {
	const provenance = recordedSourceProvenance({
		kind: 'device',
		deviceId: 'sensitive-hardware-id',
		deviceLabel: 'Studio Microphone',
		channelStart: 0,
		channelCount: 1,
	});

	assert.deepEqual(provenance.extensions?.soundscaper.recordingDeviceLabels, ['Studio Microphone']);
	assert.doesNotMatch(JSON.stringify(provenance), /sensitive-hardware-id/u);
});

test('recorded source provenance omits default and display input labels', () => {
	assert.equal(recordedSourceProvenance({
		kind: 'device', deviceId: 'default', deviceLabel: 'Default audio input',
		channelStart: 0, channelCount: 1,
	}).extensions, undefined);
	assert.equal(recordedSourceProvenance({
		kind: 'display', label: 'Desktop / tab audio', channelStart: 0, channelCount: 2,
	}).extensions, undefined);
});

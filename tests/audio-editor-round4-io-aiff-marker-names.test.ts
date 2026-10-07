/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { inventoryDeliveryConversions, createDeliveryReportForPlan } from '../src/common/editor/delivery-conversion-inventory.ts';
import { createAiffMarkChunk, parseAiffMarkChunk } from '../src/common/editor/aiff-markers.ts';

const plan = (labels: readonly string[], format = 'aiff') => ({ format, sampleRate: 48_000,
	encoding: { sampleFormat: 'int16', bitDepth: 16, floatingPoint: false, channelCount: 1, inputChannelCount: 1 },
	markers: labels.map((label, index) => ({ sampleOffset: index, label })),
});

test('AIFF marker-name loss is inventoried with actual byte limits without changing authored names', () => {
	const long = `${'a'.repeat(254)}😀`;
	const authored = plan(['Short', long, 'é'.repeat(128)]);
	const names = parseAiffMarkChunk(createAiffMarkChunk(authored.markers).subarray(8)).map(marker => marker.label);
	assert.deepEqual(names, ['Short', 'a'.repeat(254), 'é'.repeat(127)]);
	const conversions = inventoryDeliveryConversions(authored, { sampleRate: 48_000 });
	assert.deepEqual(conversions.find(item => item.code === 'delivery.marker-names-truncated'), {
		code: 'delivery.marker-names-truncated', disposition: 'converted', severity: 'warning',
		data: { markers: 2, maximumNameBytes: 255, format: 'aiff' },
		message: 'AIFF marker names longer than 255 UTF-8 bytes were shortened in the delivery.',
	});
	const report = createDeliveryReportForPlan(authored, { sampleRate: 48_000 });
	assert.equal(report.items.filter(item => item.code === 'delivery.marker-names-truncated').length, 1);
	assert.equal(authored.markers[1]?.label, long);
});

test('the exact AIFF name boundary and unrestricted WAV names produce no shortening warning', () => {
	for (const authored of [plan(['a'.repeat(255), `${'a'.repeat(251)}😀`]), plan(['é'.repeat(200)], 'wav')]) {
		assert.equal(inventoryDeliveryConversions(authored, { sampleRate: 48_000 })
			.some(item => item.code === 'delivery.marker-names-truncated'), false);
	}
});

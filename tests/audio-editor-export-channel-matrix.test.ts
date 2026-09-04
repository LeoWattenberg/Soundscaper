/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeMediaChannelMapping } from '../src/common/editor/media-export.js';
import {
	boundedExportChannelCount,
	ensureExportChannelMatrixWidth,
	exportChannelMatrixOutputCount,
	identityExportChannelMatrix,
	parseExportChannelMatrix,
	serializeExportChannelMatrix,
	toggleExportChannelMatrix,
} from '../src/common/editor/ui/export-channel-matrix.ts';

test('an absent or unreadable mapping opens on the routing the delivery would have made', () => {
	for (const value of ['', '   ', 'not json', '{}', '{"channels":[]}', null]) {
		assert.deepEqual(
			parseExportChannelMatrix(value, 3).map((row) => [...row]),
			[[true, false, false], [false, true, false], [false, false, true]],
			`${String(value)} must fall back to the identity routing`,
		);
	}
	assert.deepEqual(identityExportChannelMatrix(1).map((row) => [...row]), [[true]]);
});

test('a stated mapping is read as routing, whichever spelling it uses', () => {
	assert.deepEqual(
		parseExportChannelMatrix('{"channels":[{"inputs":[{"channel":0,"gain":0.5},{"channel":1,"gain":0.5}]}]}', 2)
			.map((row) => [...row]),
		[[true], [true]],
	);
	// A bare array of output channels, and a bare input index inside one.
	assert.deepEqual(
		parseExportChannelMatrix([[0], [1]], 2).map((row) => [...row]),
		[[true, false], [false, true]],
	);
	// A silent contribution is not a routing, so its cell stays clear.
	assert.deepEqual(
		parseExportChannelMatrix({ channels: [{ inputs: [{ channel: 0, gain: 0 }] }] }, 2).map((row) => [...row]),
		[[false], [false]],
	);
});

test('retyping the output count never forgets the columns a shorter count excluded', () => {
	const wide = toggleExportChannelMatrix(
		ensureExportChannelMatrixWidth(identityExportChannelMatrix(2), 4), 0, 3, true,
	);
	assert.equal(exportChannelMatrixOutputCount(wide), 4);
	// "3" on the way to "32": the grid keeps every column it was given.
	const narrowed = ensureExportChannelMatrixWidth(wide, 3);
	assert.equal(exportChannelMatrixOutputCount(narrowed), 4);
	assert.equal(narrowed[0][3], true);
	// Only the stated count reaches the delivery.
	assert.deepEqual(JSON.parse(serializeExportChannelMatrix(narrowed, 3)), {
		channels: [
			{ inputs: [{ channel: 0, gain: 1 }] },
			{ inputs: [{ channel: 1, gain: 1 }] },
			{ inputs: [] },
		],
	});
});

test('the output count is held inside the delivered bounds', () => {
	assert.equal(boundedExportChannelCount('8', 2), 8);
	assert.equal(boundedExportChannelCount('64', 2), 32);
	assert.equal(boundedExportChannelCount('', 5), 5);
	assert.equal(boundedExportChannelCount('0', 5), 5);
	assert.equal(boundedExportChannelCount('two', 5), 5);
});

test('a serialized grid is a mapping the export request already accepts', () => {
	const matrix = toggleExportChannelMatrix(
		toggleExportChannelMatrix(identityExportChannelMatrix(2), 1, 0, true), 1, 1, false,
	);
	const mapping = normalizeMediaChannelMapping(2, JSON.parse(serializeExportChannelMatrix(matrix)));
	assert.equal(mapping.mode, 'custom');
	assert.equal(mapping.outputChannelCount, 2);
	assert.deepEqual(mapping.channels[0].inputs, [{ channel: 0, gain: 1 }, { channel: 1, gain: 1 }]);
	assert.deepEqual(mapping.channels[1].inputs, []);
});

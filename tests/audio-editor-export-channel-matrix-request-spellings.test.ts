/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeMediaChannelMapping } from '../src/common/editor/media-export.js';
import {
	parseExportChannelMatrix,
	serializeExportChannelMatrix,
} from '../src/common/editor/ui/export-channel-matrix.ts';

/** Every spelling of a stereo identity mapping the export request accepts. */
const IDENTITY_SPELLINGS: readonly unknown[] = [
	{ channels: [0, 1] },
	'{"channels":[0,1]}',
	[[1, 0], [0, 1]],
	{ channels: [{ inputs: [{ channel: 0, gain: 1 }] }, { inputs: [{ channel: 1, gain: 1 }] }] },
];

function requested(value: unknown): unknown {
	return typeof value === 'string' ? JSON.parse(value) : value;
}

function routing(mapping: ReturnType<typeof normalizeMediaChannelMapping>): unknown {
	return mapping.channels.map((channel) => channel.inputs.map((input) => ({ ...input })));
}

test('the grid reads every mapping spelling the export request accepts', () => {
	for (const value of IDENTITY_SPELLINGS) {
		assert.deepEqual(
			parseExportChannelMatrix(value, 2).map((row) => [...row]),
			[[true, false], [false, true]],
			`${JSON.stringify(value)} is an identity routing`,
		);
	}
});

test('opening and applying a mapping delivers the routing it already stated', () => {
	for (const value of IDENTITY_SPELLINGS) {
		const applied = normalizeMediaChannelMapping(
			2,
			JSON.parse(serializeExportChannelMatrix(parseExportChannelMatrix(value, 2))),
		);
		assert.deepEqual(
			routing(applied),
			routing(normalizeMediaChannelMapping(2, requested(value))),
			`${JSON.stringify(value)} must survive a round trip through the grid`,
		);
	}
});

test('a bare array of gains routes every input it feeds, whatever the gain', () => {
	assert.deepEqual(
		parseExportChannelMatrix([[0.5, 0.5]], 2).map((row) => [...row]),
		[[true], [true]],
	);
	// A silent contribution is not a routing, so its cell stays clear.
	assert.deepEqual(
		parseExportChannelMatrix([[1, 0]], 2).map((row) => [...row]),
		[[true], [false]],
	);
});

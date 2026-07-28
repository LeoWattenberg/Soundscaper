import assert from 'node:assert/strict';
import test from 'node:test';

import { createBwfExportMetadata } from '../src/common/editor/broadcast-wave-project.ts';

const PROJECT = {
	title: 'Surround delivery',
	createdAt: '2026-07-28T10:00:00.000Z',
	sampleRate: 48_000,
	metadata: { bext: null },
};

test('BWF export metadata supports multichannel BW64 coding history', () => {
	const metadata = createBwfExportMetadata(PROJECT, {
		outputSampleRate: 48_000,
		bitDepth: 24,
		channelCount: 6,
	});
	assert.match(metadata.codingHistory, /M=multi/u);
	assert.throws(() => createBwfExportMetadata(PROJECT, {
		outputSampleRate: 48_000,
		bitDepth: 24,
		channelCount: 33,
	}), /one to 32/u);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	normalizeDesktopAudioCodecCapabilityQuery,
	normalizeDesktopAudioCodecCapabilityResult,
} from '../desktop/desktop-audio-codec-capability-contract.ts';

const QUERY = Object.freeze({
	schemaVersion: 1 as const,
	operations: Object.freeze([
		Object.freeze({ operation: 'audio-encode' as const, format: 'opus' as const, sampleRate: 48_000, channelCount: 2 }),
		Object.freeze({ operation: 'audio-decode' as const, format: 'flac' as const, sampleRate: 96_000, channelCount: 6 }),
	]),
});

test('capability query is a closed bounded set of exact audio tuples', () => {
	const normalized = normalizeDesktopAudioCodecCapabilityQuery(QUERY);
	assert.notEqual(normalized, QUERY);
	assert.deepEqual(normalized, QUERY);
	assert.equal(Object.isFrozen(normalized), true);
	assert.equal(Object.isFrozen(normalized.operations), true);
	assert.equal(Object.isFrozen(normalized.operations[0]), true);
	for (const value of [
		{ ...QUERY, executablePath: '/private/ffmpeg' },
		{ ...QUERY, operations: [] },
		{ ...QUERY, operations: [...QUERY.operations, QUERY.operations[0]] },
		{ ...QUERY, operations: [{ ...QUERY.operations[0], argv: ['-i', '/private/input'] }] },
		{ ...QUERY, operations: [{ ...QUERY.operations[0], format: 'wav' }] },
	]) assert.throws(() => normalizeDesktopAudioCodecCapabilityQuery(value), /capability query|tuple/iu);
});

test('capability result is pathless, correlated, and has closed provider and reason values', () => {
	const result = normalizeDesktopAudioCodecCapabilityResult({
		schemaVersion: 1,
		capabilities: [
			{ ...QUERY.operations[0], available: true, provider: 'external-ffmpeg', reason: null },
			{ ...QUERY.operations[1], available: false, provider: null, reason: 'configure-external-ffmpeg' },
		],
	}, QUERY);
	assert.equal(Object.isFrozen(result.capabilities[0]), true);
	assert.deepEqual(Reflect.ownKeys(result.capabilities[0] ?? {}), [
		'operation', 'format', 'sampleRate', 'channelCount', 'available', 'provider', 'reason',
	]);
	for (const value of [
		{ schemaVersion: 1, capabilities: [{ ...result.capabilities[0], executablePath: '/private/ffmpeg' }, result.capabilities[1]] },
		{ schemaVersion: 1, capabilities: [{ ...result.capabilities[0], format: 'mp3' }, result.capabilities[1]] },
		{ schemaVersion: 1, capabilities: [{ ...result.capabilities[0], provider: 'renderer' }, result.capabilities[1]] },
		{ schemaVersion: 1, capabilities: [{ ...result.capabilities[0], available: false }, result.capabilities[1]] },
		{ schemaVersion: 1, capabilities: [result.capabilities[0]] },
	]) assert.throws(() => normalizeDesktopAudioCodecCapabilityResult(value, QUERY), /capability result|correlate/iu);
});

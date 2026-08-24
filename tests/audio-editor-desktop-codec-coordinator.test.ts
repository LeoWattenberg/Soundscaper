/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DesktopCodecOperationError,
	createDesktopCodecCoordinator,
	type DesktopCodecOperation,
	type DesktopCodecProvider,
} from '../src/common/editor/desktop-codec-coordinator.ts';

const OPERATION: DesktopCodecOperation = Object.freeze({
	direction: 'encode',
	mediaKind: 'audio',
	container: 'mp3',
	codec: 'mp3',
	profile: null,
	sampleFormat: 'fltp',
	pixelFormat: null,
	sampleRate: 48_000,
	channelCount: 2,
	width: null,
	height: null,
});

test('desktop codec providers resolve in bundled, OS, external order', async () => {
	const calls: string[] = [];
	const coordinator = createDesktopCodecCoordinator({ providers: [
		provider('bundled', 'bundled', 'unsupported', calls),
		provider('os', 'operating-system', 'unavailable', calls),
		provider('ffmpeg', 'external-ffmpeg', 'supported', calls),
	] });

	const result = await coordinator.execute(OPERATION, {
		inputDigests: ['1'.repeat(64)],
		settings: { bitrateKbps: 128 },
		run: async ({ provider: selected }) => {
			calls.push(`run:${selected.id}`);
			return {
				value: Uint8Array.of(1, 2, 3),
				outputDigest: '2'.repeat(64),
				timing: { startFrame: 0, frameCount: 12_000, encoderDelayFrames: 576, endPaddingFrames: 24 },
			};
		},
	});

	assert.deepEqual(calls, ['preflight:bundled', 'preflight:os', 'preflight:ffmpeg', 'run:ffmpeg']);
	assert.equal(result.value.byteLength, 3);
	assert.deepEqual(result.receipt.provider, {
		kind: 'external-ffmpeg', id: 'ffmpeg', implementation: 'fixture-ffmpeg', version: '9.0.1',
	});
	assert.equal(result.receipt.capabilityGeneration, 'generation-ffmpeg');
	assert.deepEqual(result.receipt.settings, { bitrateKbps: 128 });
	assert.equal(Object.isFrozen(result.receipt.settings), true);
	assert.deepEqual(result.receipt.inputDigests, ['1'.repeat(64)]);
	assert.equal(result.receipt.outputDigest, '2'.repeat(64));
	assert.equal(Object.isFrozen(result.receipt.operation), true);
	assert.equal(Object.isFrozen(result.receipt.timing), true);
});

test('receipt settings are closed immutable data rather than an ambient options bag', async () => {
	const coordinator = createDesktopCodecCoordinator({ providers: [
		provider('bundled', 'bundled', 'supported', []),
	] });
	for (const settings of [
		{ bitrateKbps: Number.NaN },
		{ 'unsafe setting': 1 },
		Object.defineProperty({}, 'bitrateKbps', { get: () => 128 }),
	]) await assert.rejects(() => coordinator.execute(OPERATION, {
		inputDigests: [], settings,
		run: () => Promise.resolve({
			value: null, outputDigest: '0'.repeat(64), timing: null,
		}),
	}), /settings/iu);
});

test('provider order is rejected when an OS or external provider precedes bundled codecs', () => {
	assert.throws(() => createDesktopCodecCoordinator({ providers: [
		provider('os', 'operating-system', 'supported', []),
		provider('bundled', 'bundled', 'supported', []),
	] }), /provider order/iu);
	assert.throws(() => createDesktopCodecCoordinator({ providers: [
		provider('external', 'external-ffmpeg', 'supported', []),
		provider('os', 'operating-system', 'supported', []),
	] }), /provider order/iu);
});

test('rejected preflight is terminal and never reaches a lower-priority provider', async () => {
	const calls: string[] = [];
	const coordinator = createDesktopCodecCoordinator({ providers: [
		provider('bundled', 'bundled', 'unsupported', calls),
		provider('os', 'operating-system', 'rejected', calls),
		provider('ffmpeg', 'external-ffmpeg', 'supported', calls),
	] });
	await assert.rejects(
		() => coordinator.execute(OPERATION, execution(calls)),
		(error) => error instanceof DesktopCodecOperationError
			&& error.code === 'DESKTOP_CODEC_PREFLIGHT_REJECTED'
			&& error.providerId === 'os',
	);
	assert.deepEqual(calls, ['preflight:bundled', 'preflight:os']);
});

test('execution failure is terminal and does not retry through external FFmpeg', async () => {
	const calls: string[] = [];
	const coordinator = createDesktopCodecCoordinator({ providers: [
		provider('bundled', 'bundled', 'supported', calls),
		provider('os', 'operating-system', 'supported', calls),
		provider('ffmpeg', 'external-ffmpeg', 'supported', calls),
	] });
	await assert.rejects(
		() => coordinator.execute(OPERATION, {
			inputDigests: [],
			run: ({ provider: selected }) => {
				calls.push(`run:${selected.id}`);
				return Promise.reject(new Error('partial native output'));
			},
		}),
		/partial native output/iu,
	);
	assert.deepEqual(calls, ['preflight:bundled', 'run:bundled']);
});

test('a selected provider may resolve unknown decode geometry and is re-preflighted before receipt', async () => {
	const calls: string[] = [];
	const providerValue = provider('bundled', 'bundled', 'supported', calls);
	const coordinator = createDesktopCodecCoordinator({ providers: [providerValue] });
	const unresolved = Object.freeze({
		...OPERATION, direction: 'decode' as const, sampleRate: null, channelCount: null,
	});
	const resolved = Object.freeze({ ...unresolved, sampleRate: 44_100, channelCount: 1 });
	const result = await coordinator.execute(unresolved, {
		inputDigests: [],
		run: () => Promise.resolve({
			value: null, outputDigest: '0'.repeat(64), timing: null,
			resolvedOperation: resolved,
		}),
	});
	assert.deepEqual(calls, ['preflight:bundled', 'preflight:bundled']);
	assert.deepEqual(result.receipt.operation, resolved);
});

test('resolved execution geometry cannot change the selected codec operation', async () => {
	const coordinator = createDesktopCodecCoordinator({ providers: [
		provider('bundled', 'bundled', 'supported', []),
	] });
	await assert.rejects(() => coordinator.execute(OPERATION, {
		inputDigests: [],
		run: () => Promise.resolve({
			value: null, outputDigest: '0'.repeat(64), timing: null,
			resolvedOperation: { ...OPERATION, codec: 'aac' },
		}),
	}), /resolved operation/iu);
});

test('cancellation before or during resolution is terminal', async () => {
	const alreadyCancelled = new AbortController();
	alreadyCancelled.abort(new DOMException('cancel', 'AbortError'));
	const calls: string[] = [];
	const coordinator = createDesktopCodecCoordinator({ providers: [
		provider('bundled', 'bundled', 'supported', calls),
	] });
	await assert.rejects(
		() => coordinator.execute(OPERATION, { ...execution(calls), signal: alreadyCancelled.signal }),
		(error) => error instanceof Error && error.name === 'AbortError',
	);
	assert.equal(calls.length, 0);

	const during = new AbortController();
	const cancelling = provider('bundled', 'bundled', 'unsupported', calls, () => during.abort());
	const lower = provider('ffmpeg', 'external-ffmpeg', 'supported', calls);
	await assert.rejects(
		() => createDesktopCodecCoordinator({ providers: [cancelling, lower] })
			.execute(OPERATION, { ...execution(calls), signal: during.signal }),
		(error) => error instanceof Error && error.name === 'AbortError',
	);
	assert.equal(calls.includes('preflight:ffmpeg'), false);
});

test('no matching provider reports every typed preflight reason', async () => {
	const calls: string[] = [];
	const coordinator = createDesktopCodecCoordinator({ providers: [
		provider('bundled', 'bundled', 'unsupported', calls),
		provider('os', 'operating-system', 'unavailable', calls),
	] });
	await assert.rejects(
		() => coordinator.execute(OPERATION, execution([])),
		(error) => error instanceof DesktopCodecOperationError
			&& error.code === 'DESKTOP_CODEC_UNAVAILABLE'
			&& error.attempts.length === 2
			&& error.attempts[0]?.disposition === 'unsupported'
			&& error.attempts[1]?.disposition === 'unavailable',
	);
});

function execution(calls: string[]) {
	return {
		inputDigests: [] as string[],
		run: async ({ provider: selected }: { provider: DesktopCodecProvider }) => {
			calls.push(`run:${selected.id}`);
			return { value: null, outputDigest: '0'.repeat(64), timing: null };
		},
	};
}

function provider(
	id: string,
	kind: DesktopCodecProvider['kind'],
	disposition: 'supported' | 'unsupported' | 'unavailable' | 'rejected',
	calls: string[],
	afterPreflight: () => void = () => {},
): DesktopCodecProvider {
	const preflightResult = disposition === 'supported'
		? Object.freeze({ disposition, reason: null })
		: Object.freeze({ disposition, reason: `${id}-${disposition}` });
	return Object.freeze({
		id,
		kind,
		implementation: `fixture-${id}`,
		version: kind === 'external-ffmpeg' ? '9.0.1' : '1.0.0',
		capabilityGeneration: `generation-${id}`,
		async preflight() {
			calls.push(`preflight:${id}`);
			afterPreflight();
			return preflightResult;
		},
	});
}

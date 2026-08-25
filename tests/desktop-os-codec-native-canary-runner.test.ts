/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	createOperatingSystemCodecNativeCanaryRunner,
	type OperatingSystemCodecNativeHostAdapter,
} from '../desktop/os-codec-native-canary-runner.ts';
import type {
	OperatingSystemCodecCanaryRequest,
	OperatingSystemCodecCanaryResult,
} from '../desktop/os-codec-capability-adapter.ts';
import type { DesktopCodecCapability, DesktopCodecTarget } from '../src/common/editor/desktop-codec-provider-catalog.ts';

const WINDOWS_VIDEO = videoCapability('wmf-h264-main-nv12-decode', 'mp4', 'h264', 'main', 'nv12');
const APPLE_AUDIO = audioCapability('apple-aac-lc-f32p-encode', 'encode', 'm4a', 'aac', 'lc', 'f32p');
const APPLE_VIDEO = videoCapability('apple-hevc-main10-p010-decode', 'mov', 'hevc', 'main10', 'p010le');

test('Windows x64 and ARM64 invoke only the injected Media Foundation native host', async () => {
	const received: OperatingSystemCodecCanaryRequest[] = [];
	const signals: AbortSignal[] = [];
	const runner = createOperatingSystemCodecNativeCanaryRunner(adapter((request, signal) => {
		received.push(request);
		signals.push(signal);
		return qualified(request, '11'.repeat(32));
	}));
	for (const target of ['win-x64', 'win-arm64'] as const) {
		const result = await runner.run(canaryRequest({
			target, implementation: 'windows-media-foundation', capability: WINDOWS_VIDEO,
		}), new AbortController().signal) as OperatingSystemCodecCanaryResult;
		assert.equal(result.status, 'qualified');
		assert.equal(result.status === 'qualified' && result.target, target);
	}
	assert.deepEqual(received.map(({ target }) => target), ['win-x64', 'win-arm64']);
	assert.deepEqual(received.map(({ implementation }) => implementation), [
		'windows-media-foundation', 'windows-media-foundation',
	]);
	assert.deepEqual(Object.keys(received[0] ?? {}).sort(), [
		'capability', 'capabilityDigest', 'contractVersion', 'implementation',
		'maximumDurationMs', 'osVersion', 'target',
	]);
	assert.equal(received.every(Object.isFrozen), true);
	assert.equal(received.every(({ capability }) => Object.isFrozen(capability)), true);
	assert.equal(signals.every((signal) => signal instanceof AbortSignal), true);
});

test('macOS ARM64 binds audio and video tuples to only the reviewed Apple frameworks', async () => {
	const implementations: string[] = [];
	const runner = createOperatingSystemCodecNativeCanaryRunner(adapter((request) => {
		implementations.push(request.implementation);
		return qualified(request, request.capability.mediaKind === 'audio' ? '22'.repeat(32) : '33'.repeat(32));
	}));
	await runner.run(canaryRequest({
		target: 'mac-arm64', implementation: 'apple-audiotoolbox-avfoundation', capability: APPLE_AUDIO,
	}), new AbortController().signal);
	await runner.run(canaryRequest({
		target: 'mac-arm64', implementation: 'apple-avfoundation-videotoolbox', capability: APPLE_VIDEO,
	}), new AbortController().signal);
	assert.deepEqual(implementations, [
		'apple-audiotoolbox-avfoundation', 'apple-avfoundation-videotoolbox',
	]);
});

test('unsupported targets and target/framework/media mismatches fail before native invocation', async () => {
	let calls = 0;
	const runner = createOperatingSystemCodecNativeCanaryRunner(adapter((request) => {
		calls += 1;
		return qualified(request, '44'.repeat(32));
	}));
	const invalid = [
		{ target: 'mac-x64', implementation: 'apple-audiotoolbox-avfoundation', capability: APPLE_AUDIO },
		{ target: 'linux-x64', implementation: 'windows-media-foundation', capability: WINDOWS_VIDEO },
		{ target: 'win-x64', implementation: 'apple-avfoundation-videotoolbox', capability: WINDOWS_VIDEO },
		{ target: 'mac-arm64', implementation: 'apple-audiotoolbox-avfoundation', capability: APPLE_VIDEO },
		{ target: 'mac-arm64', implementation: 'apple-avfoundation-videotoolbox', capability: APPLE_AUDIO },
	] as const;
	for (const tuple of invalid) {
		await assert.rejects(() => runner.run(canaryRequest({
			target: tuple.target as DesktopCodecTarget,
			implementation: tuple.implementation as OperatingSystemCodecCanaryRequest['implementation'],
			capability: tuple.capability,
		}), new AbortController().signal), /unsupported|framework|media/iu);
	}
	assert.equal(calls, 0);
});

test('the native invocation is independently bounded and aborts its injected host signal', async () => {
	const capture: { signal: AbortSignal | null } = { signal: null };
	const runner = createOperatingSystemCodecNativeCanaryRunner(adapter((_request, signal) => {
		capture.signal = signal;
		return new Promise(() => {});
	}));
	const started = performance.now();
	await assert.rejects(() => runner.run(canaryRequest({
		target: 'win-x64', implementation: 'windows-media-foundation', capability: WINDOWS_VIDEO,
		maximumDurationMs: 10,
	}), new AbortController().signal), /timed out/iu);
	assert.ok(performance.now() - started < 1_000);
	assert.equal(capture.signal?.aborted, true);
});

test('caller cancellation reaches the native host even when it ignores cancellation', async () => {
	const caller = new AbortController();
	const capture: { signal: AbortSignal | null } = { signal: null };
	let started!: () => void;
	const invoked = new Promise<void>((resolve) => { started = resolve; });
	const runner = createOperatingSystemCodecNativeCanaryRunner(adapter((_request, signal) => {
		capture.signal = signal;
		started();
		return new Promise(() => {});
	}));
	const pending = runner.run(canaryRequest({
		target: 'win-arm64', implementation: 'windows-media-foundation', capability: WINDOWS_VIDEO,
		maximumDurationMs: 1_000,
	}), caller.signal);
	await invoked;
	caller.abort(new Error('caller cancelled OS canary'));
	await assert.rejects(() => pending, /caller cancelled OS canary/iu);
	assert.equal(capture.signal?.aborted, true);
});

test('malformed, expanded, or mismatched native evidence fails closed', async () => {
	const request = canaryRequest({
		target: 'mac-arm64', implementation: 'apple-audiotoolbox-avfoundation', capability: APPLE_AUDIO,
	});
	for (const answer of [
		{ ...qualified(request, '55'.repeat(32)), capabilityDigest: '66'.repeat(32) },
		{ ...qualified(request, '77'.repeat(32)), nativeApiReached: false },
		{ ...qualified(request, '88'.repeat(32)), nativeExecutablePath: '/private/native-host' },
		{ contractVersion: 1, status: 'unavailable', reason: 'unknown' },
	]) {
		const runner = createOperatingSystemCodecNativeCanaryRunner(adapter(() => answer));
		await assert.rejects(() => runner.run(request, new AbortController().signal), /native canary|evidence/iu);
	}
});

test('hostile accessors are never invoked or forwarded to the native host', async () => {
	let getterCalls = 0;
	let hostCalls = 0;
	const request = { ...canaryRequest({
		target: 'win-x64', implementation: 'windows-media-foundation', capability: WINDOWS_VIDEO,
	}) } as Record<string, unknown>;
	Object.defineProperty(request, 'target', {
		enumerable: true,
		get() { getterCalls += 1; return 'win-x64'; },
	});
	const runner = createOperatingSystemCodecNativeCanaryRunner(adapter((nativeRequest) => {
		hostCalls += 1;
		return qualified(nativeRequest, '99'.repeat(32));
	}));
	await assert.rejects(() => runner.run(
		request as unknown as OperatingSystemCodecCanaryRequest,
		new AbortController().signal,
	), /closed data fields/iu);
	assert.equal(getterCalls, 0);
	assert.equal(hostCalls, 0);
});

test('the native-host seam exposes no subprocess, shell, argv, or filesystem path authority', async () => {
	const source = await readFile(new URL('../desktop/os-codec-native-canary-runner.ts', import.meta.url), 'utf8');
	assert.doesNotMatch(source, /node:child_process|\bspawn\s*\(|\bexec(?:File)?\s*\(|\bshell\s*:/u);
	assert.doesNotMatch(source, /executablePath|inputPath|outputPath|\bargv\b/u);
});

function adapter(
	invoke: OperatingSystemCodecNativeHostAdapter['runCanary'],
): OperatingSystemCodecNativeHostAdapter {
	return { runCanary: (request, signal) => Promise.resolve(invoke(request, signal)) };
}

function canaryRequest(options: Readonly<{
	readonly target: DesktopCodecTarget;
	readonly implementation: OperatingSystemCodecCanaryRequest['implementation'];
	readonly capability: DesktopCodecCapability;
	readonly maximumDurationMs?: number;
}>): OperatingSystemCodecCanaryRequest {
	return {
		contractVersion: 1,
		target: options.target,
		osVersion: options.target.startsWith('win-') ? '10.0.26100' : '15.4',
		implementation: options.implementation,
		capability: options.capability,
		capabilityDigest: createHash('sha256').update(JSON.stringify(options.capability), 'utf8').digest('hex'),
		maximumDurationMs: options.maximumDurationMs ?? 500,
	};
}

function qualified(
	request: OperatingSystemCodecCanaryRequest,
	evidenceDigest: string,
): Extract<OperatingSystemCodecCanaryResult, { readonly status: 'qualified' }> {
	return {
		contractVersion: 1,
		status: 'qualified',
		target: request.target,
		osVersion: request.osVersion,
		capabilityId: request.capability.id,
		capabilityDigest: request.capabilityDigest,
		implementation: request.implementation,
		nativeApiReached: true,
		exactTuplePassed: true,
		evidenceDigest,
	};
}

function videoCapability(
	id: string, container: string, codec: string, profile: string, pixelFormat: string,
): DesktopCodecCapability {
	return {
		id, direction: 'decode', mediaKind: 'video', container, codec, profile,
		sampleFormat: null, pixelFormat, sampleRate: null, channelCount: null,
		width: { minimum: 16, maximum: 8_192, multipleOf: 2 },
		height: { minimum: 16, maximum: 8_192, multipleOf: 2 },
	};
}

function audioCapability(
	id: string, direction: 'encode' | 'decode', container: string, codec: string,
	profile: string | null, sampleFormat: string,
): DesktopCodecCapability {
	return {
		id, direction, mediaKind: 'audio', container, codec, profile, sampleFormat,
		pixelFormat: null,
		sampleRate: { minimum: 8_000, maximum: 192_000, multipleOf: 1 },
		channelCount: { minimum: 1, maximum: 8, multipleOf: 1 },
		width: null, height: null,
	};
}

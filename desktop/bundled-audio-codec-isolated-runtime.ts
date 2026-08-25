/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-safe bundled tier whose exact codec work is delegated to utility processes. */

import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

import {
	BUNDLED_AUDIO_CODEC_IDS,
	type BundledAudioCodecHelperConfiguration,
	type BundledAudioCodecId,
} from './bundled-audio-codec-helper-configuration.js';
import {
	createBundledAudioCodecOperationRunner,
	type BundledAudioCodecChild,
	type BundledAudioCodecOperationRunner,
} from './bundled-audio-codec-operation-runner.js';
import {
	bundledAudioCodecIdForOperation,
	createIsolatedBundledAudioCodecProvider,
} from './bundled-audio-codec-provider-catalog.js';
import type {
	DesktopAudioCodecProviderExecutionResult,
	DesktopAudioCodecProviderRuntime,
} from './desktop-audio-codec-broker.js';
import type { DesktopAudioCodecRequest } from './desktop-audio-codec-operation-contract.js';
import type {
	DesktopCodecOperation,
	DesktopCodecPreflightResult,
	DesktopCodecProvider,
} from '../src/common/editor/desktop-codec-coordinator.js';
import {
	DESKTOP_CODEC_TARGETS,
	type DesktopCodecTarget,
} from '../src/common/editor/desktop-codec-provider-catalog.js';

const TARGETS = new Set<string>(DESKTOP_CODEC_TARGETS);
const STARTUP_CANARY_BATCH_SIZE = 4;

export async function loadIsolatedBundledAudioCodecRuntime(options: Readonly<{
	readonly target: DesktopCodecTarget;
	readonly scratchRoot: string;
	readonly verifyPayload: (codec: BundledAudioCodecId) => Promise<BundledAudioCodecHelperConfiguration>;
	readonly spawn: (configuration: BundledAudioCodecHelperConfiguration) => BundledAudioCodecChild;
	readonly createRunner?: typeof createBundledAudioCodecOperationRunner;
}>): Promise<DesktopAudioCodecProviderRuntime | null> {
	validateOptions(options);
	const target = options.target;
	const runner = (options.createRunner ?? createBundledAudioCodecOperationRunner)({
		target, scratchRoot: options.scratchRoot,
		verifyPayload: options.verifyPayload, spawn: options.spawn,
	});
	const admitted: BundledAudioCodecId[] = [];
	for (let offset = 0; offset < BUNDLED_AUDIO_CODEC_IDS.length; offset += STARTUP_CANARY_BATCH_SIZE) {
		const batch = BUNDLED_AUDIO_CODEC_IDS.slice(offset, offset + STARTUP_CANARY_BATCH_SIZE);
		const results = await Promise.all(batch.map(async (codec) => {
			try { return await runner.canary(codec); }
			catch { return false; }
		}));
		for (const [index, available] of results.entries()) {
			if (available) admitted.push(batch[index]!);
		}
	}
	if (admitted.length === 0) return null;
	const runtimes = new Map(admitted.map((codec) => [
		codec, proxyRuntime(codec, target, runner),
	] as const));
	return compositeRuntime(target, runtimes);
}

function proxyRuntime(
	codec: BundledAudioCodecId,
	target: DesktopCodecTarget,
	runner: BundledAudioCodecOperationRunner,
): DesktopAudioCodecProviderRuntime {
	return Object.freeze({
		provider: createIsolatedBundledAudioCodecProvider(codec, target),
		async preflightRequest(
			request: DesktopAudioCodecRequest,
			options: Readonly<{ readonly operation: DesktopCodecOperation; readonly signal?: AbortSignal }>,
		): Promise<DesktopCodecPreflightResult> {
			return await runner.preflight(codec, request, options.operation, signalOptions(options.signal));
		},
		async execute(
			request: DesktopAudioCodecRequest,
			options: Readonly<{ readonly operation: DesktopCodecOperation; readonly signal?: AbortSignal }>,
		): Promise<DesktopAudioCodecProviderExecutionResult> {
			return await runner.execute(codec, request, options.operation, signalOptions(options.signal));
		},
	});
}

function compositeRuntime(
	target: DesktopCodecTarget,
	runtimes: ReadonlyMap<BundledAudioCodecId, DesktopAudioCodecProviderRuntime>,
): DesktopAudioCodecProviderRuntime {
	const provider = compositeProvider(target, [...runtimes.values()]);
	return Object.freeze({
		provider,
		async selectRequestRuntime(
			_request: DesktopAudioCodecRequest,
			options: Readonly<{ readonly operation: DesktopCodecOperation; readonly signal?: AbortSignal }>,
		): Promise<DesktopAudioCodecProviderRuntime | null> {
			if (options.signal?.aborted) throw abortReason(options.signal);
			const codec = bundledAudioCodecIdForOperation(options.operation);
			return codec === null ? null : runtimes.get(codec) ?? null;
		},
		async preflightRequest(): Promise<DesktopCodecPreflightResult> {
			return Object.freeze({
				disposition: 'unsupported',
				reason: 'The authenticated bundled inventory has no exact codec for this request.',
			});
		},
		async execute(): Promise<DesktopAudioCodecProviderExecutionResult> {
			return Object.freeze({
				status: 'failed', reason: 'unavailable',
				detail: 'The authenticated bundled inventory has no exact codec for this request.',
			});
		},
	});
}

function compositeProvider(
	target: DesktopCodecTarget,
	runtimes: readonly DesktopAudioCodecProviderRuntime[],
): DesktopCodecProvider {
	const versions = runtimes.map(({ provider }) => provider.version).sort();
	const generations = runtimes.map(({ provider }) => provider.capabilityGeneration).sort();
	const implementations = runtimes.map(({ provider }) => provider.implementation).sort();
	const labels = [
		...(implementations.some((value) => value.includes('libflac')) ? ['libflac'] : []),
		...(implementations.some((value) => value.includes('lame')) ? ['lame'] : []),
		...(implementations.some((value) => value.includes('libmpg123')) ? ['mpg123'] : []),
		...(implementations.some((value) => value.includes('libopus')) ? ['libopus-libogg'] : []),
		...(implementations.some((value) => value.includes('twolame')) ? ['twolame'] : []),
		...(implementations.some((value) => value.includes('libvorbis')) ? ['libvorbis-libogg'] : []),
		...(implementations.some((value) => value.includes('wavpack')) ? ['wavpack'] : []),
	];
	return Object.freeze({
		kind: 'bundled', id: `bundled-reviewed-audio-${target}`,
		implementation: 'soundscaper-reviewed-audio-codecs', version: versions.join('+'),
		capabilityGeneration: `${labels.join('-')}-${digest(generations.join('\n'))}`,
		async preflight(
			operation: DesktopCodecOperation,
			options: Readonly<{ readonly signal?: AbortSignal }>,
		): Promise<DesktopCodecPreflightResult> {
			for (const runtime of runtimes) {
				const result = await runtime.provider.preflight(operation, options);
				if (result.disposition === 'supported' || result.disposition === 'rejected') return result;
			}
			return Object.freeze({
				disposition: 'unsupported',
				reason: 'The authenticated bundled audio inventory has no exact codec for this operation.',
			});
		},
	});
}

function validateOptions(options: Readonly<{
	target: DesktopCodecTarget;
	scratchRoot: string;
	verifyPayload: unknown;
	spawn: unknown;
	createRunner?: unknown;
}>): void {
	if (!options || typeof options !== 'object' || typeof options.target !== 'string'
		|| !TARGETS.has(options.target) || typeof options.scratchRoot !== 'string'
		|| !isAbsolute(options.scratchRoot) || options.scratchRoot.includes('\0')
		|| typeof options.verifyPayload !== 'function' || typeof options.spawn !== 'function'
		|| options.createRunner !== undefined && typeof options.createRunner !== 'function') {
		throw new TypeError('The isolated bundled audio codec runtime options are invalid.');
	}
}

function signalOptions(signal?: AbortSignal): Readonly<{ readonly signal?: AbortSignal }> {
	return Object.freeze({ ...(signal === undefined ? {} : { signal }) });
}

function abortReason(signal: AbortSignal): Error {
	if (signal.reason instanceof Error) return signal.reason;
	return new DOMException('The isolated bundled codec operation was cancelled.', 'AbortError');
}

function digest(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

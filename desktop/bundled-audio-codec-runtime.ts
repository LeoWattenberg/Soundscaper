/* SPDX-License-Identifier: AGPL-3.0-only */

/** One reviewed bundled tier composed from format-specific desktop runtimes. */

import type {
	DesktopAudioCodecProviderExecutionResult,
	DesktopAudioCodecProviderRuntime,
} from './desktop-audio-codec-broker.ts';
import type { DesktopAudioCodecRequest } from './desktop-audio-codec-operation-contract.ts';
import type {
	DesktopCodecOperation,
	DesktopCodecPreflightResult,
} from '../src/common/editor/desktop-codec-coordinator.ts';
import {
	DESKTOP_CODEC_TARGETS,
	type DesktopCodecTarget,
} from '../src/common/editor/desktop-codec-provider-catalog.ts';
import { createBundledAudioCodecCompositeProvider } from
	'./bundled-audio-codec-composite-provider.ts';

const TARGETS = new Set<string>(DESKTOP_CODEC_TARGETS);

export function createBundledDesktopAudioCodecRuntime(options: Readonly<{
	readonly target: DesktopCodecTarget;
	readonly runtimes: readonly DesktopAudioCodecProviderRuntime[];
}>): DesktopAudioCodecProviderRuntime {
	const target = desktopTarget(options?.target);
	const runtimes = runtimeList(options?.runtimes, target);
	const provider = createBundledAudioCodecCompositeProvider({
		target,
		providers: runtimes.map(({ provider: candidate }) => candidate),
		unsupportedReason: 'The reviewed bundled audio inventory has no exact codec for this operation.',
	});
	return Object.freeze({
		provider,
		async selectRequestRuntime(
			request: DesktopAudioCodecRequest,
			executionOptions: Readonly<{
				readonly operation: DesktopCodecOperation;
				readonly signal?: AbortSignal;
			}>,
		): Promise<DesktopAudioCodecProviderRuntime | null> {
			for (const runtime of runtimes) {
				const tuple = await runtime.provider.preflight(
					executionOptions.operation,
					Object.freeze({ ...(executionOptions.signal ? { signal: executionOptions.signal } : {}) }),
				);
				if (tuple.disposition === 'rejected') return runtime;
				if (tuple.disposition !== 'supported') continue;
				if (runtime.preflightRequest === undefined) return runtime;
				const exact = await runtime.preflightRequest(request, executionOptions);
				if (exact.disposition === 'supported' || exact.disposition === 'rejected') return runtime;
			}
			return null;
		},
		async preflightRequest(
			request: DesktopAudioCodecRequest,
			executionOptions: Readonly<{
				readonly operation: DesktopCodecOperation;
				readonly signal?: AbortSignal;
			}>,
		): Promise<DesktopCodecPreflightResult> {
			let exactFallback: DesktopCodecPreflightResult | null = null;
			for (const runtime of runtimes) {
				const tuple = await runtime.provider.preflight(executionOptions.operation, Object.freeze({
					...(executionOptions.signal ? { signal: executionOptions.signal } : {}),
				}));
				if (tuple.disposition === 'rejected') return tuple;
				if (tuple.disposition !== 'supported') continue;
				if (runtime.preflightRequest === undefined) return tuple;
				const exact = await runtime.preflightRequest(request, executionOptions);
				if (exact.disposition === 'supported' || exact.disposition === 'rejected') return exact;
				exactFallback = exact;
			}
			return exactFallback ?? Object.freeze({
				disposition: 'unsupported',
				reason: 'The reviewed bundled audio inventory has no exact codec for this request.',
			});
		},
		async execute(
			request: DesktopAudioCodecRequest,
			executionOptions: Readonly<{
				readonly operation: DesktopCodecOperation;
				readonly signal?: AbortSignal;
			}>,
		): Promise<unknown> {
			for (const runtime of runtimes) {
				const preflight = await runtime.provider.preflight(
					executionOptions.operation,
					Object.freeze({ ...(executionOptions.signal ? { signal: executionOptions.signal } : {}) }),
				);
				if (preflight.disposition === 'rejected') {
					return failed('security-failed', 'A reviewed bundled codec rejected the operation.');
				}
				if (preflight.disposition === 'supported') {
					return await runtime.execute(request, executionOptions);
				}
			}
			return failed('unavailable', 'No reviewed bundled codec supports this exact operation.');
		},
	});
}

function runtimeList(
	value: unknown,
	target: DesktopCodecTarget,
): readonly DesktopAudioCodecProviderRuntime[] {
	if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
		throw new TypeError('The bundled audio codec runtime list is invalid.');
	}
	const identities = new Set<string>();
	const result = value.map((candidate: unknown) => {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			throw new TypeError('The bundled audio codec runtime list is invalid.');
		}
		const runtime = candidate as DesktopAudioCodecProviderRuntime;
		if (runtime.provider?.kind !== 'bundled' || typeof runtime.provider.preflight !== 'function'
			|| typeof runtime.execute !== 'function'
			|| runtime.preflightRequest !== undefined && typeof runtime.preflightRequest !== 'function'
			|| !runtime.provider.id.endsWith(`-${target}`)
			|| identities.has(runtime.provider.id)) {
			throw new TypeError('The bundled audio codec runtime list is invalid.');
		}
		identities.add(runtime.provider.id);
		return runtime;
	});
	return Object.freeze(result);
}

function failed(
	reason: 'unavailable' | 'security-failed',
	detail: string,
): Extract<DesktopAudioCodecProviderExecutionResult, { readonly status: 'failed' }> {
	return Object.freeze({ status: 'failed', reason, detail });
}

function desktopTarget(value: unknown): DesktopCodecTarget {
	if (typeof value !== 'string' || !TARGETS.has(value)) {
		throw new TypeError('The bundled audio codec desktop target is unsupported.');
	}
	return value as DesktopCodecTarget;
}

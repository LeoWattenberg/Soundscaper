/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact shared mechanics for the reviewed desktop bundled-audio-codec runtimes. */

import { createHash } from 'node:crypto';
import { setImmediate as waitImmediate } from 'node:timers/promises';

import type {
	DesktopAudioCodecProviderExecutionResult,
} from './desktop-audio-codec-broker.ts';
import {
	DESKTOP_CODEC_TARGETS,
	type DesktopCodecTarget,
} from '../src/common/editor/desktop-codec-provider-catalog.ts';

const TARGETS = new Set<string>(DESKTOP_CODEC_TARGETS);

export function bundledAudioCodecSha256(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

export function isBundledAudioCodecAbortError(value: unknown): boolean {
	return value instanceof Error && value.name === 'AbortError';
}

export async function yieldBundledAudioCodecMainLoop(): Promise<void> {
	await waitImmediate();
}

export function bundledAudioCodecFailure(
	reason: 'unavailable' | 'security-failed' | 'execution-failed' | 'result-failed',
	detail: string,
): Extract<DesktopAudioCodecProviderExecutionResult, { readonly status: 'failed' }> {
	return Object.freeze({ status: 'failed', reason, detail });
}

export function createBundledAudioCodecRuntimeSupport(codecLabel: string) {
	const cancellationMessage = `The bundled ${codecLabel} operation was cancelled.`;
	function abortReason(signal?: AbortSignal, fallback?: unknown): Error {
		if (signal?.reason instanceof Error) return signal.reason;
		if (fallback instanceof Error && isBundledAudioCodecAbortError(fallback)) return fallback;
		return new DOMException(cancellationMessage, 'AbortError');
	}
	return Object.freeze({
		abortReason,
		admitTarget(value: unknown): DesktopCodecTarget {
			if (typeof value !== 'string' || !TARGETS.has(value)) {
				throw new TypeError(`The bundled ${codecLabel} desktop target is unsupported.`);
			}
			return value as DesktopCodecTarget;
		},
		failure: bundledAudioCodecFailure,
		isAbortError: isBundledAudioCodecAbortError,
		throwIfAborted(signal?: AbortSignal): void {
			if (signal?.aborted) throw abortReason(signal);
		},
		yieldControl: yieldBundledAudioCodecMainLoop,
	});
}

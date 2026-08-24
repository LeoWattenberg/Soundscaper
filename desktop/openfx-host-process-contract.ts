/* SPDX-License-Identifier: AGPL-3.0-only */

/** Closed native scanner/runtime invocation plus exact per-launch filesystem authority. */

import { canonicalizeNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import type { NativeChildIsolationPathGrant } from './native-child-isolation-launcher.ts';

export interface OpenFxHostProcessInvocation {
	readonly executablePath: string;
	readonly arguments: readonly string[];
	/** Exact one-shot frame written before force-termination of a V12 render. */
	readonly cancellationFrame?: string;
}

export interface OpenFxHostProcessAuthority {
	readonly plugin: NativeChildIsolationPathGrant | null;
	readonly pluginResources: readonly NativeChildIsolationPathGrant[];
	readonly pluginRuntime: readonly NativeChildIsolationPathGrant[];
	readonly readOnly: readonly NativeChildIsolationPathGrant[];
	readonly writeOnly: readonly NativeChildIsolationPathGrant[];
}

export interface OpenFxHostProcessResult {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}

export interface OpenFxHostProcessHandle {
	readonly completion: Promise<OpenFxHostProcessResult>;
	cancel(): Promise<void>;
}

export type OpenFxHostProcessInvoker = (
	invocation: OpenFxHostProcessInvocation,
	authority: OpenFxHostProcessAuthority,
) => OpenFxHostProcessHandle;

export function openFxHostProcessArguments(
	invocation: OpenFxHostProcessInvocation,
): readonly string[] {
	const args = [...invocation.arguments];
	const scan = args.length === 4 && args[0] === '--scan' && args[2] === '--sha256';
	const invoke = args.length === 4 && args[0] === '--invoke-v12-grant'
		&& args[2] === '--grant-sha256';
	const interact = args.length === 4 && args[0] === '--interact-v1-grant'
		&& args[2] === '--grant-sha256';
	const selfTest = args.length === 1 && args[0] === '--self-test';
	if (!scan && !invoke && !interact && !selfTest) {
		throw new TypeError('A closed OpenFX host invocation is required.');
	}
	if ((invoke && !validOpenFxV12CancellationFrame(invocation.cancellationFrame))
		|| (!invoke && invocation.cancellationFrame !== undefined)) {
		throw new TypeError('A V12 runtime invocation requires one exact bounded cancellation frame.');
	}
	return Object.freeze(args);
}

export function createOpenFxV12CancellationFrame(
	invocation: Readonly<{ invocationId: string; abortSignalId: string }>,
): string {
	const frame = `${canonicalizeNativeMediaPlan({
		schemaVersion: 1,
		type: 'cancel',
		invocationId: invocation.invocationId,
		abortSignalId: invocation.abortSignalId,
	})}\n`;
	if (!validOpenFxV12CancellationFrame(frame)) {
		throw new TypeError('An OpenFX cancellation frame exceeds its closed one-shot domain.');
	}
	return frame;
}

function validOpenFxV12CancellationFrame(value: unknown): value is string {
	if (typeof value !== 'string' || Buffer.byteLength(value) > 4_096 || !value.endsWith('\n')) return false;
	try {
		const parsed = JSON.parse(value.slice(0, -1)) as unknown;
		return canonicalizeNativeMediaPlan(parsed) === value.slice(0, -1)
			&& !!parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			&& Object.keys(parsed).join(',') === 'schemaVersion,type,invocationId,abortSignalId'
			&& (parsed as Record<string, unknown>).schemaVersion === 1
			&& (parsed as Record<string, unknown>).type === 'cancel';
	} catch { return false; }
}

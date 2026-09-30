/* SPDX-License-Identifier: AGPL-3.0-only */

/** Contract-v1 control plane for one isolated Framescaper media utility process. */

import {
	type HelperJobGrant,
	type HelperMediaDecodeJobGrant,
	type HelperMediaEncodeJobGrant,
	type HelperMediaProxyJobGrant,
} from './helper-contract.ts';
import type { HelperDataPlaneIoPort } from './helper-data-plane-io.ts';
import { createHelperWorkerLifecycle } from './helper-worker-lifecycle.ts';
import type {
	NativeMediaHelperJobHandle,
	NativeMediaHelperJobRequest,
} from './native-media-helper-job.ts';
import type { NativeMediaHelperPoolJobKind } from './native-media-helper-pool.ts';

export const NATIVE_MEDIA_HELPER_PROCESS_KINDS = Object.freeze([
	'probe-video-source',
	'media-decode',
	'media-encode',
	'media-render',
	'media-proxy',
] as const satisfies readonly NativeMediaHelperPoolJobKind[]);

export interface NativeMediaHelperProcessRunner {
	run(request: NativeMediaHelperJobRequest): NativeMediaHelperJobHandle;
}

export interface NativeMediaHelperWorkerOptions {
	readonly post: (message: unknown) => void;
	readonly runner: NativeMediaHelperProcessRunner;
	readonly heartbeatIntervalMs?: number;
	readonly setIntervalImpl?: typeof setInterval;
	readonly clearIntervalImpl?: typeof clearInterval;
	readonly exit?: (code: number) => void;
}

export function createNativeMediaHelperWorker(options: NativeMediaHelperWorkerOptions) {
	if (!options || typeof options.post !== 'function' || !options.runner
		|| typeof options.runner.run !== 'function') {
		throw new TypeError('A native media helper requires post and exact job-runner seams.');
	}
	const lifecycle = createHelperWorkerLifecycle({
		kinds: NATIVE_MEDIA_HELPER_PROCESS_KINDS,
		post: options.post,
		admitsJob: (message) => (
			(NATIVE_MEDIA_HELPER_PROCESS_KINDS as readonly string[]).includes(message.kind)
		),
		transferredPortCount: (message) => transferredPortCount(
			message.kind as NativeMediaHelperPoolJobKind,
			message.grant as HelperJobGrant<NativeMediaHelperPoolJobKind>,
		),
		runJob: (message, ports) => options.runner.run({
			kind: message.kind as NativeMediaHelperPoolJobKind,
			grant: message.grant as HelperJobGrant<NativeMediaHelperPoolJobKind>,
			ports: ports as readonly HelperDataPlaneIoPort[],
		}),
		isFatalRunError: (error) => (
			error instanceof Error && /transferred MessagePort/u.test(error.message)
		),
		heartbeatIntervalMs: options.heartbeatIntervalMs,
		setIntervalImpl: options.setIntervalImpl,
		clearIntervalImpl: options.clearIntervalImpl,
		exit: options.exit,
	});
	return Object.freeze({
		handleMessage: lifecycle.handleMessage,
		dispose(code: number): void { lifecycle.dispose(code); },
	});
}

function transferredPortCount(
	kind: NativeMediaHelperPoolJobKind,
	grant: HelperJobGrant<NativeMediaHelperPoolJobKind>,
): number {
	if (kind === 'probe-video-source') return 0;
	if (kind === 'media-proxy') {
		const proxy = grant as HelperMediaProxyJobGrant;
		return 1 + (proxy.source.type === 'stream' ? 1 : 0);
	}
	const media = grant as HelperMediaDecodeJobGrant | HelperMediaEncodeJobGrant;
	return 1 + media.sources.filter((source) => source.type === 'stream').length
		+ (kind === 'media-decode' ? 1 : 0);
}

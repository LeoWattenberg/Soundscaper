/* SPDX-License-Identifier: AGPL-3.0-only */

/** Contract-v1 control plane for one scanner or one per-fingerprint OpenFX utility process. */

import {
	type HelperOfxScanJobGrant,
} from './helper-contract.ts';
import type { HelperOfxHostJobGrantV1OrV2 } from './helper-native-ofx-host-grant-v2.ts';
import { isHelperOfxInteractJobGrantV1 } from './helper-native-ofx-interact-grant.ts';
import type { HelperDataPlaneIoPort } from './helper-data-plane-io.ts';
import { createHelperWorkerLifecycle } from './helper-worker-lifecycle.ts';
import type { FramescaperOpenFxHelperMode } from './framescaper-openfx-runtime.ts';

export interface OpenFxHelperJobRequest {
	readonly kind: 'ofx-scan' | 'ofx-host';
	readonly grant: HelperOfxScanJobGrant | HelperOfxHostJobGrantV1OrV2;
	readonly ports: readonly HelperDataPlaneIoPort[];
}

export interface OpenFxHelperJobHandle {
	readonly completion: Promise<unknown>;
	cancel(): Promise<void>;
}

export interface OpenFxHelperJobRunnerPort {
	run(request: OpenFxHelperJobRequest): OpenFxHelperJobHandle;
}

export interface OpenFxHelperWorkerOptions {
	readonly mode: FramescaperOpenFxHelperMode;
	readonly post: (message: unknown) => void;
	readonly runner: OpenFxHelperJobRunnerPort;
	readonly heartbeatIntervalMs?: number;
	readonly setIntervalImpl?: typeof setInterval;
	readonly clearIntervalImpl?: typeof clearInterval;
	readonly exit?: (code: number) => void;
}

export function createOpenFxHelperWorker(options: OpenFxHelperWorkerOptions) {
	if (!options || (options.mode !== 'scanner' && options.mode !== 'runtime')
		|| typeof options.post !== 'function' || !options.runner
		|| typeof options.runner.run !== 'function') {
		throw new TypeError('An OpenFX helper requires an exact mode, post port, and job runner.');
	}
	const kind = options.mode === 'scanner' ? 'ofx-scan' : 'ofx-host';
	return createHelperWorkerLifecycle({
		kinds: [kind],
		post: options.post,
		admitsJob: (message) => message.kind === kind,
		transferredPortCount: (message) => openFxHelperTransferredPortCount(
			message.kind as 'ofx-scan' | 'ofx-host',
			message.grant as HelperOfxScanJobGrant | HelperOfxHostJobGrantV1OrV2,
		),
		runJob: (message, ports) => options.runner.run({
			kind,
			grant: message.grant as HelperOfxScanJobGrant | HelperOfxHostJobGrantV1OrV2,
			ports: ports as readonly HelperDataPlaneIoPort[],
		}),
		releasePorts: closePorts,
		heartbeatIntervalMs: options.heartbeatIntervalMs,
		setIntervalImpl: options.setIntervalImpl,
		clearIntervalImpl: options.clearIntervalImpl,
		exit: options.exit,
	});
}

function closePorts(value: unknown): void {
	if (!Array.isArray(value)) return;
	const ports = value as readonly unknown[];
	for (const port of ports) {
		try {
			if (port && typeof port === 'object' && typeof Reflect.get(port, 'close') === 'function') {
				Reflect.apply(Reflect.get(port, 'close') as () => void, port, []);
			}
		} catch { /* closing a rejected transfer is best-effort and must not mask its refusal */ }
	}
}

export function openFxHelperTransferredPortCount(
	kind: 'ofx-scan' | 'ofx-host',
	grant: HelperOfxScanJobGrant | HelperOfxHostJobGrantV1OrV2,
): number {
	if (kind === 'ofx-scan') return 1;
	const host = grant as HelperOfxHostJobGrantV1OrV2;
	if (isHelperOfxInteractJobGrantV1(host)) return 0;
	return 2 + (host.videoTimingAssets?.length ?? 0) + host.inputs.length;
}

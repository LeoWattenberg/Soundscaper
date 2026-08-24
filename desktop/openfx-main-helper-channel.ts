/* SPDX-License-Identifier: AGPL-3.0-only */

/** In-main control channel whose native work is delegated only to isolated children. */

import type { FramescaperOpenFxHostDescriptor } from './framescaper-openfx-host-payload.ts';
import type { FramescaperOpenFxHelperMode } from './framescaper-openfx-runtime.ts';
import type { HelperChannel } from './helper-supervisor.ts';
import type { HelperDataPlaneTransferPort } from './helper-data-plane-transfer.ts';
import {
	createOpenFxHelperJobRunner,
	selfTestFramescaperOpenFxHelper,
} from './openfx-helper-job.ts';
import type { OpenFxHostProcessInvoker } from './openfx-host-process-contract.ts';
import { createOpenFxHelperWorker } from './openfx-helper-worker.ts';

export async function createOpenFxMainHelperChannel(input: Readonly<{
	readonly descriptor: FramescaperOpenFxHostDescriptor;
	readonly mode: FramescaperOpenFxHelperMode;
	readonly pluginFingerprint: string | null;
	readonly invokeHost: OpenFxHostProcessInvoker;
}>): Promise<HelperChannel> {
	await selfTestFramescaperOpenFxHelper(input.descriptor, input.mode, input.invokeHost);
	let messageListener: ((message: unknown) => void) | null = null;
	let exitListener: ((code: number | null) => void) | null = null;
	const pending: unknown[] = [];
	let exited = false;
	let exitCode: number | null = null;
	const emit = (message: unknown) => {
		if (exited) return;
		if (messageListener) messageListener(message);
		else if (pending.length < 2) pending.push(message);
		else close(1);
	};
	const close = (code: number) => {
		if (exited) return;
		exited = true; exitCode = code;
		pending.length = 0;
		exitListener?.(code);
	};
	const worker = createOpenFxHelperWorker({
		mode: input.mode,
		post: emit,
		runner: createOpenFxHelperJobRunner({
			descriptor: input.descriptor,
			mode: input.mode,
			pluginFingerprint: input.pluginFingerprint,
			invokeHost: input.invokeHost,
		}),
		exit: close,
	});
	return Object.freeze({
		postMessage(message: Parameters<HelperChannel['postMessage']>[0], transfer = []) {
			if (exited) throw new Error('The in-main OpenFX helper channel is closed.');
			worker.handleMessage(message, transfer as readonly HelperDataPlaneTransferPort[]);
		},
		onMessage(listener: (message: unknown) => void) {
			if (messageListener) throw new Error('The in-main OpenFX helper already has a message listener.');
			messageListener = listener;
			const queued = pending.splice(0);
			queueMicrotask(() => { for (const message of queued) if (!exited) listener(message); });
		},
		onExit(listener: (code: number | null) => void) {
			if (exitListener) throw new Error('The in-main OpenFX helper already has an exit listener.');
			exitListener = listener;
			if (exited) queueMicrotask(() => listener(exitCode));
		},
		kill() { worker.dispose(); },
	});
}

/* SPDX-License-Identifier: AGPL-3.0-only */

/** Dedicated utility-process entry point for optional native speech inference. */

import { createAssistanceSpeechJobRunner } from './assistance-helper-job.js';
import { createSingleKindHelperWorker } from './helper-single-kind-worker.js';

export function createAssistanceHelperWorker(options = {}) {
	return createSingleKindHelperWorker({
		kind: 'assistance-speech',
		runJob: options.runJob ?? createAssistanceSpeechJobRunner(),
		post: options.post,
		heartbeatIntervalMs: options.heartbeatIntervalMs,
		setIntervalImpl: options.setIntervalImpl,
		clearIntervalImpl: options.clearIntervalImpl,
		exit: options.exit,
	});
}

const parentPort = globalThis.process?.parentPort;
if (parentPort && typeof parentPort.on === 'function') {
	const worker = createAssistanceHelperWorker({
		post: (message) => parentPort.postMessage(message),
		exit: (code) => process.exit(code),
	});
	parentPort.on('message', (event) => worker.handleMessage(event.data, event.ports ?? []));
}

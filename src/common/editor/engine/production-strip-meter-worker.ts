/* SPDX-License-Identifier: AGPL-3.0-only */

import { createProductionStripMeterWorkerRuntime } from './production-strip-meter-worker-runtime.ts';

const runtime = createProductionStripMeterWorkerRuntime({
	post: (response) => globalThis.postMessage(response),
});

globalThis.addEventListener('message', (event: MessageEvent<unknown>) => {
	runtime.handleMessage(event.data);
});

/* SPDX-License-Identifier: AGPL-3.0-only */

import { executeMediaContentDigestRequest } from './media-content-digest-worker-runtime.ts';

const scope = globalThis as unknown as {
	onmessage: ((event: Readonly<{ data: unknown }>) => void) | null;
	postMessage(message: unknown): void;
};
scope.onmessage = event => {
	void executeMediaContentDigestRequest(event.data).then(result => scope.postMessage(result));
};

/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperSelectedFreezeCaptureFinishing } from './editor-selected-finishing-visual-authoring-commands.ts';

const CAPTURES = new WeakMap<object, FramescaperSelectedFreezeCaptureFinishing>();

export const bindFramescaperSelectedFreezeCapture = bindFramescaperSelectedFreezeCaptureFinishing;

export function bindFramescaperSelectedFreezeCaptureFinishing(
	owner: object,
	capture: FramescaperSelectedFreezeCaptureFinishing,
): () => void {
	if (!owner || typeof owner !== 'object' || typeof capture?.capture !== 'function') {
		throw new TypeError('Selected freeze capture requires an owner and capture port.');
	}
	CAPTURES.set(owner, capture);
	return () => {
		if (CAPTURES.get(owner) === capture) CAPTURES.delete(owner);
	};
}

export function framescaperSelectedFreezeCaptureFinishingFor(
	owner: object,
): FramescaperSelectedFreezeCaptureFinishing | null {
	return CAPTURES.get(owner) ?? null;
}

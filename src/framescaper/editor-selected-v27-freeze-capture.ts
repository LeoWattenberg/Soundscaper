/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperSelectedFreezeCaptureV27 } from './editor-selected-v27-visual-authoring-commands.ts';

const CAPTURES = new WeakMap<object, FramescaperSelectedFreezeCaptureV27>();

export function bindFramescaperSelectedFreezeCaptureV27(
	owner: object,
	capture: FramescaperSelectedFreezeCaptureV27,
): () => void {
	if (!owner || typeof owner !== 'object' || typeof capture?.capture !== 'function') {
		throw new TypeError('Selected freeze capture requires an owner and capture port.');
	}
	CAPTURES.set(owner, capture);
	return () => {
		if (CAPTURES.get(owner) === capture) CAPTURES.delete(owner);
	};
}

export function framescaperSelectedFreezeCaptureV27For(
	owner: object,
): FramescaperSelectedFreezeCaptureV27 | null {
	return CAPTURES.get(owner) ?? null;
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';

/** Narrow a fixture result before reading properties unavailable on image clips. */
export function assertAudioVideoClipRecord(
	value: unknown,
	message = 'An audio or video clip is required.',
): asserts value is Readonly<Record<string, unknown>> & { readonly kind: 'audio' | 'video' } {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value)
		&& 'kind' in value && (value.kind === 'audio' || value.kind === 'video'), message);
}

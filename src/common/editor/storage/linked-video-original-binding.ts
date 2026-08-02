/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	LEGACY_LINKED_VIDEO_ORIGINAL_BINDING_SCHEMA_VERSION,
	normalizeLegacyLinkedVideoOriginalBinding,
	normalizeLegacyLinkedVideoOriginalBindingInput,
	normalizeLinkedVideoOriginalSourceShape,
	type LegacyLinkedVideoOriginalBinding,
	type LegacyLinkedVideoOriginalBindingInput,
	type LinkedVideoOriginalSourceShape,
} from './linked-original-binding.ts';

export const LINKED_VIDEO_ORIGINAL_BINDING_SCHEMA_VERSION =
	LEGACY_LINKED_VIDEO_ORIGINAL_BINDING_SCHEMA_VERSION;

export type LinkedVideoOriginalBinding = LegacyLinkedVideoOriginalBinding;
export type LinkedVideoOriginalBindingInput = LegacyLinkedVideoOriginalBindingInput;
export type { LinkedVideoOriginalSourceShape };

/** Compatibility validator for the maintained schema-v1 linked-video API. */
export function normalizeLinkedVideoOriginalBinding(value: unknown): LinkedVideoOriginalBinding {
	return normalizeLegacyLinkedVideoOriginalBinding(value);
}

export function normalizeLinkedVideoOriginalBindingInput(
	value: unknown,
): LinkedVideoOriginalBindingInput {
	return normalizeLegacyLinkedVideoOriginalBindingInput(value);
}

export { normalizeLinkedVideoOriginalSourceShape };

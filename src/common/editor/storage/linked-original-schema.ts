/* SPDX-License-Identifier: AGPL-3.0-only */

/** Legacy physical names are retained so existing durable databases need no migration. */
export const LINKED_ORIGINAL_STORE_NAME = 'linkedVideoOriginalBindings';
export const LINKED_ORIGINAL_PROJECT_INDEX_NAME = 'projectId';

const MAXIMUM_ID_CHARACTERS = 256;

/** Unambiguous exact project/source key for one product-local linked original. */
export function linkedOriginalBindingKey(projectId: unknown, sourceId: unknown): string {
	return JSON.stringify([
		linkedOriginalCanonicalIdentity(projectId, 'projectId'),
		linkedOriginalCanonicalIdentity(sourceId, 'sourceId'),
	]);
}

export function linkedOriginalCanonicalIdentity(value: unknown, field: string): string {
	if (typeof value !== 'string' || !value || value !== value.trim()) {
		throw new TypeError(`${field} must be a non-empty canonical string.`);
	}
	if (value.length > MAXIMUM_ID_CHARACTERS) {
		throw new RangeError(`${field} exceeds its character limit.`);
	}
	if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) {
		throw new TypeError(`${field} must not contain control or formatting characters.`);
	}
	return value;
}

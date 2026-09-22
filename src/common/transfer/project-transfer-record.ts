/* SPDX-License-Identifier: AGPL-3.0-only */

export const MAXIMUM_PROJECT_ID_LENGTH = 256;

export function admittedProjectTransferId(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 && value.length <= MAXIMUM_PROJECT_ID_LENGTH
		? value
		: null;
}

export function asProjectTransferRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

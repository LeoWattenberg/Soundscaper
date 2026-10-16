/* SPDX-License-Identifier: AGPL-3.0-only */

export function audiocityValidationPort(value, fallback) {
	const result = value === undefined ? fallback : Number(value);
	if (!Number.isSafeInteger(result) || result < 1024 || result > 65_535) throw new Error('Validation ports must be between 1024 and 65535.');
	return result;
}

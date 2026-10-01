/* SPDX-License-Identifier: AGPL-3.0-only */

export function isFlatStemFileName(value: string, suffix: string): boolean {
	return value.length > suffix.length
		&& value.toLowerCase().endsWith(suffix)
		&& value !== '.'
		&& value !== '..'
		&& !/[\u0000-\u001f\u007f]/u.test(value)
		&& !value.includes('/')
		&& !value.includes('\\');
}


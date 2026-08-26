/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Count the lines of a source file the way the maintainability guard counts them.
 *
 * A file that ends with a newline does not have an extra empty line after it, so splitting
 * on the separator and taking the length overcounts by one. That is not academic: the
 * module-size tests used the naive count while `scripts/check-file-size.mjs` did not, so a
 * file sitting exactly on the 600-line ceiling passed the canonical guard and failed the
 * test, with both claiming to enforce the same number. One definition keeps them honest.
 */
export function sourceLineCount(text) {
	if (!text) return 0;
	return text.split(/\r\n|\n|\r/u).length - (/\r\n$|[\n\r]$/u.test(text) ? 1 : 0);
}

/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The canonical JSON the release and payload tooling hashes.
 *
 * The same value has to serialize to the same bytes on every machine that runs
 * the tooling, because the digests taken over the result are pinned and
 * compared across hosts. Keys are therefore ordered by code unit - the default
 * array sort - never by host collation, which compares letters
 * case-insensitively first and so would order `audioX` after `audiob` on one
 * machine and before it on another.
 */
export function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value !== null && typeof value === 'object') {
		return `{${Object.keys(value).sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

/** The same canonical form as a newline-terminated document, ready to write. */
export function canonicalJsonDocument(value) {
	return `${canonicalJson(value)}\n`;
}

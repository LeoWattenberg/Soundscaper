/* SPDX-License-Identifier: AGPL-3.0-only */
/** Exchange custody preserves AE's authored Unicode form; destination model conversion owns any normalization. */
export function motionAeCustodyString(value: unknown, name: string, maximum = 512, allowEmpty = false): string {
	if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && value.length === 0)
		|| [...value].some((character) => /\p{Cc}/u.test(character) && !['\t', '\n', '\r'].includes(character))) throw new TypeError(`${name} must be bounded inert text.`);
	return value;
}

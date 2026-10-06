/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';

/**
 * Assert the original evidence claim while avoiding document-wide wildcard backtracking.
 *
 * Fixed phrases separated by top-level `.*` can be scanned from a moving offset: the
 * earliest occurrence of each phrase leaves the most room for the remaining phrases.
 * Other regular segments retain a complete regex match with lazy top-level wildcards.
 * Changing wildcard greediness preserves whether those regular patterns match, including
 * variable-length segments that may need to backtrack to leave text for the next segment.
 * Context-sensitive syntax and stateful regex flags use the original regex unchanged.
 */
export function assertOrderedClaim(text, claim, message) {
	const parsed = orderedClaimSegments(claim.source);
	if (!parsed || parsed.segments.length < 2 || /[gyv]/u.test(claim.flags)) {
		assert.match(text, claim, message);
		return;
	}
	const { segments, lazySource } = parsed;
	const fixedPhrases = segments.every(segment => !/[\\.^$*+?()[\]{}|]/u.test(segment));
	const scanInOrder = fixedPhrases && (claim.dotAll || !/[\n\r\u2028\u2029]/u.test(text));
	const flags = `${claim.flags}g`;
	let offset = 0;
	for (const [index, segment] of segments.entries()) {
		const pattern = new RegExp(segment, flags);
		// With variable-length segments, independent existence is only a necessary check.
		// The complete regex below determines whether they can all match in order.
		pattern.lastIndex = scanInOrder ? offset : 0;
		const found = pattern.exec(text);
		assert.ok(
			found,
			message ?? `Claim /${claim.source}/${claim.flags} has no match for segment ${index + 1} of ${segments.length}: /${segment}/`,
		);
		if (scanInOrder) offset = found.index + found[0].length;
	}
	if (!scanInOrder) assert.match(text, new RegExp(lazySource, claim.flags), message);
}

/** Only top-level wildcards separate segments; groups and character classes stay intact. */
function orderedClaimSegments(source) {
	const segments = [];
	let segment = '';
	let lazySource = '';
	let inClass = false;
	let depth = 0;
	for (let index = 0; index < source.length; index += 1) {
		const character = source[index];
		if (character === '\\') {
			const escaped = source[index + 1] ?? '';
			if (!inClass && /[1-9kbB]/u.test(escaped)) return null;
			segment += character + escaped;
			lazySource += character + escaped;
			index += 1;
			continue;
		}
		if (character === '[') inClass = true;
		else if (character === ']') inClass = false;
		if (!inClass) {
			if (character === '^' || character === '$' || (character === '|' && depth === 0)) return null;
			if (character === '(') {
				if (/^\(\?(?:[=!]|<)/u.test(source.slice(index))) return null;
				depth += 1;
			} else if (character === ')') depth -= 1;
			if (depth === 0 && character === '.' && source[index + 1] === '*') {
				segments.push(segment);
				segment = '';
				lazySource += '.*?';
				index += source[index + 2] === '?' ? 2 : 1;
				continue;
			}
		}
		segment += character;
		lazySource += character;
	}
	segments.push(segment);
	return { segments: segments.filter(Boolean), lazySource };
}

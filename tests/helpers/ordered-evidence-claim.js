/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';

/**
 * Assert that a document contains the phrases of an evidence claim, in order.
 *
 * These claims are long `A.*B.*C…` patterns applied to whole documents. A regex engine
 * answers that by backtracking over every way to split the text between the wildcards,
 * which grows explosively with both the segment count and the document length. As the
 * production threat model passed 325 KB, one twenty-six-segment claim stopped finishing:
 * `tests/production-security-scape-byte-source.test.js` hung, the Node test runner never
 * started the files queued behind it, and CI cancelled the whole `common` shard after
 * forty-five minutes with no failure to point at.
 *
 * Matching one segment at a time from a moving offset answers the same question - do these
 * phrases appear in this order - in linear time. Taking the earliest match of each segment
 * leaves the most room for the rest, so the scan finds an ordering whenever one exists.
 */
export function assertOrderedClaim(text, claim, message) {
	const segments = orderedClaimSegments(claim.source);
	if (segments.length < 2) {
		assert.match(text, claim, message);
		return;
	}
	const flags = `${claim.flags.replace(/[gy]/gu, '')}g`;
	let offset = 0;
	for (const [index, segment] of segments.entries()) {
		const pattern = new RegExp(segment, flags);
		pattern.lastIndex = offset;
		const found = pattern.exec(text);
		assert.ok(
			found,
			message ?? `Claim /${claim.source}/${claim.flags} has no match for segment ${index + 1} of ${segments.length}: /${segment}/`,
		);
		offset = found.index + Math.max(found[0].length, 1);
	}
}

/**
 * Split a claim on its top-level `.*` wildcards.
 *
 * Only an unescaped `.` immediately followed by `*` outside a character class separates
 * segments, so `\.scape`, `.{0,32}` and `[- ]` stay inside the segment that owns them.
 */
function orderedClaimSegments(source) {
	const segments = [];
	let segment = '';
	let inClass = false;
	for (let index = 0; index < source.length; index += 1) {
		const character = source[index];
		if (character === '\\') {
			segment += character + (source[index + 1] ?? '');
			index += 1;
			continue;
		}
		if (character === '[') inClass = true;
		else if (character === ']') inClass = false;
		if (!inClass && character === '.' && source[index + 1] === '*') {
			segments.push(segment);
			segment = '';
			index += 1;
			continue;
		}
		segment += character;
	}
	segments.push(segment);
	return segments.filter(Boolean);
}

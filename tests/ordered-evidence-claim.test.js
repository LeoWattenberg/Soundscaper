/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { assertOrderedClaim } from './helpers/ordered-evidence-claim.js';

test('an ordered claim accepts the phrases in order and rejects them out of order', () => {
	const document = 'alpha then beta and finally gamma.';
	assertOrderedClaim(document, /alpha.*beta.*gamma/isu);
	assert.throws(
		() => assertOrderedClaim(document, /gamma.*beta.*alpha/isu),
		/segment 2 of 3/u,
	);
	assert.throws(
		() => assertOrderedClaim(document, /alpha.*delta/isu),
		/segment 2 of 2/u,
	);
});

test('an ordered claim keeps regex syntax that is not a top-level wildcard', () => {
	assertOrderedClaim('open project.scape now', /open.*project\.scape/u);
	assertOrderedClaim('power-loss and power loss', /power[- ]loss.*power[- ]loss/u);
	assertOrderedClaim('one, then two', /(?:one|three).*(?:two|four)/u);
	assertOrderedClaim('peaks are PCM summaries', /peaks.{0,32}PCM/u);
	assert.throws(() => assertOrderedClaim('project scape', /project\.scape/u), /did not match/u);
});

test('an ordered claim resolves a long pattern over a large document in linear time', () => {
	// The regex form of this claim does not terminate: twenty-six greedy wildcards over a
	// 300 KB document make the engine explore every way to split the text between them.
	// That hung tests/production-security-scape-byte-source.test.js, which stalled the Node
	// runner and cost CI the whole `common` shard.
	const phrases = Array.from({ length: 26 }, (_, index) => `phrase-${String(index)}`);
	const filler = 'lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(200);
	const document = `${filler}${phrases.join(filler)}${filler}`;
	assert.ok(document.length > 300_000);
	const claim = new RegExp(phrases.join('.*'), 'isu');
	const started = process.hrtime.bigint();
	assertOrderedClaim(document, claim);
	const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
	assert.ok(elapsedMs < 1_000, `Ordered claim scanning took ${String(elapsedMs)} ms`);

	// The unmatched case is the one that actually explodes, so it has to stay bounded too.
	const missing = new RegExp([...phrases, 'phrase-absent'].join('.*'), 'isu');
	const rejectedAt = process.hrtime.bigint();
	assert.throws(() => assertOrderedClaim(document, missing), /segment 27 of 27/u);
	assert.ok(Number(process.hrtime.bigint() - rejectedAt) / 1e6 < 1_000);
});

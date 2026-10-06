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

for (const { name, document, claim } of [
	{ name: 'a greedy repeated segment', document: 'aab', claim: /a+.*ab/u },
	{ name: 'an optional segment suffix', document: 'workersecurity', claim: /workers?.*security/u },
	{ name: 'a repeated character class', document: 'ab', claim: /[ab]+.*b/u },
	{ name: 'nested wildcard alternatives', document: 'beta alpha gamma', claim: /(?:alpha.*beta|beta.*alpha).*gamma/su },
	{ name: 'a top-level alternative', document: 'gamma', claim: /alpha.*beta|gamma/u },
	{ name: 'a zero-width anchor', document: 'a', claim: /^.*a/u },
	{ name: 'a zero-width lookahead', document: 'a', claim: /(?=a).*a/u },
	{ name: 'a numbered backreference', document: 'aa', claim: /(a).*\1/u },
	{ name: 'a named backreference', document: 'aa', claim: /(?<word>a).*\k<word>/u },
	{ name: 'a greedy capture inside a lookahead', document: 'ab', claim: /^(?=(a.*))\1b$/u },
	{ name: 'a line break without dotAll', document: 'alpha\nbeta', claim: /alpha.*beta/u },
	{ name: 'a Unicode line separator without dotAll', document: 'alpha\u2028beta', claim: /alpha.*beta/u },
]) {
	test(`an ordered claim preserves the original match for ${name}`, () => {
		if (claim.test(document)) assertOrderedClaim(document, claim);
		else assert.throws(() => assertOrderedClaim(document, claim));
	});
}

test('an ordered claim preserves global and sticky regex state', () => {
	for (const claim of [/alpha.*beta/gu, /alpha.*beta/yu]) {
		claim.lastIndex = 2;
		const original = new RegExp(claim);
		original.lastIndex = claim.lastIndex;
		assert.throws(() => assert.match('alpha beta', original));
		assert.throws(() => assertOrderedClaim('alpha beta', claim));
		assert.equal(claim.lastIndex, original.lastIndex);
	}
});

test('an ordered claim keeps complete matching for overlapping and variable-length segments', () => {
	const documents = [''];
	for (let length = 1; length <= 5; length += 1) {
		for (let value = 0; value < 2 ** length; value += 1) {
			documents.push(value.toString(2).padStart(length, '0').replace(/0/gu, 'a').replace(/1/gu, 'b'));
		}
	}
	for (const claim of [/a+.*ab/u, /a?.*ab/u, /[ab]+.*b/u, /(?:a|ab).*b/u, /a.*a?b/u, /a.*b.*a/u]) {
		for (const document of documents) {
			if (claim.test(document)) assertOrderedClaim(document, claim);
			else assert.throws(() => assertOrderedClaim(document, claim), `${claim} must reject ${document}`);
		}
	}
});

test('an ordered claim rejects a missing variable-length segment before whole-document matching', () => {
	const phrases = Array.from({ length: 26 }, (_, index) => `phrase ${String(index)}`);
	const filler = 'the evidence repeats phrase 0 and phrase 1. '.repeat(200);
	const document = `${filler}${phrases.join(filler)}${filler}`;
	const pattern = [...phrases, 'phrase absent'].map(phrase => phrase.replace(' ', '\\s+')).join('.*');
	assert.throws(() => assertOrderedClaim(document, new RegExp(pattern, 'isu')), /segment 27 of 27/u);
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

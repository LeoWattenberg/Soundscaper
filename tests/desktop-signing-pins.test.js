import assert from 'node:assert/strict';
import test from 'node:test';
import { rebindSigningPins, signingDigest, canonicalSigningJson } from '../scripts/lib/desktop-signing-pins.mjs';

test('signing repins only transformed binaries and retains source provenance', () => {
	const original = { sourceRevision: 'source', files: { native: { sha256: 'before', byteLength: 10 } }, byteLength: 10 };
	assert.deepEqual(rebindSigningPins(original, new Map([['before', { sha256: 'after', byteLength: 20 }]])), {
		sourceRevision: 'source', files: { native: { sha256: 'after', byteLength: 20 } }, byteLength: 20,
	});
	assert.equal(original.files.native.sha256, 'before');
});
test('native build-result checks remain bound to their transformed result', () => {
	const result = { payload: { sha256: 'before', byteLength: 10 } };
	const updated = rebindSigningPins({ result, sha256: signingDigest(canonicalSigningJson(result)) },
		new Map([['before', { sha256: 'after', byteLength: 20 }]]));
	assert.equal(updated.sha256, signingDigest(canonicalSigningJson(updated.result)));
});

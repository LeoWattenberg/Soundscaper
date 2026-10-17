/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { motionCdpMemoryDetails, motionProcessMemoryDetails } from '../scripts/performance/motionscaper-sustained-memory-details.ts';
import { parseMotionProcessMemory } from '../scripts/performance/motionscaper-sustained-process.ts';

test('Motion optional memory absence is explicitly unavailable while reported zero remains available', () => {
	assert.deepEqual(motionCdpMemoryDetails({}), {
		backingStorageBytes: { status: 'unavailable', reason: 'not-reported' }, embedderHeapBytes: { status: 'unavailable', reason: 'not-reported' },
	});
	assert.deepEqual(motionCdpMemoryDetails({ backingStorageSize: 0, embedderHeapUsedSize: 3 }), {
		backingStorageBytes: { status: 'available', bytes: 0 }, embedderHeapBytes: { status: 'available', bytes: 3 },
	});
	for (const detail of Object.values(motionProcessMemoryDetails('Rss: 20 kB\nPss: 10 kB\n'))) assert.deepEqual(detail, { status: 'unavailable', reason: 'not-reported' });
	assert.deepEqual(motionProcessMemoryDetails('Anonymous: 0 kB\n').anonymousBytes, { status: 'available', bytes: 0 });
});

for (const value of [null, undefined, '32', -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
	test(`Motion optional CDP backing storage rejects reported ${String(value)} as unavailable`, () => {
		assert.deepEqual(motionCdpMemoryDetails({ backingStorageSize: value, embedderHeapUsedSize: 64 }), {
			backingStorageBytes: { status: 'unavailable', reason: 'invalid' }, embedderHeapBytes: { status: 'available', bytes: 64 },
		});
	});
}
test('Motion optional CDP values must be own data fields and never invoke accessors', () => {
	let calls = 0; const heap = Object.create({ backingStorageSize: 5 }) as Record<string, unknown>;
	Object.defineProperty(heap, 'embedderHeapUsedSize', { get() { calls++; throw new Error('Must not invoke diagnostic accessors'); } });
	assert.deepEqual(motionCdpMemoryDetails(heap), {
		backingStorageBytes: { status: 'unavailable', reason: 'not-reported' }, embedderHeapBytes: { status: 'unavailable', reason: 'invalid' },
	});
	assert.equal(calls, 0);
});

for (const value of ['-1 kB', '1.5 kB', '1e3 kB', 'NaN kB', 'Infinity kB', '2 MB', '9007199254740991 kB', '']) {
	test(`Motion optional Linux Pss_File ${value || 'empty'} cannot become a byte measurement`, () => {
		const text = `Rss: 20 kB\nPss: 10 kB\nPss_File: ${value}\nPrivate_Clean: 1 kB\n`;
		assert.deepEqual(motionProcessMemoryDetails(text).pssFileBytes, { status: 'unavailable', reason: 'invalid' });
		assert.deepEqual(motionProcessMemoryDetails(text).privateCleanBytes, { status: 'available', bytes: 1024 });
		assert.deepEqual(parseMotionProcessMemory(text), { rssBytes: 20480, pssBytes: 10240 }, 'Required parser contract is unchanged.');
	});
}
for (const [field, key] of [
	['Private_Clean', 'privateCleanBytes'], ['Private_Dirty', 'privateDirtyBytes'], ['Shared_Clean', 'sharedCleanBytes'], ['Shared_Dirty', 'sharedDirtyBytes'],
	['Anonymous', 'anonymousBytes'], ['Pss_Anon', 'pssAnonymousBytes'], ['Pss_File', 'pssFileBytes'], ['Pss_Shmem', 'pssSharedMemoryBytes'],
] as const) {
	test(`Motion optional Linux ${field} refuses ambiguous duplicate observations`, () => {
		assert.deepEqual(motionProcessMemoryDetails(`${field}: 4 kB\n${field}: 5 kB\n`)[key], { status: 'unavailable', reason: 'duplicate' });
		assert.deepEqual(motionProcessMemoryDetails(`${field}: 4 kB\n ${field}: invalid\n`)[key], { status: 'unavailable', reason: 'duplicate' });
	});
}
test('Motion optional Linux fields do not infer one overlapping category from another', () => {
	const detail = motionProcessMemoryDetails('Anonymous: 5 kB\nPss_Anon: 2 kB\nPrivate_Clean: 3 kB\nPss_File_extra: 4 kB\n');
	assert.deepEqual(detail.anonymousBytes, { status: 'available', bytes: 5120 });
	assert.deepEqual(detail.pssAnonymousBytes, { status: 'available', bytes: 2048 });
	assert.deepEqual(detail.pssFileBytes, { status: 'unavailable', reason: 'not-reported' });
	assert.throws(() => parseMotionProcessMemory('Pss_Anon: 20 kB\n'), /RSS\/PSS/u);
});

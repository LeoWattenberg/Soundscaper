import assert from 'node:assert/strict';
import test from 'node:test';

import {
	SourceBufferCache,
	createSourceBufferCache,
	estimateAudioBufferBytes,
} from '../src/common/editor/source-buffer-cache.js';

function audioBuffer(length, numberOfChannels = 2, name = '') {
	return { length, numberOfChannels, name };
}

test('source buffer cache accounts for Float32 planar PCM bytes', () => {
	const stereo = audioBuffer(100, 2);
	const mono = audioBuffer(25, 1);
	const cache = new SourceBufferCache({ maxBytes: 900 });

	assert.equal(estimateAudioBufferBytes(stereo), 800);
	assert.equal(cache.set('stereo', stereo), cache, 'set remains Map-compatible');
	cache.set('mono', mono);
	assert.equal(cache.byteLength, 900);
	assert.equal(cache.size, 2);
	assert.deepEqual([...cache.entries()], [['stereo', stereo], ['mono', mono]]);
	assert.equal(cache instanceof Map, true);
	assert.deepEqual(new Map(cache), new Map([['stereo', stereo], ['mono', mono]]));
});

test('get refreshes recency while peek and has do not', () => {
	const evicted = [];
	const cache = new SourceBufferCache({
		maxBytes: 16,
		onEvict: (event) => evicted.push(event),
	});
	const first = audioBuffer(2, 1, 'first');
	const second = audioBuffer(2, 1, 'second');
	const third = audioBuffer(2, 1, 'third');
	cache.set('first', first).set('second', second);

	assert.equal(cache.peek('first'), first);
	assert.equal(cache.has('first'), true);
	assert.deepEqual([...cache.keys()], ['first', 'second']);
	assert.equal(cache.get('first'), first);
	assert.deepEqual([...cache.keys()], ['second', 'first']);

	cache.set('third', third);
	assert.deepEqual([...cache.keys()], ['first', 'third']);
	assert.equal(cache.has('second'), false);
	assert.deepEqual(evicted, [{ key: 'second', value: second, bytes: 8, reason: 'capacity' }]);
});

test('replacing a key updates bytes and makes it most recently used', () => {
	const removals = [];
	const cache = createSourceBufferCache({
		maxBytes: 32,
		onRemove: (event) => removals.push(event),
	});
	const oldValue = audioBuffer(1, 1, 'old');
	const other = audioBuffer(2, 1, 'other');
	const replacement = audioBuffer(3, 1, 'replacement');
	cache.set('item', oldValue).set('other', other);
	cache.set('item', replacement);

	assert.equal(cache.byteLength, 20);
	assert.deepEqual([...cache.keys()], ['other', 'item']);
	assert.deepEqual(removals, [{ key: 'item', value: oldValue, bytes: 4, reason: 'replace' }]);
});

test('delete and clear release accounting and report explicit removal reasons', () => {
	const removals = [];
	const evictions = [];
	const cache = new SourceBufferCache({
		maxBytes: 24,
		onRemove: (event) => removals.push(event),
		onEvict: (event) => evictions.push(event),
	});
	const first = audioBuffer(1, 1, 'first');
	const second = audioBuffer(2, 1, 'second');
	cache.set('first', first).set('second', second);

	assert.equal(cache.delete('missing'), false);
	assert.equal(cache.delete('first'), true);
	assert.equal(cache.byteLength, 8);
	cache.clear();
	assert.equal(cache.byteLength, 0);
	assert.equal(cache.size, 0);
	assert.deepEqual(removals, [
		{ key: 'first', value: first, bytes: 4, reason: 'delete' },
		{ key: 'second', value: second, bytes: 8, reason: 'clear' },
	]);
	assert.deepEqual(evictions, [], 'explicit removals are not capacity evictions');
});

test('strict oversize policy rejects atomically and setIfFits declines without throwing', () => {
	const cache = new SourceBufferCache({ maxBytes: 8 });
	const resident = audioBuffer(2, 1, 'resident');
	const oversized = audioBuffer(3, 1, 'oversized');
	cache.set('key', resident);

	assert.equal(cache.canFit(resident), true);
	assert.equal(cache.canFit(oversized), false);
	assert.equal(cache.setIfFits('key', oversized), false);
	assert.equal(cache.peek('key'), resident);
	assert.equal(cache.byteLength, 8);
	assert.throws(() => cache.set('key', oversized), /requires 12 bytes/);
	assert.equal(cache.peek('key'), resident);
	assert.equal(cache.byteLength, 8);
});

test('explicit allow policy retains only one oversized most-recent entry', () => {
	const evicted = [];
	const cache = new SourceBufferCache({
		maxBytes: 8,
		oversize: 'allow',
		onEvict: (event) => evicted.push(event.key),
	});
	const small = audioBuffer(1, 1, 'small');
	const oversized = audioBuffer(4, 1, 'oversized');
	cache.set('small', small);

	assert.equal(cache.canFit(oversized), true);
	assert.equal(cache.setIfFits('oversized', oversized), true);
	assert.equal(cache.byteLength, 16);
	assert.deepEqual([...cache.keys()], ['oversized']);
	assert.deepEqual(evicted, ['small']);

	cache.set('new-small', small);
	assert.equal(cache.byteLength, 4);
	assert.deepEqual([...cache.keys()], ['new-small']);
	assert.deepEqual(evicted, ['small', 'oversized']);
});

test('lowering maxBytes evicts least-recently-used entries immediately', () => {
	const evicted = [];
	const cache = new SourceBufferCache({
		maxBytes: 24,
		onEvict: (event) => evicted.push([event.key, event.reason]),
	});
	cache.set('first', audioBuffer(2, 1));
	cache.set('second', audioBuffer(2, 1));
	cache.set('third', audioBuffer(2, 1));
	cache.get('first');

	assert.equal(cache.setMaxBytes(16), cache);
	assert.equal(cache.maxBytes, 16);
	assert.deepEqual([...cache.keys()], ['third', 'first']);
	assert.deepEqual(evicted, [['second', 'resize']]);

	cache.maxBytes = 0;
	assert.equal(cache.byteLength, 0);
	assert.deepEqual([...cache.keys()], []);
	assert.deepEqual(evicted, [['second', 'resize'], ['third', 'resize'], ['first', 'resize']]);
});

test('custom byte estimators support non-AudioBuffer cache values', () => {
	const cache = new SourceBufferCache({
		maxBytes: 5,
		estimateBytes: (value) => value.bytes,
		entries: [['initial', { bytes: 2 }]],
	});
	cache.set('next', { bytes: 3 });

	assert.equal(cache.byteLength, 5);
	assert.deepEqual([...cache.keys()], ['initial', 'next']);
	cache.set('last', { bytes: 4 });
	assert.equal(cache.byteLength, 4);
	assert.deepEqual([...cache.keys()], ['last']);
});

test('invalid budgets and byte estimates fail before mutating the cache', () => {
	assert.throws(() => new SourceBufferCache({ maxBytes: -1 }), /maxBytes/);
	assert.throws(() => new SourceBufferCache({ maxBytes: 1.5 }), /maxBytes/);
	assert.throws(() => new SourceBufferCache({ estimateBytes: null }), /estimateBytes/);
	assert.throws(() => estimateAudioBufferBytes({ length: 1.5, numberOfChannels: 2 }), /length/);
	assert.throws(() => estimateAudioBufferBytes({ length: 1, numberOfChannels: -1 }), /numberOfChannels/);

	const cache = new SourceBufferCache({ maxBytes: 10, estimateBytes: (value) => value.bytes });
	cache.set('valid', { bytes: 4 });
	assert.throws(() => cache.set('invalid', { bytes: Number.NaN }), /estimateBytes result/);
	assert.deepEqual([...cache.keys()], ['valid']);
	assert.equal(cache.byteLength, 4);
});

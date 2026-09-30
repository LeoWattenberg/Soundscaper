/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertFramescaperDesktopPublicationBodyInventory,
	createFramescaperDesktopPublicationId,
	validateFramescaperDesktopPublicationAdmission,
} from '../src/framescaper/desktop-project-library-publication-admission.ts';
import {
	framescaperNativeImageSequenceActionBridgeAvailableNativeMedia as imageSequenceBridgeAvailable,
	framescaperNativeOpenFxActionBridgeAvailableNativeMedia as openFxBridgeAvailable,
} from '../src/framescaper/editor-native-action-bridge-availability.ts';
import {
	arrayValue,
	dataArray,
	dataRecord,
	exactRecordById,
	nonNegativeInteger,
	positiveInteger,
	safeAdd,
	stableId,
	throwIfAborted,
} from '../src/soundscaper/editor-audio-track-freeze-values.ts';

const PUBLICATION_ID = 'ab'.repeat(24);
const MAXIMUM_CHUNK_BYTES = 4 * 1024 * 1024;
const IMAGE_SEQUENCE_METHODS = Object.freeze([
	'capabilities', 'selectImageSequence', 'readImageSequenceFile', 'releaseImageSequence',
	'imageSequenceImport', 'writeImageSequenceImportChunk', 'readImageSequenceImportBody',
] as const);

function publicationAdmission(requiredBodyIndexes: unknown, bodyCount = 3): Record<string, unknown> {
	return {
		publicationId: PUBLICATION_ID,
		maximumChunkBytes: MAXIMUM_CHUNK_BYTES,
		bodyCount,
		requiredBodyIndexes,
	};
}

function imageSequenceBridge(): Record<string, unknown> {
	return Object.fromEntries(IMAGE_SEQUENCE_METHODS.map((method) => [method, () => undefined]));
}

function openFxBridge(): Record<string, unknown> {
	return { capabilities: () => undefined, listOpenFxPlugins: () => undefined };
}

test('freeze record lookup returns the one record with an own stable identity', () => {
	const target = Object.assign(Object.create(null) as Record<string, unknown>, {
		id: 'target', value: 7,
	});
	assert.equal(exactRecordById([{ id: 'other' }, target], 'target', 'freeze item'), target);
});

test('freeze record lookup rejects absent and duplicate identities', () => {
	assert.throws(
		() => exactRecordById([{ id: 'other' }], 'target', 'freeze item'),
		/freeze item target must exist exactly once/u,
	);
	assert.throws(
		() => exactRecordById([{ id: 'target' }, { id: 'target' }], 'target', 'freeze item'),
		/freeze item target must exist exactly once/u,
	);
});

test('freeze record lookup rejects inherited identities without reading them', () => {
	let reads = 0;
	const prototype = Object.create(null) as Record<string, unknown>;
	Object.defineProperty(prototype, 'id', {
		enumerable: true,
		get: () => {
			reads += 1;
			return 'target';
		},
	});
	const inherited = Object.create(prototype) as Record<string, unknown>;
	assert.throws(() => exactRecordById([inherited], 'target', 'freeze item'), /plain object/u);
	assert.equal(reads, 0);
});

test('freeze record lookup rejects an own identity accessor without invoking it', () => {
	let reads = 0;
	const candidate: Record<string, unknown> = {};
	Object.defineProperty(candidate, 'id', {
		enumerable: true,
		get: () => {
			reads += 1;
			return 'target';
		},
	});
	assert.throws(() => exactRecordById([candidate], 'target', 'freeze item'), /own data property/u);
	const hostile = new Proxy({ id: 'target' }, {
		getOwnPropertyDescriptor: () => {
			throw new Error('hostile descriptor');
		},
	});
	assert.throws(() => exactRecordById([hostile], 'target', 'freeze item'), /own data property/u);
	assert.equal(reads, 0);
});

test('freeze data arrays snapshot dense plain and null-prototype records', () => {
	const first = { id: 'first' };
	const second = Object.assign(Object.create(null) as Record<string, unknown>, { id: 'second' });
	const result = dataArray([first, second], 'freeze values');
	assert.deepEqual(result, [first, second]);
	assert.equal(Object.isFrozen(result), true);
});

test('freeze arrays reject holes and unrelated own properties', () => {
	assert.throws(() => dataArray(null, 'freeze values'), /must be an array/u);
	const sparse: unknown[] = [];
	sparse.length = 1;
	assert.throws(() => dataArray(sparse, 'freeze values'), /dense data-property array/u);
	const decorated: unknown[] = [{}];
	Object.defineProperty(decorated, 'metadata', { enumerable: false, value: true });
	assert.throws(() => arrayValue(decorated, 'freeze values'), /dense data-property array/u);
	const hostile = new Proxy<unknown[]>([], {
		ownKeys: () => {
			throw new Error('hostile keys');
		},
	});
	assert.throws(() => arrayValue(hostile, 'freeze values'), /dense data-property array/u);
});

test('freeze arrays reject indexed accessors without invoking them', () => {
	let reads = 0;
	const accessor: unknown[] = [];
	Object.defineProperty(accessor, '0', {
		enumerable: true,
		get: () => {
			reads += 1;
			return { id: 'target' };
		},
	});
	assert.throws(() => arrayValue(accessor, 'freeze values'), /own data property/u);
	assert.throws(() => dataArray(accessor, 'freeze values'), /own data property/u);
	const hostile = new Proxy<unknown[]>([{}], {
		getOwnPropertyDescriptor: (target, field) => {
			if (field === '0') throw new Error('hostile descriptor');
			return Reflect.getOwnPropertyDescriptor(target, field);
		},
	});
	assert.throws(() => arrayValue(hostile, 'freeze values'), /own data property/u);
	assert.equal(reads, 0);
});

test('freeze records accept only plain object authority', () => {
	const ordinary = {};
	const nullPrototype = Object.create(null) as Record<string, unknown>;
	assert.equal(dataRecord(ordinary, 'freeze record'), ordinary);
	assert.equal(dataRecord(nullPrototype, 'freeze record'), nullPrototype);
	assert.throws(() => dataRecord(null, 'freeze record'), /must be an object/u);
	assert.throws(() => dataRecord([], 'freeze record'), /must be an object/u);
	assert.throws(() => dataRecord(new Date(0), 'freeze record'), /plain object/u);
	assert.throws(() => dataRecord(new (class FreezeRecord {})(), 'freeze record'), /plain object/u);
	const hostile = new Proxy({}, {
		getPrototypeOf: () => {
			throw new Error('hostile prototype');
		},
	});
	assert.throws(() => dataRecord(hostile, 'freeze record'), /plain object/u);
});

test('freeze scalar validators enforce stable IDs and canonical safe integers', () => {
	assert.equal(stableId('track-a', 'track'), 'track-a');
	assert.throws(() => stableId('', 'track'), /nonempty/u);
	assert.equal(nonNegativeInteger(0, 'start'), 0);
	assert.throws(() => nonNegativeInteger(-0, 'start'), /nonnegative/u);
	assert.throws(() => nonNegativeInteger(0.5, 'start'), /nonnegative/u);
	assert.equal(positiveInteger(1, 'frames'), 1);
	assert.throws(() => positiveInteger(0, 'frames'), /positive/u);
});

test('freeze safe addition validates each operand before accepting its sum', () => {
	assert.equal(safeAdd(4, 5, 'range'), 9);
	assert.throws(() => safeAdd(0.5, 0.5, 'range'), /operands/u);
	assert.throws(() => safeAdd(-1, 2, 'range'), /operands/u);
	assert.throws(() => safeAdd(-0, 1, 'range'), /operands/u);
	assert.throws(() => safeAdd(Number.MAX_SAFE_INTEGER, 1, 'range'), /safe frame range/u);
});

test('freeze abort checks preserve the caller reason and provide a fallback', () => {
	assert.doesNotThrow(() => throwIfAborted());
	assert.doesNotThrow(() => throwIfAborted(new AbortController().signal));
	const reason = new Error('stop');
	assert.throws(() => throwIfAborted(AbortSignal.abort(reason)), (error) => error === reason);
	assert.throws(
		() => throwIfAborted({ aborted: true, reason: undefined } as AbortSignal),
		(error: unknown) => error instanceof DOMException && error.name === 'AbortError',
	);
});

test('OpenFX bridge availability rejects prototype-provided methods', () => {
	assert.equal(openFxBridgeAvailable(Object.create(openFxBridge())), false);
});

test('OpenFX bridge availability does not invoke own accessors', () => {
	let reads = 0;
	const bridge = openFxBridge();
	Object.defineProperty(bridge, 'capabilities', {
		enumerable: true,
		get: () => {
			reads += 1;
			return () => undefined;
		},
	});
	assert.equal(openFxBridgeAvailable(bridge), false);
	assert.equal(reads, 0);
});

test('image-sequence bridge availability rejects prototype-provided methods', () => {
	assert.equal(imageSequenceBridgeAvailable(Object.create(imageSequenceBridge())), false);
});

test('image-sequence bridge availability does not invoke own accessors', () => {
	let reads = 0;
	const bridge = imageSequenceBridge();
	Object.defineProperty(bridge, 'readImageSequenceFile', {
		enumerable: true,
		get: () => {
			reads += 1;
			return () => undefined;
		},
	});
	assert.equal(imageSequenceBridgeAvailable(bridge), false);
	assert.equal(reads, 0);
});

test('native bridge availability converts hostile reflection failures to false', () => {
	const hostile = new Proxy(openFxBridge(), {
		getOwnPropertyDescriptor: () => {
			throw new Error('hostile descriptor');
		},
	});
	assert.equal(openFxBridgeAvailable(hostile), false);
	const revoked = Proxy.revocable(openFxBridge(), {});
	revoked.revoke();
	assert.equal(openFxBridgeAvailable(revoked.proxy), false);
});

test('native bridge availability accepts null-prototype own function surfaces', () => {
	const openFx = Object.assign(Object.create(null) as Record<string, unknown>, openFxBridge());
	const imageSequence = Object.assign(
		Object.create(null) as Record<string, unknown>, imageSequenceBridge(),
	);
	assert.equal(openFxBridgeAvailable(openFx), true);
	assert.equal(imageSequenceBridgeAvailable(imageSequence), true);
});

test('desktop publication identities are fresh 192-bit lowercase hex values', () => {
	const first = createFramescaperDesktopPublicationId();
	const second = createFramescaperDesktopPublicationId();
	assert.match(first, /^[a-f0-9]{48}$/u);
	assert.match(second, /^[a-f0-9]{48}$/u);
	assert.notEqual(first, second);
});

test('desktop publication admission returns a detached frozen index snapshot', () => {
	const indexes = [0, 2];
	const result = validateFramescaperDesktopPublicationAdmission(
		publicationAdmission(indexes), PUBLICATION_ID, 3,
	);
	indexes[0] = 1;
	assert.deepEqual(result.requiredBodyIndexes, [0, 2]);
	assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.isFrozen(result.requiredBodyIndexes), true);
});

test('desktop publication admission rejects malformed expected identities', () => {
	assert.throws(
		() => validateFramescaperDesktopPublicationAdmission({}, '', 0),
		/publication identity is invalid/u,
	);
	assert.throws(
		() => validateFramescaperDesktopPublicationAdmission({}, 'AB'.repeat(24), 0),
		/publication identity is invalid/u,
	);
	assert.throws(
		() => validateFramescaperDesktopPublicationAdmission({}, 'a'.repeat(47), 0),
		/publication identity is invalid/u,
	);
});

test('desktop publication admission rejects noncanonical expected body counts', () => {
	for (const bodyCount of [-1, -0, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
		assert.throws(
			() => validateFramescaperDesktopPublicationAdmission({}, PUBLICATION_ID, bodyCount),
			/publication body count is invalid/u,
		);
	}
});

test('desktop publication admission requires dense own-data body indexes', () => {
	assert.throws(
		() => validateFramescaperDesktopPublicationAdmission(
			publicationAdmission([0, 1], 1), PUBLICATION_ID, 1,
		),
		/bounded dense array/u,
	);
	const sparse: unknown[] = [];
	sparse.length = 1;
	assert.throws(
		() => validateFramescaperDesktopPublicationAdmission(
			publicationAdmission(sparse, 1), PUBLICATION_ID, 1,
		),
		/bounded dense array/u,
	);
	let reads = 0;
	const accessor: unknown[] = [];
	Object.defineProperty(accessor, '0', {
		enumerable: true,
		get: () => {
			reads += 1;
			return 0;
		},
	});
	assert.throws(
		() => validateFramescaperDesktopPublicationAdmission(
			publicationAdmission(accessor, 1), PUBLICATION_ID, 1,
		),
		/own data property/u,
	);
	assert.equal(reads, 0);
});

test('desktop publication admission requires canonical increasing bounded indexes', () => {
	for (const indexes of [[0, 0], [1, 0], [2], [0.5], [-0]]) {
		assert.throws(
			() => validateFramescaperDesktopPublicationAdmission(
				publicationAdmission(indexes, 2), PUBLICATION_ID, 2,
			),
			/required publication body indexes changed/u,
		);
	}
});

test('desktop publication inventory comparison ignores plain-record insertion order', () => {
	const admitted = [{ descriptor: { kind: 'body', nested: { alpha: 1, beta: true }, byteLength: 4 } }];
	const prepared = [{ descriptor: { byteLength: 4, nested: { beta: true, alpha: 1 }, kind: 'body' } }];
	assert.doesNotThrow(() => assertFramescaperDesktopPublicationBodyInventory(admitted, prepared));
	const shared = { stable: true };
	const repeated = [{ descriptor: { first: shared, second: shared } }];
	assert.doesNotThrow(() => assertFramescaperDesktopPublicationBodyInventory(repeated, repeated));
});

test('desktop publication inventory rejects lossy or executable descriptor differences', () => {
	assert.throws(
		() => assertFramescaperDesktopPublicationBodyInventory(
			[{ descriptor: { omitted: undefined } }], [{ descriptor: {} }],
		),
		/inventory changed after admission/u,
	);
	assert.throws(
		() => assertFramescaperDesktopPublicationBodyInventory(
			[{ descriptor: { value: Number.NaN } }], [{ descriptor: { value: null } }],
		),
		/inventory changed after admission/u,
	);
	const cyclic: Record<string, unknown> = {};
	cyclic.self = cyclic;
	assert.throws(
		() => assertFramescaperDesktopPublicationBodyInventory(
			[{ descriptor: cyclic }], [{ descriptor: cyclic }],
		),
		/inventory changed after admission/u,
	);
	let reads = 0;
	const executable: Record<string, unknown> = {};
	Object.defineProperty(executable, 'descriptor', {
		enumerable: true,
		get: () => {
			reads += 1;
			return {};
		},
	});
	assert.throws(
		() => assertFramescaperDesktopPublicationBodyInventory(
			[executable as Readonly<{ descriptor: unknown }>], [{ descriptor: {} }],
		),
		/inventory changed after admission/u,
	);
	assert.equal(reads, 0);
});

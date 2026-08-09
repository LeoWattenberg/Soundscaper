/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';
import { preflightScapeProjectJsonStructure } from '../src/common/editor/scape-project-json-preflight.ts';

interface ScapeProjectBinaryLimits {
	readonly maximumPayloadCount: number;
	readonly maximumPayloadBytes: number;
	readonly maximumTotalPayloadBytes: number;
	readonly maximumTraversalNodes: number;
	readonly maximumTraversalDepth: number;
}

interface ScapeProjectDocumentOptions {
	readonly limits?: Partial<ScapeProjectBinaryLimits>;
}

type SerializeScapeProjectDocument = (
	value: unknown,
	options?: ScapeProjectDocumentOptions,
) => string;

type ParseScapeProjectDocument = (
	text: string,
	options?: ScapeProjectDocumentOptions,
) => unknown;

interface ScapeProjectDocumentModule {
	readonly SCAPE_PROJECT_BINARY_HARD_LIMITS?: Readonly<ScapeProjectBinaryLimits>;
	readonly SCAPE_PROJECT_JSON_STRUCTURE_HARD_LIMITS?: Readonly<{
		readonly maximumTraversalNodes: number;
		readonly maximumTraversalDepth: number;
	}>;
	readonly resolveScapeProjectBinaryLimits?: (
		overrides?: unknown,
	) => Readonly<ScapeProjectBinaryLimits>;
	readonly serializeScapeProjectDocument?: SerializeScapeProjectDocument;
	readonly parseScapeProjectDocument?: ParseScapeProjectDocument;
}

interface BinaryDescriptor extends Record<string, unknown> {
	schemaVersion: number;
	id: number;
	type: string;
	byteLength: number;
	base64: string;
}

const CODEC_MODULE_PATH = '../src/common/editor/scape-project-document.ts';
const BINARY_TAG = '$soundscaperOpaqueBinary';
const MIB = 1024 * 1024;
const EXPECTED_HARD_LIMITS = Object.freeze({
	maximumPayloadCount: 256,
	maximumPayloadBytes: 4 * MIB,
	maximumTotalPayloadBytes: 8 * MIB,
	maximumTraversalNodes: 100_000,
	maximumTraversalDepth: 128,
});

const codecModule = await loadCodecModule();

test('the Scape project binary codec exposes frozen lower-only production limits', () => {
	assert.deepEqual(codecModule.SCAPE_PROJECT_BINARY_HARD_LIMITS, EXPECTED_HARD_LIMITS);
	assert.equal(Object.isFrozen(codecModule.SCAPE_PROJECT_BINARY_HARD_LIMITS), true);
	assert.deepEqual(codecModule.SCAPE_PROJECT_JSON_STRUCTURE_HARD_LIMITS, {
		maximumTraversalNodes: 101_536,
		maximumTraversalDepth: 130,
	});
	assert.equal(Object.isFrozen(codecModule.SCAPE_PROJECT_JSON_STRUCTURE_HARD_LIMITS), true);
	assert.equal(typeof codecModule.serializeScapeProjectDocument, 'function');
	assert.equal(typeof codecModule.parseScapeProjectDocument, 'function');

	const resolveLimits = codecModule.resolveScapeProjectBinaryLimits;
	assert.equal(typeof resolveLimits, 'function');
	if (!resolveLimits) return;
	const defaults = resolveLimits();
	assert.deepEqual(defaults, EXPECTED_HARD_LIMITS);
	assert.equal(Object.isFrozen(defaults), true);
	const lowered = resolveLimits({
		maximumPayloadCount: 2,
		maximumPayloadBytes: 3,
		maximumTotalPayloadBytes: 4,
		maximumTraversalNodes: 5,
		maximumTraversalDepth: 6,
	});
	assert.deepEqual(lowered, {
		maximumPayloadCount: 2,
		maximumPayloadBytes: 3,
		maximumTotalPayloadBytes: 4,
		maximumTraversalNodes: 5,
		maximumTraversalDepth: 6,
	});
	assert.equal(Object.isFrozen(lowered), true);

	for (const limits of [
		null,
		[],
		'maximumPayloadCount',
		{ maximumPayloadCount: 0 },
		{ maximumPayloadBytes: -1 },
		{ maximumTotalPayloadBytes: 1.5 },
		{ maximumTraversalNodes: Number.NaN },
		{ maximumTraversalDepth: Number.POSITIVE_INFINITY },
		{ maximumPayloadCount: EXPECTED_HARD_LIMITS.maximumPayloadCount + 1 },
		{ maximumPayloadBytes: EXPECTED_HARD_LIMITS.maximumPayloadBytes + 1 },
		{ maximumTotalPayloadBytes: EXPECTED_HARD_LIMITS.maximumTotalPayloadBytes + 1 },
		{ maximumTraversalNodes: EXPECTED_HARD_LIMITS.maximumTraversalNodes + 1 },
		{ maximumTraversalDepth: EXPECTED_HARD_LIMITS.maximumTraversalDepth + 1 },
		{ unsupportedLimit: 1 },
	]) {
		assert.throws(
			() => resolveLimits(limits),
			(error: unknown) => error instanceof TypeError || error instanceof RangeError,
		);
	}
});

test('the exact current schema serializes canonical tags and restores explicit binary types byte-exactly', () => {
	const { parse, serialize } = codecFunctions();
	if (!parse || !serialize) return;
	const storage = Uint8Array.from([99, 0, 1, 2, 253, 254, 255, 88]);
	const view = storage.subarray(1, 7);
	const buffer = new ArrayBuffer(2);
	new Uint8Array(buffer).set([3, 4]);
	const input = currentProject({
		view,
		buffer,
		empty: new Uint8Array(0),
	});

	const text = serialize(input);
	assert.equal(serialize(input), text, 'canonical serialization is deterministic');
	const encoded = JSON.parse(text) as {
		opaqueExtensions: Record<string, Record<string, BinaryDescriptor>>;
	};
	assert.deepEqual(encoded.opaqueExtensions, {
		view: binaryTag({ id: 1, type: 'Uint8Array', byteLength: 6, base64: 'AAEC/f7/' }),
		buffer: binaryTag({ id: 2, type: 'ArrayBuffer', byteLength: 2, base64: 'AwQ=' }),
		empty: binaryTag({ id: 3, type: 'Uint8Array', byteLength: 0, base64: '' }),
	});
	for (const value of Object.values(encoded.opaqueExtensions)) {
		assert.deepEqual(Object.keys(value), [BINARY_TAG]);
		assert.deepEqual(Object.keys(value[BINARY_TAG] ?? {}), [
			'schemaVersion',
			'id',
			'type',
			'byteLength',
			'base64',
		]);
	}

	storage.fill(9);
	new Uint8Array(buffer).fill(8);
	const decoded = parse(text) as {
		opaqueExtensions: { view: unknown; buffer: unknown; empty: unknown };
	};
	assert.ok(decoded.opaqueExtensions.view instanceof Uint8Array);
	assert.deepEqual([...decoded.opaqueExtensions.view], [0, 1, 2, 253, 254, 255]);
	assert.equal(decoded.opaqueExtensions.view.byteOffset, 0);
	assert.equal(decoded.opaqueExtensions.view.buffer.byteLength, 6);
	assert.ok(decoded.opaqueExtensions.buffer instanceof ArrayBuffer);
	assert.deepEqual([...new Uint8Array(decoded.opaqueExtensions.buffer)], [3, 4]);
	assert.ok(decoded.opaqueExtensions.empty instanceof Uint8Array);
	assert.equal(decoded.opaqueExtensions.empty.byteLength, 0);
});

test('only the exact current schema receives binary tag traversal', () => {
	const { parse, serialize } = codecFunctions();
	if (!parse || !serialize) return;
	for (const schemaVersion of [8, 10, 12, '11']) {
		const value = {
			schemaVersion,
			opaqueExtensions: {
				bytes: new Uint8Array([7, 8]),
				first: binaryTag({ id: 7, base64: 'AQ==', byteLength: 1 }),
				duplicate: binaryTag({ id: 7, base64: 'Ag==', byteLength: 1 }),
			},
		};
		const ordinaryText = JSON.stringify(value);
		assert.equal(serialize(value), ordinaryText);
		assert.deepEqual(parse(ordinaryText), JSON.parse(ordinaryText));
	}
});

test('non-current schemas retain ordinary values but receive structural JSON admission', () => {
	const { parse } = codecFunctions();
	if (!parse) return;
	const future = {
		schemaVersion: 12,
		opaqueExtensions: { candidate: binaryTag() },
	};
	assert.deepEqual(parse(JSON.stringify(future)), future);
	const overBudget = JSON.stringify({
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		items: Array.from({ length: 12 }, (_, index) => index),
	});
	assert.throws(() => parse(overBudget, { limits: {
		maximumPayloadCount: 1,
		maximumTraversalNodes: 4,
	} }), /JSON.*structural traversal node limit/iu);
});

test('serialization enforces payload count, per-payload, and aggregate byte limits', () => {
	const { serialize } = codecFunctions();
	if (!serialize) return;
	const limits = {
		maximumPayloadCount: 2,
		maximumPayloadBytes: 3,
		maximumTotalPayloadBytes: 4,
	};
	assert.doesNotThrow(() => serialize(currentProject({
		first: new Uint8Array([1, 2, 3]),
		second: new Uint8Array([4]).buffer,
	}), { limits }));
	assert.throws(() => serialize(currentProject({
		first: new Uint8Array(0),
		second: new Uint8Array(0),
		third: new Uint8Array(0),
	}), { limits }), RangeError);
	assert.throws(() => serialize(currentProject({
		oversized: new Uint8Array([1, 2, 3, 4]),
	}), { limits }), RangeError);
	assert.throws(() => serialize(currentProject({
		first: new Uint8Array([1, 2, 3]),
		second: new Uint8Array([4, 5]),
	}), { limits }), RangeError);
});

test('parsing independently enforces payload limits and rejects duplicate IDs', () => {
	const { parse, serialize } = codecFunctions();
	if (!parse || !serialize) return;
	const countText = serialize(currentProject({
		first: new Uint8Array(0),
		second: new Uint8Array(0),
		third: new Uint8Array(0),
	}));
	assert.throws(() => parse(countText, {
		limits: { maximumPayloadCount: 2 },
	}), RangeError);
	const perPayloadText = serialize(currentProject({ bytes: new Uint8Array([1, 2, 3]) }));
	assert.throws(() => parse(perPayloadText, {
		limits: { maximumPayloadBytes: 2 },
	}), RangeError);
	const aggregateText = serialize(currentProject({
		first: new Uint8Array([1, 2]),
		second: new Uint8Array([3, 4]),
	}));
	assert.throws(() => parse(aggregateText, {
		limits: { maximumTotalPayloadBytes: 3 },
	}), RangeError);

	const duplicateText = JSON.stringify(currentProject({
		first: binaryTag({ id: 1, byteLength: 1, base64: 'AQ==' }),
		second: binaryTag({ id: 1, byteLength: 1, base64: 'Ag==' }),
	}));
	assert.throws(() => parse(duplicateText), /duplicate|binary|payload|tag/iu);
});

test('parsing rejects malformed, noncanonical, truncated, unknown, and ambiguous tags', () => {
	const { parse } = codecFunctions();
	if (!parse) return;
	const malformedTags: unknown[] = [
		{ [BINARY_TAG]: null },
		{ [BINARY_TAG]: {} },
		binaryTag({ schemaVersion: 2 }),
		binaryTag({ id: 0 }),
		binaryTag({ id: 1.5 }),
		binaryTag({ id: Number.MAX_SAFE_INTEGER + 1 }),
		binaryTag({ type: 'Uint16Array' }),
		binaryTag({ byteLength: -1 }),
		binaryTag({ byteLength: 1.5 }),
		binaryTag({ base64: 12 as unknown as string }),
		binaryTag({ byteLength: 1, base64: 'AQ' }),
		binaryTag({ byteLength: 1, base64: 'AQ==\n' }),
		binaryTag({ byteLength: 1, base64: '_w==' }),
		binaryTag({ byteLength: 1, base64: 'AR==' }),
		binaryTag({ byteLength: 2, base64: 'AQ==' }),
		binaryTag({ extra: true }),
		{ ...binaryTag(), ordinarySibling: true },
	];
	for (const candidate of malformedTags) {
		const text = JSON.stringify(currentProject({ candidate }));
		assert.throws(
			() => parse(text),
			(error: unknown) => error instanceof Error,
			`accepted malformed tag ${text}`,
		);
	}
	assert.throws(() => parse('{"schemaVersion":9'), SyntaxError);
	assert.throws(() => parse(JSON.stringify(currentProject({
		candidate: binaryTag({ byteLength: 2, base64: 'AQI=' }),
	})), { limits: { maximumPayloadBytes: 1 } }), RangeError);
});

test('current-schema serialization rejects reserved collisions without activating project code', () => {
	const { parse, serialize } = codecFunctions();
	if (!parse || !serialize) return;
	assert.throws(() => serialize(currentProject({
		collision: { [BINARY_TAG]: 'ordinary project data' },
	})), /reserved|collision|binary|tag/iu);
	assert.throws(() => serialize(currentProject({
		collision: binaryTag(),
	})), /reserved|collision|binary|tag/iu);

	let activations = 0;
	const accessorState: Record<string, unknown> = {};
	Object.defineProperty(accessorState, 'bytes', {
		enumerable: true,
		get() {
			activations += 1;
			return new Uint8Array([1]);
		},
	});
	assert.throws(() => serialize(currentProject(accessorState)));
	assert.equal(activations, 0, 'binary traversal must inspect descriptors without invoking getters');

	const hookState = {
		toJSON() {
			activations += 1;
			return { activated: true };
		},
	};
	assert.throws(() => serialize(currentProject(hookState)));
	assert.equal(activations, 0, 'binary traversal must not invoke toJSON hooks');

	class SpeciesBytes extends Uint8Array {
		static get [Symbol.species](): Uint8ArrayConstructor {
			activations += 1;
			return Uint8Array;
		}
	}
	class SpeciesBuffer extends ArrayBuffer {
		static get [Symbol.species](): ArrayBufferConstructor {
			activations += 1;
			return ArrayBuffer;
		}
	}
	const speciesText = serialize(currentProject({
		bytes: new SpeciesBytes([1, 2]),
		buffer: new SpeciesBuffer(2),
	}));
	assert.equal(activations, 0, 'binary copying must not consult project-supplied species');
	const speciesDecoded = parse(speciesText) as {
		opaqueExtensions: { bytes: Uint8Array; buffer: ArrayBuffer };
	};
	assert.deepEqual([...speciesDecoded.opaqueExtensions.bytes], [1, 2]);
	assert.deepEqual([...new Uint8Array(speciesDecoded.opaqueExtensions.buffer)], [0, 0]);
	assert.throws(
		() => serialize(currentProject({ bytes: new SpeciesBytes([1, 2]) }), {
			limits: { maximumPayloadBytes: 1 },
		}),
		RangeError,
	);
	assert.equal(activations, 0, 'oversized binary must reject before any species-based copy');
	assert.throws(() => serialize(currentProject({ unsupported: new Uint16Array([1]) })), /only Uint8Array/iu);
	assert.throws(() => serialize(currentProject({ unsupported: new DataView(new ArrayBuffer(1)) })), /only Uint8Array/iu);
});

test('the exact current schema preserves non-callable toJSON data while rejecting hooks and accessors', () => {
	const { parse, serialize } = codecFunctions();
	if (!parse || !serialize) return;
	const text = serialize(currentProject({ toJSON: 'ordinary opaque data' }));
	assert.deepEqual(parse(text), currentProject({ toJSON: 'ordinary opaque data' }));
	let activations = 0;
	const root: Record<string, unknown> = { opaqueExtensions: {} };
	Object.defineProperty(root, 'schemaVersion', {
		enumerable: true,
		get() {
			activations += 1;
			return AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION;
		},
	});
	assert.throws(() => serialize(root), /schemaVersion.*accessor/iu);
	assert.equal(activations, 0);
	const hookedArray = [1, 2] as unknown[] & { toJSON?: () => unknown };
	hookedArray.toJSON = () => {
		activations += 1;
		return [];
	};
	assert.throws(() => serialize(currentProject(hookedArray)), /toJSON hooks/iu);
	assert.equal(activations, 0);
	class ProjectRoot {
		readonly schemaVersion = AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION;
		readonly opaqueExtensions = {};
	}
	assert.throws(() => serialize(new ProjectRoot()), /plain object/iu);
});

test('both codec directions enforce traversal node and depth limits', () => {
	const { parse, serialize } = codecFunctions();
	if (!parse || !serialize) return;
	const wideProject = currentProject(Array.from({ length: 12 }, (_, index) => ({ index })));
	assert.throws(() => serialize(wideProject, {
		limits: { maximumTraversalNodes: 4 },
	}), RangeError);
	const wideText = serialize(wideProject);
	assert.throws(() => parse(wideText, {
		limits: { maximumTraversalNodes: 4 },
	}), RangeError);

	let nested: Record<string, unknown> = {};
	for (let depth = 0; depth < 12; depth += 1) nested = { nested };
	const deepProject = currentProject(nested);
	assert.throws(() => serialize(deepProject, {
		limits: { maximumTraversalDepth: 4 },
	}), RangeError);
	const deepText = serialize(deepProject);
	assert.throws(() => parse(deepText, {
		limits: { maximumTraversalDepth: 4 },
	}), RangeError);
});

test('lowered traversal limits remain round-trip closed for encoded binary descriptors', () => {
	const { parse, serialize } = codecFunctions();
	if (!parse || !serialize) return;
	const limits = {
		maximumPayloadCount: 1,
		maximumTraversalNodes: 3,
		maximumTraversalDepth: 1,
	};
	const document = serialize({
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		bytes: new Uint8Array([1]),
	}, { limits });
	assert.deepEqual(parse(document, { limits }), {
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		bytes: new Uint8Array([1]),
	});
});

test('parsing rejects over-budget JSON structure before incomplete input reaches JSON.parse', () => {
	const { parse } = codecFunctions();
	if (!parse) return;
	const overNodeLimit = `{"schemaVersion":9,"items":[${'0,'.repeat(12)}`;
	assert.throws(
		() => parse(overNodeLimit, { limits: {
			maximumPayloadCount: 1,
			maximumTraversalNodes: 4,
		} }),
		/JSON.*structural traversal node limit/iu,
	);
	const overDepthLimit = `{"schemaVersion":9,"nested":${'['.repeat(8)}`;
	assert.throws(
		() => parse(overDepthLimit, { limits: { maximumTraversalDepth: 4 } }),
		/JSON.*structural traversal depth limit/iu,
	);
	assert.throws(() => parse('{"schemaVersion":9'), SyntaxError);
});

test('production JSON admission rejects beyond the binary-expanded node and depth ceilings', () => {
	const { parse } = codecFunctions();
	if (!parse) return;
	const overNodeLimit = `{"schemaVersion":9,"items":[${'0,'.repeat(101_534)}`;
	assert.throws(() => parse(overNodeLimit), /JSON.*structural traversal node limit/iu);
	const overDepthLimit = `{"schemaVersion":9,"nested":${'['.repeat(132)}`;
	assert.throws(() => parse(overDepthLimit), /JSON.*structural traversal depth limit/iu);
});

test('JSON structural preflight counts valid lexical forms and duplicate members conservatively', () => {
	const text = JSON.stringify({
		schemaVersion: 8,
		escaped: 'brackets [,] braces {} quote " slash \\',
		number: -1_250,
		items: [true, false, null],
	}).replace('-1250', '-1.25e+3');
	assert.doesNotThrow(() => preflightScapeProjectJsonStructure(text, {
		maximumTraversalNodes: 8,
		maximumTraversalDepth: 2,
	}));
	assert.throws(() => preflightScapeProjectJsonStructure(text, {
		maximumTraversalNodes: 7,
		maximumTraversalDepth: 2,
	}), /node limit/iu);
	const duplicateMembers = '{"schemaVersion":8,"value":0,"value":1}';
	assert.throws(() => preflightScapeProjectJsonStructure(duplicateMembers, {
		maximumTraversalNodes: 3,
		maximumTraversalDepth: 1,
	}), /node limit/iu);
});

test('exact-current serialization rejects cycles before JSON serialization', () => {
	const { serialize } = codecFunctions();
	if (!serialize) return;
	const opaqueExtensions: Record<string, unknown> = {};
	opaqueExtensions.self = opaqueExtensions;
	assert.throws(() => serialize(currentProject(opaqueExtensions)), /cyclic/iu);
});

test('sparse array holes consume traversal nodes before output allocation', () => {
	const { serialize } = codecFunctions();
	if (!serialize) return;
	assert.throws(
		() => serialize(currentProject(new Array(1_000)), {
			limits: { maximumTraversalNodes: 4 },
		}),
		/traversal node limit/iu,
	);
});

async function loadCodecModule(): Promise<ScapeProjectDocumentModule> {
	try {
		return await import(CODEC_MODULE_PATH) as unknown as ScapeProjectDocumentModule;
	} catch (error) {
		const candidate = error as { code?: unknown; message?: unknown };
		if (candidate.code === 'ERR_MODULE_NOT_FOUND'
			&& typeof candidate.message === 'string'
			&& candidate.message.includes('scape-project-document')) {
			return {};
		}
		throw error;
	}
}

function codecFunctions(): Readonly<{
	parse?: ParseScapeProjectDocument;
	serialize?: SerializeScapeProjectDocument;
}> {
	return {
		parse: codecModule.parseScapeProjectDocument,
		serialize: codecModule.serializeScapeProjectDocument,
	};
}

function currentProject(opaqueExtensions: unknown): Record<string, unknown> {
	return { schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION, opaqueExtensions };
}

function binaryTag(overrides: Partial<BinaryDescriptor> = {}): Record<string, BinaryDescriptor> {
	return {
		[BINARY_TAG]: {
			schemaVersion: 1,
			id: 1,
			type: 'Uint8Array',
			byteLength: 2,
			base64: 'AQI=',
			...overrides,
		},
	};
}

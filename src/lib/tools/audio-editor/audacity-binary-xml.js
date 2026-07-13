const FIELD = Object.freeze({
	CHAR_SIZE: 0,
	START_TAG: 1,
	END_TAG: 2,
	STRING: 3,
	INT: 4,
	BOOL: 5,
	LONG: 6,
	LONG_LONG: 7,
	SIZE_T: 8,
	FLOAT: 9,
	DOUBLE: 10,
	DATA: 11,
	RAW: 12,
	PUSH: 13,
	POP: 14,
	NAME: 15,
	BLOB: 16,
});

const FIELD_NAME = Object.freeze(Object.fromEntries(
	Object.entries(FIELD).map(([name, value]) => [value, name.toLowerCase().replaceAll('_', '-')]),
));
const MAX_BINARY_XML_BYTES = 256 * 1024 * 1024;
const MAX_BINARY_XML_FIELDS = 5_000_000;
const MAX_BINARY_XML_DEPTH = 512;
const MAX_BINARY_XML_NAME_BYTES = 0x7fff;

export class AudacityBinaryXmlError extends Error {
	constructor(message, code = 'INVALID_BINARY_XML', options) {
		super(message, options);
		this.name = 'AudacityBinaryXmlError';
		this.code = code;
	}
}

/**
 * Decode Audacity's typed binary XML without collapsing attribute types,
 * duplicate attributes, blobs, raw records, or name scopes.
 */
export function decodeAudacityBinaryXml(dictionary, document, options = {}) {
	const dictionaryBytes = toBytes(dictionary, 'dictionary');
	const documentBytes = toBytes(document, 'document');
	const maxBytes = positiveLimit(options.maxBytes, MAX_BINARY_XML_BYTES);
	if (dictionaryBytes.byteLength + documentBytes.byteLength > maxBytes) {
		throw new AudacityBinaryXmlError('The Audacity project description is too large.', 'BINARY_XML_TOO_LARGE');
	}

	const state = {
		charSize: 0,
		charSizeSeen: false,
		names: new Map(),
		nameStack: [],
		fieldCount: 0,
		maxFields: positiveLimit(options.maxFields, MAX_BINARY_XML_FIELDS),
	};
	const dictionaryTokens = decodeTokens(dictionaryBytes, state, { dictionary: true });
	if (![1, 2, 4].includes(state.charSize)) {
		throw new AudacityBinaryXmlError('The Audacity dictionary has no supported character encoding.', 'INVALID_DICTIONARY');
	}
	if (state.nameStack.length) {
		throw new AudacityBinaryXmlError('The Audacity dictionary has unbalanced name scopes.', 'INVALID_DICTIONARY');
	}
	const documentTokens = decodeTokens(documentBytes, state, { dictionary: false });
	if (state.nameStack.length) {
		throw new AudacityBinaryXmlError('The Audacity document has unbalanced name scopes.', 'INVALID_DOCUMENT');
	}
	const roots = buildTree(documentTokens, options);
	return {
		charSize: state.charSize,
		dictionaryTokens,
		documentTokens,
		roots,
		root: roots.find((entry) => entry.kind === 'node')?.node || null,
		original: {
			dictionary: dictionaryBytes.slice(),
			document: documentBytes.slice(),
		},
	};
}

/**
 * Encode a typed tree using a deterministic UTF-8 dictionary. Attribute and
 * content order is taken directly from each node's `content` array.
 */
export function encodeAudacityBinaryXml(value, options = {}) {
	if (options.reuseOriginal && value?.original?.dictionary && value?.original?.document) {
		const dictionary = toBytes(value.original.dictionary, 'original dictionary');
		const document = toBytes(value.original.document, 'original document');
		if (dictionary.byteLength + document.byteLength > positiveLimit(options.maxBytes, MAX_BINARY_XML_BYTES)) {
			throw new AudacityBinaryXmlError('The Audacity project description is too large.', 'BINARY_XML_TOO_LARGE');
		}
		return {
			dictionary: dictionary.slice(),
			document: document.slice(),
		};
	}
	const roots = Array.isArray(value?.roots)
		? value.roots
		: value?.kind === 'node'
			? [value]
			: value?.root
				? [{ kind: 'node', node: value.root }]
				: value?.name
					? [{ kind: 'node', node: value }]
					: [];
	if (!roots.some((entry) => entry?.kind === 'node')) {
		throw new AudacityBinaryXmlError('A binary XML root node is required.', 'MISSING_ROOT');
	}

	const names = collectNames(roots);
	if (names.length > 0xffff) throw new AudacityBinaryXmlError('The Audacity name dictionary is too large.', 'DICTIONARY_TOO_LARGE');
	const nameIds = new Map(names.map((name, index) => [name, index]));
	const budget = { used: 0, limit: positiveLimit(options.maxBytes, MAX_BINARY_XML_BYTES) };
	const dictionaryWriter = new ByteWriter(budget);
	dictionaryWriter.u8(FIELD.CHAR_SIZE);
	dictionaryWriter.u8(1);
	for (let id = 0; id < names.length; id += 1) {
		const bytes = encodeString(names[id], 1);
		if (bytes.byteLength > MAX_BINARY_XML_NAME_BYTES) {
			throw new AudacityBinaryXmlError(`Audacity XML name is too long: ${names[id]}.`, 'NAME_TOO_LONG');
		}
		dictionaryWriter.u8(FIELD.NAME);
		dictionaryWriter.u16(id);
		dictionaryWriter.u16(bytes.byteLength);
		dictionaryWriter.bytes(bytes);
	}

	const documentWriter = new ByteWriter(budget);
	for (const entry of roots) writeTreeEntry(documentWriter, entry, nameIds);
	return { dictionary: dictionaryWriter.finish(), document: documentWriter.finish() };
}

export function createAudacityXmlNode(name, attributes = [], content = []) {
	const node = {
		name: requireName(name),
		content: [],
	};
	for (const attribute of attributes) node.content.push(normalizeAttribute(attribute));
	for (const entry of content) node.content.push(normalizeContent(entry));
	return node;
}

export function audacityXmlAttributes(node, name = null) {
	if (!node || !Array.isArray(node.content)) return [];
	return node.content.filter((entry) => entry.kind === 'attribute' && (name == null || entry.name === name));
}

export function audacityXmlAttribute(node, name, fallback = undefined) {
	const entry = audacityXmlAttributes(node, name).at(-1);
	return entry ? entry.value : fallback;
}

export function audacityXmlChildren(node, name = null) {
	if (!node || !Array.isArray(node.content)) return [];
	return node.content
		.filter((entry) => entry.kind === 'node' && (name == null || entry.node.name === name))
		.map((entry) => entry.node);
}

function decodeTokens(bytes, state, { dictionary }) {
	const cursor = new ByteCursor(bytes, dictionary ? 'dictionary' : 'document');
	const tokens = [];
	while (!cursor.done) {
		state.fieldCount += 1;
		if (state.fieldCount > state.maxFields) {
			throw new AudacityBinaryXmlError('The Audacity project contains too many XML fields.', 'FIELD_LIMIT');
		}
		const field = cursor.u8();
		if (!Object.hasOwn(FIELD_NAME, field)) {
			throw new AudacityBinaryXmlError(`Unknown Audacity binary XML field type: ${field}.`, 'UNKNOWN_FIELD');
		}
		if (field === FIELD.CHAR_SIZE) {
			const charSize = cursor.u8();
			if (![1, 2, 4].includes(charSize)) throw new AudacityBinaryXmlError(`Unsupported Audacity character width: ${charSize}.`, 'INVALID_CHAR_SIZE');
			if (state.charSizeSeen && state.charSize !== charSize) {
				throw new AudacityBinaryXmlError('The Audacity binary XML changes character width mid-stream.', dictionary ? 'INVALID_DICTIONARY' : 'INVALID_DOCUMENT');
			}
			state.charSize = charSize;
			state.charSizeSeen = true;
			tokens.push({ kind: 'char-size', field, value: charSize });
			continue;
		}
		if (field === FIELD.PUSH) {
			state.nameStack.push(new Map(state.names));
			state.names.clear();
			tokens.push({ kind: 'push', field });
			continue;
		}
		if (field === FIELD.POP) {
			const names = state.nameStack.pop();
			if (!names) throw new AudacityBinaryXmlError('Audacity XML name scope underflow.', dictionary ? 'INVALID_DICTIONARY' : 'INVALID_DOCUMENT');
			state.names = names;
			tokens.push({ kind: 'pop', field });
			continue;
		}
		if (field === FIELD.NAME) {
			if (!state.charSize) throw new AudacityBinaryXmlError('An Audacity name appears before the character-width field.', dictionary ? 'INVALID_DICTIONARY' : 'INVALID_DOCUMENT');
			const id = cursor.u16();
			const length = cursor.u16();
			if (length > MAX_BINARY_XML_NAME_BYTES) throw new AudacityBinaryXmlError('An Audacity XML name is too long.', dictionary ? 'INVALID_DICTIONARY' : 'INVALID_DOCUMENT');
			const value = decodeString(cursor.bytes(length), state.charSize);
			if (!value) throw new AudacityBinaryXmlError('Audacity XML names cannot be empty.', dictionary ? 'INVALID_DICTIONARY' : 'INVALID_DOCUMENT');
			if (state.names.has(id)) throw new AudacityBinaryXmlError(`Duplicate Audacity XML name id: ${id}.`, dictionary ? 'INVALID_DICTIONARY' : 'INVALID_DOCUMENT');
			state.names.set(id, value);
			tokens.push({ kind: 'name', field, id, value });
			continue;
		}
		if (dictionary) {
			throw new AudacityBinaryXmlError(`Unexpected ${FIELD_NAME[field]} field in the Audacity dictionary.`, 'INVALID_DICTIONARY');
		}
		if (field === FIELD.DATA || field === FIELD.RAW) {
			if (!state.charSize) throw new AudacityBinaryXmlError('Audacity text appears before the character-width field.', 'INVALID_DOCUMENT');
			const length = cursor.i32Length();
			tokens.push({
				kind: field === FIELD.DATA ? 'data' : 'raw',
				field,
				value: decodeString(cursor.bytes(length), state.charSize),
			});
			continue;
		}

		const id = cursor.u16();
		const name = resolveName(state, id);
		if (field === FIELD.START_TAG || field === FIELD.END_TAG) {
			tokens.push({ kind: field === FIELD.START_TAG ? 'start-tag' : 'end-tag', field, id, name });
			continue;
		}
		if (field === FIELD.BLOB) {
			const length = cursor.i32Length();
			tokens.push({ kind: 'blob', field, id, name, value: cursor.bytes(length).slice() });
			continue;
		}
		const token = { kind: 'attribute', field, type: FIELD_NAME[field], id, name };
		if (field === FIELD.STRING) {
			if (!state.charSize) throw new AudacityBinaryXmlError('An Audacity string appears before the character-width field.', 'INVALID_DOCUMENT');
			token.value = decodeString(cursor.bytes(cursor.i32Length()), state.charSize);
		}
		else if (field === FIELD.INT || field === FIELD.LONG) token.value = cursor.i32();
		else if (field === FIELD.BOOL) token.value = cursor.u8() !== 0;
		else if (field === FIELD.LONG_LONG) token.value = cursor.i64();
		else if (field === FIELD.SIZE_T) token.value = cursor.u32();
		else if (field === FIELD.FLOAT) {
			token.value = cursor.f32();
			token.digits = cursor.i32();
		} else if (field === FIELD.DOUBLE) {
			token.value = cursor.f64();
			token.digits = cursor.i32();
		} else throw new AudacityBinaryXmlError(`Invalid attribute field: ${field}.`, 'INVALID_DOCUMENT');
		tokens.push(token);
	}
	return tokens;
}

function buildTree(tokens, options) {
	const roots = [];
	const nodes = [];
	const maxDepth = positiveLimit(options.maxDepth, MAX_BINARY_XML_DEPTH);
	for (const token of tokens) {
		if (token.kind === 'start-tag') {
			if (nodes.length >= maxDepth) throw new AudacityBinaryXmlError('The Audacity document is nested too deeply.', 'DEPTH_LIMIT');
			const node = { name: token.name, content: [] };
			const entry = { kind: 'node', node };
			if (nodes.length) nodes.at(-1).content.push(entry);
			else roots.push(entry);
			nodes.push(node);
			continue;
		}
		if (token.kind === 'end-tag') {
			const node = nodes.pop();
			if (!node || node.name !== token.name) throw new AudacityBinaryXmlError(`Mismatched Audacity end tag: ${token.name}.`, 'MISMATCHED_TAG');
			continue;
		}
		if (token.kind === 'raw') {
			const entry = { kind: 'raw', value: token.value };
			if (nodes.length) nodes.at(-1).content.push(entry);
			else roots.push(entry);
			continue;
		}
		if (['attribute', 'data', 'blob'].includes(token.kind)) {
			if (!nodes.length) throw new AudacityBinaryXmlError(`${token.kind} appears outside the root element.`, 'INVALID_DOCUMENT');
			if (token.kind === 'attribute') nodes.at(-1).content.push({
				kind: 'attribute', name: token.name, type: token.type, value: token.value, ...(token.digits == null ? {} : { digits: token.digits }),
			});
			else nodes.at(-1).content.push({ kind: token.kind, ...(token.name ? { name: token.name } : {}), value: cloneValue(token.value) });
		}
	}
	if (nodes.length) throw new AudacityBinaryXmlError('The Audacity document has unclosed elements.', 'UNCLOSED_TAG');
	if (roots.filter((entry) => entry.kind === 'node').length !== 1) {
		throw new AudacityBinaryXmlError('The Audacity document must contain exactly one root element.', 'INVALID_ROOT_COUNT');
	}
	return roots;
}

function collectNames(roots) {
	const names = [];
	const known = new Set();
	const add = (name) => {
		const normalized = requireName(name);
		if (!known.has(normalized)) {
			known.add(normalized);
			names.push(normalized);
		}
	};
	const visit = (entry, depth = 0) => {
		if (depth > MAX_BINARY_XML_DEPTH) throw new AudacityBinaryXmlError('The Audacity document is nested too deeply.', 'DEPTH_LIMIT');
		if (entry?.kind !== 'node') return;
		add(entry.node.name);
		for (const child of entry.node.content || []) {
			if (child.kind === 'attribute' || child.kind === 'blob') add(child.name);
			else if (child.kind === 'node') visit(child, depth + 1);
		}
	};
	for (const root of roots) visit(root);
	return names;
}

function writeTreeEntry(writer, input, nameIds) {
	const entry = normalizeContent(input);
	if (entry.kind === 'raw' || entry.kind === 'data') {
		writer.u8(entry.kind === 'raw' ? FIELD.RAW : FIELD.DATA);
		writeLengthAndBytes(writer, encodeString(String(entry.value ?? ''), 1));
		return;
	}
	if (entry.kind !== 'node') throw new AudacityBinaryXmlError(`${entry.kind} cannot appear outside a node.`, 'INVALID_TREE');
	const node = entry.node;
	writer.u8(FIELD.START_TAG);
	writer.u16(requireNameId(nameIds, node.name));
	for (const childInput of node.content || []) {
		const child = normalizeContent(childInput);
		if (child.kind === 'attribute') writeAttribute(writer, child, nameIds);
		else if (child.kind === 'blob') {
			writer.u8(FIELD.BLOB);
			writer.u16(requireNameId(nameIds, child.name));
			writeLengthAndBytes(writer, toBytes(child.value, `blob ${child.name}`));
		} else writeTreeEntry(writer, child, nameIds);
	}
	writer.u8(FIELD.END_TAG);
	writer.u16(requireNameId(nameIds, node.name));
}

function writeAttribute(writer, input, nameIds) {
	const attribute = normalizeAttribute(input);
	const field = fieldForAttributeType(attribute.type);
	writer.u8(field);
	writer.u16(requireNameId(nameIds, attribute.name));
	if (field === FIELD.STRING) writeLengthAndBytes(writer, encodeString(String(attribute.value ?? ''), 1));
	else if (field === FIELD.INT || field === FIELD.LONG) writer.i32(requireInteger(attribute.value, -0x80000000, 0x7fffffff, attribute.name));
	else if (field === FIELD.BOOL) writer.u8(attribute.value ? 1 : 0);
	else if (field === FIELD.LONG_LONG) writer.i64(requireInt64(attribute.value, attribute.name));
	else if (field === FIELD.SIZE_T) writer.u32(requireInteger(attribute.value, 0, 0xffffffff, attribute.name));
	else if (field === FIELD.FLOAT) {
		writer.f32(requireFinite(attribute.value, attribute.name));
		writer.i32(requireInteger(attribute.digits ?? 6, -0x80000000, 0x7fffffff, `${attribute.name} digits`));
	} else if (field === FIELD.DOUBLE) {
		writer.f64(requireFinite(attribute.value, attribute.name));
		writer.i32(requireInteger(attribute.digits ?? 17, -0x80000000, 0x7fffffff, `${attribute.name} digits`));
	}
}

function normalizeAttribute(value) {
	if (!value || value.kind !== 'attribute') throw new AudacityBinaryXmlError('A typed Audacity XML attribute is required.', 'INVALID_ATTRIBUTE');
	const type = value.type || inferAttributeType(value.value);
	const field = fieldForAttributeType(type);
	if (field === FIELD.BOOL && typeof value.value !== 'boolean') {
		throw new AudacityBinaryXmlError(`Audacity bool attribute ${value.name} must be boolean.`, 'INVALID_ATTRIBUTE_VALUE');
	}
	return { kind: 'attribute', name: requireName(value.name), type, value: value.value, ...(value.digits == null ? {} : { digits: value.digits }) };
}

function normalizeContent(value) {
	if (value?.kind === 'node') {
		if (!value.node || !Array.isArray(value.node.content)) throw new AudacityBinaryXmlError('An Audacity XML node requires ordered content.', 'INVALID_NODE');
		return { kind: 'node', node: value.node };
	}
	if (value?.name && Array.isArray(value.content) && !value.kind) return { kind: 'node', node: value };
	if (value?.kind === 'attribute') return normalizeAttribute(value);
	if (value?.kind === 'blob') return { kind: 'blob', name: requireName(value.name), value: toBytes(value.value, `blob ${value.name}`).slice() };
	if (value?.kind === 'raw' || value?.kind === 'data') return { kind: value.kind, value: String(value.value ?? '') };
	throw new AudacityBinaryXmlError('Unknown Audacity XML content entry.', 'INVALID_CONTENT');
}

function fieldForAttributeType(type) {
	const entry = Object.entries(FIELD_NAME).find(([, name]) => name === type);
	const field = entry ? Number(entry[0]) : -1;
	if (![FIELD.STRING, FIELD.INT, FIELD.BOOL, FIELD.LONG, FIELD.LONG_LONG, FIELD.SIZE_T, FIELD.FLOAT, FIELD.DOUBLE].includes(field)) {
		throw new AudacityBinaryXmlError(`Unsupported Audacity attribute type: ${type}.`, 'INVALID_ATTRIBUTE_TYPE');
	}
	return field;
}

function inferAttributeType(value) {
	if (typeof value === 'string') return 'string';
	if (typeof value === 'boolean') return 'bool';
	if (typeof value === 'bigint') return 'long-long';
	if (Number.isInteger(value)) return 'int';
	if (typeof value === 'number') return 'double';
	throw new AudacityBinaryXmlError('Audacity attribute values must be strings, booleans, integers, floats, or bigints.', 'INVALID_ATTRIBUTE_VALUE');
}

function requireNameId(nameIds, name) {
	const id = nameIds.get(requireName(name));
	if (id == null) throw new AudacityBinaryXmlError(`Missing Audacity dictionary name: ${name}.`, 'MISSING_NAME');
	return id;
}

function requireName(value) {
	const name = String(value || '');
	if (!name) throw new AudacityBinaryXmlError('Audacity XML names cannot be empty.', 'INVALID_NAME');
	return name;
}

function resolveName(state, id) {
	const name = state.names.get(id);
	if (name == null) throw new AudacityBinaryXmlError(`Unknown Audacity XML name id: ${id}.`, 'UNKNOWN_NAME');
	return name;
}

function writeLengthAndBytes(writer, bytes) {
	if (bytes.byteLength > 0x7fffffff) throw new AudacityBinaryXmlError('Audacity XML value is too large.', 'VALUE_TOO_LARGE');
	writer.i32(bytes.byteLength);
	writer.bytes(bytes);
}

function encodeString(value, charSize) {
	if (charSize === 1) return new TextEncoder().encode(String(value));
	const codePoints = [...String(value)].map((character) => character.codePointAt(0));
	const units = charSize === 2
		? Array.from(String(value), (character) => character.codePointAt(0)).flatMap((point) => point <= 0xffff
			? [point]
			: [0xd800 + ((point - 0x10000) >>> 10), 0xdc00 + ((point - 0x10000) & 0x3ff)])
		: codePoints;
	const bytes = new Uint8Array(units.length * charSize);
	const view = new DataView(bytes.buffer);
	for (let index = 0; index < units.length; index += 1) {
		if (charSize === 2) view.setUint16(index * 2, units[index], true);
		else view.setUint32(index * 4, units[index], true);
	}
	return bytes;
}

function decodeString(bytes, charSize) {
	if (bytes.byteLength % charSize !== 0) throw new AudacityBinaryXmlError('Audacity string length is not aligned to its character width.', 'INVALID_STRING');
	try {
		if (charSize === 1) return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		if (charSize === 2) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
	} catch (error) {
		throw new AudacityBinaryXmlError('Audacity binary XML contains invalid Unicode.', 'INVALID_STRING', { cause: error });
	}
	let value = '';
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let offset = 0; offset < bytes.byteLength; offset += 4) {
		const point = view.getUint32(offset, true);
		if (point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) throw new AudacityBinaryXmlError('Audacity UTF-32 data contains an invalid code point.', 'INVALID_STRING');
		value += String.fromCodePoint(point);
	}
	return value;
}

function requireFinite(value, name) {
	const number = Number(value);
	if (!Number.isFinite(number)) throw new AudacityBinaryXmlError(`Audacity numeric attribute ${name} must be finite.`, 'INVALID_ATTRIBUTE_VALUE');
	return number;
}

function requireInteger(value, minimum, maximum, name) {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
		throw new AudacityBinaryXmlError(`Audacity integer attribute ${name} is out of range.`, 'INVALID_ATTRIBUTE_VALUE');
	}
	return number;
}

function requireInt64(value, name) {
	let integer;
	try {
		if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new TypeError();
		integer = BigInt(value);
	} catch {
		throw new AudacityBinaryXmlError(`Audacity 64-bit integer attribute ${name} is invalid.`, 'INVALID_ATTRIBUTE_VALUE');
	}
	if (integer < -(1n << 63n) || integer > (1n << 63n) - 1n) {
		throw new AudacityBinaryXmlError(`Audacity 64-bit integer attribute ${name} is out of range.`, 'INVALID_ATTRIBUTE_VALUE');
	}
	return integer;
}

function toBytes(value, name) {
	if (value instanceof Uint8Array) return value;
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (Array.isArray(value)) return Uint8Array.from(value);
	throw new TypeError(`${name} must be binary data.`);
}

function positiveLimit(value, fallback) {
	const number = Number(value ?? fallback);
	return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function cloneValue(value) {
	return value instanceof Uint8Array ? value.slice() : value;
}

class ByteCursor {
	constructor(bytes, name) {
		this.bytesValue = bytes;
		this.name = name;
		this.offset = 0;
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	}

	get done() { return this.offset === this.bytesValue.byteLength; }

	require(length) {
		if (this.offset + length > this.bytesValue.byteLength) throw new AudacityBinaryXmlError(`Unexpected end of Audacity ${this.name}.`, 'TRUNCATED_BINARY_XML');
	}

	u8() { this.require(1); return this.view.getUint8(this.offset++); }
	u16() { this.require(2); const value = this.view.getUint16(this.offset, true); this.offset += 2; return value; }
	u32() { this.require(4); const value = this.view.getUint32(this.offset, true); this.offset += 4; return value; }
	i32() { this.require(4); const value = this.view.getInt32(this.offset, true); this.offset += 4; return value; }
	i32Length() { const value = this.i32(); if (value < 0) throw new AudacityBinaryXmlError('Audacity XML value has a negative length.', 'INVALID_LENGTH'); return value; }
	i64() {
		this.require(8);
		const value = this.view.getBigInt64(this.offset, true);
		this.offset += 8;
		return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
	}
	f32() { this.require(4); const value = this.view.getFloat32(this.offset, true); this.offset += 4; return value; }
	f64() { this.require(8); const value = this.view.getFloat64(this.offset, true); this.offset += 8; return value; }
	bytes(length) { this.require(length); const value = this.bytesValue.subarray(this.offset, this.offset + length); this.offset += length; return value; }
}

class ByteWriter {
	constructor(budget) { this.parts = []; this.length = 0; this.budget = budget; }
	append(bytes) {
		if (this.budget && this.budget.used + bytes.byteLength > this.budget.limit) {
			throw new AudacityBinaryXmlError('The Audacity project description is too large.', 'BINARY_XML_TOO_LARGE');
		}
		this.parts.push(bytes);
		this.length += bytes.byteLength;
		if (this.budget) this.budget.used += bytes.byteLength;
	}
	u8(value) { const bytes = new Uint8Array(1); bytes[0] = Number(value); this.append(bytes); }
	u16(value) { const bytes = new Uint8Array(2); new DataView(bytes.buffer).setUint16(0, Number(value), true); this.append(bytes); }
	u32(value) { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, Number(value), true); this.append(bytes); }
	i32(value) { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setInt32(0, Number(value), true); this.append(bytes); }
	i64(value) { const bytes = new Uint8Array(8); new DataView(bytes.buffer).setBigInt64(0, BigInt(value), true); this.append(bytes); }
	f32(value) { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setFloat32(0, Number(value), true); this.append(bytes); }
	f64(value) { const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, Number(value), true); this.append(bytes); }
	bytes(value) { this.append(toBytes(value, 'writer input').slice()); }
	finish() { const output = new Uint8Array(this.length); let offset = 0; for (const part of this.parts) { output.set(part, offset); offset += part.byteLength; } return output; }
}

export const AUDACITY_BINARY_XML_FIELDS = FIELD;

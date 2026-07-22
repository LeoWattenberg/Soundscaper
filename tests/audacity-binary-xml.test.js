import assert from 'node:assert/strict';
import test from 'node:test';

import {
	AudacityBinaryXmlError,
	audacityXmlAttribute,
	audacityXmlAttributes,
	audacityXmlChildren,
	createAudacityXmlNode,
	decodeAudacityBinaryXml,
	encodeAudacityBinaryXml,
} from '../src/common/editor/audacity-binary-xml.js';
import {
	AUP4_BINARY_XML_ORACLE,
	decodeBase64Bytes,
} from './fixtures/aup4-binary-xml-oracle.js';

test('Audacity binary XML preserves typed attributes, duplicate names, blobs, and content order', () => {
	const root = createAudacityXmlNode('project', [
		{ kind: 'attribute', name: 'version', type: 'string', value: '2.0.0' },
		{ kind: 'attribute', name: 'signed-int', type: 'int', value: -2_147_483_648 },
		{ kind: 'attribute', name: 'signed-long', type: 'long', value: 2_147_483_647 },
		{ kind: 'attribute', name: 'unsigned-size', type: 'size-t', value: 0xffff_ffff },
		{ kind: 'attribute', name: 'gain', type: 'float', value: 0.5, digits: 6 },
		{ kind: 'attribute', name: 'gain', type: 'double', value: 0.75, digits: 17 },
		{ kind: 'attribute', name: 'enabled', type: 'bool', value: true },
		{ kind: 'attribute', name: 'frames', type: 'long-long', value: 9_007_199_254_740_993n },
	], [
		{ kind: 'raw', value: '<?xml version="1.0"?>' },
		{ kind: 'blob', name: 'thumbnail', value: Uint8Array.of(0, 1, 2, 255) },
		{ kind: 'node', node: createAudacityXmlNode('labeltrack', [
			{ kind: 'attribute', name: 'name', type: 'string', value: 'Änderungen' },
		], [{ kind: 'data', value: 'eins' }]) },
	]);

	const encoded = encodeAudacityBinaryXml(root);
	const decoded = decodeAudacityBinaryXml(encoded.dictionary, encoded.document);
	assert.equal(decoded.charSize, 1);
	assert.equal(decoded.root.name, 'project');
	assert.equal(audacityXmlAttribute(decoded.root, 'version'), '2.0.0');
	assert.equal(audacityXmlAttribute(decoded.root, 'signed-int'), -2_147_483_648);
	assert.equal(audacityXmlAttribute(decoded.root, 'signed-long'), 2_147_483_647);
	assert.equal(audacityXmlAttribute(decoded.root, 'unsigned-size'), 0xffff_ffff);
	assert.deepEqual(audacityXmlAttributes(decoded.root, 'gain').map((entry) => entry.type), ['float', 'double']);
	assert.deepEqual(audacityXmlAttributes(decoded.root, 'gain').map((entry) => entry.digits), [6, 17]);
	assert.equal(audacityXmlAttribute(decoded.root, 'frames'), 9_007_199_254_740_993n);
	assert.deepEqual(
		decoded.root.content.filter((entry) => entry.kind === 'attribute').map(({ name, type }) => [name, type]),
		[
			['version', 'string'], ['signed-int', 'int'], ['signed-long', 'long'], ['unsigned-size', 'size-t'],
			['gain', 'float'], ['gain', 'double'], ['enabled', 'bool'], ['frames', 'long-long'],
		],
	);
	assert.deepEqual(decoded.root.content.find((entry) => entry.kind === 'blob').value, Uint8Array.of(0, 1, 2, 255));
	assert.equal(audacityXmlChildren(decoded.root, 'labeltrack')[0].content.at(-1).value, 'eins');
	assert.equal(audacityXmlAttribute(audacityXmlChildren(decoded.root)[0], 'name'), 'Änderungen');

	const secondEncoding = encodeAudacityBinaryXml(decoded);
	assert.deepEqual(secondEncoding.dictionary, encoded.dictionary);
	assert.deepEqual(secondEncoding.document, encoded.document);
});

test('Audacity binary XML retains imported name scopes for an exact rewrite', () => {
	const dictionary = Uint8Array.of(
		0, 1,
		15, 0, 0, 7, 0, ...new TextEncoder().encode('project'),
		13,
		15, 0, 0, 6, 0, ...new TextEncoder().encode('shadow'),
		14,
	);
	const document = Uint8Array.of(1, 0, 0, 2, 0, 0);
	const decoded = decodeAudacityBinaryXml(dictionary, document);
	assert.equal(decoded.root.name, 'project');
	assert.deepEqual(decoded.dictionaryTokens.map((token) => token.kind), ['char-size', 'name', 'push', 'name', 'pop']);
	assert.deepEqual(encodeAudacityBinaryXml(decoded, { reuseOriginal: true }), { dictionary, document });
});

test('Audacity binary XML can reuse the exact imported token streams', () => {
	const encoded = encodeAudacityBinaryXml(createAudacityXmlNode('project', [
		{ kind: 'attribute', name: 'rate', type: 'int', value: 48_000 },
	]));
	const decoded = decodeAudacityBinaryXml(encoded.dictionary, encoded.document);
	const reused = encodeAudacityBinaryXml(decoded, { reuseOriginal: true });
	assert.deepEqual(reused, encoded);
});

test('Audacity binary XML rejects corrupt lengths and unbalanced tags', () => {
	const valid = encodeAudacityBinaryXml(createAudacityXmlNode('project'));
	assert.throws(
		() => decodeAudacityBinaryXml(valid.dictionary, valid.document.subarray(0, valid.document.length - 1)),
		(error) => error instanceof AudacityBinaryXmlError && error.code === 'TRUNCATED_BINARY_XML',
	);
	assert.throws(
		() => decodeAudacityBinaryXml(valid.dictionary, valid.document, { maxFields: 1 }),
		(error) => error instanceof AudacityBinaryXmlError && error.code === 'FIELD_LIMIT',
	);
	const nested = encodeAudacityBinaryXml(createAudacityXmlNode('project', [], [{
		kind: 'node', node: createAudacityXmlNode('track', [], [{
			kind: 'node', node: createAudacityXmlNode('clip'),
		}]),
	}]));
	assert.throws(
		() => decodeAudacityBinaryXml(nested.dictionary, nested.document, { maxDepth: 2 }),
		(error) => error instanceof AudacityBinaryXmlError && error.code === 'DEPTH_LIMIT',
	);
});

test('Audacity binary XML decodes an upstream UTF-32 project fixture byte-for-byte', () => {
	const dictionary = decodeBase64Bytes(AUP4_BINARY_XML_ORACLE.dictionaryBase64);
	const document = decodeBase64Bytes(AUP4_BINARY_XML_ORACLE.documentBase64);
	const decoded = decodeAudacityBinaryXml(dictionary, document);
	assert.equal(decoded.charSize, 4);
	assert.equal(decoded.root.name, 'project');
	assert.equal(audacityXmlAttribute(decoded.root, 'version'), '1.3.0');
	assert.equal(audacityXmlAttribute(decoded.root, 'rate'), 44_100);
	assert.deepEqual(encodeAudacityBinaryXml(decoded, { reuseOriginal: true }), { dictionary, document });
});

test('Audacity binary XML rejects ambiguous dictionaries, invalid Unicode, and numeric overflow', () => {
	const encoded = encodeAudacityBinaryXml(createAudacityXmlNode('project'));
	const duplicateDictionary = Uint8Array.from([...encoded.dictionary, ...encoded.dictionary.subarray(2)]);
	assert.throws(
		() => decodeAudacityBinaryXml(duplicateDictionary, encoded.document),
		(error) => error instanceof AudacityBinaryXmlError && error.code === 'INVALID_DICTIONARY',
	);
	const invalidUtf8Dictionary = Uint8Array.of(0, 1, 15, 0, 0, 1, 0, 0xff);
	assert.throws(
		() => decodeAudacityBinaryXml(invalidUtf8Dictionary, Uint8Array.of()),
		(error) => error instanceof AudacityBinaryXmlError && error.code === 'INVALID_STRING',
	);
	assert.throws(
		() => encodeAudacityBinaryXml(createAudacityXmlNode('project', [
			{ kind: 'attribute', name: 'rate', type: 'int', value: 0x80000000 },
		])),
		(error) => error instanceof AudacityBinaryXmlError && error.code === 'INVALID_ATTRIBUTE_VALUE',
	);
	assert.throws(
		() => encodeAudacityBinaryXml(createAudacityXmlNode('project'), { maxBytes: 4 }),
		(error) => error instanceof AudacityBinaryXmlError && error.code === 'BINARY_XML_TOO_LARGE',
	);
});

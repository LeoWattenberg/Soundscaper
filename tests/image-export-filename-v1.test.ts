/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { formatImageExportFilenameV1 } from '../src/common/editor/image-export-filename-v1.ts';

const request = { template: '{name}', sourceFileName: 'Summer.photo.PNG', format: 'png', index: 1 };

test('the default template preserves the original stem and chooses the actual codec extension', () => {
	assert.equal(formatImageExportFilenameV1(request), 'Summer.photo.png');
	assert.equal(formatImageExportFilenameV1({ ...request, format: 'jpeg' }), 'Summer.photo.jpg');
	assert.equal(formatImageExportFilenameV1({ ...request, sourceFileName: 'Urlaub ä 🌅.jpg' }), 'Urlaub ä 🌅.png');
	assert.equal(formatImageExportFilenameV1({ ...request, sourceFileName: '.hidden' }), 'photo.png');
	assert.equal(request.sourceFileName, 'Summer.photo.PNG');
});

test('literal text, escaped braces and bounded sequence padding have independent golden names', () => {
	assert.equal(formatImageExportFilenameV1({ ...request, template: '{{print}}-{index:4}-{name}', index: 27 }), '{print}-0027-Summer.photo.png');
	assert.equal(formatImageExportFilenameV1({ ...request, template: '{index}-{index:1}-{index:8}', index: 12 }), '12-12-00000012.png');
	assert.equal(formatImageExportFilenameV1({ ...request, template: 'finished-{name}-v2', format: 'jpeg' }), 'finished-Summer.photo-v2.jpg');
	assert.equal(formatImageExportFilenameV1({ ...request, template: 'custom' }), 'custom.png');
});

test('source names and literal paths are suggested flat names through the established save sanitizer', () => {
	assert.equal(formatImageExportFilenameV1({ ...request, sourceFileName: 'folder/unsafe:name?.png' }), 'folder-unsafe-name-.png');
	assert.equal(formatImageExportFilenameV1({ ...request, template: '../{name}/print.' }), '..-Summer.photo-print.png');
	assert.equal(formatImageExportFilenameV1({ ...request, template: '  {name} .  ' }), 'Summer.photo.png');
});

test('unknown tokens, malformed braces and unsupported padding are refused instead of silently renamed', () => {
	for (const template of ['{date}', '{unknown}', '{name:3}', '{index:0}', '{index:9}', '{index:03}', '{index:-1}', '{', '}', '{name', '{index}}']) {
		assert.throws(() => formatImageExportFilenameV1({ ...request, template }), /template/u);
	}
});

test('closed scalar requests refuse future fields, accessors and invalid index or format values', () => {
	for (const value of [{ ...request, extra: true }, { ...request, format: 'tiff' }, { ...request, index: 0 },
		{ ...request, index: 100_000_000 }, { ...request, index: 1.5 }, { ...request, index: NaN },
		{ ...request, sourceFileName: '' }, { ...request, template: '' }, { ...request, template: ' . ' }]) {
		assert.throws(() => formatImageExportFilenameV1(value));
	}
	let reads = 0;
	assert.throws(() => formatImageExportFilenameV1({ ...request, get template() { reads += 1; return '{name}'; } }));
	assert.equal(reads, 0);
});

test('all input and expanded filename capacities are enforced without truncation or sequence collisions', () => {
	assert.throws(() => formatImageExportFilenameV1({ ...request, template: 'x'.repeat(257) }), /bound/u);
	assert.throws(() => formatImageExportFilenameV1({ ...request, sourceFileName: 'x'.repeat(513) }), /bound/u);
	assert.throws(() => formatImageExportFilenameV1({ ...request, template: '{name}-{name}', sourceFileName: 'x'.repeat(300) + '.png' }), /bound/u);
	const names = Array.from({ length: 64 }, (_, index) => formatImageExportFilenameV1({ ...request, template: '{name}-{index:3}', index: index + 1 }));
	assert.equal(new Set(names).size, 64);
	assert.equal(names[0], 'Summer.photo-001.png'); assert.equal(names.at(-1), 'Summer.photo-064.png');
	assert.equal(formatImageExportFilenameV1({ ...request, sourceFileName: 'x'.repeat(508) + '.png' }).length, 512);
});

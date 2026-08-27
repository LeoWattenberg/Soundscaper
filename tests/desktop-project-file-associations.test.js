/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = resolve(ROOT, 'electron-builder.config.cjs');
const require = createRequire(import.meta.url);

function packagingConfig(product) {
	const previous = process.env.SCAPE_PRODUCT;
	if (product === undefined) delete process.env.SCAPE_PRODUCT;
	else process.env.SCAPE_PRODUCT = product;
	try {
		delete require.cache[CONFIG_PATH];
		return require(CONFIG_PATH);
	} finally {
		delete require.cache[CONFIG_PATH];
		if (previous === undefined) delete process.env.SCAPE_PRODUCT;
		else process.env.SCAPE_PRODUCT = previous;
	}
}

test('each packaged product claims its native suffix and the legacy one, and no other', () => {
	for (const [product, nativeExtension] of [['soundscaper', 'sscape'], ['framescaper', 'fscape']]) {
		const associations = packagingConfig(product).fileAssociations;
		const scapeFamily = associations.filter(
			({ mimeType }) => mimeType === 'application/vnd.soundscaper.scape+zip',
		);
		assert.deepEqual(scapeFamily.map(({ ext }) => ext), [nativeExtension, 'scape'], product);
		for (const association of scapeFamily) {
			assert.equal(association.role, 'Editor');
		}
		// Lightscaper's reserved suffix stays unclaimed until Lightscaper ships.
		assert.ok(!associations.some(({ ext }) => [ext].flat().includes('liscape')), product);
		assert.equal(
			new Set(associations.map(({ name }) => name)).size,
			associations.length,
			`${product} document type names must stay distinct`,
		);
	}
});

test('only the Soundscaper package claims Audacity projects, under its own name', () => {
	const soundscaper = packagingConfig('soundscaper').fileAssociations;
	const audacity = soundscaper.find(({ mimeType }) => mimeType === 'application/x-audacity-project');
	assert.deepEqual(audacity.ext, ['aup3', 'aup4']);
	assert.equal(audacity.name, 'Audacity Project');
	assert.ok(!packagingConfig('framescaper').fileAssociations.some(
		({ mimeType }) => mimeType === 'application/x-audacity-project',
	));
});

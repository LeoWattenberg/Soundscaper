/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);

const SURFACES = Object.freeze([
	Object.freeze({
		label: 'desktop preparation',
		args: ['--input-type=module', '--eval', [
			"const module = await import('./scripts/desktop-prepare.mjs');",
			'process.stdout.write(module.resolveDesktopProductId(process.env.SCAPE_PRODUCT));',
		].join(' ')],
	}),
	Object.freeze({
		label: 'electron-builder',
		args: ['--eval', [
			"const config = require('./electron-builder.config.cjs');",
			"process.stdout.write(config.productName === 'Framescaper' ? 'framescaper' : 'soundscaper');",
		].join(' ')],
	}),
	Object.freeze({
		label: 'desktop runtime constants',
		args: ['--input-type=module', '--eval', [
			"const module = await import('./desktop/constants.js');",
			'process.stdout.write(module.PRODUCT_ID);',
		].join(' ')],
	}),
	Object.freeze({
		label: 'packaged desktop smoke',
		args: ['--input-type=module', '--eval', [
			"const module = await import('./scripts/desktop-smoke.mjs');",
			'process.stdout.write(module.resolveDesktopProductId(process.env.SCAPE_PRODUCT));',
		].join(' ')],
	}),
]);

test('desktop selectors default only an absent SCAPE_PRODUCT to Soundscaper', () => {
	for (const surface of SURFACES) {
		const result = runSurface(surface, undefined);
		assert.equal(result.status, 0, `${surface.label}: ${result.stderr}`);
		assert.equal(result.stdout, 'soundscaper', surface.label);
	}
});

test('desktop selectors accept each exact product id without cross-product fallback', () => {
	for (const productId of ['soundscaper', 'framescaper']) {
		for (const surface of SURFACES) {
			const result = runSurface(surface, productId);
			assert.equal(result.status, 0, `${surface.label}/${productId}: ${result.stderr}`);
			assert.equal(result.stdout, productId, `${surface.label}/${productId}`);
		}
	}
});

test('desktop selectors reject empty and unrecognized SCAPE_PRODUCT values', () => {
	for (const productId of ['', 'lightscaper', 'Framescaper', 'framescaper ']) {
		for (const surface of SURFACES) {
			const result = runSurface(surface, productId);
			assert.notEqual(result.status, 0, `${surface.label} accepted ${JSON.stringify(productId)}`);
			assert.match(
				`${result.stdout}\n${result.stderr}`,
				/SCAPE_PRODUCT.*soundscaper.*framescaper/isu,
				`${surface.label}/${JSON.stringify(productId)}`,
			);
		}
	}
});

test('desktop runtime constants never borrow Soundscaper version metadata for Framescaper', () => {
	const script = [
		"const module = await import('./desktop/constants.js');",
		'process.stdout.write(JSON.stringify({',
		'productId: module.PRODUCT_ID, declaredVersion: module.DECLARED_APPLICATION_VERSION,',
		'applicationVersionChannel: module.APPLICATION_VERSION_CHANNEL,',
		'releaseChannel: module.RELEASE_CHANNEL, updateTagPrefix: module.UPDATE_TAG_PREFIX,',
		'}));',
	].join(' ');
	const result = runNode(['--input-type=module', '--eval', script], 'framescaper');
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(JSON.parse(result.stdout), {
		productId: 'framescaper',
		declaredVersion: null,
		applicationVersionChannel: 'candidate',
		releaseChannel: 'deferred',
		updateTagPrefix: 'framescaper-v',
	});
});

function runSurface(surface, productId) {
	return runNode(surface.args, productId);
}

function runNode(args, productId) {
	const env = { ...process.env };
	if (productId === undefined) delete env.SCAPE_PRODUCT;
	else env.SCAPE_PRODUCT = productId;
	return spawnSync(process.execPath, args, {
		cwd: ROOT,
		env,
		encoding: 'utf8',
	});
}

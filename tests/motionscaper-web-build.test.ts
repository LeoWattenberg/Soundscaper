/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { webBuildRouting, composeProductHeaders, matchedHeaders, parseHeaderRules } from '../scripts/lib/product-web-routing.mjs';
import { productWebManifest, PROJECT_FILE_EXTENSIONS } from '../scripts/lib/product-web-manifest.mjs';
import { ACCEPTED_PROJECT_FILE_EXTENSIONS } from '../src/common/project-file-extensions.ts';
import { assertProductGraphOwnership, BUDGETED_PRODUCT_IDS, PRODUCT_BOOTSTRAPS } from '../scripts/lib/startup-graph-budget.mjs';

test('Motionscaper web build owns root routes, a configurable origin and sealed capture permissions', async () => {
	const routing = webBuildRouting({ SCAPE_PRODUCT: 'motionscaper', MOTIONSCAPER_SITE: 'https://motion.example' });
	assert.equal(routing.productId, 'motionscaper');
	assert.equal(routing.site.origin, 'https://motion.example');
	assert.equal(routing.plans.length, 1);
	assert.equal(routing.plans[0]?.startUrl, '/en/');
	assert.equal(routing.workers[0]?.scriptUrl, '/service-worker.js');
	const template = await readFile(new URL('../public/_headers', import.meta.url), 'utf8');
	const headers = matchedHeaders(parseHeaderRules(composeProductHeaders(template, routing)), '/en/');
	assert.deepEqual(headers.get('cross-origin-opener-policy'), ['same-origin']);
	assert.deepEqual(headers.get('cross-origin-embedder-policy'), ['credentialless']);
	assert.ok(headers.get('permissions-policy')?.[0]?.includes('camera=()'));
});

test('Motionscaper startup ownership rejects both foreign runtime trees', () => {
	assert.ok(BUDGETED_PRODUCT_IDS.includes('motionscaper'));
	assert.equal(PRODUCT_BOOTSTRAPS.motionscaper, '/src/motionscaper/MotionscaperBootstrap.tsx');
	for (const foreign of ['soundscaper', 'framescaper']) {
		assert.throws(() => assertProductGraphOwnership('motionscaper', {
			moduleIds: new Set([`/repo/src/${foreign}/editor-controller.ts`]),
		}), /forbidden/u);
	}
	assert.doesNotThrow(() => assertProductGraphOwnership('motionscaper', {
		moduleIds: new Set(['/repo/src/motionscaper/MotionscaperBootstrap.tsx']),
	}));
});

test('Motionscaper shell install metadata advertises its identity without unimplemented import workflows', () => {
	assert.deepEqual(PROJECT_FILE_EXTENSIONS, ACCEPTED_PROJECT_FILE_EXTENSIONS);
	const manifest = productWebManifest({
		id: 'motionscaper', name: 'Motionscaper', description: 'Motion graphics',
		startUrl: '/en/', scope: '/', categories: ['photo'], media: [],
	});
	assert.equal(manifest.name, 'Motionscaper');
	assert.equal(manifest.id, '/motionscaper');
	assert.equal(manifest.start_url, '/en/');
	assert.ok(manifest.icons.every(({ src }: { src: string }) => src.includes('motionscaper')));
	assert.deepEqual(manifest.screenshots, []);
	assert.equal(manifest.file_handlers.length, 1);
	assert.ok(manifest.file_handlers[0].accept['application/vnd.soundscaper.scape+zip'].includes('.mscape'));
	assert.ok(manifest.file_handlers[0].icons.every(({ src }: { src: string }) => src.includes('motionscaper')));
	assert.equal(manifest.shortcuts.length, 2);
	assert.ok(manifest.shortcuts.every(({ url }: { url: string }) => url.startsWith(manifest.start_url)));
	assert.equal(Object.hasOwn(manifest, 'share_target'), false);
});

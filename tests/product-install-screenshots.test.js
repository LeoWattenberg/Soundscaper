/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
	MAXIMUM_SCREENSHOT_BYTES,
	checkInstallScreenshots,
	installScreenshotDeclarations,
	pngGeometry,
} from '../scripts/capture-install-screenshots.mjs';
import { generateOfflineApplicationShell } from '../scripts/lib/offline-application-shell.mjs';
import { pagesCachePolicyDescriptors } from '../scripts/lib/pages-deploy-preflight.mjs';
import {
	INSTALL_SCREENSHOT_DIRECTORY,
	productInstallScreenshots,
} from '../scripts/lib/product-web-manifest.mjs';
import { webBuildRouting } from '../scripts/lib/product-web-routing.mjs';

const INSTALLED_PRODUCTS = Object.freeze(['soundscaper', 'framescaper']);

/**
 * What a browser will accept as an install-dialog screenshot.
 *
 * Chrome drops a screenshot outside these bounds and falls back to the bare
 * install mini-bar, silently, so the geometry is asserted here rather than
 * discovered in a browser that quietly stopped showing the richer dialog.
 */
const MINIMUM_EDGE = 320;
const MAXIMUM_EDGE = 3840;
const MAXIMUM_ASPECT_RATIO = 2.3;

test('every declared screenshot is committed as a PNG of exactly the declared size', async () => {
	const records = await checkInstallScreenshots();
	assert.equal(records.length, INSTALLED_PRODUCTS.length * 2);
	for (const record of records) {
		const bytes = await readFile(record.path);
		// The declaration, the file's own header, and the manifest entry are three
		// separate statements about one image, and this is where they must agree.
		assert.deepEqual(pngGeometry(bytes), { width: record.width, height: record.height }, record.src);
		const declared = productInstallScreenshots(record.productId)
			.find((entry) => entry.src === record.src);
		assert.equal(declared.sizes, `${String(record.width)}x${String(record.height)}`, record.src);
		assert.equal(declared.type, 'image/png', record.src);
		assert.ok(bytes.byteLength <= MAXIMUM_SCREENSHOT_BYTES, `${record.src} is ${String(bytes.byteLength)} bytes`);
	}
});

test('a screenshot the repository does not have fails the check rather than a browser', async (context) => {
	const emptyRoot = await mkdtemp(join(tmpdir(), 'soundscaper-install-screenshot-test-'));
	context.after(() => rm(emptyRoot, { recursive: true, force: true }));
	await assert.rejects(
		checkInstallScreenshots({ repositoryRoot: emptyRoot }),
		/soundscaper-wide\.png is declared but the repository has no such file/u,
	);

	// A file that exists at the wrong size is the failure a bare existence check
	// would wave through: the manifest would keep promising 1280x800.
	const wrongSize = await mkdtemp(join(tmpdir(), 'soundscaper-install-screenshot-test-'));
	context.after(() => rm(wrongSize, { recursive: true, force: true }));
	for (const declaration of installScreenshotDeclarations(wrongSize)) {
		await mkdir(dirname(declaration.path), { recursive: true });
		await copyFile(installScreenshotDeclarations()[0].path, declaration.path);
	}
	await assert.rejects(
		checkInstallScreenshots({ repositoryRoot: wrongSize, productIds: ['soundscaper'] }),
		/soundscaper-narrow\.png is declared 720x1280 and is 1280x800/u,
	);
});

test('each product manifest declares one wide and one narrow screenshot inside its scope', async (context) => {
	for (const productId of INSTALLED_PRODUCTS) {
		const { manifest, outputRoot } = await productShell(context, productId);
		assert.deepEqual(manifest.screenshots, productInstallScreenshots(productId), productId);
		assert.deepEqual(manifest.screenshots.map(({ form_factor }) => form_factor), ['wide', 'narrow'], productId);
		const base = new URL(`https://${productId}.test/manifest-${productId}.webmanifest`);
		const labels = new Set();
		for (const screenshot of manifest.screenshots) {
			const resolved = new URL(screenshot.src, base);
			assert.equal(resolved.origin, base.origin, screenshot.src);
			assert.ok(resolved.pathname.startsWith(manifest.scope), `${screenshot.src} resolves outside the scope`);
			assert.equal(screenshot.type, 'image/png', screenshot.src);
			// A label is read aloud in place of the image, so two screenshots
			// sharing one label describe neither.
			assert.ok(screenshot.label.length > 20, screenshot.src);
			assert.equal(labels.has(screenshot.label), false, screenshot.label);
			labels.add(screenshot.label);

			const bytes = await readFile(join(outputRoot, screenshot.src));
			const [width, height] = screenshot.sizes.split('x').map(Number);
			assert.deepEqual(pngGeometry(bytes), { width, height }, screenshot.src);
			assert.ok(Math.min(width, height) >= MINIMUM_EDGE, screenshot.src);
			assert.ok(Math.max(width, height) <= MAXIMUM_EDGE, screenshot.src);
			assert.ok(Math.max(width, height) / Math.min(width, height) <= MAXIMUM_ASPECT_RATIO, screenshot.src);
		}
		// The wide image is what a desktop install dialog shows; a manifest whose
		// screenshots are all narrow gets the mini-bar there instead.
		const wide = manifest.screenshots.find(({ form_factor }) => form_factor === 'wide');
		const [wideWidth, wideHeight] = wide.sizes.split('x').map(Number);
		assert.ok(wideWidth > wideHeight, `${productId} declares a wide screenshot that is taller than it is wide`);
	}
});

test('a build precaches its own screenshots and deletes the other product copies', async (context) => {
	const { audit, outputRoot } = await productShell(context, 'soundscaper');
	const installUrls = audit.workers.soundscaper.installUrls;
	for (const screenshot of productInstallScreenshots('soundscaper')) {
		assert.ok(installUrls.includes(`/${screenshot.src}`), `${screenshot.src} is precached`);
		assert.ok(audit.assets.some(({ url }) => url === `/${screenshot.src}`), `${screenshot.src} is served`);
	}
	for (const screenshot of productInstallScreenshots('framescaper')) {
		assert.equal(
			await readFile(join(outputRoot, screenshot.src)).catch(() => null),
			null,
			`${screenshot.src} is dropped from a Soundscaper deployment`,
		);
		assert.equal(audit.assets.some(({ url }) => url === `/${screenshot.src}`), false, screenshot.src);
	}
	// The install core is capped; the screenshots must fit inside it with room.
	assert.ok(audit.workers.soundscaper.installByteLength < 8 * 1024 * 1024);
});

test('the screenshots are audited after publication, not required of the deployment they replace', () => {
	const routing = webBuildRouting({ SCAPE_PRODUCT: 'soundscaper' });
	const assetPath = '/assets/site-entry-AbCd1234.js';
	const introduced = productInstallScreenshots('soundscaper').map(({ src }) => `/${src}`);
	const published = pagesCachePolicyDescriptors({ routing, assetPath });
	for (const path of introduced) {
		assert.deepEqual(
			published.find((descriptor) => descriptor.path === path),
			{ path, expectation: 'served', cacheControl: 'no-cache' },
		);
	}
	// The pre-deploy gate reads the deployment being replaced, which cannot serve
	// a file this build is the first to emit.
	const predecessor = pagesCachePolicyDescriptors({ routing, assetPath, includeRetired: false });
	assert.equal(predecessor.some(({ path }) => introduced.includes(path)), false);
});

test('the shared headers revalidate the screenshot directory exactly as they do the icons', async () => {
	const headers = await readFile('public/_headers', 'utf8');
	assert.match(headers, new RegExp(`/${INSTALL_SCREENSHOT_DIRECTORY}/\\*\\n\\tCache-Control: no-cache`, 'u'));
});

/** One generated shell for one product, carrying the committed screenshots. */
async function productShell(context, productId) {
	const outputRoot = await mkdtemp(join(tmpdir(), 'soundscaper-install-screenshot-shell-'));
	context.after(() => rm(outputRoot, { recursive: true, force: true }));
	for (const [path, contents] of Object.entries({
		'index.html': '<!doctype html><title>Root</title>',
		'en/index.html': '<!doctype html><title>Editor</title>',
		'embed/en/index.html': '<!doctype html><title>Embedded</title>',
		'assets/application-abc.js': 'export const application = 1;',
		'assets/soundscaper-core.js': 'export const soundscaper = 1;',
		'assets/framescaper-core.js': 'export const framescaper = 1;',
		'logo/framescaper-icon.svg': '<svg viewBox="0 0 1 1" />',
		'logo/logo-klein-schwarz.svg': '<svg viewBox="0 0 1 1" />',
		'logo/logo-klein-weiß.svg': '<svg viewBox="0 0 1 1" />',
		'.offline-build-manifest.json': JSON.stringify({
			'index.html': {
				file: 'assets/application-abc.js',
				isEntry: true,
				dynamicImports: [
					'src/soundscaper/ui/SoundscaperAudioEditorBootstrap.tsx',
					'src/framescaper/ui/FramescaperAudioEditorBootstrap.tsx',
				],
			},
			'src/soundscaper/ui/SoundscaperAudioEditorBootstrap.tsx': {
				file: 'assets/soundscaper-core.js', isDynamicEntry: true,
			},
			'src/framescaper/ui/FramescaperAudioEditorBootstrap.tsx': {
				file: 'assets/framescaper-core.js', isDynamicEntry: true,
			},
		}),
	})) {
		const target = join(outputRoot, path);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, contents);
	}
	// The real images, because a fixture PNG would prove only that the generator
	// copies bytes: these assertions are about the files a deployment serves.
	await mkdir(join(outputRoot, INSTALL_SCREENSHOT_DIRECTORY), { recursive: true });
	for (const declaration of installScreenshotDeclarations()) {
		await copyFile(declaration.path, join(outputRoot, declaration.src));
	}
	await generateOfflineApplicationShell({
		outputRoot,
		repositoryRoot: resolve('.'),
		environment: { SCAPE_PRODUCT: productId },
	});
	return {
		outputRoot,
		audit: JSON.parse(await readFile(join(outputRoot, 'offline-shell.json'), 'utf8')),
		manifest: JSON.parse(await readFile(join(outputRoot, `manifest-${productId}.webmanifest`), 'utf8')),
	};
}

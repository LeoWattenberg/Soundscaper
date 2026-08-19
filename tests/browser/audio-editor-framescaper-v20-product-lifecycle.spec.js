/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	bootEditor,
	collectClientErrors,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

const ROUTE_ROOT = '/__m4b2-framescaper-v20-product__';
const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(TEST_DIRECTORY, '../..');
const HARNESS_PATH = resolve(REPOSITORY_ROOT, 'tests/helpers/m4b2-framescaper-v20-product-browser-harness.test.ts');
const CONTROLLER_PATH = resolve(REPOSITORY_ROOT, 'src/framescaper/editor-controller-v20.ts');
const STRATEGY_PATH = resolve(REPOSITORY_ROOT, 'src/framescaper/video-export-strategy-v20.ts');
const REQUIREMENTS_PATH = resolve(
	REPOSITORY_ROOT,
	'src/framescaper/editor-project-feature-requirements-v20.ts',
);
const PRODUCT_PROFILE_PATH = resolve(REPOSITORY_ROOT, 'src/framescaper/product.js');
const APP_PATH = resolve(REPOSITORY_ROOT, 'src/common/site/App.jsx');

const WEBKIT_AV_IMPORT_DEFERRED = 'Playwright WebKit rejects the IndexedDB Blob write that persists an imported A/V source.';

test.describe('dormant Framescaper V20 product browser acceptance', () => {
	registerAudioEditorHooks();

	test('keeps keyed authoring hidden while the exact V20 controller qualifies lifecycle and export', async ({ page }, testInfo) => {
		test.skip(testInfo.project.name === 'webkit', WEBKIT_AV_IMPORT_DEFERRED);
		test.setTimeout(120_000);
		const clientErrors = collectClientErrors(page);
		const source = await readFile(CONTROLLER_PATH, 'utf8');
		expect(source).toMatch(
			/import\s*\{\s*createFramescaperVideoExportStrategyV20\s*\}\s*from\s*'\.\/video-export-strategy-v20\.ts'/u,
		);
		expect(source).toMatch(
			/productVideoExportStrategy:\s*createFramescaperVideoExportStrategyV20\(environment\.runtime\.profile\)/u,
		);
		const requirementsSource = await readFile(REQUIREMENTS_PATH, 'utf8');
		const capabilityPath = resolvePublicOwnerImport(
			REQUIREMENTS_PATH,
			requirementsSource,
			'FRAMESCAPER_V20_PROJECT_FEATURE_CAPABILITY_PROFILE',
		);
		const capabilitySource = await readFile(capabilityPath, 'utf8');
		expect(capabilitySource).toMatch(
			/\{ key: 'videoKeyframes', featureId: 'org\.soundscaper\.capability\.video-keyframes', available: false \}/u,
		);
		const productSource = await readFile(PRODUCT_PROFILE_PATH, 'utf8');
		expect(productSource).toMatch(/videoKeyframes:\s*false/u);
		const appSource = await readFile(APP_PATH, 'utf8');
		expect(appSource).toMatch(/FramescaperAudioEditorBootstrapV19/u);
		expect(appSource).not.toMatch(/FramescaperAudioEditorBootstrapV20/u);

		const bundle = await bundleQualificationHarness();
		await installHarnessRoute(page, bundle);
		await page.goto(`${ROUTE_ROOT}/index.html`);
		const diagnostic = await page.evaluate(async ({ root }) => {
			const harness = await import(`${root}/harness.js`);
			return harness.runM4B2FramescaperV20ProductLifecycle();
		}, { root: ROUTE_ROOT });

		expect(diagnostic).toMatchObject({
			profile: 'dormant-exact-v20-product-browser-v2',
			availability: {
				testOnlyFeatureRequirementAvailable: true,
				testOnlyProductCapabilityAvailable: true,
			},
			project: {
				schemaVersion: 20,
				staleRefused: true,
				undoRestoredOriginal: true,
				redoRestoredEdit: true,
				autosaveScheduled: true,
				autosavePersistedEdit: true,
				savePersistedUndo: true,
				flushPersistedRedo: true,
				savedExact: true,
				reopenedExact: true,
				openedReadOnly: false,
				revisions: {
					initial: 0,
					committed: 1,
					autosavePersisted: 1,
					undone: 2,
					savePersisted: 2,
					redone: 3,
					flushPersisted: 3,
					reopened: 3,
				},
			},
			blob: {
				method: 'object-url',
				mimeType: 'video/mp4',
				size: 8,
				published: true,
			},
			direct: {
				method: 'file-system-access',
				mimeType: 'video/mp4',
				size: 8,
				writtenBytes: 8,
				committed: true,
			},
			cancellation: {
				result: null,
				published: false,
				encoderObservedAbort: true,
			},
			directCancellation: {
				result: null,
				published: false,
				partialBytes: 4,
				sinkAborted: true,
				sinkClosed: false,
				encoderObservedAbort: true,
			},
			encoder: {
				observations: 4,
				blobAborts: 1,
				directAborts: 1,
				timingMapAndBoundViewExact: 4,
				exportLeaseDistinctFromPlayback: 4,
				canvasExact: 4,
				projectKeyframesExact: 4,
				sourceBlobAuthenticated: 4,
			},
			cleanup: {
				timingLeasesAfterEachExport: [0, 0, 0, 0],
				directAborts: 1,
				directCloses: 1,
				objectUrlsCreated: 1,
				objectUrlsRevoked: 1,
				runtimeDisposed: true,
				timingRegistryClearedAfterDispose: true,
				injectedEncoderRemoved: true,
			},
		});

		await page.unroute(`**${ROUTE_ROOT}/**`);
		let editor = await bootEditor(page, '/embed/en/');
		await expect(editor).toHaveAttribute('data-product', 'soundscaper');
		await assertNoVideoKeyframeAuthoring(page, editor);

		editor = await bootEditor(page, '/framescaper/embed/en/');
		await expect(editor).toHaveAttribute('data-product', 'framescaper');
		await assertNoVideoKeyframeAuthoring(page, editor);
		expect(clientErrors).toEqual([]);
	});
});

async function assertNoVideoKeyframeAuthoring(page, editor) {
	const edit = editor.getByRole('menubar', { name: 'Application menu', exact: true })
		.getByRole('menuitem', { name: 'Edit', exact: true });
	await edit.click();
	const menu = page.getByRole('menu', { name: 'Edit', exact: true });
	await expect(menu).toBeVisible();
	await expect(menu.getByRole('menuitem', { name: /^Video keyframes(?:\s|$)/u })).toHaveCount(0);
	await page.keyboard.press('Escape');
	await expect(editor.locator('[data-editor-surface="video-keyframes"]')).toHaveCount(0);
}

async function installHarnessRoute(page, bundle) {
	await page.route(`**${ROUTE_ROOT}/**`, async (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path === `${ROUTE_ROOT}/index.html`) {
			await route.fulfill({
				status: 200,
				contentType: 'text/html',
				body: '<!doctype html><meta charset="utf-8"><title>V20 product qualification</title>',
			});
			return;
		}
		if (path === `${ROUTE_ROOT}/harness.js`) {
			await route.fulfill({ status: 200, contentType: 'text/javascript', body: bundle });
			return;
		}
		await route.fulfill({ status: 404, body: 'Not found' });
	});
}

async function bundleQualificationHarness() {
	const controllerSource = await readFile(CONTROLLER_PATH, 'utf8');
	const requirementsSource = await readFile(REQUIREMENTS_PATH, 'utf8');
	const productSource = await readFile(PRODUCT_PROFILE_PATH, 'utf8');
	let redirectedController = false;
	let enabledFeatureRequirement = false;
	let enabledProductCapability = false;
	const result = await build({
		entryPoints: [HARNESS_PATH],
		bundle: true,
		write: false,
		format: 'esm',
		platform: 'browser',
		target: 'es2022',
		// The delivery code in this graph imports its burn-in font subsets as URLs,
		// which Vite resolves natively and esbuild has no loader for. Inline them so
		// the URLs stay usable and the harness still bundles to a single module.
		loader: { '.woff': 'dataurl', '.woff2': 'dataurl' },
		plugins: [{
			name: 'm4b2-v20-product-strategy-injection',
			setup(buildApi) {
				buildApi.onResolve({ filter: /^module$/ }, (args) => (
					args.importer.replaceAll('\\', '/').includes('/@echogarden/pffft-wasm/dist/')
						? { path: 'pffft-node-module', namespace: 'm4b2-product' }
						: null
				));
				buildApi.onLoad({ filter: /^pffft-node-module$/, namespace: 'm4b2-product' }, () => ({
					contents: 'export function createRequire() { throw new Error("Node createRequire cannot run in the browser harness."); }',
					loader: 'js',
				}));
				buildApi.onLoad({ filter: /editor-controller-v20\.ts$/ }, () => {
					redirectedController = true;
					return {
						contents: replaceExactlyOnce(controllerSource,
							"from './video-export-strategy-v20.ts';",
							"from 'm4b2-test-video-export-strategy';",
						),
						loader: 'ts',
					};
				});
				buildApi.onLoad({ filter: /editor-project-feature-requirements-v20\.ts$/ }, () => {
					enabledFeatureRequirement = true;
					return {
						contents: replaceExactlyOnce(
							requirementsSource,
							'.filter(({ available }) => available)',
							'.filter(({ available, key }) => available || key === \'videoKeyframes\')',
						),
						loader: 'ts',
					};
				});
				buildApi.onLoad({ filter: /\/framescaper\/product\.js$/ }, () => {
					enabledProductCapability = true;
					return {
						contents: replaceExactlyOnce(
							productSource, 'videoKeyframes: false', 'videoKeyframes: true',
						),
						loader: 'js',
					};
				});
				buildApi.onResolve({ filter: /^m4b2-test-video-export-strategy$/ }, () => ({
					path: 'strategy-adapter',
					namespace: 'm4b2-product',
				}));
				buildApi.onLoad({ filter: /^strategy-adapter$/, namespace: 'm4b2-product' }, () => ({
					contents: strategyAdapterSource(),
					loader: 'ts',
					resolveDir: dirname(STRATEGY_PATH),
				}));
			}
		}],
	});
	if (!redirectedController) throw new Error('The V20 controller strategy import was not redirected.');
	if (!enabledFeatureRequirement || !enabledProductCapability) {
		throw new Error('The explicit test-only V20 availability injection was not bundled.');
	}
	if (result.outputFiles.length !== 1) throw new Error('Expected one bundled V20 qualification module.');
	return result.outputFiles[0].text;
}

function strategyAdapterSource() {
	return `
		import { createFramescaperVideoExportStrategyV20 as createActual } from ${JSON.stringify(STRATEGY_PATH)};
		export function createFramescaperVideoExportStrategyV20(profile) {
			return createActual(profile, globalThis.__m4b2FramescaperV20EncoderDependencies);
		}
	`;
}

function resolvePublicOwnerImport(ownerPath, source, importedName) {
	const match = source.match(new RegExp(
		`import\\s*\\{[^}]*\\b${importedName}\\b[^}]*\\}\\s*from\\s*'([^']+)'`,
		'u',
	));
	if (!match?.[1]) throw new Error(`The public V20 requirements owner lost ${importedName}.`);
	return resolve(dirname(ownerPath), match[1]);
}

function replaceExactlyOnce(source, expected, replacement) {
	if (source.split(expected).length !== 2) {
		throw new Error(`The test-only V20 availability seam expected exactly one ${expected}.`);
	}
	return source.replace(expected, replacement);
}

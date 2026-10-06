/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';

interface FulfilledRoute {
	readonly body: Uint8Array;
	readonly headers: Record<string, string>;
	readonly contentType: string;
}

interface FixtureRoute {
	request(): { url(): string };
	fallback(): Promise<void>;
	fulfill(value: FulfilledRoute): Promise<void>;
}

type RouteHandler = (route: FixtureRoute) => Promise<void>;

interface FixturePage {
	route(pattern: string, handler: RouteHandler): Promise<void>;
	unroute(pattern: string, handler: RouteHandler): Promise<void>;
}

interface RendererModule {
	installOriginalOverwriteDesktopRenderer(page: FixturePage): Promise<void>;
	releaseOriginalOverwriteDesktopRenderer(page: FixturePage): Promise<void>;
}

const CSP = "default-src 'self'; connect-src 'self' https://fixture.example";

test('nightly video overwrite serves its packaged renderer without a checkout or Vite', async (context) => {
	const fixture = await createFixture(context);
	const product = join(fixture.root, 'products/framescaper');
	const resources = process.platform === 'darwin'
		? join(product, `mac${process.arch === 'x64' ? '' : `-${process.arch}`}/Framescaper.app/Contents/Resources`)
		: join(product, `${process.platform === 'win32' ? 'win' : 'linux'}${process.arch === 'x64' ? '' : `-${process.arch}`}-unpacked/resources`);
	const renderer = join(resources, 'renderer');
	await writeRenderer(renderer);
	setEnvironment(context, { SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT: fixture.root });
	const page = fixturePage();
	await fixture.module.installOriginalOverwriteDesktopRenderer(page);
	const response = await page.request('http://127.0.0.1:4322/embed/en/');
	assert.equal(Buffer.from(response.body).toString(), '<title>Packaged Framescaper</title>');
	assert.equal(response.headers['Content-Security-Policy'], CSP);
	await fixture.module.releaseOriginalOverwriteDesktopRenderer(page);
	assert.equal(await readFile(join(renderer, 'index.html'), 'utf8'), '<title>Packaged Framescaper</title>');
	assert.equal(page.active(), false);
});

test('a supplied overwrite renderer uses its own response policy and survives cleanup', async (context) => {
	const fixture = await createFixture(context);
	const renderer = join(fixture.root, 'supplied-renderer');
	await writeRenderer(renderer);
	setEnvironment(context, {
		SCAPE_BROWSER_DESKTOP_FRAMESCAPER_RENDERER: renderer,
		SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT: join(fixture.root, 'unused-nightly-root'),
	});
	const page = fixturePage();
	await fixture.module.installOriginalOverwriteDesktopRenderer(page);
	const response = await page.request('http://127.0.0.1:4322/en/');
	assert.equal(response.headers['Content-Security-Policy'], CSP);
	await fixture.module.releaseOriginalOverwriteDesktopRenderer(page);
	assert.equal(await readFile(join(renderer, 'index.html'), 'utf8'), '<title>Packaged Framescaper</title>');
});

async function createFixture(context: TestContext): Promise<{ root: string; module: RendererModule }> {
	const root = await mkdtemp(join(tmpdir(), 'overwrite-renderer-payload-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	for (const file of [
		'tests/browser/helpers/original-overwrite-desktop-video.js',
		'scripts/lib/static-response-headers.mjs',
		'scripts/lib/desktop-packaged-product-executable.mjs',
		'scripts/lib/packaged-executable-resource-identity.mjs',
	]) {
		await mkdir(dirname(join(root, file)), { recursive: true });
		await copyFile(new URL(`../${file}`, import.meta.url), join(root, file));
	}
	await mkdir(join(root, 'desktop'));
	await writeFile(join(root, 'desktop/desktop-video-codec-operation-contract.ts'), [
		'export function createDesktopExternalFfmpegVideoWorkload() {}',
		'export function normalizeDesktopVideoCodecOperationPlan() {}',
	].join('\n'));
	const module = await import(pathToFileURL(join(root, 'tests/browser/helpers/original-overwrite-desktop-video.js')).href) as RendererModule;
	return { root, module };
}

async function writeRenderer(root: string): Promise<void> {
	await mkdir(root, { recursive: true });
	await writeFile(join(root, 'index.html'), '<title>Packaged Framescaper</title>');
	await writeFile(join(root, '_headers'), `/*\n\tContent-Security-Policy: ${CSP}\n`);
}

function setEnvironment(context: TestContext, environment: Record<string, string>): void {
	for (const key of ['SCAPE_BROWSER_DESKTOP_FRAMESCAPER_RENDERER', 'SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT']) {
		const previous = process.env[key];
		context.after(() => {
			if (previous === undefined) delete process.env[key];
			else process.env[key] = previous;
		});
		if (Object.hasOwn(environment, key)) process.env[key] = environment[key];
		else delete process.env[key];
	}
}

function fixturePage() {
	let installed: RouteHandler | null = null;
	return {
		async route(pattern: string, handler: RouteHandler): Promise<void> {
			assert.equal(pattern, '**/*');
			installed = handler;
		},
		async unroute(pattern: string, handler: RouteHandler): Promise<void> {
			assert.equal(pattern, '**/*');
			assert.equal(handler, installed);
			installed = null;
		},
		async request(url: string): Promise<FulfilledRoute> {
			assert.ok(installed);
			const response: { value: FulfilledRoute | null } = { value: null };
			await installed({
				request: () => ({ url: () => url }),
				fallback: () => { throw new Error('The packaged renderer route unexpectedly fell back.'); },
				fulfill: (value) => { response.value = value; return Promise.resolve(); },
			});
			assert.ok(response.value);
			return response.value;
		},
		active: () => installed !== null,
	};
}

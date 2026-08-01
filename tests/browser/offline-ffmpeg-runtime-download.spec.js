import { createHash } from 'node:crypto';

import { expect, test } from '@playwright/test';

const RUNTIME_ROOT = 'https://assets.soundscaper.org/runtime/ffmpeg/0.12.10';

test.setTimeout(60_000);

test('explicit runtime updates commit only complete verified releases', async ({ page }) => {
	const first = runtimeRelease('first');
	const second = runtimeRelease('second');
	let published = first;
	let failWasm = false;
	await page.route(`${RUNTIME_ROOT}/**`, async (route) => {
		const url = route.request().url();
		const resource = published.resources.get(url);
		if (!resource) return route.fulfill({ status: 404, body: 'not found' });
		if (failWasm && url.endsWith('/ffmpeg-core.wasm')) {
			return route.fulfill({ status: 503, body: 'candidate unavailable' });
		}
		return route.fulfill({
			status: 200,
			body: resource.body,
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Content-Length': String(resource.body.byteLength),
				'Content-Type': resource.contentType,
			},
		});
	});

	const editor = await bootEditor(page);
	await chooseCommand(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Offline$/ }).click();
	const panel = preferences.locator('[data-offline-ffmpeg-runtime]');
	await expect(panel).toHaveAttribute('data-offline-runtime-status', 'not-installed');

	await panel.getByRole('button', { name: 'Download for offline use', exact: true }).click();
	await expect(panel).toHaveAttribute('data-offline-runtime-status', 'ready');
	await expect(panel).toContainText('Ready for offline use');
	await expect.poll(() => activeRuntimeRelease(page)).toBe(first.releaseId);
	await expect.poll(() => cachedRuntimeBodies(page, first)).toEqual(first.fileBodies);

	published = second;
	failWasm = true;
	await panel.getByRole('button', { name: 'Check for updates', exact: true }).click();
	await expect(panel).toHaveAttribute('data-offline-runtime-status', 'failed');
	await expect(panel.getByRole('alert')).toContainText('previous verified runtime remains available');
	await expect.poll(() => activeRuntimeRelease(page)).toBe(first.releaseId);
	await expect.poll(() => cachedRuntimeBodies(page, first)).toEqual(first.fileBodies);
});

async function bootEditor(page) {
	await page.goto('/en/');
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true', { timeout: 20_000 });
	return editor;
}

async function chooseCommand(page, editor, menuName, commandName) {
	const menubar = editor.getByRole('menubar', { name: 'Application menu', exact: true });
	await menubar.getByRole('menuitem', { name: menuName, exact: true }).click();
	const menu = page.getByRole('menu', { name: menuName, exact: true });
	await expect(menu).toBeVisible();
	await menu.getByRole('menuitem', { name: new RegExp(`^${commandName}(?:\\s|$)`) }).first().click();
}

async function activeRuntimeRelease(page) {
	return page.evaluate(async () => {
		const cache = await caches.open('soundscaper-ffmpeg-runtime-v1-state');
		const response = await cache.match(new URL('/.soundscaper/offline/ffmpeg-runtime-state-v1.json', location.origin));
		return response ? (await response.json()).active.releaseId : null;
	});
}

async function cachedRuntimeBodies(page, release) {
	return page.evaluate(async ({ cacheName, urls }) => {
		const cache = await caches.open(cacheName);
		return Promise.all(urls.map(async (url) => {
			const response = await cache.match(url);
			return response ? await response.text() : null;
		}));
	}, {
		cacheName: `soundscaper-ffmpeg-runtime-v1-${release.releaseId}`,
		urls: release.fileUrls,
	});
}

function runtimeRelease(seed) {
	const files = [
		{
			name: 'ffmpeg-core.js',
			body: Buffer.from(`self.__soundscaperRuntime = ${JSON.stringify(seed)};`),
			contentType: 'text/javascript; charset=utf-8',
		},
		{
			name: 'ffmpeg-core.wasm',
			body: Buffer.from(`verified-wasm-${seed}`),
			contentType: 'application/wasm',
		},
	];
	const publicPrefix = 'runtime/ffmpeg/0.12.10';
	const manifest = Buffer.from(JSON.stringify({
		schemaVersion: 1,
		id: 'ffmpeg-core-0.12.10',
		package: { name: '@ffmpeg/core', version: '0.12.10' },
		runtime: {
			publicPrefix,
			files: files.map((file) => ({
				name: file.name,
				byteLength: file.body.byteLength,
				sha256: digest(file.body),
				contentType: file.contentType,
			})),
		},
		publication: { manifestName: 'manifest.json' },
	}));
	const releaseId = digest(manifest);
	const releaseRoot = `${RUNTIME_ROOT}/releases/${releaseId}`;
	const pointer = Buffer.from(JSON.stringify({
		schemaVersion: 1,
		releaseId,
		manifest: descriptor(`${publicPrefix}/releases/${releaseId}/manifest.json`, manifest),
		files: Object.fromEntries(files.map((file) => [
			file.name,
			descriptor(`${publicPrefix}/releases/${releaseId}/${file.name}`, file.body),
		])),
	}));
	return {
		releaseId,
		fileUrls: files.map(({ name }) => `${releaseRoot}/${name}`),
		fileBodies: files.map(({ body }) => body.toString()),
		resources: new Map([
			[`${RUNTIME_ROOT}/latest.json`, { body: pointer, contentType: 'application/json' }],
			[`${releaseRoot}/manifest.json`, { body: manifest, contentType: 'application/json' }],
			...files.map((file) => [`${releaseRoot}/${file.name}`, file]),
		]),
	};
}

function descriptor(path, body) {
	return { path, byteLength: body.byteLength, sha256: digest(body) };
}

function digest(body) {
	return createHash('sha256').update(body).digest('hex');
}

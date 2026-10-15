/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { buildSync } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as Fixture from './fixtures/amplify-selection-intent.tsx';

interface Scope {
	amplifySelectionFixture: typeof Fixture;
	amplifyPreparation: ReturnType<typeof Fixture.mountAmplifyPreparation>;
}

const bundleDirectory = process.env.SCAPE_AMPLIFY_SELECTION_BUNDLE_DIRECTORY;
const build = buildSync({ stdin: { contents: `import { mountAmplifyPreparation } from './fixtures/amplify-selection-intent.tsx';
globalThis.amplifySelectionFixture = { mountAmplifyPreparation };`,
	resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' },
	bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', external: ['module'], loader: { '.woff2': 'dataurl' },
	jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, target: 'es2022',
	outfile: resolve(bundleDirectory ?? '.', 'component.js') });
if (bundleDirectory) {
	mkdirSync(bundleDirectory, { recursive: true });
	for (const output of build.outputFiles) writeFileSync(output.path, output.contents);
	writeFileSync(resolve(bundleDirectory, 'metafile.json'), `${JSON.stringify(build.metafile, null, 2)}\n`);
}
const script = build.outputFiles.find((output) => output.path.endsWith('.js'))!.text;
const styles = build.outputFiles.find((output) => output.path.endsWith('.css'))?.text;

const read = (page: Page) => page.evaluate(() => (globalThis as unknown as Scope).amplifyPreparation.snapshot());

async function mount(page: Page) {
	await page.route('http://amplify-component.test/**', async (route) => {
		const path = new URL(route.request().url()).pathname;
		await route.fulfill(path === '/component.js' ? { contentType: 'text/javascript', body: script }
			: path === '/component.css' ? { contentType: 'text/css', body: styles ?? '' }
			: { contentType: 'text/html', body: '<!doctype html><html><head><title>Amplify selection intent</title><link rel="stylesheet" href="/component.css"></head><body><script type="module" src="/component.js"></script></body></html>' });
	});
	await page.goto('http://amplify-component.test/');
	await page.evaluate(() => {
		const scope = globalThis as unknown as Scope;
		scope.amplifyPreparation = scope.amplifySelectionFixture.mountAmplifyPreparation();
	});
	const gain = page.getByRole('spinbutton', { name: 'Amplification (dB)', exact: true });
	await expect(gain).toHaveValue('0');
	await expect.poll(async () => (await read(page)).renders).toBe(1);
	return gain;
}

async function finishScan(page: Page) {
	await page.evaluate(() => (globalThis as unknown as Scope).amplifyPreparation.finishScan());
	// Wait for the actual preparation publication and React value effects, regardless of which gain wins.
	await expect.poll(async () => {
		const state = await read(page);
		return state.completed && state.synchronized;
	}).toBe(true);
}

async function retain(page: Page, info: TestInfo, checkpoints: unknown[]) {
	await info.attach('amplify-selection-operands', { body: JSON.stringify({ checkpoints, final: await read(page) }, null, 2), contentType: 'application/json' });
	await page.evaluate(() => (globalThis as unknown as Scope).amplifyPreparation.dispose());
}

test('untouched focused Amplify still accepts the real automatic headroom scan', async ({ page }, info) => {
	const checkpoints: unknown[] = [];
	await mount(page);
	try {
		await page.getByRole('spinbutton', { name: 'Amplification (dB)', exact: true }).focus();
		checkpoints.push({ stage: 'focused-before-pcm', ...await read(page) });
		await finishScan(page);
		const state = await read(page);
		checkpoints.push({ stage: 'scan-completed', ...state });
		expect(state.gainDb).toBe(state.headroom);
		expect(Number(state.fieldValue)).toBe(state.headroom);
		expect(state.touched).toEqual([]);
		expect(state.sameField).toBe(true);
		expect(state.focused).toBe(true);
	} finally { await retain(page, info, checkpoints); }
});

test('native select-all before pending Amplify headroom completion replaces the draft with exactly six', async ({ page }, info) => {
	const checkpoints: unknown[] = [];
	const gain = await mount(page);
	try {
		await gain.focus();
		await page.keyboard.press('ControlOrMeta+A');
		checkpoints.push({ stage: 'native-select-all-before-pcm', ...await read(page) });
		await finishScan(page);
		checkpoints.push({ stage: 'scan-completed-before-insert', ...await read(page) });
		await page.keyboard.insertText('6');
		await gain.blur();
		checkpoints.push({ stage: 'native-insert-and-blur', ...await read(page) });
		await expect(gain).toHaveValue('6');
		await expect.poll(async () => (await read(page)).gainDb).toBe(6);
		expect((await read(page)).sameField).toBe(true);
	} finally { await retain(page, info, checkpoints); }
});

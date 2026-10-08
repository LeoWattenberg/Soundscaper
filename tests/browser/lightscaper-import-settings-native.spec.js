/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { expect, test } from './helpers/browser-coverage-fixture.js';

test.use({ browserCoverage: false });
const ROOT = '/__lightscaper_import_settings_native__';

async function scenario(page, mode) {
	const [bundle, worker] = await Promise.all([
		build({ entryPoints: [fileURLToPath(new URL('../helpers/lightscaper-import-settings-native-fixture.ts', import.meta.url))],
			bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] }),
		build({ entryPoints: [fileURLToPath(new URL('../../src/common/editor/storage/opfs-sync-worker.ts', import.meta.url))],
			bundle: true, write: false, format: 'esm', platform: 'browser' }),
	]);
	await page.route(`${ROOT}/**`, async route => {
		const path = new URL(route.request().url()).pathname;
		const html = path === `${ROOT}/index.html`;
		if (!html && path !== `${ROOT}/entry.js` && path !== `${ROOT}/opfs-sync-worker.ts`) {
			await route.abort(); return;
		}
		await route.fulfill({ contentType: html ? 'text/html' : 'text/javascript', body: html
			? '<!doctype html><title>Native photo import settings qualification</title>'
			: path.endsWith('/opfs-sync-worker.ts') ? worker.outputFiles[0].text : bundle.outputFiles[0].text });
	});
	await page.goto(`${ROOT}/index.html`);
	return page.evaluate(async ({ root, mode }) => (await import(new URL(`${root}/entry.js`, location.href).href)).qualifyPhotoImportSettingsNativeV1(mode), { root: ROOT, mode });
}

test('native production session applies import settings, retains exact deduped originals and persists preset CAS across reopen', async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'WebKit Blob/OPFS catalog custody is deferred.');
	test.setTimeout(60_000);
	const result = await scenario(page, 'settings');
	expect(result.first.map(item => [item.index, item.fileName, item.status])).toEqual([
		[0, result.sourceName, 'imported'], [1, 'Broken.PNG', 'failed'], [2, result.sourceName, 'imported'],
	]);
	expect(result.acknowledged.map(item => item.index)).toEqual([0, 2]);
	expect(result.first.filter(item => item.status === 'imported').map(item => item.reusedOriginal)).toEqual([false, true]);
	expect(result.second[0].status).toBe('imported'); expect(result.unmodified[0].status).toBe('imported');
	expect(result.selectedNames).toEqual([result.sourceName, 'Broken.PNG', result.sourceName]);
	expect(result.before.photoCount).toBe(4); expect(result.before.intent).toBe(false); expect(result.before.stagedIds).toEqual([]);
	expect(result.before.photos.map(photo => photo.metadata.fileName)).toEqual(['Original ÉTÉ-0007.png', 'Original ÉTÉ-0009.png', 'Second-11.png', result.sourceName]);
	const [first, third, second, plain] = result.before.photos;
	for (const photo of [first, third]) {
		expect(photo.metadata).toMatchObject({ title: 'Authored title', creator: '', location: 'Berlin', caption: 'Source caption', copyright: 'Source rights' });
		expect(photo.keywordIds).toEqual([result.keywordId]);
	}
	expect(second.metadata).toMatchObject({ title: '', caption: '', creator: 'Authored creator', copyright: 'Authored rights', location: '' });
	expect(plain.metadata).toMatchObject({ title: '', caption: 'Source caption', creator: 'Source creator', copyright: 'Source rights', location: '' });
	expect(plain.keywordIds).toEqual([]);
	expect(new Set(result.before.photos.map(photo => photo.original.storageKey)).size).toBe(1);
	preserveSources(result, result.before.photos); expect(result.after).toEqual(result.before);
	expect(result.saved.revision).toBe(1); expect(result.reopenedPresets).toEqual(result.saved);
	expect(result.deleted).toEqual({ revision: 2, presets: [] }); expect(result.emptyPresets).toEqual(result.deleted);
	expect(result.staleMessage).toMatch(/keyword/i); expect(result.bodyReads).toBe(0);
});

test('native acknowledged cancellation retains the first photo and same-session recovery settles custody before another import', async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'WebKit Blob/OPFS catalog custody is deferred.');
	test.setTimeout(60_000);
	const result = await scenario(page, 'cancel-recovery');
	expect(result.interruption).toBe('AbortError');
	expect(result.acknowledged).toHaveLength(1); expect(result.acknowledged[0]).toMatchObject({ index: 0, fileName: result.sourceName, status: 'imported' });
	expect(result.interrupted.photoCount).toBe(1); expect(result.interrupted.intent).toBe(true);
	expect(result.interrupted.stagedIds).toEqual([result.acknowledged[0].photoId]);
	expect(result.recoveredPage.totalCount).toBe(1); expect(result.recovered.intent).toBe(false); expect(result.recovered.stagedIds).toEqual([]);
	expect(result.recovered.permanentIds).toEqual([result.acknowledged[0].photoId]);
	expect(result.next[0]).toMatchObject({ index: 0, status: 'imported', reusedOriginal: true });
	expect(result.sameSession.photoCount).toBe(2); expect(result.sameSession.intent).toBe(false); expect(result.sameSession.stagedIds).toEqual([]);
	expect(result.sameSession.photos.map(photo => photo.metadata.fileName)).toEqual(['Original ÉTÉ-0007.png', 'Recovered-20.png']);
	expect(result.reopenedPage.totalCount).toBe(2); expect(result.reopened).toEqual(result.sameSession);
	preserveSources(result, result.reopened.photos);
});

function preserveSources(result, photos) {
	expect(result.sourceFacts.exif).toMatchObject({ artist: 'Source creator', description: 'Source caption', copyright: 'Source rights',
		captureTime: { local: '2026-10-08T11:12:13', offsetMinutes: null } });
	for (const photo of photos) {
		expect(photo.original.name).toBe(result.sourceName); expect(photo.original.byteLength).toBe(result.sourceBytes.length);
		expect(photo.original.contentSha256).toBe(result.sourceSha256); expect(photo.actualSha256).toBe(result.sourceSha256);
		expect(photo.actualBytes).toEqual(result.sourceBytes); expect(photo.extractedMetadata).toEqual(result.sourceFacts);
		expect(photo.metadata.captureTime).toEqual({ local: '2026-10-08T11:12:13.000', offsetMinutes: null });
		expect(photo.metadata.cameraMake).toBe('Native camera'); expect(photo.metadata.orientation).toBe(1);
		expect(photo.versions).toHaveLength(1); expect(photo.versions[0].kind).toBe('master'); expect(photo.activeVersionId).toBe(photo.versions[0].id);
	}
}

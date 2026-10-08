/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import { EDITOR_ENGLISH_COPY, EDITOR_GERMAN_COPY } from '../src/common/i18n/editor-copy-inventory.ts';
import { SITE_COPY_BY_LOCALE } from '../src/common/i18n/site-copy.js';
import { LIGHTSCAPER_EDITOR_COPY_BY_LOCALE, bundledLightscaperEditorCopyForLocale } from '../src/common/i18n/lightscaper-editor-copy.ts';
import { loadTranslationCatalog } from '../src/common/i18n/translation-catalog.js';
import { translateLocale } from '../scripts/i18n-ai/workflows.mjs';
import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';

const KEYS = Object.freeze([
	'photoFileMenu', 'photoViewMenu', 'photoShowLibrary', 'photoHideLibrary', 'photoEmptyLibrary', 'photoMenuLabel',
	'photoImportPhotos', 'photoChooseFiles', 'photoImportAction', 'photoCancelAction', 'photoFirstPage', 'photoNextPage',
	'photoPhotoMenu', 'photoRateStars', 'photoRating', 'photoFlag', 'photoUnflagged', 'photoPick', 'photoReject',
	'photoColorLabel', 'photoColorNone', 'photoColorRed', 'photoColorYellow', 'photoColorGreen', 'photoColorBlue',
	'photoColorPurple', 'photoWorking', 'photoImported', 'photoImportFailed', 'photoEditMetadata', 'photoFileName',
	'photoMetadataTitle', 'photoCaption', 'photoCreator', 'photoCopyright', 'photoLocation', 'photoCaptureTime',
	'photoCaptureOffset', 'photoSaveMetadata', 'photoCloseMetadata', 'photoOriginalMetadata', 'photoNoSourceMetadata',
	'photoCamera', 'photoLens', 'photoKeywords', 'photoMetadataNotice',
] as const);

test('the lazy photo source preserves every corrected English and German flat identity', () => {
	const copy = LIGHTSCAPER_EDITOR_COPY_BY_LOCALE;
	assert.deepEqual(Object.keys(copy.en).slice(0, KEYS.length), KEYS);
	assert.deepEqual(Object.keys(copy.de), Object.keys(copy.en));
	// Snapshot of the corrected source at 0f175d60a, before the ownership move.
	const snapshot = JSON.stringify(KEYS.map(key => [key, copy.en[key], copy.de[key]]));
	assert.equal(createHash('sha256').update(snapshot).digest('hex'), '2a3cf1bcafbd5adad36ff987d1cfe92bd1cf3d358854846928447f976a37e5b6');
	for (const key of Object.keys(copy.en) as (keyof typeof copy.en)[]) {
		assert.equal(ENGLISH_COPY[key], copy.en[key], key);
		assert.equal(GERMAN_COPY[key], copy.de[key], key);
		assert.equal(EDITOR_ENGLISH_COPY[key], copy.en[key], key);
		assert.equal(EDITOR_GERMAN_COPY[key], copy.de[key], key);
		assert.equal(Object.hasOwn(SITE_COPY_BY_LOCALE.en, key), false, key);
		assert.equal(Object.hasOwn(SITE_COPY_BY_LOCALE.de, key), false, key);
	}
	for (const key of ['lightscaperTitle', 'lightscaperMetaDescription', 'photoEditor', 'workspacePhoto']) {
		assert.equal(Object.hasOwn(SITE_COPY_BY_LOCALE.en, key), true, key);
		assert.equal(Object.hasOwn(SITE_COPY_BY_LOCALE.de, key), true, key);
	}
	assert.ok(Object.isFrozen(copy) && Object.isFrozen(copy.en) && Object.isFrozen(copy.de));
	assert.equal(bundledLightscaperEditorCopyForLocale('de-AT'), copy.de);
	assert.equal(bundledLightscaperEditorCopyForLocale('fr'), copy.en);
});

test('the shared committed catalog loader accepts the same flat keys and filters stale or unrelated entries', async () => {
	const englishCopy = LIGHTSCAPER_EDITOR_COPY_BY_LOCALE.en;
	const entries = await loadTranslationCatalog('fr', { englishCopy, loaders: {
		fr: async () => ({ schemaVersion: 2, locale: 'fr', entries: {
			photoRateStars: ['human', englishCopy.photoRateStars, 'Noter {count} étoiles'],
			photoFileMenu: ['machine', englishCopy.photoFileMenu, 'Fichier'],
			photoCaption: ['audacity', englishCopy.photoCaption, 'Description'],
			photoEditMetadata: ['human', 'Edit metadata (old)', 'Modifier les métadonnées'],
			photoSaveMetadata: ['machine', englishCopy.photoSaveMetadata, 'Enregistrer…'],
			fileMenu: ['human', 'File', 'Une autre commande'],
		} }),
	} });
	assert.deepEqual(entries, { photoRateStars: 'Noter {count} étoiles', photoFileMenu: 'Fichier', photoCaption: 'Description' });
});

test('the automatic writer discovers moved photo strings through its default inventory', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'lightscaper-copy-writer-'));
	const packets: { messages: Record<string, string>; reference: Record<string, string> }[] = [];
	try {
		const summary = await translateLocale({ locale: 'fr', directory, keys: ['photoRateStars'],
			client: {
				identity: async () => ({ model: 'test', digest: 'sha256:test' }),
				generateJson: async (request: { prompt: string }) => {
					const packet = JSON.parse(request.prompt) as typeof packets[number];
					packets.push(packet);
					return { locale: 'fr', translations: { photoRateStars: 'Noter {count} étoiles' } };
				},
			},
		});
		assert.equal(summary.translated, 1);
		assert.deepEqual(packets[0]?.messages, { photoRateStars: LIGHTSCAPER_EDITOR_COPY_BY_LOCALE.en.photoRateStars });
		assert.deepEqual(packets[0]?.reference, { photoRateStars: LIGHTSCAPER_EDITOR_COPY_BY_LOCALE.de.photoRateStars });
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test('site static ownership excludes the lazy photo source and the photo hook excludes complete timeline catalogs', async () => {
	const root = fileURLToPath(new URL('../', import.meta.url));
	const site = await closure(root, ['src/common/site/App.jsx', 'src/common/site/use-site-copy.js']);
	assert.ok(!site.has(resolve(root, 'src/common/i18n/lightscaper-editor-copy.ts')));
	assert.ok(!site.has(resolve(root, 'src/common/editor/ui/lightscaper/use-lightscaper-editor-copy.ts')));
	const photo = await closure(root, ['src/common/editor/ui/lightscaper/use-lightscaper-editor-copy.ts']);
	assert.ok(photo.has(resolve(root, 'src/common/i18n/lightscaper-editor-copy.ts')));
	for (const path of photo) {
		assert.doesNotMatch(path, /\/i18n\/(?:catalogs\.js|editor-copy-inventory\.ts|runtime\.js|editor-(?:soundscaper|framescaper)-[^/]+\.ts)$/u, path);
	}
});

test('the photo copy and hook have one semantic owner while existing editor groups remain unchanged', () => {
	for (const separator of ['/', '\\']) {
		for (const path of ['src/common/i18n/lightscaper-editor-copy.ts', 'src/common/editor/ui/lightscaper/use-lightscaper-editor-copy.ts']) {
			assert.equal(chunkGroupForModulePath(path.replaceAll('/', separator)), 'lightscaper-editor-copy', path);
		}
	}
	assert.equal(chunkGroupForModulePath('src/common/editor/ui/lightscaper/LightscaperApp.tsx'), null);
	assert.equal(chunkGroupForModulePath('src/common/editor/ui/AudioEditorMenuBar.jsx'), 'editor-shell');
	assert.equal(chunkGroupForModulePath('src/common/editor/ui/AudioEditorDialogShell.tsx'), 'editor-dialog-foundations');
});

async function closure(root: string, entries: readonly string[]): Promise<ReadonlySet<string>> {
	const pending = entries.map(entry => resolve(root, entry));
	const paths = new Set<string>();
	while (pending.length) {
		const path = pending.pop()!;
		if (paths.has(path)) continue;
		paths.add(path);
		let source: string;
		try { source = await readFile(path, 'utf8'); } catch { continue; }
		for (const match of source.matchAll(/\b(?:from|import)\s*['"](\.{1,2}\/[^'"]+)['"]/gu)) {
			pending.push(resolve(dirname(path), match[1]!));
		}
	}
	return paths;
}

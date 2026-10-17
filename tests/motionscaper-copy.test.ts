/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { EDITOR_ENGLISH_COPY, EDITOR_GERMAN_COPY, getEditorCopyMetadata } from '../src/common/i18n/editor-copy-inventory.ts';
import { MOTIONSCAPER_CANONICAL_ENGLISH_COPY, resolveMotionscaperCopy } from '../src/common/i18n/editor-motionscaper-copy.ts';
import { VIDEO_EFFECT_COPY_BY_LOCALE } from '../src/common/i18n/video-effect-copy.js';
import { loadTranslationCatalog } from '../src/common/i18n/translation-catalog.js';
import { motionscaperCopy } from '../src/common/editor/ui/motionscaper/motionscaper-copy.ts';

const motionOwners = ['motionscaper', 'motionscaper-ae', 'motionscaper-appearance', 'motionscaper-canvas',
	'motionscaper-import', 'motionscaper-link', 'motionscaper-queue', 'motionscaper-scene',
	'motionscaper-tracking', 'motionscaper-updates'];
const registeredMotionEntries = Object.values(getEditorCopyMetadata())
	.filter(({ owner }) => owner === 'motionscaper' || owner.startsWith('motionscaper-'));

async function loadFrench(entries: Readonly<Record<string, readonly [string, string, string]>>): Promise<Readonly<Record<string, string>>> {
	let calls = 0;
	const translated = await loadTranslationCatalog('fr', {
		englishCopy: MOTIONSCAPER_CANONICAL_ENGLISH_COPY,
		loaders: { fr: async () => {
			calls += 1;
			return { default: { schemaVersion: 2, locale: 'fr', entries } };
		} },
	});
	assert.equal(calls, 1);
	assert.ok(translated);
	return translated;
}

test('Motionscaper owned copy participates in canonical translation generation and scoped overrides', () => {
	const key = 'ui.motionscaper.motionscaperNewComposition';
	assert.equal(EDITOR_ENGLISH_COPY[key], 'New Composition');
	assert.equal(EDITOR_GERMAN_COPY[key], 'Neue Komposition');
	assert.equal(MOTIONSCAPER_CANONICAL_ENGLISH_COPY[key], EDITOR_ENGLISH_COPY[key]);
	assert.equal(resolveMotionscaperCopy('de-DE').motionscaperNewComposition, 'Neue Komposition');
	assert.equal(resolveMotionscaperCopy('fr', { [key]: 'Nouvelle composition' }).motionscaperNewComposition, 'Nouvelle composition');
	assert.equal(resolveMotionscaperCopy('fr').motionscaperNewComposition, 'New Composition');
});

test('Motionscaper bootstrap reference admits current French base, scene, queue and shared effects through the loader', async () => {
	const examples = [
		['ui.motionscaper.motionscaperNewComposition', 'Nouvelle composition', 'motionscaperNewComposition'],
		['ui.motionscaper-scene.motionscaperSceneAddCamera', 'Ajouter une caméra', 'motionscaperSceneAddCamera'],
		['ui.motionscaper-queue.motionscaperQueueCompleted', 'Terminé', 'motionscaperQueueCompleted'],
		['videoEffectGlow', 'Lueur', 'videoEffectGlow'],
	] as const;
	const entries = Object.fromEntries(examples.map(([key, target]) => [key, ['machine', EDITOR_ENGLISH_COPY[key]!, target] as const]));
	const translated = await loadFrench(entries);
	const copy = motionscaperCopy('fr', translated);
	for (const [key, target, localKey] of examples) {
		assert.equal(translated[key], target, `Current catalog entry rejected: ${key}`);
		assert.equal(copy[localKey], target, `Loaded entry did not reach the normal resolver: ${key}`);
	}
});

test('Motionscaper catalog reference covers every registered Motion owner and only the consumed shared effect keys', async () => {
	assert.deepEqual([...new Set(registeredMotionEntries.map(({ owner }) => owner))].sort(), motionOwners);
	const expected = Object.fromEntries<string>([
		...registeredMotionEntries.map(({ key, source }) => [key, source] as const),
		...Object.entries(VIDEO_EFFECT_COPY_BY_LOCALE.en),
	]);
	assert.deepEqual(Object.keys(MOTIONSCAPER_CANONICAL_ENGLISH_COPY).sort(), Object.keys(expected).sort());
	for (const [key, source] of Object.entries(expected)) {
		assert.equal(MOTIONSCAPER_CANONICAL_ENGLISH_COPY[key], source);
		assert.equal(EDITOR_ENGLISH_COPY[key], source, `Reference differs from the registered English: ${key}`);
	}
	const entries = Object.fromEntries(Object.entries(expected).map(([key, source]) =>
		[key, ['human', source, `Français : ${source}`] as const]));
	const translated = await loadFrench(entries);
	assert.deepEqual(translated, Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, entry[2]])));
	const copy = motionscaperCopy('fr', translated);
	for (const [key, entry] of Object.entries(entries)) {
		const localKey = key.startsWith('ui.') ? key.slice(key.lastIndexOf('.') + 1) : key;
		assert.equal(copy[localKey], entry[2], `Registered copy was lost before display: ${key}`);
	}
});

test('Motionscaper catalog still rejects stale English, unknown names and other products while resolving fallback copy', async () => {
	const staleKeys = ['ui.motionscaper.motionscaperNewComposition',
		'ui.motionscaper-scene.motionscaperSceneAddCamera', 'videoEffectGlow'] as const;
	const foreign = Object.values(getEditorCopyMetadata()).find(({ owner }) => owner === 'soundscaperNative');
	assert.ok(foreign);
	const currentKey = 'ui.motionscaper.motionscaperHelpMenu';
	const translated = await loadFrench({
		...Object.fromEntries(staleKeys.map((key) => [key, ['machine', `Old ${EDITOR_ENGLISH_COPY[key]!}`, 'Ancienne traduction'] as const])),
		[currentKey]: ['human', EDITOR_ENGLISH_COPY[currentKey]!, 'Aide'],
		[foreign.key]: ['machine', foreign.source, `Français : ${foreign.source}`],
		'ui.motionscaper-scene.notRegistered': ['human', 'Unknown', 'Inconnu'],
		'ui.editor.videoEffectGlow': ['human', VIDEO_EFFECT_COPY_BY_LOCALE.en.videoEffectGlow, 'Alias non enregistré'],
	});
	assert.deepEqual(translated, { [currentKey]: 'Aide' });
	const copy = motionscaperCopy('fr', translated);
	assert.equal(copy.motionscaperHelpMenu, 'Aide');
	for (const key of staleKeys) {
		const localKey = key.startsWith('ui.') ? key.slice(key.lastIndexOf('.') + 1) : key;
		assert.equal(copy[localKey], EDITOR_ENGLISH_COPY[key]);
	}
});

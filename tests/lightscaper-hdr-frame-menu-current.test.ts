/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { createApplicationMenuProductItems } from '../src/common/editor/ui/application-menu-product-items.js';
import { filterProductMenus } from '../src/common/editor/ui/application-menu-product-filter.js';
import { EDITOR_ENGLISH_COPY } from '../src/common/i18n/editor-copy-inventory.ts';
import { cloneFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { editableImageFixture } from './helpers/framescaper-editable-image-current-fixture.ts';

const MENU = new URL('../src/common/editor/ui/framescaper-image-hdr-merge-menu-current-v1.ts', import.meta.url);
interface Item { readonly id: string; readonly label: string; readonly disabled: boolean; onClick(): unknown }
interface Input { readonly productId: string; readonly project: unknown; readonly editingBlocked: boolean; readonly readOnly?: boolean; readonly locale?: string }
interface Module { createFramescaperImageHdrMergeMenuItemsCurrentV1(input: Readonly<Input>, open?: () => unknown): readonly Item[] }
async function module(): Promise<Module> {
	assert.ok(existsSync(MENU), 'The Frame HDR menu owner is missing.');
	return await import(MENU.href) as Module;
}
function bracket() {
	const f = editableImageFixture(), source = { ...f.source, id: 'second-source', storageKey: 'second-source' }, clip = { ...f.clip, id: 'second-clip', sourceId: source.id, sequenceStartFrame: 1 };
	const added = applyFramescaperProjectCommand(PROFILE, f.project(), { type: 'batch', commands: [
		{ type: 'image-source/set', sourceId: source.id, expectedSource: null, source },
		{ type: 'image-clip/set', clipId: clip.id, expectedClip: null, expectedPlacement: null, clip, placement: { scope: 'timeline', trackId: 'video-track' } },
	] });
	return cloneFramescaperProject(PROFILE, { ...added, selection: { ...added.selection, clipIds: [f.clip.id, clip.id] } });
}

for (const [locale, label] of [['en', 'Merge HDR…'], ['de', 'HDR zusammenfügen…']] as const) test(`${locale}: the actual Frame Effect menu retains opted-in HDR creation for a selected bracket`, () => {
	const project = bracket(), calls: string[] = [];
	const items = createApplicationMenuProductItems({ productId: 'framescaper', capabilities: {}, project, snapshot: { readOnly: false }, editBlocked: false,
		copy: EDITOR_ENGLISH_COPY, locale, actions: { openFramescaperImageHdrMerge: () => { calls.push('opened'); } } });
	const entry = (items.effect as readonly Item[]).find(value => value.id === 'image-hdr-merge');
	assert.ok(entry, 'HDR must be reachable through the existing Frame Effect menu.');
	assert.equal(entry.label, label); assert.equal(entry.disabled, false);
	const filtered = filterProductMenus([{ id: 'effect', items: [entry] }], { audioEffects: false }, 'framescaper') as readonly { readonly items: readonly Item[] }[];
	assert.equal(filtered[0]?.items[0], entry); entry.onClick(); assert.deepEqual(calls, ['opened']);
});

test('Frame HDR menu requires distinct opaque static Originals and equal extents before opening', async () => {
	const api = await module(), project = bracket(); let calls = 0;
	const image = project.sources.find(source => source.kind === 'image'); assert.ok(image);
	const base = { productId: 'framescaper', project, editingBlocked: false };
	for (const input of [
		{ ...base, editingBlocked: true }, { ...base, readOnly: true },
		{ ...base, project: { ...project, selection: { ...project.selection, clipIds: [project.clips[0]!.id] } } },
		{ ...base, project: { ...project, selection: { ...project.selection, clipIds: [project.clips[0]!.id, project.clips[0]!.id] } } },
		{ ...base, project: { ...project, clips: project.clips.map(clip => ({ ...clip, sourceId: project.clips[0]!.sourceId })) } },
		...[{ schemaVersion: 5 }, { canonical: { ...image.canonical, hasAlpha: true } },
			{ canonical: { ...image.canonical, frameCount: 2 } }, { canonical: { ...image.canonical, width: 3 } },
			{ original: { ...image.original, byteLength: 64 * 1024 * 1024 + 1 } }].map(change => ({ ...base,
			project: { ...project, sources: project.sources.map((source, index) => index === 0 ? { ...source, ...change } : source) } })),
	]) {
		const entry = api.createFramescaperImageHdrMergeMenuItemsCurrentV1(input, () => { calls++; })[0];
		assert.ok(entry); assert.equal(entry.disabled, true); entry.onClick();
	}
	assert.equal(calls, 0);
	const unavailable = api.createFramescaperImageHdrMergeMenuItemsCurrentV1(base)[0]; assert.ok(unavailable); assert.equal(unavailable.disabled, true);
	assert.deepEqual(api.createFramescaperImageHdrMergeMenuItemsCurrentV1({ ...base, productId: 'soundscaper' }, () => { calls++; }), []);
});

test('Frame HDR reads locked bracket sources and creates a fresh result rather than editing those clips', async () => {
	const api = await module(), project = bracket(); let calls = 0;
	const entry = api.createFramescaperImageHdrMergeMenuItemsCurrentV1({ productId: 'framescaper', editingBlocked: false,
		project: { ...project, tracks: project.tracks.map(track => ({ ...track, locked: true })) } }, () => { calls++; })[0];
	assert.ok(entry); assert.equal(entry.disabled, false); entry.onClick(); assert.equal(calls, 1);
});

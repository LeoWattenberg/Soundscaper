/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createApplicationMenuProductItems } from '../src/common/editor/ui/application-menu-product-items.js';
import { EDITOR_ENGLISH_COPY } from '../src/common/i18n/editor-copy-inventory.ts';
import { editableImageFixture } from './helpers/framescaper-editable-image-current-fixture.ts';
import { createFramescaperImageDevelopMenuItemsV1 } from '../src/common/editor/ui/framescaper-image-develop-menu-v1.ts';
import { filterProductMenus } from '../src/common/editor/ui/application-menu-product-filter.js';
import { createProductWorkspaceApplicationMenuRuntime } from '../src/common/editor/ui/workspace/workspace-product-application-menu-runtime.ts';
import { bindFramescaperImageDevelopAuthoringCurrentV1 } from '../src/framescaper/editor-selected-timeline-image-develop-authoring-controller-v1.ts';

interface Item { readonly id?: string; readonly disabled?: boolean; readonly items?: readonly Item[]; readonly onClick?: () => unknown; }
function flatten(items: readonly Item[]): Item[] { return items.flatMap(item => [item, ...flatten(item.items ?? [])]); }

test('the actual workspace action dispatches every Frame image menu kind and fences blocked edits', () => {
	const f = editableImageFixture(), opened: string[] = [], controller = { project: f.project(),
		getSnapshot: () => ({ selectedClipId: f.clip.id, readOnly: false }), actions: { edit: { commit: () => assert.fail('Menu dispatch cannot edit.') } } };
	bindFramescaperImageDevelopAuthoringCurrentV1({ controller, store: f.store });
	for (const [editingBlocked, readOnly] of [[false, false], [true, false], [false, true]]) {
		const runtime = createProductWorkspaceApplicationMenuRuntime({ controller, productId: 'framescaper', copy: {}, project: controller.project,
			projectCapabilities: {}, editingBlocked: Boolean(editingBlocked), readOnly: Boolean(readOnly), run: operation => operation(), openSurface: surface => { opened.push(surface); } });
		const open = runtime.openFramescaperImageDevelop; assert.equal(typeof open, 'function'); opened.length = 0;
		const entries = createFramescaperImageDevelopMenuItemsV1({ productId: 'framescaper', project: controller.project, selectedClipId: f.clip.id, editingBlocked: false },
			kind => Reflect.apply(open as (kind: string) => unknown, runtime, [kind]));
		for (const entry of entries) entry.onClick();
		assert.deepEqual(opened, editingBlocked || readOnly ? [] : ['image-develop-repairs', 'image-develop-masks', 'image-develop-brush']);
	}
});

test('actual Frame Effect menu opens Repair spots for its selected static editable image', () => {
	const f = editableImageFixture(), opened: string[] = [];
	const items = createApplicationMenuProductItems({ productId: 'framescaper', capabilities: {}, project: f.project(),
		snapshot: { selectedClipId: f.clip.id, readOnly: false }, editBlocked: false, copy: EDITOR_ENGLISH_COPY,
		actions: { openFramescaperImageDevelop: (kind: string) => { opened.push(kind); } } });
	const entry = flatten(items.effect as readonly Item[]).find(item => item.id === 'image-develop-repairs');
	assert.ok(entry, 'The actual selected-image Repair entry must exist in the existing Effect menu.');
	assert.equal(entry.disabled, false); entry.onClick?.(); assert.deepEqual(opened, ['repairs']);
});

test('the final product menu filter retains all image editors when Frame has no audio effects', () => {
	const f = editableImageFixture(), effect = createFramescaperImageDevelopMenuItemsV1({ productId: 'framescaper', project: f.project(),
		selectedClipId: f.clip.id, editingBlocked: false }, () => undefined);
	const menus = filterProductMenus([{ id: 'effect', items: effect }], { audioEffects: false }, 'framescaper') as readonly { readonly items: readonly Item[] }[];
	assert.deepEqual(menus.flatMap(menu => menu.items.map(item => item.id)), ['image-develop-repairs', 'image-develop-masks', 'image-develop-brush']);
});

test('Frame image Develop menus offer localized opt-in entries for timeline and Bin selections', () => {
	const f = editableImageFixture();
	for (const bin of [false, true]) {
		const calls: string[] = [], entries = createFramescaperImageDevelopMenuItemsV1({ productId: 'framescaper', project: f.project(bin),
			selectedClipId: f.clip.id, editingBlocked: false, locale: 'de-DE' }, kind => calls.push(kind));
		assert.deepEqual(entries.map(item => [item.id, item.label, item.disabled]), [
			['image-develop-repairs', 'Reparaturpunkte…', false], ['image-develop-masks', 'Bildmasken verwalten…', false], ['image-develop-brush', 'Pinselmaske…', false],
		]); for (const entry of entries) entry.onClick(); assert.deepEqual(calls, ['repairs', 'masks', 'brush']);
	}
});
test('unavailable, stale, locked and read-only image menu handlers cannot open a surface', () => {
	const f = editableImageFixture(), project = f.project(); let calls = 0;
	const base = { productId: 'framescaper', project, selectedClipId: f.clip.id, editingBlocked: false };
	for (const input of [{ ...base, editingBlocked: true }, { ...base, readOnly: true }, { ...base, selectedClipId: 'gone' },
		{ ...base, project: { ...project, tracks: project.tracks.map(track => ({ ...track, locked: true })) } },
		{ ...base, project: { ...project, sources: project.sources.map(source => ({ ...source, canonical: { ...f.source.canonical, frameCount: 2 } })) } }]) {
		const entries = createFramescaperImageDevelopMenuItemsV1(input, () => { calls++; });
		assert.equal(entries.length, 3); for (const entry of entries) { assert.equal(entry.disabled, true); entry.onClick(); }
	}
	for (const entry of createFramescaperImageDevelopMenuItemsV1(base)) { assert.equal(entry.disabled, true); entry.onClick(); }
	assert.equal(calls, 0);
	assert.deepEqual(createFramescaperImageDevelopMenuItemsV1({ ...base, productId: 'soundscaper' }, () => { calls++; }), []);
});

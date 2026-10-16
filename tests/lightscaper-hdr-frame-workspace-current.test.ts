/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceApplicationMenus } from '../src/common/editor/ui/workspace/workspace-application-menu-runtime.js';
import { createProductWorkspaceApplicationMenuRuntime } from '../src/common/editor/ui/workspace/workspace-product-application-menu-runtime.ts';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { EDITOR_ENGLISH_COPY } from '../src/common/i18n/editor-copy-inventory.ts';
import { cloneFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { bindFramescaperImageHdrMergeCurrentV1 } from '../src/framescaper/editor-selected-image-hdr-merge-current-v1.ts';
import { editableImageFixture } from './helpers/framescaper-editable-image-current-fixture.ts';

interface Item { readonly id?: string; readonly disabled?: boolean; readonly items?: readonly Item[]; readonly onClick?: () => unknown }
function flatten(items: readonly Item[]): Item[] { return items.flatMap(item => [item, ...flatten(item.items ?? [])]); }
function fixture() {
	const f = editableImageFixture(), base = f.project(), source = { ...f.source, id: 'second-source', storageKey: 'second-source' }, clip = { ...f.clip, id: 'second-clip', sourceId: source.id };
	const project = cloneFramescaperProject(PROFILE, { ...base, sources: [...base.sources, source], clips: [...base.clips, clip],
		tracks: base.tracks.map(track => Array.isArray(track.clipIds) && track.clipIds.includes(f.clip.id) ? { ...track, clipIds: [...track.clipIds, clip.id] } : track),
		selection: { ...base.selection, clipIds: [f.clip.id, clip.id] } });
	let readOnly = false, importing = false;
	const controller = { project, getSnapshot: () => ({ readOnly, importing }), actions: { project: { async openById() { assert.fail('Menu dispatch cannot adopt a project.'); } } } };
	bindFramescaperImageHdrMergeCurrentV1({ controller, store: { async loadMediaAsset() { assert.fail('Menu dispatch cannot load pixels.'); } },
		prepareCurrentProject() { assert.fail('Menu dispatch cannot prepare publication.'); },
		session: { captureProjectHistory() { assert.fail('Menu dispatch cannot capture publication history.'); }, assertProjectHistoryToken() { assert.fail('Menu dispatch cannot adopt history.'); },
			updateProjectHistory() { assert.fail('Menu dispatch cannot change history.'); }, markProjectSaved() { assert.fail('Menu dispatch cannot save.'); }, getProjectHistory() { assert.fail('Menu dispatch cannot read publication history.'); } },
		executeCommand() { assert.fail('Menu dispatch cannot edit the project.'); },
		async publishIfCurrent() { assert.fail('Menu dispatch cannot publish.'); },
	});
	return { controller, project, readOnly(value: boolean) { readOnly = value; }, importing(value: boolean) { importing = value; } };
}

test('the complete workspace menu assembly forwards the native HDR action into Frame Effect', () => {
	const f = fixture(), opened: string[] = [], noop = () => undefined;
	const input = { productId: 'framescaper', capabilities: { audioEffects: false }, locale: 'en', copy: EDITOR_ENGLISH_COPY, project: f.project, controller: f.controller,
		snapshot: { project: f.project, selectedClipId: f.project.selection.clipIds[0], preferences: { workspace: { activeId: 'editing', custom: [],
			panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map(id => [id, { visible: false }])) }, view: {} }, history: { canUndo: false, canRedo: false }, effects: { selectionTypes: [] } },
		blocked: false, editBlocked: false, handoffBlocked: false, showArmControls: false, selectionActive: true, selectedClip: f.project.clips[0], durationFrames: 10,
		projectBinEffectivelyOpen: false, uiFlags: {}, fileService: { isDesktop: false }, parityRuntime: { actions: null }, run: (operation: () => unknown) => operation(),
		openSurface: (surface: string) => { opened.push(surface); } };
	const menus = createWorkspaceApplicationMenus(new Proxy(input, { get: (target, key, receiver) => Reflect.get(target, key, receiver) ?? noop }) as never) as readonly Item[];
	const effect = menus.find(menu => menu.id === 'effect'); assert.ok(effect);
	const hdr = flatten(effect.items ?? []).find(item => item.id === 'image-hdr-merge'); assert.ok(hdr);
	assert.equal(hdr.disabled, false); hdr.onClick?.(); assert.deepEqual(opened, ['image-hdr-merge']);
});

test('retained workspace HDR actions become inert after selection, authority or project Close changes', () => {
	const f = fixture(), opened: string[] = [];
	const runtime = createProductWorkspaceApplicationMenuRuntime({ controller: f.controller, productId: 'framescaper', copy: {}, project: f.project,
		projectCapabilities: {}, editingBlocked: false, readOnly: false, run: operation => operation(), openSurface: surface => { opened.push(surface); } });
	const open = runtime.openFramescaperImageHdrMerge; assert.equal(typeof open, 'function');
	const invoke = () => Reflect.apply(open as () => unknown, runtime, []);
	f.readOnly(true); invoke(); f.readOnly(false); f.importing(true); invoke(); f.importing(false);
	f.controller.project = cloneFramescaperProject(PROFILE, { ...f.project, selection: { ...f.project.selection, clipIds: [] } }); invoke();
	Object.assign(f.controller, { project: null }); assert.doesNotThrow(invoke); assert.deepEqual(opened, []);
});

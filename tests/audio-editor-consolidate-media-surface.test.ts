/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { EXPORT_MENU_COPY_BY_LOCALE } from '../src/common/i18n/export-menu-copy.js';
import {
	createProjectMediaActionGroup,
} from '../src/common/editor/controller/project-media-action-group.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';

interface MenuItem {
	readonly id: string;
	readonly label?: string;
	readonly disabled?: boolean;
	readonly onClick?: () => unknown;
	readonly items?: readonly MenuItem[];
}

const MEDIA = Uint8Array.from({ length: 64 }, (_value, index) => index);
const DIGEST = digestScapeBytes(MEDIA);

test('consolidate is reachable from the File menu and blocked on a read-only project', () => {
	let invoked = 0;
	const menus = createApplicationMenus(menuInput({
		editBlocked: false,
		actions: actionPorts({ consolidateMedia: () => { invoked += 1; } }),
	})) as readonly MenuItem[];
	const item = fileItem(menus, 'consolidate-media');
	assert.ok(item, 'a feature nobody can reach is not a feature');
	assert.equal(item.label, EXPORT_MENU_COPY_BY_LOCALE.en.consolidateMedia);
	assert.equal(item.disabled, false);
	item.onClick?.();
	assert.equal(invoked, 1);

	const blocked = createApplicationMenus(menuInput({
		editBlocked: true, actions: actionPorts({}),
	})) as readonly MenuItem[];
	// Consolidating writes to the project's media, so a project that cannot be
	// edited cannot be consolidated either.
	assert.equal(fileItem(blocked, 'consolidate-media')?.disabled, true);
});

test('the archive checksum entry is present and follows what the session actually wrote', () => {
	let invoked = 0;
	const withManifest = createApplicationMenus({
		...menuInput({
			editBlocked: false,
			actions: actionPorts({ saveArchiveManifest: () => { invoked += 1; } }),
		}),
		snapshot: {
			...menuInput({ editBlocked: false, actions: actionPorts({}) }).snapshot,
			archiveManifest: { manifest: { members: [] }, unavailable: null, fileName: 'p.scape' },
		},
	}) as readonly MenuItem[];
	const item = fileItem(withManifest, 'save-archive-manifest');
	assert.equal(item?.disabled, false);
	item?.onClick?.();
	assert.equal(invoked, 1);

	// A streamed save leaves no bytes to have measured, so there is nothing to
	// save and the entry says so by being unavailable rather than by failing.
	const streamed = createApplicationMenus({
		...menuInput({ editBlocked: false, actions: actionPorts({}) }),
		snapshot: {
			...menuInput({ editBlocked: false, actions: actionPorts({}) }).snapshot,
			archiveManifest: { manifest: null, unavailable: 'streamed', fileName: 'p.scape' },
		},
	}) as readonly MenuItem[];
	assert.equal(fileItem(streamed, 'save-archive-manifest')?.disabled, true);
	// And nothing written at all is the same unavailability.
	assert.equal(
		fileItem(createApplicationMenus(menuInput({
			editBlocked: false, actions: actionPorts({}),
		})) as readonly MenuItem[], 'save-archive-manifest')?.disabled,
		true,
	);
});

test('both locales name the command and its outcomes', () => {
	for (const locale of ['en', 'de'] as const) {
		const copy = EXPORT_MENU_COPY_BY_LOCALE[locale];
		for (const key of [
			'consolidateMedia', 'consolidatingMedia', 'consolidatedMedia', 'consolidatedMediaIncomplete',
			'saveArchiveManifest', 'archiveManifestSaved',
		]) {
			assert.equal(typeof copy[key], 'string', `${locale}.${key}`);
			assert.ok(copy[key].length > 0, `${locale}.${key}`);
		}
	}
});

test('the action publishes its report where the delivery report surface reads it', async () => {
	const state: Record<string, unknown> = {};
	const statuses: [string, string | undefined][] = [];
	let published = 0;
	const group = createProjectMediaActionGroup({
		state,
		getProject: () => ({
			id: 'project-1',
			sources: [{ id: 'linked', kind: 'audio' }],
			clips: [{ sourceId: 'linked' }],
		}),
		store: createStore(),
		publishDocumentSnapshot: () => { published += 1; },
		setStatus: (message, tone) => { statuses.push([message, tone]); },
		copy: EXPORT_MENU_COPY_BY_LOCALE.en,
	});

	const result = await group.consolidate();
	assert.equal(result?.run.complete, true);
	// The same session field the File > Delivery report entry reads: a
	// consolidate that left a source behind belongs on the surface that exists
	// for exactly that kind of omission.
	assert.equal(state.deliveryReport, result?.run.report);
	assert.ok(published > 0);
	assert.deepEqual(statuses.map(([message]) => message), [
		EXPORT_MENU_COPY_BY_LOCALE.en.consolidatingMedia,
		EXPORT_MENU_COPY_BY_LOCALE.en.consolidatedMedia,
	]);
	assert.equal(statuses.at(-1)?.[1], 'success');
});

test('an incomplete consolidate says so rather than reporting success', async () => {
	const state: Record<string, unknown> = {};
	const statuses: [string, string | undefined][] = [];
	const group = createProjectMediaActionGroup({
		state,
		getProject: () => ({
			id: 'project-1',
			sources: [{ id: 'linked', kind: 'audio' }],
			clips: [{ sourceId: 'linked' }],
		}),
		store: createStore({ unreachable: true }),
		setStatus: (message, tone) => { statuses.push([message, tone]); },
		copy: EXPORT_MENU_COPY_BY_LOCALE.en,
	});

	const result = await group.consolidate();
	assert.equal(result?.run.complete, false);
	assert.equal(statuses.at(-1)?.[0], EXPORT_MENU_COPY_BY_LOCALE.en.consolidatedMediaIncomplete);
	assert.equal(statuses.at(-1)?.[1], 'warning');
});

test('planning answers without copying, and a project with no store answers null', async () => {
	const store = createStore();
	const planned = await createProjectMediaActionGroup({
		state: {},
		getProject: () => ({
			id: 'project-1',
			sources: [{ id: 'linked', kind: 'audio' }],
			clips: [{ sourceId: 'linked' }],
		}),
		store,
	}).planConsolidate();
	assert.deepEqual(planned?.copy.map(({ sourceId }) => sourceId), ['linked']);

	const withoutStore = createProjectMediaActionGroup({
		state: {}, getProject: () => ({ id: 'project-1', sources: [], clips: [] }), store: null,
	});
	assert.equal(await withoutStore.consolidate(), null);
	assert.equal(await withoutStore.planConsolidate(), null);
});

function createStore(options: { unreachable?: boolean } = {}) {
	const written = new Map<string, Uint8Array>();
	return {
		async getLinkedOriginalBinding() {
			return {
				kind: 'audio',
				sourceId: 'linked',
				storageKey: 'linked/original',
				byteLength: MEDIA.byteLength,
				sha256: DIGEST,
				bindingToken: 'token-1',
			};
		},
		async resolveLinkedAudioOriginal() {
			if (options.unreachable) throw new Error('the drive is not plugged in');
			return { blob: new Blob([MEDIA.slice().buffer]) };
		},
		async resolveLinkedVideoOriginal() { return null; },
		async beginMediaAssetWrite(sourceId: string) {
			const collected: number[] = [];
			return {
				maximumChunkBytes: 1024,
				async write(bytes: Uint8Array) { collected.push(...bytes); },
				async commit() { written.set(sourceId, Uint8Array.from(collected)); return {}; },
				async abort() {},
			};
		},
		async loadMediaAsset(sourceId: string) {
			const bytes = written.get(sourceId);
			return bytes ? new Blob([bytes.slice().buffer]) : null;
		},
		async unlinkLinkedAudioOriginal() { return true; },
		async unlinkLinkedVideoOriginal() { return true; },
	} as never;
}

function fileItem(menus: readonly MenuItem[], id: string): MenuItem | null {
	const file = menus.find((menu) => menu.id === 'file');
	return file?.items?.find((item) => item.id === id) ?? null;
}

function menuInput({ editBlocked, actions }: Readonly<{ editBlocked: boolean; actions: object }>) {
	return {
		productId: 'soundscaper' as const,
		aboutLabel: 'About',
		capabilities: {},
		locale: 'en',
		copy: copyValues(),
		project: {
			id: 'project', sampleRate: 48_000, sources: [], clips: [],
			tracks: [{ id: 'audio-track', type: 'audio', locked: false, clipIds: [], hidden: false }],
			selection: null, loop: { enabled: false }, snap: { enabled: false, division: 'samples' },
		},
		snapshot: {
			selectedTrackId: 'audio-track',
			preferences: {
				workspace: {
					activeId: 'editing',
					custom: [],
					panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: false }])),
				},
				view: {},
			},
			history: { canUndo: false, canRedo: false, hasClipboard: false },
			effects: { selectionTypes: [], canRepeatLast: false },
		},
		blocked: false,
		editBlocked,
		handoffBlocked: false,
		showArmControls: false,
		selectionActive: false,
		selectedClip: null,
		playheadSample: 0,
		durationFrames: 0,
		effectsPanelOpen: false,
		projectBinEffectivelyOpen: false,
		uiFlags: {},
		actionRuntime: null,
		actions,
	};
}

function actionPorts(overrides: Readonly<Record<string, unknown>>): object {
	return new Proxy({ ...overrides }, {
		get(target, property, receiver) {
			return Reflect.has(target, property)
				? Reflect.get(target, property, receiver)
				: () => undefined;
		},
	});
}

function copyValues(): object {
	return new Proxy({ ...EXPORT_MENU_COPY_BY_LOCALE.en }, {
		get(target, property, receiver) {
			return Reflect.has(target, property)
				? Reflect.get(target, property, receiver)
				: String(property);
		},
	});
}

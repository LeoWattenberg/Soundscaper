/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import LightscaperApp from '../src/common/editor/ui/lightscaper/LightscaperApp.tsx';
import PhotoDevelopWorkspace from '../src/common/editor/ui/lightscaper/PhotoDevelopWorkspace.tsx';
import { withPhotoDevelopProxyV1 } from '../src/lightscaper/controller/photo-develop-proxy-v1.ts';
import { photoDevelopMenuLabel } from '../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { bundledLightscaperEditorCopyForLocale } from '../src/common/i18n/lightscaper-editor-copy.ts';
import type { PhotoLibraryDevelopApplyV1, PhotoLibraryDevelopSnapshotV1, PhotoLibraryDevelopPortV1 } from '../src/common/editor/photo-library-develop-port-v1.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { surveyAppOwner } from './helpers/lightscaper-survey-app-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { settle } from './helpers/async-test-control.ts';
import { deferred } from './helpers/async-test-control.ts';
import type { ExecutePhotoDevelopV1 } from '../src/common/editor/controller/shared/photo-library-develop-workflow-v1.ts';

const document: PhotoLibraryDevelopSnapshotV1 = { schemaVersion: 1, photoId: 'a', revision: 5, activeVersionId: 'master', versionId: 'master',
	versions: [{ id: 'master', name: 'Original', kind: 'master' }], history: { cursor: 0, entries: [{ index: 0, label: 'Initial', createdAt: null }] }, snapshots: [],
	develop: { processVersion: 1, effects: [], masks: [], maskBindings: [], geometry: { crop: null, rotationDegrees: 0, flipHorizontal: false, flipVertical: false } } };

for (const locale of ['en', 'de']) test(`actual ${locale} Develop belongs only to File Photo, stays lazy and uses the primary photo`, async () => {
	const h = surveyAppOwner(), reads: string[] = [], copy = bundledLightscaperEditorCopyForLocale(locale);
	const develop: PhotoLibraryDevelopPortV1 = { read: async request => { reads.push(request.photoId); return document; }, apply: async () => { throw Error('No write'); } };
	const factory = async () => ({ ...await h.factory(), develop });
	const mounted = await mountPhotoImportUi(() => { Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: () => true });
		return <StrictMode><LightscaperApp locale={locale} createSession={factory} /></StrictMode>; });
	const click = async (selector: string) => { await act(async () => { const target = mounted.dom.one(selector);
		reactProps(target).onClick?.({ currentTarget: target, ctrlKey: false, metaKey: false, shiftKey: false }); await settle(); }); };
	try {
		const menu = mounted.dom.one('[data-photo-develop-menu]'); assert.equal(menu.textContent, photoDevelopMenuLabel(locale));
		assert.equal(menu.closest('details')?.querySelector('summary')?.textContent, locale === 'de' ? 'Foto' : 'Photo');
		assert.equal(h.opens(), 0); assert.equal(mounted.dom.find('[data-photo-develop-workspace]'), null); assert.equal(menu.hasAttribute('disabled'), true);
		const show = mounted.dom.container.querySelectorAll('button').find(button => button.textContent === copy.photoShowLibrary);
		assert.ok(show); await act(async () => { reactProps(show).onClick?.({ currentTarget: show }); await settle(); });
		await click('[data-photo-id="a"]'); await click('[data-photo-develop-menu]'); await settle();
		assert.deepEqual(reads, ['a']); assert.ok(mounted.dom.find('[data-photo-develop-workspace]'));
	} finally { await mounted.dispose(); }
});

test('retained Save and Cancel cannot borrow a newer acknowledged revision or a later demand', async () => {
	const requests: PhotoLibraryDevelopApplyV1[] = [], held = deferred<void>(); let hold = false;
	let current = document, stopped: AbortSignal | null = null;
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopWorkspace locale="en" photoId="a" label="a" generation={document}
		execute={async (run, signal) => { stopped = signal!; await run({ signal: signal!, isCurrent: () => true, refresh: async () => undefined,
			acquire: async () => ({ read: async () => current, apply: async request => { requests.push(request); if (hold) await held.promise;
				current = { ...current, revision: current.revision + 1, develop: request.command.type === 'record-develop' ? request.command.develop : current.develop };
				return { snapshot: current, notices: [] }; } }) }); }}
		readPreview={async () => ({ outcome: 'missing' })} beforePresent={Promise.resolve()} registerRetirement={() => () => undefined}
		loadProxy={async () => { throw Error('No body'); }} onClose={() => undefined} />);
	const button = (name: string) => { const found = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === name); assert.ok(found); return found; };
	const click = async (name: string) => { await act(async () => { reactProps(button(name)).onClick?.({}); await settle(); }); };
	try {
		await act(async () => { await settle(); }); await click('Add adjustment');
		const oldSave = reactProps(button('Save settings')).onClick!;
		await click('Save settings'); await click('Add adjustment');
		await act(async () => { oldSave({}); await settle(); }); assert.equal(requests.length, 1);
		hold = true; await click('Save settings'); const oldCancel = reactProps(button('Cancel')).onClick!;
		held.resolve(); await act(async () => { await settle(); });
		await click('Add adjustment'); await click('Save settings');
		await act(async () => { oldCancel({}); }); assert.equal(stopped!.aborted, false);
	} finally { held.resolve(); await mounted.dispose(); }
});

test('generation replacement joins an old held read before the new controls borrow the same workflow demand', async () => {
	let generation = {}, active = false, reads = 0;
	const held = deferred<PhotoLibraryDevelopSnapshotV1>();
	const execute: ExecutePhotoDevelopV1 = async (run, signal) => {
		if (active) return 'busy'; active = true;
		try { await run({ signal: signal!, isCurrent: () => true, refresh: async () => undefined,
			acquire: async () => ({ read: async () => { reads++; return reads === 1 ? held.promise : { ...document, revision: 9 }; },
				apply: async () => { throw Error('No write'); } }) }); } finally { active = false; }
		return 'completed';
	};
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopWorkspace locale="en" photoId="a" label="a" generation={generation} execute={execute}
		readPreview={async () => ({ outcome: 'missing' })} beforePresent={Promise.resolve()} registerRetirement={() => () => undefined}
		loadProxy={async () => { throw Error('No body'); }} onClose={() => undefined} />);
	try {
		await act(async () => { await settle(); }); assert.equal(reads, 1);
		generation = {}; await mounted.render(); assert.equal(reads, 1);
		held.resolve(document); await act(async () => { await settle(); });
		assert.equal(reads, 2); assert.ok(mounted.dom.find('[data-photo-develop-effects]'));
	} finally { held.resolve(document); await mounted.dispose(); }
});

test('old generation Close and name handlers cannot retire or change a replacement workspace', async () => {
	let generation = {}, closes = 0;
	const execute: ExecutePhotoDevelopV1 = async (run, signal) => { await run({ signal: signal!, isCurrent: () => true,
		refresh: async () => undefined, acquire: async () => ({ read: async () => document, apply: async () => { throw Error('No write'); } }) }); };
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopWorkspace locale="en" photoId="a" label="a" generation={generation} execute={execute}
		readPreview={async () => ({ outcome: 'missing' })} beforePresent={Promise.resolve()} registerRetirement={() => () => undefined}
		loadProxy={async () => { throw Error('No body'); }} onClose={() => { closes++; }} />);
	const close = () => { const button = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === 'Close'); assert.ok(button); return reactProps(button).onClick!; };
	const name = () => { const input = mounted.dom.container.querySelectorAll('input').find(value => value.parentNode?.textContent.startsWith('Snapshot name')); assert.ok(input); return input; };
	try {
		await act(async () => { await settle(); }); const oldClose = close(), oldName = reactProps(name()).onChange!;
		generation = {}; await mounted.render(); await act(async () => { await settle(); });
		await act(async () => { oldName({ currentTarget: { value: 'Retired' } }); oldClose({}); });
		assert.equal(closes, 0); assert.equal((reactProps(name()) as unknown as { value: string }).value, '');
		await act(async () => { close()({}); }); assert.equal(closes, 1);
	} finally { await mounted.dispose(); }
});

test('actual App Close joins a held Develop demand before any same-photo reopen', async () => {
	const h = surveyAppOwner(), held = deferred<PhotoLibraryDevelopSnapshotV1>(); let reads = 0;
	const develop: PhotoLibraryDevelopPortV1 = { read: async () => { reads++; return reads === 1 ? held.promise : document; }, apply: async () => { throw Error('No write'); } };
	const factory = async () => ({ ...await h.factory(), develop });
	const mounted = await mountPhotoImportUi(() => { Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: () => true });
		return <LightscaperApp locale="en" createSession={factory} />; });
	const click = async (target: Parameters<typeof reactProps>[0]) => { await act(async () => { reactProps(target).onClick?.({ currentTarget: target,
		ctrlKey: false, metaKey: false, shiftKey: false }); await settle(); }); };
	try {
		const show = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === 'Show photo library'); assert.ok(show); await click(show);
		await click(mounted.dom.one('[data-photo-id="a"]')); const menu = mounted.dom.one('[data-photo-develop-menu]'); await click(menu);
		assert.equal(reads, 1); const close = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === 'Close'); assert.ok(close); await click(close);
		assert.equal(mounted.dom.find('[data-photo-develop-workspace]'), null); assert.equal(menu.hasAttribute('disabled'), true);
		await click(menu); assert.equal(reads, 1);
		held.resolve(document); await act(async () => { await settle(); }); assert.equal(menu.hasAttribute('disabled'), false);
		await click(menu); assert.equal(reads, 2); assert.ok(mounted.dom.find('[data-photo-develop-effects]'));
	} finally { held.resolve(document); await mounted.dispose(); }
});

test('mounted controls preview shared WB/tone/geometry without a Frame authority and save complete settings', async () => {
	const requests: PhotoLibraryDevelopApplyV1[] = [];
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopWorkspace locale="en" photoId="a" label="a.png" generation={document}
		execute={async (run, signal) => { await run({ signal: signal!, isCurrent: () => true, refresh: async () => undefined,
			acquire: async () => ({ read: async () => document, apply: async request => { requests.push(request);
				return { snapshot: { ...document, revision: 6, develop: request.command.type === 'record-develop' ? request.command.develop : document.develop }, notices: [] }; } }) }); }}
		readPreview={async () => ({ outcome: 'missing' })} beforePresent={Promise.resolve()} registerRetirement={() => () => undefined}
		loadProxy={async () => { throw Error('No body expected'); }} onClose={() => undefined} />);
	try {
		await act(async () => { await settle(); });
		const add = mounted.dom.container.querySelectorAll('button').find(button => button.textContent === 'Add adjustment'); assert.ok(add);
		await act(async () => { reactProps(add).onClick?.({ currentTarget: add }); });
		const temperature = mounted.dom.container.querySelectorAll('input').find(input => input.getAttribute('aria-label') === 'Exact value: Temperature (relative)'); assert.ok(temperature);
		await act(async () => { reactProps(temperature).onFocus?.({}); reactProps(temperature).onChange?.({ currentTarget: { value: '0.25', valueAsNumber: 0.25 } }); });
		await act(async () => { reactProps(temperature).onKeyDown?.({ key: 'Enter', preventDefault() {} }); });
		assert.equal(requests.length, 0);
		const save = mounted.dom.container.querySelectorAll('button').find(button => button.textContent === 'Save settings'); assert.ok(save);
		await act(async () => { reactProps(save).onClick?.({ currentTarget: save }); await settle(); });
		assert.equal(requests[0]?.expectedRevision, 5); const command = requests[0]!.command;
		assert.equal(command.type, 'record-develop'); assert.equal(command.type === 'record-develop' && command.develop.effects[0]?.params.temperature, 0.25);
		assert.equal(document.develop.effects.length, 0);
	} finally { await mounted.dispose(); }
});

for (const [type, expected] of [['chroma-v1', [255, 0, 0, 127]], ['black-white-mix-v1', [54, 54, 54, 127]],
	['hsl-mixer-v1', [255, 0, 0, 127]]] as const) test(`mounted Photo workspace authors, saves and renders shared ${type}`, async () => {
	let saved = document.develop;
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopWorkspace locale="en" photoId="a" label="a.png" generation={document}
		execute={async (run, signal) => { await run({ signal: signal!, isCurrent: () => true, refresh: async () => undefined,
			acquire: async () => ({ read: async () => document, apply: async request => {
				assert.equal(request.command.type, 'record-develop');
				if (request.command.type === 'record-develop') saved = request.command.develop;
				return { snapshot: { ...document, revision: 6, develop: saved }, notices: [] }; } }) }); }}
		readPreview={async () => ({ outcome: 'missing' })} beforePresent={Promise.resolve()} registerRetirement={() => () => undefined}
		loadProxy={async () => { throw Error('No body expected'); }} onClose={() => undefined} />);
	try {
		await act(async () => { await settle(); });
		const panel = mounted.dom.one('[data-photo-develop-effects]'), select = panel.querySelector('select'); assert.ok(select);
		assert.ok(select.querySelectorAll('option').some(option => option.getAttribute('value') === type), 'The rendered family must be authorable.');
		await act(async () => { reactProps(select).onChange?.({ currentTarget: { value: type } }); });
		const click = async (name: string) => { const button = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === name);
			assert.ok(button); await act(async () => { reactProps(button).onClick?.({ currentTarget: button }); await settle(); }); };
		await click('Add adjustment'); await click('Save settings');
		assert.equal(saved.effects[0]?.type, type);
		const frame = { descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' },
			pixels: new Uint8Array([255, 0, 0, 127]) };
		assert.deepEqual(await withPhotoDevelopProxyV1({ frame, develop: saved }, view => [...view.frame.pixels]), expected);
		assert.deepEqual([...frame.pixels], [255, 0, 0, 127]);
	} finally { await mounted.dispose(); }
});

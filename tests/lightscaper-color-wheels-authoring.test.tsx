/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoDevelopWorkspace from '../src/common/editor/ui/lightscaper/PhotoDevelopWorkspace.tsx';
import PhotoDevelopEffects from '../src/common/editor/ui/lightscaper/PhotoDevelopEffects.tsx';
import { PhotoLibraryDevelopWorkflowV1 } from '../src/common/editor/controller/shared/photo-library-develop-workflow-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import type { VideoEffectLeaf } from '../src/common/editor/project-media-types.ts';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import { PhotoLibrarySessionV1 } from '../src/lightscaper/controller/photo-library-session.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import type { PhotoLibrarySessionPortsV1 } from '../src/lightscaper/controller/photo-library-session-ports.ts';
import { withPhotoDevelopProxyV1 } from '../src/lightscaper/controller/photo-develop-proxy-v1.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { queryCatalogRootV1, queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';
import { settle } from './helpers/async-test-control.ts';
import VideoEffectRack from '../src/common/editor/ui/inspector/VideoEffectRack.jsx';
import { VIDEO_EFFECT_COPY_BY_LOCALE } from '../src/common/i18n/video-effect-copy.js';
import { createVideoEffectService, type VideoEffectProject } from '../src/common/editor/controller/clip-video/video-effect-service.ts';
import { EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing, cloneFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { applyFramescaperProjectCommandFinishing } from '../src/framescaper/editor-project-finishing-commands.ts';
import { applyVideoExactBrowserEffectsFinishing } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });

for (const locale of ['en', 'de']) for (const type of ['color-wheels-v1']) {
	test(`${locale} actual Photo workspace saves and renders an authored ${type} through the real Session`, async () => {
		const catalog = new PhotoCatalogRepositoryV1({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			databaseName: `wheels-${locale}-${type}`, verifyOriginal: async () => undefined });
		await catalog.createCatalog(queryCatalogRootV1()); await catalog.publishPhotos('catalog', 0, [queryPhotoV1()]);
		const before = (await catalog.loadPhoto('catalog', queryPhotoV1().id))!;
		const unexpected = async (): Promise<never> => { throw Error('No original mutation is authorized.'); };
		const ports: PhotoLibrarySessionPortsV1 = { catalog, initialize: async () => (await catalog.loadCatalog('catalog'))!,
			closeResources: async () => undefined, exclusive: async (_id, operation, signal) => operation(signal),
			journal: { get: async () => undefined, putIfAbsent: unexpected, deleteIfCurrent: unexpected },
			media: { writeAsset: unexpected, custody: { findDigestPage: unexpected, stage: unexpected, promote: unexpected,
				releaseStaged: unexpected, readPage: unexpected } } };
		const session = new PhotoLibrarySessionV1(ports), messages = photoDevelopCopy(locale);
		const mounted = await mountPhotoImportUi(() => <PhotoDevelopWorkspace locale={locale} photoId={before.id} label={before.metadata.fileName} generation={session}
			execute={async (run, signal) => { await run({ signal: signal!, isCurrent: () => true, acquire: async () => session.develop,
				refresh: async () => undefined }); }} readPreview={async () => ({ outcome: 'missing' })} loadProxy={unexpected}
			beforePresent={Promise.resolve()} registerRetirement={() => () => undefined} onClose={() => undefined} />);
		const button = (label: string) => { const value = mounted.dom.container.querySelectorAll('button').find(row => row.textContent === label); assert.ok(value, label); return value; };
		const click = async (target: ReactTestElement) => { await act(async () => { reactProps(target).onClick?.({ currentTarget: target }); await settle(); }); };
		const change = async (label: string, value: string) => {
			const input = mounted.dom.container.querySelectorAll('input').find(row => row.getAttribute('aria-label') === label); assert.ok(input, label);
			await act(async () => { reactProps(input).onFocus?.({}); reactProps(input).onChange?.({ currentTarget: { value, valueAsNumber: Number(value) } }); });
			await act(async () => { reactProps(input).onKeyDown?.({ key: 'Enter', preventDefault() {} }); });
		};
		try {
			await act(async () => { await settle(); });
			const select = mounted.dom.one('[data-photo-develop-effects]').querySelector('select'); assert.ok(select);
			assert.ok(select.querySelectorAll('option').some(option => option.getAttribute('value') === type), 'The renderable family must be authorable.');
			await act(async () => { reactProps(select).onChange?.({ currentTarget: { value: type } }); }); await click(button(messages.add));
			assert.equal(mounted.dom.container.querySelectorAll('[data-video-color-wheel]').length, 3);
			await change(`${messages.shared.videoEffectExactValue}: ${messages.shared.videoEffectWheelHighlights}: ${messages.shared.videoEffectParamLuminance}`, '100');
			await click(button(messages.save));
			const saved = await session.develop.read({ schemaVersion: 1, photoId: before.id });
			assert.equal(saved.history.entries.length, 2); assert.equal(saved.develop.effects[0]?.type, type);
			assert.equal(saved.develop.effects[0]?.params.highlightsLuminance, 100);
			const frame = { descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: new Uint8Array([128, 128, 128, 127]) };
			assert.deepEqual(await withPhotoDevelopProxyV1({ frame, develop: saved.develop }, view => [...view.frame.pixels]),
				[176, 176, 176, 127]);
			const after = (await catalog.loadPhoto('catalog', before.id))!;
			assert.deepEqual(after.original, before.original); assert.deepEqual(after.extractedMetadata, before.extractedMetadata); assert.deepEqual(after.metadata, before.metadata);
			assert.deepEqual([...frame.pixels], [128, 128, 128, 127]);
		} finally { await mounted.dispose(); await session.close(); await catalog.close(); }
	});
}

test('actual Frames opted-in effect rack edits three polar wheels through the owning gesture service and persists renderable bytes', async context => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	context.after(() => { if (previous) Object.defineProperty(globalThis, 'React', previous); else Reflect.deleteProperty(globalThis, 'React'); });
	let project = createFramescaperProjectFinishing(PROFILE, framescaperV20Options()), error = '';
	const view = (value: unknown) => value as VideoEffectProject, generation = new EditorProjectGeneration(); generation.activate(view(project).id);
	const service = createVideoEffectService({ state: { selectedClipId: 'video-clip', readOnly: false, videoEffectGestures: new Map() },
		copy: { projectReadOnly: 'Read only' }, getProject: () => view(project), captureProject: () => generation.capture(view(project).id),
		assertProject: token => { generation.assertCurrent(token); }, editingBlocked: () => false,
		commit: command => { project = applyFramescaperProjectCommandFinishing(PROFILE, project, command); return view(project); }, publishDocumentSnapshot() {} });
	const actions = { add: service.addVideoClipEffect, beginGesture: service.beginVideoEffectGesture, preview: service.previewVideoEffectGesture,
		commit: service.commitVideoEffectGesture, cancel: service.cancelVideoEffectGesture, toggle: service.toggleVideoClipEffect,
		reorder: service.reorderVideoClipEffect, remove: service.removeVideoClipEffect, update: service.updateVideoClipEffect };
	const mounted = await mountPhotoImportUi(() => <VideoEffectRack clip={view(project).clips.find(row => row.id === 'video-clip')}
		controller={{ actions: { video: { effects: actions } } }} copy={{ ...VIDEO_EFFECT_COPY_BY_LOCALE.en, chooseEffect: 'Choose effect', addEffect: 'Add effect' }}
		disabled={false} onError={(value: string) => { error = value; }} />);
	try {
		const picker = mounted.dom.one('.dropdown');
		await act(async () => { reactProps(picker).onKeyDown?.({ key: 'Enter', preventDefault() {} }); });
		for (let n = 0; n < 20; n++) await act(async () => { reactProps(picker).onKeyDown?.({ key: 'ArrowDown', preventDefault() {} }); });
		await act(async () => { reactProps(picker).onKeyDown?.({ key: 'Enter', preventDefault() {} }); });
		const add = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === 'Add effect'); assert.ok(add);
		await act(async () => { reactProps(add).onClick?.({}); await settle(); }); await mounted.render();
		assert.equal(error, ''); assert.equal(view(project).clips.find(row => row.id === 'video-clip')?.videoEffects?.[0]?.type, 'color-wheels-v1');
		assert.equal(mounted.dom.container.querySelectorAll('[data-video-color-wheel]').length, 3);
		const input = mounted.dom.container.querySelectorAll('input').find(row => row.getAttribute('aria-label') === 'Exact value: Highlights: Luminance'); assert.ok(input);
		await act(async () => { reactProps(input).onFocus?.({}); reactProps(input).onChange?.({ currentTarget: { value: '100', valueAsNumber: 100 } }); });
		await act(async () => { reactProps(input).onKeyDown?.({ key: 'Enter', preventDefault() {} }); }); await mounted.render();
		assert.equal(error, '');
		const clip = view(cloneFramescaperProjectFinishing(PROFILE, project)).clips.find(row => row.id === 'video-clip')!;
		assert.equal(clip.videoEffects?.[0]?.params.highlightsLuminance, 100);
		assert.deepEqual([...(await applyVideoExactBrowserEffectsFinishing({ width: 1, height: 1, pixels: new Uint8Array([128,128,128,1]) },
			clip.videoEffects!, new AbortController().signal)).pixels], [176,176,176,1]);
	} finally { await mounted.dispose(); }
});

async function photoWorkflowFixture() {
	const catalog = new PhotoCatalogRepositoryV1({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
		databaseName: 'held-curve-ui', verifyOriginal: async () => undefined });
	await catalog.createCatalog(queryCatalogRootV1()); await catalog.publishPhotos('catalog', 0, [queryPhotoV1()]);
	const unexpected = async (): Promise<never> => { throw Error('No original mutation is authorized.'); };
	const session = new PhotoLibrarySessionV1({ catalog, initialize: async () => (await catalog.loadCatalog('catalog'))!,
		closeResources: async () => undefined, exclusive: async (_id, operation, signal) => operation(signal),
		journal: { get: async () => undefined, putIfAbsent: unexpected, deleteIfCurrent: unexpected },
		media: { writeAsset: unexpected, custody: { findDigestPage: unexpected, stage: unexpected, promote: unexpected,
			releaseStaged: unexpected, readPage: unexpected } } });
	const owner = new PhotoLibraryDevelopWorkflowV1({ execute: async (run, signal) => { await run({ signal: signal!, isCurrent: () => true,
		acquire: async () => session.develop, refresh: async () => undefined }); } });
	await owner.open(queryPhotoV1().id);
	return { owner, close: async () => { await owner.close(); await session.close(); await catalog.close(); } };
}

for (const replacement of ['tone-ladder-v1', 'color-wheels-v1']) test(`held Photo wheel handler refuses same-ID ${replacement} replacement before React rerenders`, async () => {
	const h = await photoWorkflowFixture(), messages = photoDevelopCopy('en');
	h.owner.setEffects([createVideoEffect('color-wheels-v1', { id: 'same' }) as VideoEffectLeaf]);
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopEffects effects={h.owner.snapshot().draft!.effects} owner={h.owner}
		messages={messages} disabled={false} isCurrent={() => true} />);
	try {
		const input = mounted.dom.container.querySelectorAll('input').find(row => row.getAttribute('aria-label') === 'Exact value: Highlights: Luminance'); assert.ok(input);
		const retained = reactProps(input).onChange!;
		h.owner.setEffects([createVideoEffect(replacement, { id: 'same', params: replacement === 'tone-ladder-v1' ? { exposure: 1 } : { highlightsLuminance: 50 } }) as VideoEffectLeaf]);
		const expected = h.owner.snapshot().draft;
		await act(async () => { retained({ currentTarget: { value: '100', valueAsNumber: 100 } }); });
		assert.equal(h.owner.snapshot().draft, expected);
	} finally { await mounted.dispose(); await h.close(); }
});

test('captured wheel settlement follows its own rerendered previews and retains the previous accepted wheel when the next edit cancels', async () => {
	const h = await photoWorkflowFixture(), messages = photoDevelopCopy('en');
	h.owner.setEffects([createVideoEffect('color-wheels-v1', { id: 'same' }) as VideoEffectLeaf]);
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopEffects effects={h.owner.snapshot().draft!.effects} owner={h.owner}
		messages={messages} disabled={false} isCurrent={() => true} />);
	const input = (group: string) => { const node = mounted.dom.container.querySelectorAll('input').find(row => row.getAttribute('aria-label') === `Exact value: ${group}: Luminance`); assert.ok(node); return node; };
	try {
		await act(async () => { reactProps(input('Highlights')).onFocus?.({}); reactProps(input('Highlights')).onChange?.({ currentTarget: { value: '25', valueAsNumber: 25 } }); });
		await mounted.render(); await act(async () => { reactProps(input('Highlights')).onChange?.({ currentTarget: { value: '50', valueAsNumber: 50 } }); });
		await mounted.render(); await act(async () => { reactProps(input('Highlights')).onKeyDown?.({ key: 'Enter', preventDefault() {} }); });
		const expected = h.owner.snapshot().draft;
		await mounted.render(); await act(async () => { reactProps(input('Shadows')).onFocus?.({}); reactProps(input('Shadows')).onChange?.({ currentTarget: { value: '25', valueAsNumber: 25 } }); });
		await mounted.render(); await act(async () => { reactProps(input('Shadows')).onKeyDown?.({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); });
		assert.equal(h.owner.snapshot().draft, expected); assert.equal(expected!.effects[0]!.params.highlightsLuminance, 50);
	} finally { await mounted.dispose(); await h.close(); }
});

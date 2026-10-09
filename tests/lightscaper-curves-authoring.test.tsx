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

for (const locale of ['en', 'de']) for (const type of ['point-curves-v1', 'parametric-curves-v1']) {
	test(`${locale} actual Photo workspace saves and renders an authored ${type} through the real Session`, async () => {
		const catalog = new PhotoCatalogRepositoryV1({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
			databaseName: `curves-${locale}-${type}`, verifyOriginal: async () => undefined });
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
		const change = async (label: string, value: string, commit = true) => {
			const input = mounted.dom.container.querySelectorAll('input').find(row => row.getAttribute('aria-label') === label); assert.ok(input, label);
			await act(async () => { reactProps(input).onFocus?.({}); reactProps(input).onChange?.({ currentTarget: { value, valueAsNumber: Number(value) } }); });
			if (commit) await act(async () => { reactProps(input).onKeyDown?.({ key: 'Enter', preventDefault() {} }); });
		};
		try {
			await act(async () => { await settle(); });
			const select = mounted.dom.one('[data-photo-develop-effects]').querySelector('select'); assert.ok(select);
			assert.ok(select.querySelectorAll('option').some(option => option.getAttribute('value') === type), 'The renderable family must be authorable.');
			await act(async () => { reactProps(select).onChange?.({ currentTarget: { value: type } }); }); await click(button(messages.add));
			if (type === 'point-curves-v1') {
				await change(`${messages.shared.videoEffectCurveMaster}: ${messages.shared.videoEffectCurveOutput} 1`, '1');
				await change(`${messages.shared.videoEffectCurveMaster}: ${messages.shared.videoEffectCurveOutput} 2`, '0');
			} else {
				await change(`${messages.shared.videoEffectExactValue}: ${messages.shared.videoEffectCurveMasterShadows}`, '100');
				const split = `${messages.shared.videoEffectExactValue}: ${messages.shared.videoEffectCurveShadowSplit}`;
				await change(split, '0.5', false);
				assert.equal(mounted.dom.one('[data-photo-develop-effects]').querySelector('[role="alert"]')?.textContent,
					messages.shared.videoEffectCurveParametersInvalid);
				await change(split, '0.25');
				assert.equal(mounted.dom.one('[data-photo-develop-effects]').querySelector('[role="alert"]'), null);
				const old = mounted.dom.container.querySelectorAll('input').find(row => row.getAttribute('aria-label') === split)!;
				const retained = reactProps(old).onChange!;
				await change(split, '0.1');
				const midtone = `${messages.shared.videoEffectExactValue}: ${messages.shared.videoEffectCurveMidtoneSplit}`;
				await change(midtone, '0.2');
				await act(async () => { retained({ currentTarget: { value: '0.3', valueAsNumber: 0.3 } }); });
				assert.equal(mounted.dom.one('[data-photo-develop-effects]').querySelector('[role="alert"]'), null);
				await change(midtone, '0.5'); await change(split, '0.25');
			}
			await click(button(messages.save));
			const saved = await session.develop.read({ schemaVersion: 1, photoId: before.id });
			assert.equal(saved.history.entries.length, 2); assert.equal(saved.develop.effects[0]?.type, type);
			if (type === 'point-curves-v1') assert.deepEqual(saved.develop.effects[0]?.params.master, [{ x: 0, y: 1 }, { x: 1, y: 0 }]);
			else assert.equal(saved.develop.effects[0]?.params.masterShadows, 100);
			const frame = { descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: new Uint8Array([0, 32, 64, 127]) };
			assert.deepEqual(await withPhotoDevelopProxyV1({ frame, develop: saved.develop }, view => [...view.frame.pixels]),
				type === 'point-curves-v1' ? [255, 223, 191, 127] : [0, 64, 80, 127]);
			const after = (await catalog.loadPhoto('catalog', before.id))!;
			assert.deepEqual(after.original, before.original); assert.deepEqual(after.extractedMetadata, before.extractedMetadata); assert.deepEqual(after.metadata, before.metadata);
			assert.deepEqual([...frame.pixels], [0, 32, 64, 127]);
		} finally { await mounted.dispose(); await session.close(); await catalog.close(); }
	});
}

test('actual Frames opted-in effect rack edits structured points through the owning gesture service and persists renderable bytes', async context => {
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
		for (let n = 0; n < 18; n++) await act(async () => { reactProps(picker).onKeyDown?.({ key: 'ArrowDown', preventDefault() {} }); });
		await act(async () => { reactProps(picker).onKeyDown?.({ key: 'Enter', preventDefault() {} }); });
		const add = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === 'Add effect'); assert.ok(add);
		await act(async () => { reactProps(add).onClick?.({}); await settle(); }); await mounted.render();
		assert.equal(error, ''); assert.equal(view(project).clips.find(row => row.id === 'video-clip')?.videoEffects?.[0]?.type, 'point-curves-v1');
		for (const [index, value] of [[1, '1'], [2, '0']] as const) {
			const input = mounted.dom.container.querySelectorAll('input').find(row => row.getAttribute('aria-label') === `Master: Output ${String(index)}`); assert.ok(input);
			await act(async () => { reactProps(input).onFocus?.({}); reactProps(input).onChange?.({ currentTarget: { value, valueAsNumber: Number(value) } }); });
			await act(async () => { reactProps(input).onKeyDown?.({ key: 'Enter', preventDefault() {} }); }); await mounted.render();
		}
		assert.equal(error, '');
		const clip = view(cloneFramescaperProjectFinishing(PROFILE, project)).clips.find(row => row.id === 'video-clip')!;
		assert.deepEqual(clip.videoEffects?.[0]?.params.master, [{ x: 0, y: 1 }, { x: 1, y: 0 }]);
		assert.deepEqual([...(await applyVideoExactBrowserEffectsFinishing({ width: 1, height: 1, pixels: new Uint8Array([0, 32, 64, 1]) },
			clip.videoEffects!, new AbortController().signal)).pixels], [255, 223, 191, 1]);
	} finally { await mounted.dispose(); }
});

for (const replacement of ['tone-ladder-v1', 'point-curves-v1']) test(`held Photo point handler cannot target a same-ID ${replacement} replacement before React rerenders`, async () => {
	const h = await photoWorkflowFixture(), messages = photoDevelopCopy('en');
	h.owner.setEffects([createVideoEffect('point-curves-v1', { id: 'same' }) as VideoEffectLeaf]);
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopEffects effects={h.owner.snapshot().draft!.effects} owner={h.owner}
		messages={messages} disabled={false} isCurrent={() => true} />);
	try {
		const input = mounted.dom.container.querySelectorAll('input').find(row => row.getAttribute('aria-label') === 'Master: Output 1'); assert.ok(input);
		const retained = reactProps(input).onChange!;
		const add = mounted.dom.container.querySelectorAll('button').find(row => row.getAttribute('aria-label') === 'Add point: Master'); assert.ok(add);
		const retainedAdd = reactProps(add).onClick!;
		h.owner.setEffects([createVideoEffect(replacement, { id: 'same', params: replacement === 'tone-ladder-v1'
			? { exposure: 1 } : { master: [{ x: 0, y: 0.25 }, { x: 1, y: 0.75 }] } }) as VideoEffectLeaf]);
		const expected = h.owner.snapshot().draft;
		await act(async () => { retained({ currentTarget: { value: '1', valueAsNumber: 1 } }); retainedAdd({}); });
		assert.equal(h.owner.snapshot().draft, expected, 'The held field must not submit into another canonical effect array.');
	} finally { await mounted.dispose(); await h.close(); }
});

for (const action of ['addition', 'removal']) test(`a committed Photo point ${action} survives cancellation of the next numeric gesture`, async () => {
	const h = await photoWorkflowFixture(), messages = photoDevelopCopy('en');
	h.owner.setEffects([createVideoEffect('point-curves-v1', { id: 'same', ...(action === 'removal'
		? { params: { master: [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }] } } : {}) }) as VideoEffectLeaf]);
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopEffects effects={h.owner.snapshot().draft!.effects} owner={h.owner}
		messages={messages} disabled={false} isCurrent={() => true} />);
	try {
		const label = action === 'addition' ? 'Add point: Master' : 'Remove point: Master 2';
		const button = mounted.dom.container.querySelectorAll('button').find(row => row.getAttribute('aria-label') === label); assert.ok(button);
		await act(async () => { reactProps(button).onClick?.({}); }); await mounted.render();
		const committed = h.owner.snapshot().draft, points = committed!.effects[0]!.params.master; assert.ok(points && typeof points !== 'number');
		assert.equal(points.length, action === 'addition' ? 3 : 2);
		const input = () => { const value = mounted.dom.container.querySelectorAll('input').find(row => row.getAttribute('aria-label') === 'Master: Output 1'); assert.ok(value); return value; };
		await act(async () => { reactProps(input()).onFocus?.({}); reactProps(input()).onChange?.({ currentTarget: { value: '0.25', valueAsNumber: 0.25 } }); });
		await mounted.render();
		await act(async () => { reactProps(input()).onKeyDown?.({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); });
		assert.equal(h.owner.snapshot().draft, committed, 'Cancel must restore only the numeric gesture, retaining the accepted discrete point edit.');
	} finally { await mounted.dispose(); await h.close(); }
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

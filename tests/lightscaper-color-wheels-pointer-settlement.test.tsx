/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import React, { act } from 'react';
import PhotoDevelopEffects from '../src/common/editor/ui/lightscaper/PhotoDevelopEffects.tsx';
import { PhotoLibraryDevelopWorkflowV1 } from '../src/common/editor/controller/shared/photo-library-develop-workflow-v1.ts';
import { PhotoLibrarySessionV1 } from '../src/lightscaper/controller/photo-library-session.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import type { VideoEffectLeaf } from '../src/common/editor/project-media-types.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { queryCatalogRootV1, queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';

for (const accepted of [0, 50]) test(`actual Photo numeric-to-pointer cancellation admits its first capture and preserves accepted Highlights${String(accepted)}`, async () => {
	Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
	const catalog = new PhotoCatalogRepositoryV1({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
		databaseName: 'native-wheel-first-drag', verifyOriginal: async () => undefined });
	await catalog.createCatalog(queryCatalogRootV1()); await catalog.publishPhotos('catalog', 0, [queryPhotoV1()]);
	const unexpected = async (): Promise<never> => { throw Error('No original mutation is authorized.'); };
	const session = new PhotoLibrarySessionV1({ catalog, initialize: async () => (await catalog.loadCatalog('catalog'))!,
		closeResources: async () => undefined, exclusive: async (_id, operation, signal) => operation(signal),
		journal: { get: async () => undefined, putIfAbsent: unexpected, deleteIfCurrent: unexpected },
		media: { writeAsset: unexpected, custody: { findDigestPage: unexpected, stage: unexpected, promote: unexpected,
			releaseStaged: unexpected, readPage: unexpected } } });
	const owner = new PhotoLibraryDevelopWorkflowV1({ execute: async (run, signal) => { await run({ signal: signal!, isCurrent: () => true,
		acquire: async () => session.develop, refresh: async () => undefined }); } });
	await owner.open(queryPhotoV1().id); owner.setEffects([createVideoEffect('color-wheels-v1', { id: 'wheel', params: { highlightsLuminance: accepted } }) as VideoEffectLeaf]);
	const mounted = await mountPhotoImportUi(() => React.createElement(PhotoDevelopEffects, { effects: owner.snapshot().draft!.effects,
		owner, messages: photoDevelopCopy('en'), disabled: false, isCurrent: () => true }));
	try {
		const input = mounted.dom.container.querySelectorAll('input').find(node => node.getAttribute('aria-label') === 'Exact value: Shadows: Luminance'); assert.ok(input);
		await act(async () => { reactProps(input).onFocus?.({}); reactProps(input).onChange?.({ currentTarget: { value: '20', valueAsNumber: 20 } }); });
		await mounted.render(); await act(async () => { reactProps(input).onChange?.({ currentTarget: { value: '101', valueAsNumber: 101 } }); }); await mounted.render();
		let captures = 0;
		const target = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 160, height: 160 }), setPointerCapture() { captures++; },
			releasePointerCapture() {}, focus() { reactProps(input).onBlur?.({}); } };
		await act(async () => { reactProps(mounted.dom.container.querySelectorAll('[data-video-color-wheel]')[0]!).onPointerDown?.({ currentTarget: target,
			pointerId: 1, button: 0, clientX: 160, clientY: 80, preventDefault() {} }); });
		assert.equal(captures, 1, 'The first native pointer gesture must be admitted after canceling its numeric preview.');
		assert.equal(owner.snapshot().draft!.effects[0]!.params.shadowsLuminance, 0);
		assert.equal(owner.snapshot().draft!.effects[0]!.params.shadowsSaturation, 100);
		assert.equal(owner.snapshot().draft!.effects[0]!.params.highlightsLuminance, accepted);
	} finally { await mounted.dispose(); await owner.close(); await session.close(); await catalog.close(); }
});


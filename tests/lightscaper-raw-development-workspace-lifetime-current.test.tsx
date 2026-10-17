/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoDevelopWorkspaceCurrentV1 from '../src/common/editor/ui/lightscaper/PhotoDevelopWorkspaceCurrentV1.tsx';
import type { PhotoDevelopWorkspacePropsCurrentV1 } from '../src/common/editor/ui/lightscaper/PhotoDevelopWorkspaceCurrentV1.tsx';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import type { PhotoLibraryDevelopOriginalPortCurrentV1 } from '../src/common/editor/photo-library-develop-original-current-v1.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { recoveryRasterFixture } from './helpers/lightscaper-raw-development-raster-export-fixture.ts';
import { currentAppCanvasBoundary } from './helpers/lightscaper-current-app-fixture.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { deferred, settle, waitFor } from './helpers/async-test-control.ts';

for (const action of ['Save', 'Discard'] as const) test(`held actual RAW verification fences retained parent ${action} and effect callbacks`, async () => {
	const words = photoDevelopCopy('en');
	const f = await recoveryRasterFixture('headroom'), canvas = currentAppCanvasBoundary(), release = deferred<void>();
	const retirements = new Set<() => Promise<void>>(), planes: Float32Array[] = [];
	const original = f.original, port = f.session.develop;
	let entered = false;
	const held: PhotoLibraryDevelopOriginalPortCurrentV1 = {
		withFrame: (request, consume, options) => original.withFrame(request, consume, options),
		withDerivedFrame: (request, consume, options) => original.withDerivedFrame!(request, async view => {
			const result = await consume(view);
			planes.push(view.frame.pixels); entered = true; await release.promise;
			return result;
		}, options),
	};
	Object.defineProperty(f.session, 'develop', { configurable: true, value: Object.freeze({ ...port, original: held }) });
	const runtime = createPhotoDevelopRenderRuntimeCurrentV1({ source: f.session.cubeLuts.source, maskSource: f.session.maskRasterSource });
	const register = (retire: () => Promise<void>) => { retirements.add(retire); return () => undefined; };
	const props: PhotoDevelopWorkspacePropsCurrentV1 = { locale: 'en', photoId: f.saved.photoId, label: 'Recovery.dng',
		generation: {}, execute: f.execute, readPreview: (id, tier, options) => f.session.readPreview(id, tier, options),
		loadProxy: async () => runtime, withOriginalFrame: f.request.withOriginalFrame,
		withDerivedFrame: f.request.withDerivedFrame, beforePresent: Promise.resolve(), registerRetirement: register,
		registerDemandRetirement: register, onClose: () => undefined };
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopWorkspaceCurrentV1 {...props} />);
	const button = (name: string) => {
		const node = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === name); assert.ok(node, name); return node;
	};
	const turn = async () => { await act(async () => { await settle(); }); };
	try {
		await waitFor(async () => { await turn(); return mounted.dom.container.querySelectorAll('button').some(node => node.textContent === words.add); }, 'native RAW Workspace');
		await act(async () => { reactProps(button(words.add)).onClick?.({}); await settle(); });
		assert.equal(mounted.dom.container.querySelectorAll('[data-photo-develop-effect]').length, 2);
		const retained = reactProps(button(action === 'Save' ? words.save : words.discard)).onClick, retainedAdd = reactProps(button(words.add)).onClick;
		assert.ok(retained); assert.ok(retainedAdd);
		await act(async () => { reactProps(button('RAW source processing')).onClick?.({}); retainedAdd({}); await settle(); });
		assert.equal(mounted.dom.container.querySelectorAll('[data-photo-develop-effect]').length, 2, 'Modal admission fences same-event parent edits.');
		await waitFor(async () => { await turn(); return mounted.dom.find('.lightscaper-raw-development-dialog') !== null; }, 'menu-owned RAW source modal');
		const dialog = mounted.dom.one('.lightscaper-raw-development-dialog'), select = dialog.querySelectorAll('select')[0]; assert.ok(select);
		await act(async () => { reactProps(select).onChange?.({ currentTarget: { value: 'recovery' } }); await settle(); });
		await waitFor(async () => { await turn(); return entered; }, 'held genuine ABI2 source proof');
		assert.ok(planes.some(plane => plane.some(value => value !== 0)));
		await act(async () => { retained({}); retainedAdd({}); await settle(); });
		assert.deepEqual(await f.session.develop.read({ schemaVersion: 3, photoId: f.saved.photoId }), f.saved);
		assert.equal(mounted.dom.container.querySelectorAll('[data-photo-develop-effect]').length, 2, 'The parent dirty draft stays unchanged.');
		const close = dialog.querySelectorAll('button').find(node => node.textContent === 'Close'); assert.ok(close);
		await act(async () => { reactProps(close).onClick?.({}); await settle(); });
		assert.ok(mounted.dom.find('.lightscaper-raw-development-dialog'), 'Close awaits the actual native borrow.');
		await act(async () => { release.resolve(); await settle(); });
		await waitFor(async () => { await turn(); return mounted.dom.find('.lightscaper-raw-development-dialog') === null; }, 'joined RAW modal Close');
		assert.ok(planes.every(plane => plane.every(value => value === 0)));
		await waitFor(async () => { await turn(); return f.canonical.active() === 0 && f.recovery.active() === 0
			&& mounted.dom.find('[data-photo-develop-preview]')?.getAttribute('data-state') === 'ready'; }, 'resumed native preview retirement');
		await f.assertCustody();
		await act(async () => { reactProps(button(words.save)).onClick?.({}); await settle(); });
		await waitFor(async () => { await turn(); return (await f.session.develop.read({ schemaVersion: 3, photoId: f.saved.photoId })).revision === f.saved.revision + 1; }, 'fresh parent Save after RAW retirement');
		const saved = await f.session.develop.read({ schemaVersion: 3, photoId: f.saved.photoId });
		assert.equal(saved.develop.processVersion, 4); assert.equal(saved.develop.effects.length, 2);
		if (saved.develop.processVersion !== 4) assert.fail('Parent Save must keep the full RAW recipe.');
		assert.equal(saved.develop.rawDevelopment.mode, 'headroom');
	} finally {
		release.resolve(); await mounted.dispose();
		try { await Promise.all([...retirements].map(retire => retire())); }
		finally { try { await f.close(); } finally { canvas.restore(); } }
	}
});

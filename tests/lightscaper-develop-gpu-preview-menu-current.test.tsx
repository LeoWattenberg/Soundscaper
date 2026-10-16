/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import PhotoDevelopWorkspaceCurrentV1 from '../src/common/editor/ui/lightscaper/PhotoDevelopWorkspaceCurrentV1.tsx';
import { usePhotoDevelopSettingsCurrentV1 } from '../src/common/editor/ui/lightscaper/use-photo-develop-settings-current-v1.ts';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { repairSettingsFixture } from './helpers/lightscaper-repair-settings-current-fixture.ts';
import { currentAppCanvasBoundary } from './helpers/lightscaper-current-app-fixture.tsx';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { settle, waitFor } from './helpers/async-test-control.ts';
import { deferred } from './helpers/async-test-control.ts';
import PhotoDevelopPreviewCurrentV1 from '../src/common/editor/ui/lightscaper/PhotoDevelopPreviewCurrentV1.tsx';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../src/common/editor/photo-library-develop-original-port-v1.ts';

for (const locale of ['en', 'de']) test(`${locale}: Current Settings owns an optional temporary GPU preview choice without changing the native document`, async () => {
	const f = await repairSettingsFixture(1), canvas = currentAppCanvasBoundary(), before = await f.inspect();
	const generation = {}, readPreview = async () => ({ outcome: 'missing' as const }), runtime = createPhotoDevelopRenderRuntimeCurrentV1();
	const loadProxy = async () => runtime, beforePresent = Promise.resolve(), retirements = new Set<() => Promise<void>>();
	const registerRetirement = (retire: () => Promise<void>) => { retirements.add(retire); return () => { retirements.delete(retire); }; };
	function View() {
		const settings = usePhotoDevelopSettingsCurrentV1({ generation, execute: f.execute });
		return <PhotoDevelopWorkspaceCurrentV1 locale={locale} photoId={f.photos[0]!.id} catalogId={f.photos[0]!.catalogId}
			label="Selected photo" generation={generation} execute={f.execute} readPreview={readPreview} loadProxy={loadProxy}
			settingsCurrent={settings} beforePresent={beforePresent} registerRetirement={registerRetirement} onClose={() => undefined} />;
	}
	const mounted = await mountPhotoImportUi(() => <View />), label = locale === 'de' ? 'Vorschauberechnung…' : 'Preview rendering…';
	try {
		await waitFor(async () => { await act(async () => { await settle(); }); return mounted.dom.find('[data-photo-develop-workspace]') !== null; }, 'actual Current Develop workspace');
		const menu = mounted.dom.container.querySelectorAll('button').find(node => node.textContent === label);
		assert.ok(menu, 'The renderer choice must be reachable from the existing Settings menu.');
		assert.equal(menu.closest('details')?.querySelector('summary')?.textContent, locale === 'de' ? 'Einstellungen' : 'Settings');
		assert.equal(mounted.dom.find('[data-photo-develop-preview-renderer]'), null, 'No renderer control appears before its menu is opened.');
		await act(async () => { reactProps(menu).onClick?.({}); await settle(); });
		await waitFor(async () => { await act(async () => { await settle(); }); return mounted.dom.find('[data-photo-develop-preview-renderer]') !== null; }, 'menu-owned renderer dialog');
		const select = mounted.dom.one('[data-photo-develop-preview-renderer]'); assert.equal(reactProps(select).value, 'cpu');
		await act(async () => { reactProps(select).onChange?.({ currentTarget: { value: 'gpu-preferred' } }); await settle(); });
		await act(async () => { reactProps(mounted.dom.one('[data-photo-develop-preview-renderer-apply]')).onClick?.({}); await settle(); });
		assert.equal(mounted.dom.find('[data-photo-develop-preview-renderer]'), null);
		assert.deepEqual(await f.inspect(), before, 'Renderer preference changes no recipe, history, preset or Original custody.');
		await act(async () => { reactProps(menu).onClick?.({}); await settle(); });
		await waitFor(async () => { await act(async () => { await settle(); }); return mounted.dom.find('[data-photo-develop-preview-renderer]') !== null; }, 'retained temporary renderer choice');
		assert.equal(reactProps(mounted.dom.one('[data-photo-develop-preview-renderer]')).value, 'gpu-preferred');
	} finally { const joins = [...retirements]; await mounted.dispose(); await Promise.allSettled(joins.map(retire => retire())); canvas.restore(); await f.close(); }
});

test('changing GPU preference aborts and joins the held Original before the next preview generation', async () => {
	const canvas = currentAppCanvasBoundary(), entered = deferred<void>(), release = deferred<void>(), signals: AbortSignal[] = [], planes: Uint8Array[] = [];
	let reads = 0, previewRenderer: 'gpu-preferred' | undefined;
	const withOriginalFrame: PhotoLibraryDevelopOriginalPortV1['withFrame'] = async (request, consume, options) => {
		assert.ok(options?.signal); signals.push(options.signal); reads++;
		const frame = { descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' } as const, pixels: Uint8Array.of(64, 96, 128, 255) }; planes.push(frame.pixels);
		try { if (reads === 1) { entered.resolve(); await release.promise; } options.signal.throwIfAborted();
			return await consume({ photoId: request.photoId, revision: request.expectedRevision, frame });
		} finally { frame.pixels.fill(0); }
	};
	const runtime = createPhotoDevelopRenderRuntimeCurrentV1(), loadProxy = async () => runtime, readPreview = async () => ({ outcome: 'missing' as const });
	const beforePresent = Promise.resolve(), retirements = new Set<() => Promise<void>>();
	const registerRetirement = (retire: () => Promise<void>) => { retirements.add(retire); return () => { retirements.delete(retire); }; };
	const mounted = await mountPhotoImportUi(() => <PhotoDevelopPreviewCurrentV1 {...{ previewRenderer }} photoId="photo" revision={7} develop={defaultImageDevelopStateV2()}
		withOriginalFrame={withOriginalFrame} readPreview={readPreview} loadProxy={loadProxy} beforePresent={beforePresent} registerRetirement={registerRetirement} messages={photoDevelopCopy('en')} locale="en" />);
	try {
		await entered.promise; previewRenderer = 'gpu-preferred'; await mounted.render(); await act(async () => { await settle(); });
		assert.equal(signals[0]!.aborted, true); assert.equal(reads, 1);
		await act(async () => { release.resolve(); await settle(); });
		await waitFor(async () => { await act(async () => { await settle(); }); return reads === 2 && mounted.dom.one('[data-photo-develop-preview]').getAttribute('data-state') === 'ready'; }, 'joined successor GPU-preferred preview');
		assert.ok(planes.every(plane => plane.every(value => value === 0)));
	} finally { release.resolve(); const joins = [...retirements]; await mounted.dispose(); await Promise.allSettled(joins.map(retire => retire())); canvas.restore(); }
});

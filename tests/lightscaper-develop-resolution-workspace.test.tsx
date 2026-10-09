/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, StrictMode } from 'react';
import PhotoDevelopWorkspace from '../src/common/editor/ui/lightscaper/PhotoDevelopWorkspace.tsx';
import { usePhotoDevelopSettings } from '../src/common/editor/ui/lightscaper/use-photo-develop-settings.ts';
import { photoDevelopCopy } from '../src/common/i18n/lightscaper-develop-copy.ts';
import { PHOTO_DEVELOP_RENDER_RUNTIME_V1 } from '../src/lightscaper/photo-develop-render-runtime-v1.ts';
import type { ExecutePhotoDevelopV1 } from '../src/common/editor/controller/shared/photo-library-develop-workflow-v1.ts';
import type { PhotoLibraryDevelopOriginalPortV1 } from '../src/common/editor/photo-library-develop-original-port-v1.ts';
import { developBatchFixture } from './helpers/lightscaper-develop-batch-fixture.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';
import { settle } from './helpers/async-test-control.ts';

for (const locale of ['en', 'de']) test(`${locale}: mounted inspection resets on selection/owner replacement and refuses retained menu handlers`, async () => {
	const f = await developBatchFixture(), copy = photoDevelopCopy(locale), originals: string[] = [];
	let generation: object = {}, photoId = f.photos[0]!.id, closes = 0;
	const before = await f.repository.loadPhoto('catalog', photoId);
	const execute: ExecutePhotoDevelopV1 = async (run, signal) => {
		await run({ signal: signal!, acquire: async () => f.owner.develop, isCurrent: () => true, refresh: async () => undefined });
	};
	const withOriginalFrame: PhotoLibraryDevelopOriginalPortV1['withFrame'] = async request => {
		originals.push(request.photoId); throw Error('No original body in this mounted ownership witness');
	};
	const readPreview = async () => ({ outcome: 'missing' as const });
	const loadProxy = async () => PHOTO_DEVELOP_RENDER_RUNTIME_V1, beforePresent = Promise.resolve();
	const registerRetirement = () => () => undefined;
	// This ownership witness doubles only native backing retirement. Pixel
	// presentation is qualified by the browser workflow and actual-kernel tests.
	const priorCanvas = Object.getOwnPropertyDescriptor(globalThis, 'HTMLCanvasElement');
	const widths = new WeakMap<object, number>(), heights = new WeakMap<object, number>();
	class CanvasRetirement {
		get width(): number { return widths.get(this) ?? 0; }
		set width(value: number) { widths.set(this, value); }
		get height(): number { return heights.get(this) ?? 0; }
		set height(value: number) { heights.set(this, value); }
	}
	Object.defineProperty(globalThis, 'HTMLCanvasElement', { configurable: true, value: CanvasRetirement });
	function View() {
		const settings = usePhotoDevelopSettings({ generation, execute });
		return <PhotoDevelopWorkspace locale={locale} photoId={photoId} label="Source" catalogId="catalog" generation={generation} execute={execute}
			settings={settings} withOriginalFrame={withOriginalFrame} readPreview={readPreview} loadProxy={loadProxy} beforePresent={beforePresent}
			registerRetirement={registerRetirement} onClose={() => { closes++; }} />;
	}
	const mounted = await mountPhotoImportUi(() => <StrictMode><View /></StrictMode>);
	const button = (label: string): ReactTestElement => {
		const target = mounted.dom.container.querySelectorAll('button').find(node => node.textContent === label); assert.ok(target, label); return target;
	};
	const flush = async () => { await act(async () => { await settle(4); }); };
	const click = async (target: ReactTestElement) => { await act(async () => { reactProps(target).onClick?.({ currentTarget: target }); await settle(4); }); };
	const pressed = (label: string) => button(label).getAttribute('aria-pressed') === 'true';
	try {
		await flush(); assert.equal(pressed(copy.fitResolution), true); assert.equal(originals.length, 0);
		const staleFull = reactProps(button(copy.fullResolution)).onClick;
		await click(button(copy.fullResolution)); assert.equal(pressed(copy.fullResolution), true); assert.deepEqual(originals, [photoId]);
		const images = mounted.dom.container.querySelector('.lightscaper-develop-images'); assert.equal(images?.getAttribute('data-resolution'), 'full');
		const viewport = mounted.dom.container.querySelector('.lightscaper-develop-scroll'); assert.equal(viewport?.getAttribute('tabindex'), '0');
		assert.equal(viewport?.getAttribute('role'), 'region'); assert.equal(viewport?.getAttribute('aria-label'), copy.imageViewport);
		await click(button(copy.fitResolution)); assert.equal(pressed(copy.fitResolution), true);
		await act(async () => { staleFull?.({}); await settle(4); }); assert.equal(pressed(copy.fitResolution), true); assert.equal(originals.length, 1);
		await click(button(copy.fullResolution)); const staleFit = reactProps(button(copy.fitResolution)).onClick;
		generation = {}; await mounted.render(); await flush(); assert.equal(pressed(copy.fitResolution), true);
		await click(button(copy.fullResolution)); assert.equal(pressed(copy.fullResolution), true);
		await act(async () => { staleFit?.({}); await settle(4); }); assert.equal(pressed(copy.fullResolution), true);
		const previousFull = reactProps(button(copy.fullResolution)).onClick;
		photoId = f.photos[1]!.id; await mounted.render(); await flush(); assert.equal(pressed(copy.fitResolution), true);
		const count = originals.length; await act(async () => { previousFull?.({}); await settle(4); }); assert.equal(originals.length, count);
		await click(button(copy.fullResolution)); assert.equal(originals.at(-1), photoId);
		const retired = reactProps(button(copy.fitResolution)).onClick;
		await click(button(copy.close)); await act(async () => { retired?.({}); await settle(4); }); assert.equal(closes, 1);
		assert.deepEqual(await f.repository.loadPhoto('catalog', f.photos[0]!.id), before);
		assert.equal((await f.owner.develop.read({ schemaVersion: 1, photoId })).revision, 0);
	} finally {
		try { await mounted.dispose(); await f.close(); }
		finally { if (priorCanvas) Object.defineProperty(globalThis, 'HTMLCanvasElement', priorCanvas); else Reflect.deleteProperty(globalThis, 'HTMLCanvasElement'); }
	}
});

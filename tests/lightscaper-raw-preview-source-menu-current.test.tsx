/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React, { act, StrictMode, type ReactNode } from 'react';
import LightscaperAppCurrentV1, { type LightscaperAppPropsCurrentV1 } from '../src/common/editor/ui/lightscaper/LightscaperAppCurrentV1.tsx';
import LightscaperAppV2 from '../src/common/editor/ui/lightscaper/LightscaperAppV2.tsx';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import type { PhotoLibraryPreviewReadOptionsCurrentV1 } from '../src/common/editor/photo-library-session-port-current-v1.ts';
import { bundledLightscaperEditorCopyForLocale } from '../src/common/i18n/lightscaper-editor-copy.ts';
import { seedCurrentAppPhoto, currentAppLocks, currentAppCanvasBoundary } from './helpers/lightscaper-current-app-fixture.tsx';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { deferred, settle, waitFor } from './helpers/async-test-control.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';

const COPY = {
	en: { menu: 'RAW preview source', neutral: 'Neutral Original (default)', camera: 'Camera embedded (when available)', view: 'View' },
	de: { menu: 'RAW-Vorschauquelle', neutral: 'Neutrales Original (Standard)', camera: 'Kameravorschau (falls verfügbar)', view: 'Ansicht' },
} as const;

const priorKeyRange = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (priorKeyRange) Object.defineProperty(globalThis, 'IDBKeyRange', priorKeyRange); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });

function mountApp(render: () => ReactNode) {
	return mountPhotoImportUi(() => {
		// The inert host observes no website workspace; App still publishes its
		// actual event through the same window API before the menu assertion.
		Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: (_event: Event) => true });
		return render();
	});
}

type Mounted = Awaited<ReturnType<typeof mountApp>>;
function button(mounted: Mounted, name: string) {
	const result = mounted.dom.container.querySelectorAll('button').find(node => node.textContent === name);
	assert.ok(result, `Missing actual App action ${name}`); return result;
}
async function click(mounted: Mounted, name: string) {
	const target = button(mounted, name); assert.equal(target.hasAttribute('disabled'), false);
	await act(async () => { reactProps(target).onClick?.({ currentTarget: target }); await settle(); });
}

// Scalar App presentation witness only: no synthetic body, RAW decoder or
// preview is claimed. The actual App must expose this preference through View
// while remaining inert before the user activates the library/preview.
for (const locale of ['en', 'de'] as const) test(`${locale}: Current RAW source choice lives in View and defaults to neutral Original without opening a Session`, async () => {
	let opens = 0;
	const createSession = async (): Promise<never> => { opens++; throw new Error('An inert menu must not acquire a library Session.'); };
	const mounted = await mountApp(() => <StrictMode><LightscaperAppCurrentV1 locale={locale} createSession={createSession} /></StrictMode>);
	try {
		const menu = mounted.dom.container.querySelectorAll('details').find(node => node.querySelector('summary')?.textContent === COPY[locale].menu);
		assert.ok(menu, 'The actual Current App must offer its RAW source choice in the existing View menu.');
		const view = mounted.dom.container.querySelectorAll('details').find(node => node.querySelector('summary')?.textContent === COPY[locale].view);
		assert.ok(view); assert.equal(view.contains(menu), true);
		const neutral = menu.querySelectorAll('button').find(node => node.textContent === COPY[locale].neutral);
		const camera = menu.querySelectorAll('button').find(node => node.textContent === COPY[locale].camera);
		assert.ok(neutral); assert.ok(camera);
		assert.equal(neutral.getAttribute('aria-pressed'), 'true'); assert.equal(camera.getAttribute('aria-pressed'), 'false');
		assert.equal(mounted.dom.find('canvas'), null); assert.equal(mounted.dom.find('[data-photo-library]'), null);
		assert.equal(opens, 0);
	} finally { await mounted.dispose(); }
});

test('legacy App keeps its existing View menu without a Current RAW source preference', async () => {
	const mounted = await mountApp(() => <LightscaperAppV2 locale="en" />);
	try {
		assert.equal(mounted.dom.container.querySelectorAll('summary').some(node => node.textContent === COPY.en.menu), false);
		assert.equal(mounted.dom.container.querySelectorAll('button').some(node => node.textContent === COPY.en.camera), false);
	} finally { await mounted.dispose(); }
});

test('actual Current culling cancels the prior source and joins its held read before acquiring the camera preference', async () => {
	const native = mediaRestoreFixture(), seeded = await seedCurrentAppPhoto(native.factory, currentAppLocks());
	const released = deferred<void>(), canvas = currentAppCanvasBoundary(), copy = bundledLightscaperEditorCopyForLocale('en');
	const reads: Readonly<PhotoLibraryPreviewReadOptionsCurrentV1>[] = [], sessions: Awaited<ReturnType<typeof createPhotoLibrarySessionCurrentV1>>[] = [];
	let active = 0, maximum = 0;
	const createSession = async () => {
		const session = await createPhotoLibrarySessionCurrentV1(seeded.options); sessions.push(session);
		Object.defineProperty(session, 'readPreview', { configurable: true, value: async (photoId: string, _tier: 'thumbnail' | 'fit-screen', options: Readonly<PhotoLibraryPreviewReadOptionsCurrentV1> = {}) => {
			assert.equal(photoId, seeded.photo.id); reads.push(options); active++; maximum = Math.max(maximum, active);
			try {
				if (reads.length === 1) await released.promise;
				// This body-free port witness deliberately delivers even an aborted
				// old outcome. The actual presenter must fence it and join the call.
				return { outcome: 'missing' as const };
			} finally { active--; }
		} });
		return session;
	};
	const mounted = await mountApp(() => <StrictMode><LightscaperAppCurrentV1 locale="en" createSession={createSession} /></StrictMode>);
	try {
		await click(mounted, copy.photoShowLibrary);
		await waitFor(async () => { await act(async () => { await settle(); }); return mounted.dom.find('[data-photo-id]') !== null; }, 'actual native catalog row');
		await click(mounted, copy.photoShowThumbnails);
		await waitFor(async () => { await act(async () => { await settle(); }); return reads.length === 1; }, 'first neutral culling read');
		assert.equal(reads[0]!.rawPreviewSource, 'neutral-original'); assert.equal(reads[0]!.signal?.aborted, false);
		await click(mounted, COPY.en.camera);
		assert.equal(button(mounted, COPY.en.camera).getAttribute('aria-pressed'), 'true');
		assert.equal(reads[0]!.signal?.aborted, true); assert.equal(reads.length, 1); assert.equal(active, 1);
		await act(async () => { await settle(2); }); assert.equal(reads.length, 1, 'new source cannot acquire ahead of old delivery');
		await act(async () => { released.resolve(); await settle(); });
		await waitFor(async () => { await act(async () => { await settle(); }); return reads.length === 2; }, 'joined camera culling read');
		assert.equal(reads[1]!.rawPreviewSource, 'camera-embedded'); assert.equal(reads[1]!.signal?.aborted, false);
		assert.equal(maximum, 1); assert.equal(sessions.length, 1);
		await click(mounted, COPY.en.camera); assert.equal(reads.length, 2, 'choosing the selected preference does not restart demand');
		await click(mounted, COPY.en.neutral);
		await waitFor(async () => { await act(async () => { await settle(); }); return reads.length === 3; }, 'restored neutral culling read');
		assert.equal(reads[2]!.rawPreviewSource, 'neutral-original'); assert.equal(maximum, 1);
	} finally {
		released.resolve();
		try { await mounted.dispose(); await Promise.all(sessions.map(session => session.close())); }
		finally { canvas.restore(); }
	}
});

test('Current source preference resets with the App factory and retained menu handlers cannot change the replacement generation', async () => {
	let opens = 0;
	const unavailable = async (): Promise<never> => { opens++; throw new Error('An inert menu cannot acquire a Session.'); };
	let props: LightscaperAppPropsCurrentV1 = { locale: 'en', createSession: unavailable };
	const mounted = await mountApp(() => <LightscaperAppCurrentV1 {...props} />);
	try {
		await click(mounted, COPY.en.camera); assert.equal(button(mounted, COPY.en.camera).getAttribute('aria-pressed'), 'true');
		const oldButton = button(mounted, COPY.en.camera), retained = reactProps(oldButton).onClick;
		props = { ...props, createSession: async () => unavailable() }; await mounted.render();
		assert.equal(button(mounted, COPY.en.neutral).getAttribute('aria-pressed'), 'true');
		await act(async () => { retained?.({ currentTarget: oldButton }); await settle(); });
		assert.equal(button(mounted, COPY.en.neutral).getAttribute('aria-pressed'), 'true'); assert.equal(opens, 0);
	} finally { await mounted.dispose(); }
});

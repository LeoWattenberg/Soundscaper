/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import React, { act, Profiler, StrictMode, type ReactNode } from 'react';
import LightscaperAppCurrentV1, { type LightscaperAppPropsCurrentV1 } from '../src/common/editor/ui/lightscaper/LightscaperAppCurrentV1.tsx';
import { createPhotoLibrarySessionCurrentV1 } from '../src/lightscaper/photo-library-session-runtime-current-v1.ts';
import { createPhotoDevelopRenderRuntimeV3 } from '../src/lightscaper/photo-develop-render-runtime-v3.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { photoDevelopSettingsCopy } from '../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopMenuLabel } from '../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { bundledLightscaperEditorCopyForLocale } from '../src/common/i18n/lightscaper-editor-copy.ts';
import { seedCurrentAppPhoto, currentAppLocks, currentAppCanvasBoundary } from './helpers/lightscaper-current-app-fixture.tsx';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';
import { settle, waitFor } from './helpers/async-test-control.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (prior) Object.defineProperty(globalThis, 'IDBKeyRange', prior); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });

async function mountCurrentApp(render: () => ReactNode, closeSessions: () => Promise<void>) {
	const canvas = currentAppCanvasBoundary();
	const target = new EventTarget(), methods = { dispatchEvent: target.dispatchEvent.bind(target),
		addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target) };
	const previous = new Map<string, PropertyDescriptor | undefined>(); let host: Window | undefined;
	const restore = () => { if (host) for (const [key, descriptor] of previous) {
		if (descriptor) Object.defineProperty(host, key, descriptor); else Reflect.deleteProperty(host, key);
	} };
	try {
		const mounted = await mountPhotoImportUi(() => {
			if (!host) { host = window; for (const [key, value] of Object.entries(methods)) {
				previous.set(key, Object.getOwnPropertyDescriptor(host, key)); Object.defineProperty(host, key, { configurable: true, value });
			} }
			return render();
		});
		return { ...mounted, async dispose() { try { await mounted.dispose(); } finally {
			try { await closeSessions(); } finally { canvas.restore(); restore(); }
		} } };
	} catch (error) { try { await closeSessions(); } finally { canvas.restore(); restore(); } throw error; }
}

interface CommitObservation { commits: number; failure?: unknown; }
class CommitBoundary extends React.Component<Readonly<{ observation: CommitObservation; children: ReactNode }>, { failed: boolean }> {
	state = { failed: false };
	static getDerivedStateFromError() { return { failed: true }; }
	componentDidCatch(error: Error) { this.props.observation.failure = error; }
	render() { return this.state.failed ? null : this.props.children; }
}

for (const locale of ['en', 'de']) test(`${locale}: Current App keeps Repair behind the existing Develop menu and shares the actual selected Session`, async () => {
	const native = mediaRestoreFixture(), seeded = await seedCurrentAppPhoto(native.factory, currentAppLocks()), copy = bundledLightscaperEditorCopyForLocale(locale);
	const sessions: Awaited<ReturnType<typeof createPhotoLibrarySessionCurrentV1>>[] = [];
	let opens = 0, renderers = 0;
	const props: LightscaperAppPropsCurrentV1 = { locale,
		createSession: async () => { opens++; const session = await createPhotoLibrarySessionCurrentV1(seeded.options); sessions.push(session); return session; },
		loadDevelopProxyRuntime: async (source, maskSource) => { renderers++; return createPhotoDevelopRenderRuntimeV3({ source, ...(maskSource ? { maskSource } : {}) }); } };
	const mounted = await mountCurrentApp(() => <StrictMode><LightscaperAppCurrentV1 {...props} /></StrictMode>, async () => { await Promise.all(sessions.map(session => session.close())); });
	const button = (name: string) => { const found = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === name); assert.ok(found, name); return found; };
	const click = async (name: string) => { const value = button(name); await act(async () => { reactProps(value).onClick?.({ currentTarget: value }); await settle(); }); };
	try {
		assert.equal(opens, 0); assert.equal(renderers, 0); assert.equal(mounted.dom.find('[data-photo-develop-workspace]'), null);
		const repairName = locale === 'de' ? 'Flecken reparieren…' : 'Repair spots…';
		assert.equal(mounted.dom.container.querySelectorAll('button').some(value => value.textContent === repairName), false);
		await click(copy.photoShowLibrary);
		await waitFor(async () => { await act(async () => { await settle(); }); return mounted.dom.find('[data-photo-id]') !== null; }, 'actual selected Current library');
		const card = mounted.dom.one('[data-photo-id]'); await act(async () => { reactProps(card).onClick?.({ ctrlKey: false, metaKey: false, shiftKey: false }); });
		await click(photoDevelopMenuLabel(locale));
		await waitFor(async () => { await act(async () => { await settle(); }); return mounted.dom.container.querySelectorAll('button').some(value => value.textContent === repairName && !reactProps(value).disabled); }, 'Current Repair menu');
		assert.equal(opens, 1); assert.equal(mounted.dom.find('[data-photo-repair-spots-dialog]'), null);
		await click(repairName);
		await waitFor(async () => { await act(async () => { await settle(); }); return mounted.dom.find('[data-photo-repair-spots-dialog]') !== null; }, 'menu-owned Repair dialog');
		assert.equal(opens, 1); assert.ok(renderers <= 1);
	} finally { await mounted.dispose(); }
});

test('Current App keeps a retained Develop menu handler retired across actual renderer generation replacement', async () => {
	const native = mediaRestoreFixture(), seeded = await seedCurrentAppPhoto(native.factory, currentAppLocks()), copy = bundledLightscaperEditorCopyForLocale('en');
	const sessions: Awaited<ReturnType<typeof createPhotoLibrarySessionCurrentV1>>[] = [];
	const createSession = async () => { const session = await createPhotoLibrarySessionCurrentV1(seeded.options); sessions.push(session); return session; };
	let props: LightscaperAppPropsCurrentV1 = { locale: 'en', createSession,
		loadDevelopProxyRuntime: async (source, maskSource) => createPhotoDevelopRenderRuntimeV3({ source, ...(maskSource ? { maskSource } : {}) }) };
	const mounted = await mountCurrentApp(() => <LightscaperAppCurrentV1 {...props} />, async () => { await Promise.all(sessions.map(session => session.close())); });
	const button = (name: string) => { const found = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === name); assert.ok(found, name); return found; };
	try {
		await act(async () => { const shown = button(copy.photoShowLibrary); reactProps(shown).onClick?.({ currentTarget: shown }); await settle(); });
		await waitFor(async () => { await act(async () => { await settle(); }); return mounted.dom.find('[data-photo-id]') !== null; }, 'Current library before replacement');
		const card = mounted.dom.one('[data-photo-id]'); await act(async () => { reactProps(card).onClick?.({ ctrlKey: false, metaKey: false, shiftKey: false }); });
		const menu = button(photoDevelopMenuLabel('en')), stale = reactProps(menu).onClick;
		props = { ...props, loadDevelopProxyRuntime: async (source, maskSource) => createPhotoDevelopRenderRuntimeV3({ source, ...(maskSource ? { maskSource } : {}) }) };
		await mounted.render(); await act(async () => { stale?.({ currentTarget: menu }); await settle(); });
		assert.equal(mounted.dom.find('[data-photo-develop-workspace]'), null); assert.equal(mounted.dom.find('[data-photo-repair-spots-dialog]'), null);
	} finally { await mounted.dispose(); }
});


test('unrepaired Current App keeps genuine selected settings Copy delivery live across its own busy render', async () => {
	const native = mediaRestoreFixture(), seeded = await seedCurrentAppPhoto(native.factory, currentAppLocks());
	const preparation = await createPhotoLibrarySessionCurrentV1(seeded.options);
	try {
		const selected = await preparation.develop.read({ schemaVersion: 3, photoId: seeded.photo.id });
		await preparation.develop.apply({ schemaVersion: 3, photoId: seeded.photo.id, expectedRevision: selected.revision,
			command: { type: 'record-develop', versionId: selected.versionId, develop: defaultImageDevelopStateV2(), label: 'Unrepaired', createdAt: '2026-10-11T00:00:00.000Z' } });
		const legacy = await preparation.legacyDevelop!.read({ schemaVersion: 2, photoId: seeded.photo.id });
		assert.equal(legacy.develop.processVersion, 2);
	} finally { await preparation.close(); }
	let release!: () => void;
	const held = new Promise<void>(resolve => { release = resolve; });
	const observed: { signal?: AbortSignal; calls: number; nativeReads: Promise<unknown>[] } = { calls: 0, nativeReads: [] };
	const rendering: CommitObservation = { commits: 0 };
	const sessions: Awaited<ReturnType<typeof createPhotoLibrarySessionCurrentV1>>[] = [];
	const copy = bundledLightscaperEditorCopyForLocale('en'), settings = photoDevelopSettingsCopy('en', 'current3');
	const props: LightscaperAppPropsCurrentV1 = { locale: 'en', createSession: async () => {
		const session = await createPhotoLibrarySessionCurrentV1(seeded.options), port = session.develop, child = port.settingsCurrent;
		sessions.push(session); assert.ok(child, 'The actual Current settings child is available on an unrepaired native Photo.');
		const copySelected = child.copySelected;
		const selected = Object.freeze({ ...child,
			async copySelected(this: unknown, request: Parameters<typeof copySelected>[0], options: Parameters<typeof copySelected>[1]) {
				assert.equal(this, session.develop.settingsCurrent); observed.calls++; observed.signal ??= options?.signal;
				// Invoke the actual selected source reader with its real receiver;
				// preserve the exact issued packet and hold only its delivery.
				const nativeRead = Reflect.apply(copySelected, child, [request, options]) as ReturnType<typeof copySelected>;
				const outcome = nativeRead.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
				observed.nativeReads.push(outcome); const result = await outcome; await held;
				if (!result.ok) throw result.error;
				assert.equal(result.value.schemaVersion, 3); assert.equal(result.value.develop.processVersion, 2); return result.value;
			},
		});
		Object.defineProperty(session, 'develop', { configurable: true, value: Object.freeze({ ...port, settingsCurrent: selected }) });
		return session;
	}, loadDevelopProxyRuntime: async (source, maskSource) => createPhotoDevelopRenderRuntimeV3({ source, ...(maskSource ? { maskSource } : {}) }) };
	const mounted = await mountCurrentApp(() => <CommitBoundary observation={rendering}><Profiler id="current-settings-copy" onRender={() => {
		if (++rendering.commits > 50) throw new Error('The genuine Current selected Copy exceeded 50 App commits.');
	}}><LightscaperAppCurrentV1 {...props} /></Profiler></CommitBoundary>, async () => { await Promise.all(sessions.map(session => session.close())); });
	const button = (name: string) => { const found = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === name); assert.ok(found, name); return found; };
	const click = async (name: string) => { const value = button(name); await act(async () => { reactProps(value).onClick?.({ currentTarget: value }); await settle(); }); };
	try {
		await click(copy.photoShowLibrary);
		await waitFor(async () => { await act(async () => { await settle(); }); return mounted.dom.find('[data-photo-id]') !== null; }, 'unrepaired actual selected library');
		const card = mounted.dom.one('[data-photo-id]'); await act(async () => { reactProps(card).onClick?.({ ctrlKey: false, metaKey: false, shiftKey: false }); });
		await click(photoDevelopMenuLabel('en'));
		await waitFor(async () => { await act(async () => { await settle(); }); return mounted.dom.container.querySelectorAll('button').some(value => value.textContent === settings.copy && !reactProps(value).disabled); }, 'genuine Current settings menu');
		await click(settings.copy); await click(settings.confirmCopy);
		await waitFor(async () => { await act(async () => { await settle(); }); return rendering.failure !== undefined || observed.calls > 0; }, 'actual selected Copy reader entry');
		assert.equal(rendering.failure, undefined, 'The selected settings owner must not restart across busy renders.');
		await Promise.all(observed.nativeReads); await act(async () => { await settle(); });
		assert.ok(observed.signal); assert.equal(observed.signal.aborted, false, 'The same settings owner survives its action busy render.');
		assert.equal(observed.calls, 1); assert.equal(mounted.dom.container.querySelectorAll('p').some(value => value.textContent === settings.copied), false);
		assert.ok(button(settings.confirmCopy), 'The child dialog awaits joined actual packet delivery.'); release();
		await waitFor(async () => { await act(async () => { await settle(); }); return rendering.failure !== undefined
			|| mounted.dom.container.querySelectorAll('p').some(value => value.textContent === settings.copied); }, 'selected Packet3 clipboard publication');
		assert.equal(rendering.failure, undefined); assert.ok(rendering.commits <= 50); assert.equal(observed.calls, 1);
		assert.equal(observed.signal.aborted, false); assert.equal(mounted.dom.container.querySelectorAll('p').some(value => value.textContent === settings.copied), true);
		assert.equal(mounted.dom.container.querySelectorAll('button').some(value => value.textContent === settings.confirmCopy), false);
	} finally { release(); await Promise.all(observed.nativeReads); await mounted.dispose(); }
});

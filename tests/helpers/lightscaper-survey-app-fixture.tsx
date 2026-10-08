/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import React, { act, StrictMode } from 'react';
import LightscaperApp from '../../src/common/editor/ui/lightscaper/LightscaperApp.tsx';
import type { CreatePhotoLibrarySessionV1, PhotoLibraryRowV1 } from '../../src/common/editor/photo-library-session-port-v1.ts';
import type { LoadPhotoLibraryBackupSaveRuntimeV1 } from '../../src/common/editor/ui/lightscaper/use-photo-library-workflow.ts';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { createImportTestPort } from './photo-import-workflow-fixture.tsx';
import { mountPhotoImportUi } from './photo-import-options-react-fixture.tsx';
import { reactProps, type ReactTestElement } from './react-test-dom.ts';
import { settle } from './async-test-control.ts';

export const SURVEY_APP_ROWS: readonly PhotoLibraryRowV1[] = Object.freeze(['a', 'b', 'c', 'd'].map(id => Object.freeze({
	id, fileName: `${id}.png`, width: 2, height: 3, rating: 0, flag: 'unflagged', colorLabel: 'none',
})));

export function surveyAppOwner() {
	const port = createImportTestPort(); let opens = 0, rows = [...SURVEY_APP_ROWS];
	const writes: [string, Partial<PhotoLibraryRowV1>][] = [], signals: (AbortSignal | undefined)[] = [];
	const previews: [string, string, AbortSignal | undefined][] = [];
	port.readPage = async () => ({ catalogName: 'Library', totalCount: rows.length, rows, cursor: null });
	port.readPreview = async (id, tier, options) => { previews.push([id, tier, options?.signal]); return { outcome: 'missing' }; };
	port.setRating = async (id, rating, options) => {
		writes.push([id, { rating }]); signals.push(options?.signal);
		const found = rows.find(row => row.id === id); assert.ok(found); const result = { ...found, rating };
		rows = rows.map(row => row.id === id ? result : row); return result;
	};
	port.applyAttributes = async (id, changes) => {
		writes.push([id, changes]); const found = rows.find(row => row.id === id); assert.ok(found); const result = { ...found, ...changes };
		rows = rows.map(row => row.id === id ? result : row); return result;
	};
	return { port, writes, signals, previews, opens: () => opens, factory: async () => { opens++; return port; } };
}

export async function mountSurveyApp(initialFactory: CreatePhotoLibrarySessionV1, locale = 'en') {
	let factory = initialFactory, loader: LoadPhotoLibraryBackupSaveRuntimeV1 | undefined;
	// Ownership only: missing previews and clearing zero-sized canvases. Native
	// browser workflows independently qualify actual pixel bytes and backing.
	const priorCanvas = Object.getOwnPropertyDescriptor(globalThis, 'HTMLCanvasElement');
	class ScalarCanvasBacking {}
	for (const name of ['width', 'height']) Object.defineProperty(ScalarCanvasBacking.prototype, name, {
		get(this: ReactTestElement) { assert.equal(this.nodeName, 'CANVAS'); return Number(this.getAttribute(name) ?? 0); },
		set(this: ReactTestElement, value: number) { assert.equal(this.nodeName, 'CANVAS'); assert.equal(value, 0); this.setAttribute(name, String(value)); },
	});
	Object.defineProperty(globalThis, 'HTMLCanvasElement', { configurable: true, value: ScalarCanvasBacking });
	const restoreCanvas = () => {
		if (priorCanvas) Object.defineProperty(globalThis, 'HTMLCanvasElement', priorCanvas); else Reflect.deleteProperty(globalThis, 'HTMLCanvasElement');
	};
	const mounted = await mountPhotoImportUi(() => {
		Object.defineProperty(window, 'dispatchEvent', { configurable: true, value: () => true });
		return <StrictMode><LightscaperApp locale={locale} createSession={factory} loadBackupSaveRuntime={loader} /></StrictMode>;
	}).catch((error: unknown) => { restoreCanvas(); throw error; });
	const flush = async (work: () => void = () => undefined) => { await act(async () => { work(); await settle(); }); };
	const click = async (target: ReactTestElement, ctrlKey = false) => {
		assert.equal(target.hasAttribute('disabled'), false);
		await flush(() => { target.focus(); reactProps(target).onFocus?.({ currentTarget: target }); reactProps(target).onClick?.({ currentTarget: target, ctrlKey, metaKey: false, shiftKey: false }); });
	};
	const menu = async (text: string) => {
		const button = mounted.dom.container.querySelectorAll('button').find(value => value.textContent === text); assert.ok(button, `Missing action ${text}`); await click(button);
	};
	return { ...mounted, flush, click, menu, copy: bundledLightscaperEditorCopyForLocale(locale),
		dispose: async () => { try { await mounted.dispose(); } finally { restoreCanvas(); } },
		photo: async (id: string, toggle = false) => { await click(mounted.dom.one(`[data-photo-id="${id}"]`), toggle); },
		selected: () => mounted.dom.container.querySelectorAll('[data-photo-id]').filter(value => value.getAttribute('aria-pressed') === 'true').map(value => value.getAttribute('data-photo-id')),
		key: async (id: string, key: string) => { await flush(() => { const target = mounted.dom.one(`[data-survey-photo="${id}"]`); target.focus(); reactProps(target).onKeyDown?.({ key, target, currentTarget: target, preventDefault() {} }); }); },
		replace: async (next: CreatePhotoLibrarySessionV1) => { factory = next; await mounted.render(); },
		replaceLoader: async (next: LoadPhotoLibraryBackupSaveRuntimeV1) => { loader = next; await mounted.render(); },
	};
}

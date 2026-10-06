/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildLocalDiagnosticsReport, createLocalDiagnosticsRuntimeIdentity } from '../src/common/editor/local-diagnostics-report.ts';
import { AUDACITY_ACTION_STATUS, audacityActionDefinition } from '../src/common/editor/audacity-action-parity.js';
import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import LocalDiagnosticsDialog, { LocalDiagnosticsDialogView } from '../src/common/editor/ui/dialogs/LocalDiagnosticsDialog.tsx';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { createAudioEditorFileService } from '../src/common/editor/file-service.js';

const REPORT = buildLocalDiagnosticsReport({
	generatedAt: '2026-08-29T10:11:12.000Z',
	applicationVersion: '1.0.0-rc.1',
	productId: 'soundscaper',
	runtime: createLocalDiagnosticsRuntimeIdentity({
		isDesktop: false, locale: 'en', navigator: {},
	}),
	capabilities: { project: true, audioPlayback: true },
	streaming: { streamUnderrunFrames: 64, streamedPlaybackObserved: true },
	snapshot: { project: null, projects: [], projectTabs: [], storage: {} },
	diagnostics: { recentErrors: [] },
});

test('both bundled locales carry every local diagnostics surface string', () => {
	for (const copy of [ENGLISH_COPY, GERMAN_COPY]) {
		for (const key of [
			'diagnostics', 'localDiagnosticsTitle', 'localDiagnosticsPrivacy', 'localDiagnosticsGenerate', 'localDiagnosticsGenerating',
			'localDiagnosticsExport', 'localDiagnosticsExporting', 'localDiagnosticsSaved',
			'localDiagnosticsError', 'localDiagnosticsVersions', 'localDiagnosticsEnvironment',
			'localDiagnosticsCapabilities', 'localDiagnosticsErrors', 'localDiagnosticsStorage',
			'localDiagnosticsRecovery', 'localDiagnosticsStreaming',
			'localDiagnosticsStreamingSummary', 'localDiagnosticsStreamingObserved',
			'localDiagnosticsStreamingNotObserved',
		]) {
			assert.equal(typeof copy[key], 'string', `${key} is missing`);
			assert.ok(copy[key].length > 0, `${key} is empty`);
		}
	}
});

test('the dialog is inert before generation and exposes only diagnostic summaries afterwards', () => {
	const waiting = renderToStaticMarkup(<LocalDiagnosticsDialogView
		copy={ENGLISH_COPY}
		report={null}
		phase="idle"
		onClose={() => undefined}
		onGenerate={() => undefined}
		onExport={() => undefined}
	/>);
	assert.match(waiting, /Local Diagnostics/u);
	assert.match(waiting, /stays on this device/u);
	assert.match(waiting, /data-local-diagnostics-generate/u);
	assert.doesNotMatch(waiting, /data-local-diagnostics-export/u);

	const ready = renderToStaticMarkup(<LocalDiagnosticsDialogView
		copy={ENGLISH_COPY}
		report={REPORT}
		phase="ready"
		onClose={() => undefined}
		onGenerate={() => undefined}
		onExport={() => undefined}
	/>);
	assert.match(ready, /Versions/u);
	assert.match(ready, /Environment/u);
	assert.match(ready, /Capabilities/u);
	assert.match(ready, /Recent typed errors/u);
	assert.match(ready, /Storage and library/u);
	assert.match(ready, /Recovery journals/u);
	assert.match(ready, /Streamed playback/u);
	assert.match(ready, /data-stream-underrun-frames="64"/u);
	assert.match(ready, /data-streamed-playback-observed="true"/u);
	assert.match(ready, /data-local-diagnostics-export/u);
	assert.doesNotMatch(ready, /private-project|Secret interview|operator|confidential/u);
});

test('a failed refresh removes the prior diagnostics report and its Export action', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let failEnvironment = false;
	const recordedErrors: unknown[] = [];
	try {
		await act(async () => root.render(<LocalDiagnosticsDialog
			controller={{
				getSnapshot: () => ({ project: null, projects: [], projectTabs: [], storage: {} }),
				getLocalDiagnosticsSnapshot: () => ({ recentErrors: [] }),
				recordLocalDiagnosticError: (error) => { recordedErrors.push(error); },
			}}
			copy={ENGLISH_COPY}
			fileService={{
				isDesktop: true,
				getEnvironment: async () => {
					if (failEnvironment) throw new Error('Environment unavailable.');
					return {};
				},
			}}
			locale="en"
			productId="soundscaper"
			onClose={() => undefined}
		/>));
		const generate = dom.one('[data-local-diagnostics-generate]');
		await act(async () => { reactProps(generate).onClick(); });
		assert.ok(dom.find('[data-local-diagnostics-summary]'));
		assert.ok(dom.find('[data-local-diagnostics-export]'));

		failEnvironment = true;
		await act(async () => { reactProps(generate).onClick(); });
		assert.equal(recordedErrors.length, 1);
		assert.match(dom.container.textContent, /could not be created or exported/u);
		assert.equal(Boolean(dom.find('[data-local-diagnostics-summary]')), false);
		assert.equal(Boolean(dom.find('[data-local-diagnostics-export]')), false);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});

test('Help reaches local diagnostics in both product menus', () => {
	assert.equal(audacityActionDefinition('menu-diagnostics')?.status, AUDACITY_ACTION_STATUS.IMPLEMENTED);
	assert.equal(audacityActionDefinition('menu-diagnostics')?.handler, 'help.openDiagnostics');
	for (const productId of ['soundscaper', 'framescaper']) {
		const opened: string[] = [];
		const menus = createApplicationMenus(menuInput(productId, {
			openDiagnostics: () => opened.push(productId),
		}));
		const diagnostics = findMenuItem(menus, 'diagnostics');
		assert.ok(diagnostics);
		assert.equal(diagnostics.label, ENGLISH_COPY.diagnostics);
		assert.equal(diagnostics.disabled, undefined);
		diagnostics.onClick?.();
		assert.deepEqual(opened, [productId]);
	}
});

test('cancelling the desktop diagnostic report save leaves the report ready for retry', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let cancelPicker = true;
	let saveRequests = 0;
	let writtenSize = 0;
	let writes = 0;
	const errors: unknown[] = [];
	const fileService = createAudioEditorFileService({ bridge: {
		getEnvironment: () => ({}),
		chooseSaveTarget: (request: { purpose: string; suggestedName: string }) => {
			assert.equal(request.purpose, 'report');
			saveRequests += 1;
			return cancelPicker ? null : { id: 'chosen-report', name: request.suggestedName };
		},
		beginWrite: (request: { size: number }) => {
			writtenSize = request.size;
			writes += 1;
			return { writeId: 'report-write', chunkSize: 1024 * 1024 };
		},
		writeChunk: (request: { offset: number; bytes: Uint8Array }) => ({ nextOffset: request.offset + request.bytes.byteLength }),
		finishWrite: () => ({ byteLength: writtenSize }),
	} });
	try {
		await act(async () => root.render(<LocalDiagnosticsDialog
			controller={{
				getSnapshot: () => ({ project: null, projects: [], projectTabs: [], storage: {} }),
				getLocalDiagnosticsSnapshot: () => ({ recentErrors: [] }),
				recordLocalDiagnosticError: (error) => { errors.push(error); },
			}}
			copy={ENGLISH_COPY} fileService={fileService} locale="en" productId="soundscaper"
			onClose={() => undefined}
		/>));
		await act(async () => { reactProps(dom.one('[data-local-diagnostics-generate]')).onClick(); });
		await act(async () => { reactProps(dom.one('[data-local-diagnostics-export]')).onClick(); });
		assert.equal(saveRequests, 1);
		assert.equal(writes, 0);
		assert.equal(errors.length, 0);
		assert.equal(dom.one('[role="status"]').textContent, '');
		assert.equal(dom.one('[data-local-diagnostics-export]').hasAttribute('disabled'), false);
		cancelPicker = false;
		await act(async () => { reactProps(dom.one('[data-local-diagnostics-export]')).onClick(); });
		assert.equal(saveRequests, 2);
		assert.equal(writes, 1);
		assert.match(dom.one('[role="status"]').textContent, /report was exported/u);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});

interface MenuItem {
	readonly id?: string;
	readonly label?: string;
	readonly disabled?: boolean;
	readonly items?: readonly MenuItem[];
	onClick?(): unknown;
}

function findMenuItem(values: readonly unknown[], id: string): MenuItem | null {
	for (const item of values as readonly MenuItem[]) {
		if (item.id === id) return item;
		const nested = item.items ? findMenuItem(item.items, id) : null;
		if (nested) return nested;
	}
	return null;
}

function menuInput(productId: string, actions: Record<string, unknown>) {
	return {
		productId, aboutLabel: 'About', capabilities: {}, locale: 'en', copy: ENGLISH_COPY,
		project: null,
		snapshot: {
			project: null, selectedTrackId: null, deliveryReport: null,
			preferences: { workspace: {
				activeId: productId === 'framescaper' ? 'video-editor' : 'modern', custom: [],
				panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: false }])),
			}, view: {} },
			history: { canUndo: false, canRedo: false, hasClipboard: false },
			effects: { selectionTypes: [], canRepeatLast: false },
		},
		blocked: false, editBlocked: false, handoffBlocked: false, showArmControls: false,
		selectionActive: false, selectedClip: null, durationFrames: 0,
		effectsPanelOpen: false, projectBinEffectivelyOpen: false, uiFlags: {},
		actionRuntime: null,
		actions: new Proxy({ ...actions }, {
			get: (target, property, receiver) => Reflect.has(target, property)
				? Reflect.get(target, property, receiver)
				: () => undefined,
		}),
	};
}

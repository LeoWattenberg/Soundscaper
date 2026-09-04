/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { buildLocalDiagnosticsReport, createLocalDiagnosticsRuntimeIdentity } from '../src/common/editor/local-diagnostics-report.ts';
import { AUDACITY_ACTION_STATUS, audacityActionDefinition } from '../src/common/editor/audacity-action-parity.js';
import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { LocalDiagnosticsDialogView } from '../src/common/editor/ui/dialogs/LocalDiagnosticsDialog.tsx';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';

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

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import {
	CueImportDestinationDialog,
	useCueImportWorkspace,
	WorkspaceImportInput,
} from '../src/common/editor/ui/workspace/cue-import-workspace.tsx';
import { createWorkspaceApplicationMenus } from '../src/common/editor/ui/workspace/workspace-application-menu-runtime.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

test('the shared File import input always targets the timeline', () => {
	const imports: Array<Readonly<{ files: readonly File[]; options: unknown }>> = [];
	const input = WorkspaceImportInput({
		accept: '.wav',
		copy: ENGLISH_COPY,
		importInputRef: { current: null },
		importRoutedFiles: (files, options) => imports.push({ files, options }),
		run: (operation) => operation(),
	});
	const file = { name: 'voice.wav' } as File;
	(input.props as Readonly<{ onChange(event: unknown): void }>).onChange({
		currentTarget: { files: [file], value: 'voice.wav' },
	});

	assert.deepEqual(imports, [{ files: [file], options: { destination: 'timeline' } }]);
});

test('desktop File import always targets the timeline', () => {
	const calls: unknown[][] = [];
	const menu = workspaceFileMenu((...args: unknown[]) => { calls.push(args); });
	const item = menu.items?.find(({ id }) => id === 'import-audio');
	assert.ok(item?.onClick);
	item.onClick();
	assert.deepEqual(calls, [['media', true, { destination: 'timeline' }]]);
});

test('normal file import asks whether a CUE sheet becomes markers or labels', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const imports: Array<Readonly<{ file: File; destination: string }>> = [];
	let requestCueImport: ((file: File) => Promise<unknown>) | null = null;
	const controller = { actions: { labels: {
		importCueFile: (file: File, destination: string) => { imports.push({ file, destination }); return destination; },
	} } };
	function Harness() {
		const runtime = useCueImportWorkspace(controller);
		requestCueImport = runtime.requestCueImport;
		return <CueImportDestinationDialog copy={ENGLISH_COPY} runtime={runtime.cueImportDialog} />;
	}
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness />));
		const file = { name: 'album.cue' } as File;
		let importing!: Promise<unknown>;
		await act(async () => { importing = requestCueImport!(file); });
		assert.match(dom.one('[data-cue-import-choice]').textContent, /album\.cue/u);
		await act(async () => {
			buttonWithText(dom.container, ENGLISH_COPY.panelMarkers).click();
			await importing;
		});
		assert.deepEqual(imports, [{ file, destination: 'markers' }]);
		assert.equal(dom.find('[data-cue-import-choice]'), null);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('a project change cancels a pending CUE destination choice', async () => {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	let requestCueImport: ((file: File) => Promise<unknown>) | null = null;
	const controller = { actions: { labels: {
		importCueFile: () => { throw new Error('A cancelled prompt must not import.'); },
	} } };
	function Harness({ projectId }: Readonly<{ projectId: string }>) {
		const runtime = useCueImportWorkspace(controller, projectId);
		requestCueImport = runtime.requestCueImport;
		return <CueImportDestinationDialog copy={ENGLISH_COPY} runtime={runtime.cueImportDialog} />;
	}
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<Harness projectId="project-a" />));
		let importing!: Promise<unknown>;
		await act(async () => { importing = requestCueImport!({ name: 'album.cue' } as File); });
		await act(async () => root.render(<Harness projectId="project-b" />));
		assert.equal(await importing, null);
		assert.equal(dom.find('[data-cue-import-choice]'), null);
	} finally {
		await act(async () => root.unmount());
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

function buttonWithText(root: ReactTestElement, text: string): ReactTestElement {
	const button = root.querySelectorAll('button').find((candidate) => candidate.textContent === text);
	assert.ok(button, `Missing button ${text}`);
	const props = reactProps(button);
	button.click = () => { void props.onClick({}); };
	return button;
}

interface MenuItem {
	readonly id?: string;
	readonly items?: readonly MenuItem[];
	readonly onClick?: () => unknown;
}

function workspaceFileMenu(openDesktopFiles: (...args: unknown[]) => unknown): MenuItem {
	const project = {
		id: 'project', sampleRate: 48_000, sources: [], clips: [], tracks: [],
		selection: { trackIds: [], clipIds: [] }, loop: { enabled: false },
		snap: { enabled: false, division: 'samples' },
	};
	const input = {
		productId: 'soundscaper', aboutLabel: 'About', locale: 'en', copy: ENGLISH_COPY,
		capabilities: { audioGenerators: true, audioEffects: true, audioAnalysis: true },
		project,
		snapshot: {
			project, selectedTrackId: null,
			preferences: { workspace: {
				activeId: 'editing', custom: [],
				panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id) => [id, { visible: false }])),
			}, view: {} },
			history: { canUndo: false, canRedo: false, hasClipboard: false },
			effects: { selectionTypes: [], canRepeatLast: false },
		},
		blocked: false, editBlocked: false, handoffBlocked: false, showArmControls: false,
		selectionActive: false, selectedClip: null, selectedAudioTrack: null, durationFrames: 0,
		projectBinEffectivelyOpen: true, uiFlags: {}, desktopHostRuntime: null,
		fileService: { isDesktop: true }, parityRuntime: { actions: null }, openDesktopFiles,
		run: (operation: () => unknown) => operation(),
	};
	const menus = createWorkspaceApplicationMenus(new Proxy(input, {
		get: (target, property, receiver) => Reflect.has(target, property)
			? Reflect.get(target, property, receiver)
			: () => undefined,
	}) as unknown as Parameters<typeof createWorkspaceApplicationMenus>[0]) as readonly MenuItem[];
	const file = menus.find(({ id }) => id === 'file');
	assert.ok(file);
	return file;
}

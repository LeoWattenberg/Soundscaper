/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import WorkspaceOnboardingDialog from '../src/common/editor/ui/dialogs/WorkspaceOnboardingDialog.tsx';
import {
	FIRST_LAUNCH_SETUP_STORAGE_KEY,
	firstLaunchSetupSeedValue,
	firstLaunchSetupStorageKey,
	isFirstLaunchSetupComplete,
	markFirstLaunchSetupComplete,
	readFirstLaunchSetup,
	type FirstLaunchSetupStorage,
} from '../src/common/editor/ui/first-launch-setup.ts';
import {
	shouldOfferWorkspaceOnboarding,
	useWorkspaceOnboardingSurface,
	type WorkspaceOnboardingSurfaceOptions,
} from '../src/common/editor/ui/use-workspace-onboarding-surface.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { sourceLineCount } from '../scripts/lib/source-line-count.mjs';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const ROOT = new URL('../', import.meta.url);
const PENDING_RECOVERY = Object.freeze({ recoveryToken: 'take-cycle-open-recovery-v1:test' });

test('first-launch setup reads only a completed record and tolerates unusable storage', () => {
	assert.equal(firstLaunchSetupStorageKey('soundscaper'), FIRST_LAUNCH_SETUP_STORAGE_KEY);
	assert.equal(firstLaunchSetupStorageKey('framescaper'), 'framescaper-first-launch-setup-v1');
	assert.doesNotMatch(FIRST_LAUNCH_SETUP_STORAGE_KEY, /\s/u);

	for (const [label, value] of [
		['garbage', 'garbage'],
		['incomplete', '{"completed":false}'],
		['array', '[]'],
		['null', 'null'],
		['string', '"completed"'],
	] as const) {
		const storage = memoryStorage({ [FIRST_LAUNCH_SETUP_STORAGE_KEY]: value });
		assert.equal(readFirstLaunchSetup('soundscaper', storage), null, label);
		assert.equal(isFirstLaunchSetupComplete('soundscaper', storage), false, label);
	}
	assert.equal(readFirstLaunchSetup('soundscaper', memoryStorage()), null);
	assert.equal(readFirstLaunchSetup('soundscaper', null), null);

	const storage = memoryStorage();
	markFirstLaunchSetupComplete('soundscaper', 'audacity', storage, () => '2026-09-02T10:00:00.000Z');
	assert.deepEqual(readFirstLaunchSetup('soundscaper', storage), {
		completed: true,
		workspaceId: 'audacity',
		completedAt: '2026-09-02T10:00:00.000Z',
	});
	assert.equal(isFirstLaunchSetupComplete('soundscaper', storage), true);
	assert.equal(isFirstLaunchSetupComplete('framescaper', storage), false, 'products keep separate records');

	markFirstLaunchSetupComplete('framescaper', null, storage, () => '2026-09-02T11:00:00.000Z');
	assert.deepEqual([...storage.entries.keys()].sort(), [
		'framescaper-first-launch-setup-v1',
		FIRST_LAUNCH_SETUP_STORAGE_KEY,
	]);
	assert.equal(readFirstLaunchSetup('framescaper', storage)?.workspaceId, null);

	const broken: FirstLaunchSetupStorage = {
		getItem: () => { throw new Error('blocked'); },
		setItem: () => { throw new Error('quota'); },
	};
	assert.doesNotThrow(() => markFirstLaunchSetupComplete('soundscaper', 'modern', broken));
	assert.equal(readFirstLaunchSetup('soundscaper', broken), null);

	const seeded = memoryStorage({ [FIRST_LAUNCH_SETUP_STORAGE_KEY]: firstLaunchSetupSeedValue() });
	assert.equal(readFirstLaunchSetup('soundscaper', seeded)?.workspaceId, 'modern');
	assert.equal(JSON.parse(firstLaunchSetupSeedValue('audacity')).workspaceId, 'audacity');
});

test('the onboarding dialog renders an accessible radio-card choice for Soundscaper only', () => {
	const markup = renderDialogMarkup('audacity');
	assert.match(markup, /role="dialog"[^>]*aria-label="Getting started"/u);
	assert.match(markup, /data-workspace-onboarding-dialog="true"/u);
	assert.match(markup, /aria-describedby="workspace-onboarding-question"/u);
	assert.match(markup, /id="workspace-onboarding-question"[^>]*>What UI layout \(workspace\) do you want\?</u);
	assert.match(markup, /role="radiogroup"[^>]*aria-label="Select workspace layout"/u);
	assert.match(markup, /Closely matches the layout of Audacity 4/u);
	assert.match(markup, /vertical rulers and side meters/u);
	assert.match(markup, /You can change between these layouts at any time from View &gt; Workspace/u);
	assert.match(markup, /<button[^>]*data-workspace-onboarding-done="true"[^>]*>Done</u);
	assert.match(markup, /kw-audio-editor-dialog__actions/u);
	assert.match(markup, /role="status" aria-live="polite" aria-atomic="true"/u);

	const radios = radioTags(markup);
	assert.equal(radios.length, 2);
	for (const radio of radios) assert.match(radio, /name="workspace-onboarding"/u);
	assert.match(radioFor(radios, 'audacity'), /checked=""/u);
	assert.doesNotMatch(radioFor(radios, 'modern'), /checked=""/u);
	assert.match(markup, /audio-editor-workspace-onboarding__option--selected[^>]*>[\s\S]*data-workspace-onboarding-option="audacity"/u);
	assert.match(markup, />Audacity</u);
	assert.match(markup, />Soundscaper</u);

	const modern = radioTags(renderDialogMarkup('modern'));
	assert.match(radioFor(modern, 'modern'), /checked=""/u);
	assert.doesNotMatch(radioFor(modern, 'audacity'), /checked=""/u);

	const music = renderDialogMarkup('music');
	assert.doesNotMatch(music, /checked=""/u, 'other presets leave both cards unchecked');
	assert.doesNotMatch(music, /audio-editor-workspace-onboarding__option--selected/u);

	assert.equal(renderDialogMarkup('modern', 'framescaper'), '');
});

test('choosing a card switches the workspace at once and finishing records the choice', async () => {
	const mounted = await mountDom();
	const calls: string[] = [];
	const storage = memoryStorage();
	let closed = 0;
	const controller = { actions: { preferences: { setWorkspace: (id: string) => { calls.push(id); } } } };
	const renderDialog = (activeId: string) => (
		<WorkspaceOnboardingDialog
			productId="soundscaper"
			controller={controller}
			preferences={{ workspace: { activeId } }}
			copy={ENGLISH_COPY}
			run={(operation) => operation()}
			storage={storage}
			onClose={() => { closed += 1; }}
		/>
	);
	try {
		await act(async () => mounted.root.render(renderDialog('modern')));
		const audacity = mounted.dom.one('[data-workspace-onboarding-option="audacity"]');
		await act(async () => {
			void reactProps(audacity).onChange({ target: { checked: true, value: 'audacity' } });
			await Promise.resolve();
		});
		assert.deepEqual(calls, ['audacity'], 'a card change applies the preset immediately');
		assert.equal(readFirstLaunchSetup('soundscaper', storage), null, 'choosing does not finish setup');
		assert.equal(closed, 0);

		await act(async () => mounted.root.render(renderDialog('audacity')));
		await act(async () => {
			reactProps(mounted.dom.one('[data-workspace-onboarding-done]')).onClick({});
		});
		assert.equal(closed, 1);
		assert.equal(readFirstLaunchSetup('soundscaper', storage)?.workspaceId, 'audacity');
	} finally {
		await mounted.unmount();
	}
});

test('closing the shell also records the current workspace and reports apply failures', async () => {
	const mounted = await mountDom();
	const storage = memoryStorage();
	let closed = 0;
	const controller = { actions: { preferences: { setWorkspace: () => { throw new Error('workspace locked'); } } } };
	try {
		await act(async () => mounted.root.render(<WorkspaceOnboardingDialog
			productId="soundscaper"
			controller={controller}
			preferences={{ workspace: { activeId: 'modern' } }}
			copy={ENGLISH_COPY}
			run={(operation) => operation()}
			storage={storage}
			onClose={() => { closed += 1; }}
		/>));
		await act(async () => {
			void reactProps(mounted.dom.one('[data-workspace-onboarding-option="audacity"]'))
				.onChange({ target: { checked: true, value: 'audacity' } });
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		assert.equal(mounted.dom.one('[role="status"]').textContent, 'workspace locked');

		const backdrop = mounted.dom.one('.kw-audio-editor-dialog-backdrop');
		await act(async () => {
			reactProps(backdrop).onMouseDown({ target: backdrop, currentTarget: backdrop });
		});
		assert.equal(closed, 1);
		assert.equal(readFirstLaunchSetup('soundscaper', storage)?.workspaceId, 'modern');
	} finally {
		await mounted.unmount();
	}
});

test('the onboarding offer needs a ready Soundscaper session with nothing else in front', () => {
	const ready = {
		productId: 'soundscaper',
		phase: 'ready',
		initialSurface: null,
		takeCycleRecovery: null,
		activeSurface: null,
		setupComplete: false,
	};
	assert.equal(shouldOfferWorkspaceOnboarding(ready), true);
	for (const [label, update] of [
		['framescaper', { productId: 'framescaper' }],
		['booting', { phase: 'booting' }],
		['error', { phase: 'error' }],
		['flag set', { setupComplete: true }],
		['initial surface', { initialSurface: 'privacy-policy' }],
		['pending recovery', { takeCycleRecovery: PENDING_RECOVERY }],
		['another surface', { activeSurface: 'export' }],
	] as const) {
		assert.equal(shouldOfferWorkspaceOnboarding({ ...ready, ...update }), false, label);
	}
});

test('the onboarding hook offers the surface once per session and after recovery clears', async () => {
	const base: Omit<WorkspaceOnboardingSurfaceOptions, 'setActiveSurface'> = {
		productId: 'soundscaper',
		phase: 'ready',
		initialSurface: null,
		takeCycleRecovery: null,
		activeSurface: null,
		storage: memoryStorage(),
	};
	const offered = await mountProbe(base);
	try {
		assert.deepEqual(offered.calls, ['workspace-onboarding']);
		await offered.rerender({ ...base, activeSurface: 'workspace-onboarding' });
		await offered.rerender({ ...base, activeSurface: null });
		assert.deepEqual(offered.calls, ['workspace-onboarding'], 'closing the dialog does not re-offer it');
	} finally {
		await offered.unmount();
	}

	for (const [label, update] of [
		['framescaper', { productId: 'framescaper' }],
		['booting', { phase: 'booting' }],
		['flag set', { storage: memoryStorage({ [FIRST_LAUNCH_SETUP_STORAGE_KEY]: firstLaunchSetupSeedValue() }) }],
		['initial surface', { initialSurface: 'privacy-policy' }],
		['pending recovery', { takeCycleRecovery: PENDING_RECOVERY }],
		['another surface', { activeSurface: 'export' }],
	] as const) {
		const probe = await mountProbe({ ...base, ...update });
		try {
			assert.deepEqual(probe.calls, [], label);
		} finally {
			await probe.unmount();
		}
	}

	const recovering = await mountProbe({
		...base, takeCycleRecovery: PENDING_RECOVERY, activeSurface: 'take-cycle-recovery',
	});
	try {
		assert.deepEqual(recovering.calls, []);
		await recovering.rerender({ ...base, takeCycleRecovery: null, activeSurface: null });
		assert.deepEqual(recovering.calls, ['workspace-onboarding'], 'a settled recovery lets the offer through');
	} finally {
		await recovering.unmount();
	}

	const booting = await mountProbe({ ...base, phase: 'booting' });
	try {
		await booting.rerender({ ...base, phase: 'ready' });
		assert.deepEqual(booting.calls, ['workspace-onboarding'], 'readiness arriving later still offers once');
	} finally {
		await booting.unmount();
	}
});

test('the workspace shell, overlays and menu runtime wire the onboarding surface', async () => {
	const [workspace, overlays, runtime, menus, dialog, css, manifest] = await Promise.all([
		source('src/common/editor/ui/workspace/AudioEditorWorkspace.jsx'),
		source('src/common/editor/ui/workspace/AudioEditorWorkspaceOverlays.jsx'),
		source('src/common/editor/ui/workspace/workspace-application-menu-runtime.js'),
		source('src/common/editor/ui/application-menus.js'),
		source('src/common/editor/ui/dialogs/WorkspaceOnboardingDialog.tsx'),
		source('src/common/editor/ui/audio-editor-design-system/33-workspace-onboarding.css'),
		source('src/common/editor/ui/audio-editor-design-system.css'),
	]);
	assert.match(workspace, /useWorkspaceOnboardingSurface\(\{/u);
	assert.match(workspace, /useTakeCycleRecoverySurface\(productId, snapshot\.takeCycleRecovery\)/u);
	assert.ok(sourceLineCount(workspace) <= 600, 'the workspace shell stays within its ceiling');
	assert.match(overlays, /import\('\.\.\/dialogs\/WorkspaceOnboardingDialog\.tsx'\)/u);
	assert.match(overlays, /activeSurface === 'workspace-onboarding'/u);
	assert.match(overlays, /data-editor-surface="workspace-onboarding"/u);
	assert.match(runtime, /openWorkspaceOnboarding: \(\) => openSurface\('workspace-onboarding'\)/u);
	assert.match(menus, /id: 'workspace-onboarding', label: copy\.workspaceOnboardingMenu, onClick: actions\.openWorkspaceOnboarding/u);
	assert.match(dialog, /audio-editor-design-system\/33-workspace-onboarding\.css/u);
	assert.doesNotMatch(manifest, /33-workspace-onboarding\.css/u);
	assert.match(css, /@media \(forced-colors: active\)/u);
	assert.match(css, /forced-color-adjust: none/u);
});

function renderDialogMarkup(activeId: string, productId = 'soundscaper'): string {
	return renderToStaticMarkup(<WorkspaceOnboardingDialog
		productId={productId}
		controller={{ actions: { preferences: { setWorkspace: () => undefined } } }}
		preferences={{ workspace: { activeId } }}
		copy={ENGLISH_COPY}
		run={(operation) => operation()}
		onClose={() => undefined}
	/>);
}

function radioTags(markup: string): string[] {
	return (markup.match(/<input[^>]*>/gu) ?? []).filter((tag) => /type="radio"/u.test(tag));
}

function radioFor(radios: readonly string[], id: string): string {
	const radio = radios.find((tag) => tag.includes(`data-workspace-onboarding-option="${id}"`));
	assert.ok(radio, `missing ${id} radio`);
	return radio;
}

function memoryStorage(initial: Readonly<Record<string, string>> = {}) {
	const entries = new Map(Object.entries(initial));
	return {
		entries,
		getItem: (key: string) => entries.get(key) ?? null,
		setItem: (key: string, value: string) => { entries.set(key, value); },
	};
}

async function mountDom() {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	return {
		dom,
		root,
		async unmount() {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			dom.restore();
		},
	};
}

type ProbeOptions = Omit<WorkspaceOnboardingSurfaceOptions, 'setActiveSurface'>;

function Probe({ options, calls }: Readonly<{ options: ProbeOptions; calls: string[] }>) {
	useWorkspaceOnboardingSurface({
		...options,
		setActiveSurface: (surface: string | null) => { calls.push(String(surface)); },
	});
	return null;
}

async function mountProbe(options: ProbeOptions) {
	const mounted = await mountDom();
	const calls: string[] = [];
	const render = (next: ProbeOptions) => act(async () => mounted.root.render(<Probe options={next} calls={calls} />));
	await render(options);
	return {
		calls,
		rerender: render,
		unmount: () => mounted.unmount(),
	};
}

async function source(path: string): Promise<string> {
	return readFile(new URL(path, ROOT), 'utf8');
}

test('reopening the chooser on a preset without a card still starts on the first card', async () => {
	const dialog = await readFile(new URL('../src/common/editor/ui/dialogs/WorkspaceOnboardingDialog.tsx', import.meta.url), 'utf8');
	assert.match(dialog, /: '\[data-workspace-onboarding-option\]'/u, 'the fallback focus target is the first card, not the dialog close button');
});

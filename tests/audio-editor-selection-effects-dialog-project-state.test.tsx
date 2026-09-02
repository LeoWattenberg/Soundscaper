/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import { SelectionEffectsDialog } from '../src/common/editor/ui/inspector/SelectionEffectsDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import {
	installReactTestDom, reactProps, type ReactTestElement,
} from './helpers/react-test-dom.ts';

test('selection effect apply completion belongs only to its submitted project', async () => {
	const fixture = await mountedSelectionEffectsFixture();
	try {
		const projectA = effectProject('project-a');
		const projectB = effectProject('project-b');
		await fixture.render(projectA, { gainDb: 3 });
		await fixture.startApply();
		assert.deepEqual(fixture.applyCalls[0]?.request, {
			type: 'audacity-amplify', params: { gainDb: 3, allowClipping: false }, controlTrackId: null,
		});

		await fixture.render(projectB, { gainDb: 9 });
		await fixture.startApply();
		assert.deepEqual(fixture.applyCalls[1]?.request, {
			type: 'audacity-amplify', params: { gainDb: 9, allowClipping: false }, controlTrackId: null,
		});

		await settle(fixture.applyCalls[0]!.completion, undefined);
		assert.equal(fixture.closes.count, 0, 'project A completion must not close project B');
		await settle(fixture.applyCalls[1]!.completion, undefined);
		assert.equal(fixture.closes.count, 1, 'project B completion may close its own surface');
	} finally {
		await fixture.cleanup();
	}
});

test('selection effect apply cannot enter a newer project before its rerender', async () => {
	const fixture = await mountedSelectionEffectsFixture();
	try {
		await fixture.render(effectProject('project-a'), { gainDb: 3 });
		await act(async () => {
			void reactProps(fixture.applyButton()).onClick();
			fixture.switchControllerProject(effectProject('project-b'));
			await Promise.resolve();
			await Promise.resolve();
		});

		assert.deepEqual(fixture.applyCalls, []);
		assert.equal(fixture.closes.count, 0);
	} finally {
		await fixture.cleanup();
	}
});

test('selection effect preset drafts reset only when project identity changes', async () => {
	const fixture = await mountedSelectionEffectsFixture();
	try {
		const projectA = effectProject('project-a');
		const projectB = effectProject('project-b');
		await fixture.render(projectA, { gainDb: 3 });
		await fixture.openPresetPrompt();
		await fixture.typePresetName('Project A draft');

		await fixture.render(projectB, { gainDb: 9 });
		assert.equal(Boolean(fixture.presetPrompt()), false, 'project B starts with no naming prompt open');
		await fixture.openPresetPrompt();
		await fixture.typePresetName('Project B draft');

		await fixture.render(projectB, { gainDb: 10 });
		assert.equal(fixture.presetNameInput().value, 'Project B draft');
	} finally {
		await fixture.cleanup();
	}
});

test('selection effect preset save completion cannot overwrite the newer project draft', async () => {
	const fixture = await mountedSelectionEffectsFixture();
	try {
		const projectA = effectProject('project-a');
		const projectB = effectProject('project-b');
		await fixture.render(projectA, { gainDb: 3 });
		await fixture.openPresetPrompt();
		await fixture.typePresetName('Project A preset');
		await fixture.startPresetSaveAs();
		assert.equal(fixture.saveCalls.length, 1);

		await fixture.render(projectB, { gainDb: 9 });
		await fixture.openPresetPrompt();
		await fixture.typePresetName('Project B draft');
		await settle(fixture.saveCalls[0]!.completion, {
			id: 'preset-a',
			effectType: 'audacity-amplify',
			name: 'Project A preset',
			params: { gainDb: 3, allowClipping: false },
		});

		assert.equal(fixture.presetNameInput().value, 'Project B draft');
		assert.equal(fixture.alert(), null);
	} finally {
		await fixture.cleanup();
	}
});

test('selection effect preset import cannot enter a newer project after a stale file read', async () => {
	const fixture = await mountedSelectionEffectsFixture();
	try {
		const fileText = deferred<string>();
		await fixture.render(effectProject('project-a'), { gainDb: 3 });
		await fixture.openPresetOptions();
		await fixture.startPresetImport(fileText.promise);

		await fixture.render(effectProject('project-b'), { gainDb: 9 });
		await settle(fileText, '{"schemaVersion":1,"presets":[]}');

		assert.deepEqual(fixture.importCalls, []);
	} finally {
		await fixture.cleanup();
	}
});

test('reviewed Utility Gain uses the canonical selection-effect label and parameter range', async () => {
	const fixture = await mountedSelectionEffectsFixture();
	try {
		await fixture.render(effectProject('reviewed-project'), { gain: 1.25 }, 'reviewed-utility-gain');
		assert.match(fixture.dialog().textContent, /Utility Gain \(Reviewed\)/u);
		const gain = fixture.effectParameter('gain');
		const slider = gain.querySelector('[role="slider"]');
		assert.ok(slider, 'Reviewed Utility Gain must use the canonical bounded parameter control.');
		assert.equal(slider.getAttribute('aria-valuemin'), '0');
		assert.equal(slider.getAttribute('aria-valuemax'), '4');

		await fixture.startApply();
		assert.deepEqual(fixture.applyCalls[0]?.request, {
			type: 'reviewed-utility-gain', params: { gain: 1.25 }, controlTrackId: null,
		});
	} finally {
		await fixture.cleanup();
	}
});

interface EffectProject {
	readonly id: string;
	readonly sampleRate: number;
	readonly clips: readonly never[];
	readonly tracks: readonly Readonly<{
		id: string;
		type: 'audio';
		name: string;
		clipIds: readonly never[];
	}>[];
}

interface ApplyRequest {
	readonly type: string;
	readonly params: Readonly<Record<string, unknown>>;
	readonly controlTrackId: string | null;
}

interface EffectPreset {
	readonly id: string;
	readonly effectType: string;
	readonly name: string;
	readonly params: Readonly<Record<string, unknown>>;
}

async function mountedSelectionEffectsFixture() {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	let currentProject: EffectProject | null = null;
	const applyCalls: Array<Readonly<{
		request: ApplyRequest;
		completion: Deferred<void>;
	}>> = [];
	const saveCalls: Array<Readonly<{
		request: Readonly<Record<string, unknown>>;
		completion: Deferred<EffectPreset>;
	}>> = [];
	const importCalls: string[] = [];
	const closes = { count: 0 };
	const controller = {
		get project() { return currentProject; },
		actions: {
			effects: {
				setSelectionParams: () => undefined,
				setControlTrack: () => undefined,
				cancelPreview: () => undefined,
				previewSelection: () => undefined,
				captureNoiseProfile: () => undefined,
				applySelection: (request: ApplyRequest) => {
					const completion = deferred<void>();
					applyCalls.push({ request, completion });
					return completion.promise;
				},
				presets: {
					apply: () => { throw new Error('not used'); },
					save: (request: Readonly<Record<string, unknown>>) => {
						const completion = deferred<EffectPreset>();
						saveCalls.push({ request, completion });
						return completion.promise;
					},
					import: (encoded: string) => { importCalls.push(encoded); },
					export: () => { throw new Error('not used'); },
					delete: () => { throw new Error('not used'); },
				},
			},
		},
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	return {
		applyCalls,
		saveCalls,
		importCalls,
		closes,
		render: async (
			project: EffectProject,
			params: Readonly<Record<string, unknown>>,
			type = 'audacity-amplify',
		) => {
			currentProject = project;
			await act(async () => root.render(<SelectionEffectsDialog
				isOpen
				controller={controller}
				snapshot={effectSnapshot(project, params, type)}
				copy={ENGLISH_COPY}
				fileService={null}
				onClose={() => { closes.count += 1; }}
			/>));
		},
		switchControllerProject: (project: EffectProject) => { currentProject = project; },
		dialog: () => dom.one('[data-selection-effects-dialog]'),
		effectParameter: (name: string) => dom.one(`[data-effect-param="${name}"]`),
		applyButton: () => descendantByTag(dom.one('[data-apply-audacity-effect]'), 'button'),
		presetPrompt: () => dom.container.querySelector('[data-preset-name-dialog]'),
		presetNameInput: () => {
			const prompt = dom.container.querySelector('[data-preset-name-dialog]');
			assert.ok(prompt, 'Missing mounted Save as… prompt.');
			return descendantByTag(prompt, 'input');
		},
		alert: () => dom.container.querySelector('[role="alert"]'),
		openPresetPrompt: async () => {
			const buttons = dom.container.querySelectorAll('.effect-header__icon-button');
			assert.ok(buttons[0], 'Missing mounted save-preset button.');
			await click(buttons[0]);
			await click(menuItemNamed(dom.container, ENGLISH_COPY.saveEffectPresetAs));
		},
		openPresetOptions: async () => {
			const buttons = dom.container.querySelectorAll('.effect-header__icon-button');
			assert.ok(buttons[3], 'Missing mounted preset-options button.');
			await click(buttons[3]);
		},
		typePresetName: async (value: string) => {
			const prompt = dom.container.querySelector('[data-preset-name-dialog]');
			assert.ok(prompt, 'Missing mounted Save as… prompt.');
			await act(async () => {
				reactProps(descendantByTag(prompt, 'input')).onChange({ target: { value }, currentTarget: { value } });
				await Promise.resolve();
			});
		},
		startPresetSaveAs: async () => {
			const prompt = dom.container.querySelector('[data-preset-name-dialog]');
			assert.ok(prompt, 'Missing mounted Save as… prompt.');
			await click(elementNamed(prompt, 'button', ENGLISH_COPY.saveEffectPreset));
		},
		startPresetImport: async (text: Promise<string>) => {
			const input = dom.one('[data-effect-preset-file]');
			await act(async () => {
				void reactProps(input).onChange({
					currentTarget: { files: [{ text: () => text }], value: 'preset.json' },
				});
				await Promise.resolve();
			});
		},
		startApply: async () => {
			await act(async () => {
				void reactProps(descendantByTag(dom.one('[data-apply-audacity-effect]'), 'button')).onClick();
				await Promise.resolve();
			});
		},
		cleanup: async () => {
			for (const call of applyCalls) call.completion.resolve();
			for (const call of saveCalls) call.completion.resolve({
				id: 'cleanup', effectType: 'audacity-amplify', name: 'Cleanup', params: {},
			});
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}

function effectProject(id: string): EffectProject {
	return {
		id,
		sampleRate: 48_000,
		clips: [],
		tracks: [{ id: `${id}-audio`, type: 'audio', name: `${id} audio`, clipIds: [] }],
	};
}

function effectSnapshot(
	project: EffectProject,
	params: Readonly<Record<string, unknown>>,
	type = 'audacity-amplify',
) {
	return {
		ready: true,
		project,
		selectedTrackId: project.tracks[0]?.id ?? null,
		effects: {
			selectionType: type,
			selectionParams: type === 'audacity-amplify'
				? { ...params, allowClipping: false }
				: { ...params },
			controlTrackId: null,
			presets: [],
			previewing: false,
			noiseProfileReady: false,
		},
	};
}

function descendantByTag(root: ReactTestElement, tagName: string): ReactTestElement {
	const expected = tagName.toUpperCase();
	const element = root.querySelectorAll(tagName).find((candidate) => candidate.tagName === expected);
	assert.ok(element, `Missing mounted ${tagName}.`);
	return element;
}

function elementNamed(root: ReactTestElement, tagName: string, text: string): ReactTestElement {
	const expected = tagName.toUpperCase();
	const element = root.querySelectorAll(tagName).find((candidate) => (
		candidate.tagName === expected && candidate.textContent === text
	));
	assert.ok(element, `Missing mounted ${tagName} named ${text}.`);
	return element;
}

function menuItemNamed(root: ReactTestElement, label: string): ReactTestElement {
	const item = [...root.querySelectorAll('.context-menu-item')].find((candidate) => (
		[...candidate.querySelectorAll('.context-menu-item-label')]
			.some((text) => text.textContent.trim() === label)
	));
	assert.ok(item, `Missing mounted menu item named ${label}.`);
	return item;
}

async function click(element: ReactTestElement): Promise<void> {
	await act(async () => {
		void reactProps(element).onClick();
		await Promise.resolve();
	});
}

async function settle<Value>(completion: Deferred<Value>, value: Value): Promise<void> {
	await act(async () => {
		completion.resolve(value);
		await completion.promise;
		await Promise.resolve();
	});
}

interface Deferred<Value> {
	readonly promise: Promise<Value>;
	readonly resolve: (value: Value) => void;
}

function deferred<Value>(): Deferred<Value> {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return { promise, resolve };
}

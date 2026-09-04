/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act, useEffect, useState } from 'react';

import AudioEditorMacroManagerDialog from '../src/common/editor/ui/inspector/AudioEditorMacroManagerDialog.jsx';
import { createEffect } from '../src/common/editor/effects.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import {
	installReactTestDom, reactProps, type ReactTestElement,
} from './helpers/react-test-dom.ts';

test('a project switch retires an in-flight macro run before the next project can run', async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		await click(fixture.button(ENGLISH_COPY.runMacro));
		assert.equal(fixture.runs.length, 1);
		assert.equal(fixture.button(ENGLISH_COPY.runMacro).hasAttribute('disabled'), true);

		await fixture.render(macroSnapshot('project-b'));
		assert.equal(
			fixture.button(ENGLISH_COPY.runMacro).hasAttribute('disabled'),
			false,
			'project A must not retain project B\'s run admission',
		);
		await click(fixture.button(ENGLISH_COPY.runMacro));
		assert.deepEqual(fixture.runs.map(({ projectId }) => projectId), ['project-a', 'project-b']);

		await act(async () => {
			fixture.runs[0]!.settlement.reject(new Error('project A was replaced'));
			await Promise.resolve();
			await Promise.resolve();
		});
		assert.equal(fixture.button(ENGLISH_COPY.runMacro).hasAttribute('disabled'), true);
		assert.equal(fixture.message(), ENGLISH_COPY.macroProcessing);

		await act(async () => {
			fixture.runs[1]!.settlement.resolve(true);
			await Promise.resolve();
			await Promise.resolve();
		});
		assert.equal(fixture.button(ENGLISH_COPY.runMacro).hasAttribute('disabled'), false);
		assert.equal(fixture.message(), ENGLISH_COPY.macroApplied);
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('a macro import started for a replaced project cannot overwrite the surviving draft', async () => {
	const fixture = await mountedMacroManagerFixture();
	const importedText = deferred<string>();
	try {
		await fixture.render(macroSnapshot('project-a'));
		await changeFile(fixture.importInput(), {
			name: 'project-a-chain.txt',
			size: 42,
			text: () => importedText.promise,
		} as File);

		await fixture.render(macroSnapshot('project-b'));
		await changeText(fixture.nameInput(), 'Project B chain');
		await act(async () => {
			importedText.resolve('Echo:Delay="0.4" Decay="0.5"\n');
			await importedText.promise;
			await Promise.resolve();
		});

		assert.equal(fixture.nameInput().value, 'Project B chain');
		assert.deepEqual(fixture.effectNames(), ['Invert']);
		assert.equal(fixture.message(), '');
		assert.deepEqual(fixture.macroNames(), ['Project B chain'], 'the stale import must not save a macro');
	} finally {
		importedText.resolve('Invert:\n');
		await fixture.cleanup();
	}
});

test('a stale macro export cannot replace the current project completion message', async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		await click(fixture.button(ENGLISH_COPY.exportMacro));
		assert.equal(fixture.exports.length, 1);

		await fixture.render(macroSnapshot('project-b'));
		await click(fixture.button(ENGLISH_COPY.exportMacro));
		assert.equal(fixture.exports.length, 2);
		await act(async () => {
			fixture.exports[1]!.settlement.resolve({ cancelled: false });
			await Promise.resolve();
			await Promise.resolve();
		});
		assert.equal(fixture.message(), ENGLISH_COPY.macroExported);

		await act(async () => {
			fixture.exports[0]!.settlement.reject(new Error('project A destination failed'));
			await Promise.resolve();
			await Promise.resolve();
		});
		assert.equal(fixture.message(), ENGLISH_COPY.macroExported);
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('the Restoration template saves a macro of its own, embeds its captured profile, and only then admits Run', async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		await click(fixture.button('Restoration'));
		assert.deepEqual(fixture.macroNames(), ['Portable chain', 'Restoration']);
		assert.equal(fixture.selectedMacroName(), 'Restoration');
		assert.deepEqual(fixture.effectNames(), ['Click Removal', 'Noise Reduction', 'Filter Curve EQ']);
		assert.deepEqual(
			fixture.library()[0]!.effects.map(({ type }) => type),
			['audacity-invert'],
			'the template must not reach into the macro that was open',
		);
		assert.equal(fixture.button(ENGLISH_COPY.runMacro).hasAttribute('disabled'), true);
		assert.match(fixture.text(), /Capture a noise profile in every Noise Reduction step/u);

		await click(fixture.selectEffect('Noise Reduction'));
		await click(fixture.button(ENGLISH_COPY.getNoiseProfile));
		assert.equal(fixture.profileCaptures(), 1);
		assert.deepEqual(fixture.profileParams(), [{
			reductionDb: 6, sensitivity: 6, frequencySmoothingBands: 6, output: 'reduce',
		}]);
		assert.ok(fixture.button(ENGLISH_COPY.replaceNoiseProfile));
		await click(fixture.button('Close'));
		assert.equal(fixture.button(ENGLISH_COPY.runMacro).hasAttribute('disabled'), false);

		await click(fixture.button(ENGLISH_COPY.runMacro));
		assert.equal(fixture.runs.length, 1);
		const effects = fixture.runs[0]!.macro.effects as Array<Readonly<{
			type: string;
			context?: Readonly<{ noiseProfile?: unknown }>;
		}>>;
		assert.equal(effects[1]?.type, 'audacity-noise-reduction');
		assert.deepEqual(effects[1]?.context?.noiseProfile, SERIALIZED_NOISE_PROFILE);
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('the macro list creates, renames, selects, and deletes saved macros', async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		assert.deepEqual(fixture.macroNames(), ['Portable chain']);

		await click(fixture.button(ENGLISH_COPY.newMacro));
		assert.deepEqual(fixture.macroNames(), ['Portable chain', ENGLISH_COPY.untitledMacro]);
		assert.deepEqual(fixture.effectNames(), []);

		await changeText(fixture.nameInput(), 'Second chain');
		assert.deepEqual(fixture.macroNames(), ['Portable chain', 'Second chain']);
		assert.deepEqual(fixture.library().map(({ name }) => name), ['Portable chain', 'Second chain']);

		await click(fixture.macro('Portable chain'));
		assert.equal(fixture.selectedMacroName(), 'Portable chain');
		assert.deepEqual(fixture.effectNames(), ['Invert']);

		await click(fixture.button(ENGLISH_COPY.deleteMacro));
		assert.deepEqual(fixture.macroNames(), ['Second chain']);
		assert.equal(fixture.selectedMacroName(), 'Second chain');
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('an emptied library leaves nothing to edit and takes the manager back to its own hint', async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		await click(fixture.button(ENGLISH_COPY.deleteMacro));

		assert.deepEqual(fixture.macroNames(), []);
		assert.ok(fixture.find('[data-macro-library-empty]'));
		assert.ok(fixture.find('[data-macro-unselected]'));
		assert.equal(fixture.find('[data-macro-steps]'), null);
		assert.equal(fixture.button(ENGLISH_COPY.runMacro).hasAttribute('disabled'), true);
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('Add effect sits after the last step and opens the rack flyout rather than a dialog', async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project-a'));
		const steps = fixture.find('[data-macro-steps]');
		assert.ok(steps);
		const rows = steps.childNodes.filter((node) => node.nodeType === 1);
		assert.equal(rows.at(-1), fixture.addEffect(), 'Add effect must follow the step stack.');

		await click(fixture.addEffect());
		assert.equal(fixture.find('[data-effect-picker]'), null, 'the picker must not open as a dialog');
		const flyout = fixture.find('.audio-editor-effect-picker-flyout__grid');
		assert.ok(flyout, 'the picker must open as the flyout the realtime rack uses');

		await click(fixture.menuItem('Echo'));
		assert.deepEqual(fixture.effectNames(), ['Invert', 'Echo']);
		assert.deepEqual(
			fixture.library()[0]!.effects.map(({ type }) => type),
			['audacity-invert', 'audacity-echo'],
			'the added step must reach the saved macro',
		);
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('a failed Restoration profile capture stays gated and reports the failure in the dialog', async () => {
	const fixture = await mountedMacroManagerFixture({ id: 'macro-initial', name: ENGLISH_COPY.untitledMacro, effects: [] });
	try {
		await fixture.render(macroSnapshot('project-a'));
		await click(fixture.button('Restoration'));
		await click(fixture.selectEffect('Noise Reduction'));
		fixture.failNextProfileCapture(new Error('profile worker unavailable'));
		await click(fixture.button(ENGLISH_COPY.getNoiseProfile));

		assert.match(fixture.message(), /profile worker unavailable/u);
		await click(fixture.button('Close'));
		assert.equal(fixture.button(ENGLISH_COPY.runMacro).hasAttribute('disabled'), true);
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('Restoration profile recapture replaces the embedded portable profile', async () => {
	const fixture = await mountedMacroManagerFixture({ id: 'macro-initial', name: ENGLISH_COPY.untitledMacro, effects: [] });
	const replacement = Object.freeze({ ...SERIALIZED_NOISE_PROFILE, windowCount: 3 });
	try {
		await fixture.render(macroSnapshot('project-a'));
		await click(fixture.button('Restoration'));
		await click(fixture.selectEffect('Noise Reduction'));
		await click(fixture.button(ENGLISH_COPY.getNoiseProfile));
		fixture.queueProfileResponse(Promise.resolve(replacement));
		await click(fixture.button(ENGLISH_COPY.replaceNoiseProfile));
		await click(fixture.button('Close'));
		await click(fixture.button(ENGLISH_COPY.runMacro));

		const effects = fixture.runs[0]!.macro.effects as Array<Readonly<{
			context?: Readonly<{ noiseProfile?: unknown }>;
		}>>;
		assert.deepEqual(effects[1]?.context?.noiseProfile, replacement);
		assert.equal(fixture.profileCaptures(), 2);
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('a stale Restoration recapture cannot replace the surviving embedded profile', async () => {
	const fixture = await mountedMacroManagerFixture({ id: 'macro-initial', name: ENGLISH_COPY.untitledMacro, effects: [] });
	const pending = deferred<unknown>();
	try {
		await fixture.render(macroSnapshot('project-a'));
		await click(fixture.button('Restoration'));
		await click(fixture.selectEffect('Noise Reduction'));
		await click(fixture.button(ENGLISH_COPY.getNoiseProfile));
		fixture.queueProfileResponse(pending.promise);
		await click(fixture.button(ENGLISH_COPY.replaceNoiseProfile));
		await fixture.render(macroSnapshot('project-b'));
		await act(async () => {
			pending.resolve({ ...SERIALIZED_NOISE_PROFILE, windowCount: 99 });
			await pending.promise;
			await Promise.resolve();
		});
		await click(fixture.button('Close'));
		await click(fixture.button(ENGLISH_COPY.runMacro));

		const effects = fixture.runs[0]!.macro.effects as Array<Readonly<{
			context?: Readonly<{ noiseProfile?: unknown }>;
		}>>;
		assert.deepEqual(effects[1]?.context?.noiseProfile, SERIALIZED_NOISE_PROFILE);
	} finally {
		pending.resolve(SERIALIZED_NOISE_PROFILE);
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('Framescaper keeps its shared Macro Manager unchanged', async () => {
	const fixture = await mountedMacroManagerFixture(undefined, 'framescaper');
	try {
		await fixture.render(macroSnapshot('project-a'));
		assert.equal(fixture.find('[data-macro-templates]'), null);
		assert.doesNotMatch(fixture.text(), /Restoration/u);
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});

type MacroProject = ReturnType<typeof macroProject>;

const SERIALIZED_NOISE_PROFILE = Object.freeze({
	type: 'audacity-noise-profile',
	version: 1,
	sampleRate: 48_000,
	windowSize: 2_048,
	stepsPerWindow: 4,
	windowType: 'hann-hann',
	channelCount: 1,
	windowCount: 2,
	meanPowers: Object.freeze(Array.from({ length: 1_025 }, () => 0.25)),
});

type MacroEntry = Readonly<{
	readonly id: string;
	readonly name: string;
	readonly effects: readonly Readonly<Record<string, unknown>>[];
}>;

async function mountedMacroManagerFixture(initialDraft: MacroEntry = {
	id: 'macro-initial',
	name: 'Portable chain',
	effects: [createEffect('audacity-invert', { id: 'macro-effect-1' })],
}, productId = 'soundscaper') {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	Object.assign(globalThis.window, {
		getComputedStyle: () => ({ display: '', visibility: '' }),
	});
	let currentProject: MacroProject | null = null;
	const runs: Array<Readonly<{
		readonly projectId: string | null;
		readonly macro: Readonly<{ readonly effects: readonly unknown[] }>;
		readonly settlement: ReturnType<typeof deferred<true>>;
	}>> = [];
	const exports: Array<Readonly<{
		readonly projectId: string | null;
		readonly settlement: ReturnType<typeof deferred<Readonly<{ cancelled: boolean }>>>;
	}>> = [];
	let profileCaptures = 0;
	let profileFailure: Error | null = null;
	// A stand-in for the controller's saved macro library: writes land in memory
	// and republish, the way the service publishes a document snapshot.
	const libraryPublishers = new Set<(macros: readonly MacroEntry[]) => void>();
	let library: readonly MacroEntry[] = [initialDraft];
	let mintedMacros = 0;
	const publishLibrary = () => {
		for (const publish of libraryPublishers) publish(library);
	};
	const macroLibrary = {
		list: () => library,
		save: (macro: MacroEntry) => {
			const saved = { ...macro, id: macro.id ?? `macro-minted-${(mintedMacros += 1)}` };
			const index = library.findIndex((candidate) => candidate.id === saved.id);
			library = index < 0
				? [...library, saved]
				: library.map((candidate, at) => at === index ? saved : candidate);
			publishLibrary();
			return saved;
		},
		delete: (macroId: string) => {
			library = library.filter((macro) => macro.id !== macroId);
			publishLibrary();
			return true as const;
		},
	};
	const profileResponses: Promise<unknown>[] = [];
	const profileParams: unknown[] = [];
	const controller = {
		get project() { return currentProject; },
		actions: {
			macros: {
				run: (macro: Readonly<{ readonly effects: readonly unknown[] }>) => {
					const settlement = deferred<true>();
					runs.push({ projectId: currentProject?.id ?? null, macro, settlement });
					return settlement.promise;
				},
				library: macroLibrary,
			},
			effects: {
			captureNoiseProfile: (params: unknown) => {
					profileCaptures += 1;
					profileParams.push(params);
					if (profileFailure) {
						const cause = profileFailure;
						profileFailure = null;
						return Promise.reject(cause);
					}
					const response = profileResponses.shift();
					if (response) return response;
					return Promise.resolve(SERIALIZED_NOISE_PROFILE);
				},
			},
		},
	};
	const fileService = {
		saveFile: () => {
			const settlement = deferred<Readonly<{ cancelled: boolean }>>();
			exports.push({ projectId: currentProject?.id ?? null, settlement });
			return settlement.promise;
		},
	};
	function Host({ snapshot }: Readonly<{ snapshot: ReturnType<typeof macroSnapshot> }>) {
		const [draft, setDraft] = useState<MacroEntry | null>(() => initialDraft);
		const [macros, setMacros] = useState(() => library);
		useEffect(() => {
			libraryPublishers.add(setMacros);
			return () => { libraryPublishers.delete(setMacros); };
		}, []);
		return <AudioEditorMacroManagerDialog
			isOpen
			productId={productId}
			controller={controller}
			snapshot={{ ...snapshot, macros: { library: macros } }}
			copy={ENGLISH_COPY}
			locale="en"
			fileService={fileService}
			draft={draft}
			onDraftChange={setDraft}
			onClose={() => undefined}
		/>;
	}
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	return {
		runs,
		exports,
		button: (label: string) => buttonByLabel(dom.container, label),
		find: (selector: string) => dom.find(selector),
		text: () => dom.container.textContent,
		profileCaptures: () => profileCaptures,
		profileParams: () => profileParams,
		failNextProfileCapture: (cause: Error) => { profileFailure = cause; },
		queueProfileResponse: (response: Promise<unknown>) => { profileResponses.push(response); },
		effectNames: () => dom.container.querySelectorAll('.effect-slot__name-text').map(({ textContent }) => textContent),
		selectEffect: (name: string) => {
			const slot = dom.container.querySelectorAll('.effect-slot').find((candidate) => (
				candidate.textContent.includes(name)
			));
			const button = slot?.querySelector('.effect-slot__name-field');
			assert.ok(button, `Missing selectable ${name} effect.`);
			return button;
		},
		importInput: () => dom.one('[data-macro-import-file]'),
		macroNames: () => dom.container.querySelectorAll('[data-macro-id]').map(({ textContent }) => textContent),
		selectedMacroName: () => dom.container.querySelectorAll('[data-macro-id]').find((candidate) => (
			candidate.getAttribute('aria-current') === 'true'
		))?.textContent ?? null,
		library: () => library,
		addEffect: () => dom.one('[data-macro-add-effect]'),
		macro: (name: string) => {
			const entry = dom.container.querySelectorAll('[data-macro-id]').find((candidate) => (
				candidate.textContent === name
			));
			assert.ok(entry, `Missing ${name} in the macro list.`);
			return entry;
		},
		menuItem: (name: string) => {
			const item = dom.container.querySelectorAll('[role="menuitem"]').find((candidate) => (
				candidate.textContent === name
			));
			assert.ok(item, `Missing ${name} in the effect flyout.`);
			return item;
		},
		message: () => dom.find('[role="status"]')?.textContent
			?? dom.find('[role="alert"]')?.textContent
			?? '',
		nameInput: () => {
			const input = dom.container.querySelectorAll('label').find((label) => (
				label.textContent.includes(ENGLISH_COPY.macroName)
			))?.querySelector('input');
			assert.ok(input, 'Missing macro name input.');
			return input;
		},
		render: async (snapshot: ReturnType<typeof macroSnapshot>) => {
			currentProject = snapshot.project;
			await act(async () => root.render(<Host snapshot={snapshot} />));
		},
		settlePending: () => {
			for (const run of runs) run.settlement.resolve(true);
			for (const exported of exports) exported.settlement.resolve({ cancelled: true });
		},
		cleanup: async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}

function macroSnapshot(id: string) {
	return {
		project: macroProject(id),
		selection: { startFrame: 0, endFrame: 480 },
		selectedClipId: null,
		selectedTrackId: `${id}-track`,
	};
}

function macroProject(id: string) {
	return {
		id,
		revision: 1,
		sampleRate: 48_000,
		tracks: [{ id: `${id}-track`, type: 'audio' }],
	};
}

async function click(button: ReactTestElement): Promise<void> {
	await act(async () => {
		void reactProps(button).onClick({});
		await Promise.resolve();
	});
}

async function changeFile(input: ReactTestElement, file: File): Promise<void> {
	await act(async () => {
		void reactProps(input).onChange({ currentTarget: { files: [file], value: file.name } });
		await Promise.resolve();
	});
}

async function changeText(input: ReactTestElement, value: string): Promise<void> {
	await act(async () => {
		void reactProps(input).onChange({ target: { value }, currentTarget: { value } });
		await Promise.resolve();
	});
}

function buttonByLabel(root: ReactTestElement, label: string): ReactTestElement {
	const button = root.querySelectorAll('button').find((candidate) => (
		candidate.getAttribute('aria-label') === label || candidate.textContent.endsWith(label)
	));
	assert.ok(button, `Missing button ${label}.`);
	return button;
}

function deferred<Value>(): Readonly<{
	readonly promise: Promise<Value>;
	readonly resolve: (value: Value) => void;
	readonly reject: (cause: unknown) => void;
}> {
	let resolve!: (value: Value) => void;
	let reject!: (cause: unknown) => void;
	const promise = new Promise<Value>((accept, decline) => {
		resolve = accept;
		reject = decline;
	});
	return Object.freeze({ promise, resolve, reject });
}

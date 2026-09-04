/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The mounted Macro Manager and the project snapshots its tests drive.
 *
 * Extracted so the manager's growing test surface does not push one spec file
 * past the maintainability ceiling, and so a focused spec can reuse the fixture
 * instead of restating three hundred lines of controller double.
 */

import assert from 'node:assert/strict';

import React, { act, useEffect, useState } from 'react';

import AudioEditorMacroManagerDialog from '../../src/common/editor/ui/inspector/AudioEditorMacroManagerDialog.jsx';
import { createEffect } from '../../src/common/editor/effects.js';
import { ENGLISH_COPY } from '../../src/common/i18n/catalogs.js';
import {
	installReactTestDom, reactProps, type ReactTestElement,
} from './react-test-dom.ts';

type MacroProject = ReturnType<typeof macroProject>;

export const SERIALIZED_NOISE_PROFILE = Object.freeze({
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

export type MacroEntry = Readonly<{
	readonly id: string;
	readonly name: string;
	readonly effects: readonly Readonly<Record<string, unknown>>[];
}>;

export async function mountedMacroManagerFixture(initialDraft: MacroEntry = {
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
	let cancels = 0;
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
				cancel: () => {
					cancels += 1;
					const pending = runs.at(-1);
					pending?.settlement.reject(
						Object.assign(new Error('The editor task was superseded.'), { name: 'AbortError' }),
					);
					return true;
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
		cancels: () => cancels,
		exports,
		button: (label: string) => buttonByLabel(dom.container, label),
		buttonLabels: () => dom.container.querySelectorAll('button').map(({ textContent }) => textContent),
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
		menuItems: () => dom.container.querySelectorAll('[role="menuitem"]').map(({ textContent }) => textContent),
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

export function macroSnapshot(id: string) {
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

export async function click(button: ReactTestElement): Promise<void> {
	await act(async () => {
		void reactProps(button).onClick({});
		await Promise.resolve();
	});
}

export async function changeFile(input: ReactTestElement, file: File): Promise<void> {
	await act(async () => {
		void reactProps(input).onChange({ currentTarget: { files: [file], value: file.name } });
		await Promise.resolve();
	});
}

export async function changeText(input: ReactTestElement, value: string): Promise<void> {
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

export function deferred<Value>(): Readonly<{
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

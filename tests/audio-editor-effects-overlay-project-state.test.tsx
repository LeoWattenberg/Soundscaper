/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import AudioEditorEffectsOverlay from '../src/common/editor/ui/inspector/AudioEditorEffectsOverlay.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import {
	installReactTestDom, reactProps, ReactTestElement,
} from './helpers/react-test-dom.ts';

test('a deferred rack-effect choice cannot enter a newer controller project', async () => {
	const fixture = await mountedEffectsOverlayFixture();
	try {
		await fixture.render(effectProject('project-a'));
		await fixture.openTrackPicker();
		await act(async () => {
			void reactProps(fixture.effectChoice()).onClick({});
			fixture.switchControllerProject(effectProject('project-b'));
			await Promise.resolve();
			await Promise.resolve();
		});

		assert.deepEqual(fixture.addCalls, []);
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});

test('an old rack-effect completion cannot close the current project picker', async () => {
	const fixture = await mountedEffectsOverlayFixture();
	try {
		await fixture.render(effectProject('project-a'));
		await fixture.openTrackPicker();
		await act(async () => {
			void reactProps(fixture.effectChoice()).onClick({});
			await Promise.resolve();
			await Promise.resolve();
		});
		assert.equal(fixture.addCalls.length, 1);

		await fixture.render(effectProject('project-b'));
		await fixture.openTrackPicker();
		await act(async () => {
			fixture.addCalls[0]!.completion.resolve('project-a-effect');
			await fixture.addCalls[0]!.completion.promise;
			await Promise.resolve();
		});

		assert.ok(fixture.effectChoice(), 'project B picker must survive project A completion');
	} finally {
		fixture.settlePending();
		await fixture.cleanup();
	}
});

async function mountedEffectsOverlayFixture() {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const priorClassList = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'classList');
	const priorBoundingRect = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'getBoundingClientRect');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	Object.assign(globalThis.window, {
		getComputedStyle: () => ({ display: '', visibility: '' }),
		setTimeout: globalThis.setTimeout.bind(globalThis),
		clearTimeout: globalThis.clearTimeout.bind(globalThis),
		innerHeight: 800,
		innerWidth: 1_200,
	});
	Object.defineProperty(ReactTestElement.prototype, 'classList', {
		configurable: true,
		get(this: ReactTestElement) {
			return {
				contains: (name: string) => (this.getAttribute('class') ?? '').split(/\s+/u).includes(name),
			};
		},
	});
	Object.defineProperty(ReactTestElement.prototype, 'getBoundingClientRect', {
		configurable: true,
		value: () => ({
			bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0,
			toJSON: () => ({}),
		}),
	});
	let currentProject = effectProject('initial');
	const addCalls: Array<Readonly<{
		projectId: string;
		completion: Deferred<string>;
	}>> = [];
	const controller = {
		get project() { return currentProject; },
		actions: {
			effects: {
				add: () => {
					const completion = deferred<string>();
					addCalls.push({ projectId: currentProject.id, completion });
					return completion.promise;
				},
				presets: { list: () => [] },
				setMasterGain: () => undefined,
			},
			mixer: {},
			track: {},
		},
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const render = async (project: ReturnType<typeof effectProject>) => {
		currentProject = project;
		await act(async () => root.render(<AudioEditorEffectsOverlay
			isOpen
			controller={controller}
			snapshot={{
				ready: true,
				project,
				selectedTrackId: 'track',
				effects: { hasStackClipboard: false },
			}}
			copy={ENGLISH_COPY}
			locale="en"
			fileService={null}
			trackId="track"
			selectedEffect={undefined}
			onSelectedEffectChange={undefined}
			onClose={() => undefined}
		/>));
	};
	return {
		addCalls,
		render,
		switchControllerProject: (project: ReturnType<typeof effectProject>) => {
			currentProject = project;
		},
		openTrackPicker: async () => {
			const button = dom.container.querySelectorAll('.effects-stack-header__add-button')[0];
			assert.ok(button, 'Missing track effects picker button.');
			await act(async () => {
				void reactProps(button).onClick({ currentTarget: button });
			});
		},
		effectChoice: () => {
			const choice = (globalThis.document.body as unknown as ReactTestElement)
				.querySelector('[role="menuitem"]');
			assert.ok(choice, 'Missing effect picker choice.');
			return choice;
		},
		settlePending: () => {
			for (const call of addCalls) call.completion.resolve('settled-effect');
		},
		cleanup: async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			if (priorClassList) Object.defineProperty(ReactTestElement.prototype, 'classList', priorClassList);
			else Reflect.deleteProperty(ReactTestElement.prototype, 'classList');
			if (priorBoundingRect) Object.defineProperty(ReactTestElement.prototype, 'getBoundingClientRect', priorBoundingRect);
			else Reflect.deleteProperty(ReactTestElement.prototype, 'getBoundingClientRect');
			dom.restore();
		},
	};
}

function effectProject(id: string) {
	return createAudioEditorProjectV17({
		id,
		title: id,
		now: '2026-08-29T00:00:00.000Z',
		tracks: [createAudioTrack({ id: 'track', name: 'Vocal', clipIds: [] })],
		sequences: [{ id: 'sequence', trackIds: ['track'] }],
		primarySequenceId: 'sequence',
	});
}

interface Deferred<Value> {
	readonly promise: Promise<Value>;
	resolve(value: Value | PromiseLike<Value>): void;
}

function deferred<Value>(): Deferred<Value> {
	let resolve: (value: Value | PromiseLike<Value>) => void = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}

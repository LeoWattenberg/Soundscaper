/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';

import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { ClipPropertiesDialog } from '../src/common/editor/ui/inspector/ClipPropertiesDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import {
	installReactTestDom, reactProps, type ReactTestElement,
} from './helpers/react-test-dom.ts';

test('reverse and invert are checkboxes inside the media settings card', async () => {
	const fixture = await mountedFixture();
	try {
		await fixture.render();

		assert.equal(fixture.headings()[1], ENGLISH_COPY.clipMediaSettings);
		assert.equal(fixture.toggleState('reversed'), 'false');
		assert.equal(fixture.toggleState('inverted'), 'false');

		await fixture.toggle('reversed');
		await fixture.toggle('inverted');
		assert.deepEqual(fixture.calls, [['reverse', 'shared-clip'], ['invert', 'shared-clip']]);

		assert.equal(
			fixture.buttonLabels().includes(ENGLISH_COPY.reverse),
			false,
			'the reverse action must not remain a button beside the checkbox',
		);
	} finally {
		await fixture.cleanup();
	}
});

test('a clip already reversed and inverted shows both boxes checked', async () => {
	const fixture = await mountedFixture({ reversed: true, inverted: true });
	try {
		await fixture.render();
		assert.equal(fixture.toggleState('reversed'), 'true');
		assert.equal(fixture.toggleState('inverted'), 'true');
	} finally {
		await fixture.cleanup();
	}
});

test('pitch and tempo owns its own render and reset buttons', async () => {
	const fixture = await mountedFixture({ pitchCents: 200 });
	try {
		await fixture.render();

		const card = fixture.pitchCard();
		assert.deepEqual(
			card.querySelectorAll('button').map((button) => button.textContent),
			[ENGLISH_COPY.render, ENGLISH_COPY.reset],
		);
		assert.equal(fixture.buttonLabels().includes(ENGLISH_COPY.renderPitchSpeed), false);
		assert.equal(fixture.buttonLabels().includes(ENGLISH_COPY.resetPitchSpeed), false);

		await fixture.click(card.querySelectorAll('button')[0]!);
		await fixture.click(card.querySelectorAll('button')[1]!);
		assert.deepEqual(fixture.calls, [
			['renderPitchSpeed', 'shared-clip'],
			['resetPitchSpeed', 'shared-clip'],
		]);
	} finally {
		await fixture.cleanup();
	}
});

test('the dialog confirms with an unpunctuated Done', async () => {
	const fixture = await mountedFixture();
	try {
		await fixture.render();
		assert.equal(ENGLISH_COPY.done, 'Done');
		assert.equal(fixture.buttonLabels().includes('Done'), true);
	} finally {
		await fixture.cleanup();
	}
});

async function mountedFixture(clipOverrides: Readonly<Record<string, unknown>> = {}) {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const currentProject = project(clipOverrides);
	const calls: Array<[string, string]> = [];
	const record = (name: string) => (clipId: string) => {
		calls.push([name, clipId]);
		return Promise.resolve(clipId);
	};
	const controller = {
		get project() { return currentProject; },
		actions: {
			clip: {
				update: () => undefined,
				move: () => undefined,
				trim: () => undefined,
				setTimePitch: () => undefined,
				toggleStretchToTempo: () => undefined,
				reverse: record('reverse'),
				invert: record('invert'),
				normalizePeak: record('normalizePeak'),
				normalizeLoudness: record('normalizeLoudness'),
				renderPitchSpeed: record('renderPitchSpeed'),
				resetPitchSpeed: record('resetPitchSpeed'),
			},
		},
	};
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const click = async (element: ReactTestElement) => {
		await act(async () => {
			reactProps(element).onClick();
			await Promise.resolve();
		});
	};
	const checkbox = (field: string) => {
		const box = dom.one(`[data-clip-field="${field}"]`).querySelector('[role="checkbox"]');
		assert.ok(box, `Missing mounted ${field} checkbox.`);
		return box;
	};
	return {
		calls,
		click,
		render: async () => {
			await act(async () => root.render(<ClipPropertiesDialog
				isOpen
				controller={controller}
				snapshot={{
					project: currentProject,
					selectedClipId: 'shared-clip',
					capabilities: { audioEffects: true, videoEffects: false },
				}}
				copy={ENGLISH_COPY}
				onClose={() => undefined}
			/>));
		},
		headings: () => dom.container.querySelectorAll('h3').map((node) => node.textContent),
		buttonLabels: () => dom.container.querySelectorAll('button').map((node) => node.textContent),
		pitchCard: () => {
			const heading = dom.container.querySelectorAll('h3')
				.find((node) => node.textContent === ENGLISH_COPY.pitchTempo);
			assert.ok(heading?.parentNode instanceof Object, 'the pitch card carries a heading.');
			return heading!.closest('section')!;
		},
		toggleState: (field: string) => checkbox(field).getAttribute('aria-checked'),
		toggle: (field: string) => click(checkbox(field)),
		cleanup: async () => {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}

function project(clipOverrides: Readonly<Record<string, unknown>>) {
	const source = createAudioSource({
		id: 'shared-source', storageKey: 'shared-source', name: 'Interview',
		frameCount: 1_000, channelCount: 1, sampleRate: 48_000,
	});
	const clip = createAudioClip({
		id: 'shared-clip', sourceId: source.id, title: 'Interview',
		timelineStartFrame: 0, durationFrames: 200,
		sourceStartFrame: 0, sourceDurationFrames: 200,
		...clipOverrides,
	});
	return createSoundscaperProject({
		id: 'project', title: 'Project', now: '2026-09-03T00:00:00.000Z',
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'shared-track', name: 'Track', clipIds: [clip.id] })],
	});
}

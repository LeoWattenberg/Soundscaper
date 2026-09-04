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

		const actions = fixture.pitchCard().querySelectorAll('[data-clip-action]')
			.map((hook) => hook.querySelector('button'));
		assert.deepEqual(
			actions.map((button) => button?.textContent),
			[ENGLISH_COPY.render, ENGLISH_COPY.reset],
		);
		assert.equal(fixture.buttonLabels().includes(ENGLISH_COPY.renderPitchSpeed), false);
		assert.equal(fixture.buttonLabels().includes(ENGLISH_COPY.resetPitchSpeed), false);

		await fixture.click(actions[0]!);
		await fixture.click(actions[1]!);
		assert.deepEqual(fixture.calls, [
			['renderPitchSpeed', 'shared-clip'],
			['resetPitchSpeed', 'shared-clip'],
		]);
	} finally {
		await fixture.cleanup();
	}
});

test('the pitch unit toggle offers Audacity\'s semitones or its percent change', async () => {
	const fixture = await mountedFixture({ pitchCents: 200 });
	try {
		await fixture.render();

		assert.deepEqual(
			await fixture.pitchUnitOptions(),
			[ENGLISH_COPY.clipPitchUnitSemitones, ENGLISH_COPY.clipPitchUnitPercent],
			'the two readings Audacity\'s Change Pitch dialog shows',
		);
		assert.equal(ENGLISH_COPY.clipPitchUnitSemitones, 'Semitones (half-steps)');
		assert.equal(fixture.pitchLabel(), ENGLISH_COPY.clipPitchSemitones);
		assert.equal(fixture.pitchValue(), '2.00');

		await fixture.choosePitchUnit(ENGLISH_COPY.clipPitchUnitPercent);
		assert.equal(fixture.pitchLabel(), ENGLISH_COPY.clipPitchPercent);
		assert.equal(fixture.pitchValue(), '12.246', 'two hundred cents raise the frequency by 12.246%');

		await fixture.choosePitchUnit(ENGLISH_COPY.clipPitchUnitSemitones);
		assert.equal(fixture.pitchValue(), '2.00', 'reading the shift back never rewrote it');
		assert.deepEqual(fixture.timePitchCalls, []);
	} finally {
		await fixture.cleanup();
	}
});

test('cents are the two decimals of a semitone rather than a field of their own', async () => {
	const fixture = await mountedFixture({ pitchCents: 101 });
	try {
		await fixture.render();
		assert.equal(fixture.pitchValue(), '1.01', 'a semitone and a cent');

		await fixture.commitPitch('1.01');
		await fixture.commitPitch('-0.07');
		await fixture.commitPitch('12');

		assert.deepEqual(fixture.timePitchCalls, [
			{ pitchCents: 101 },
			{ pitchCents: -7 },
			{ pitchCents: 1_200 },
		]);
	} finally {
		await fixture.cleanup();
	}
});

test('a percentage commits the cents that frequency change asks for', async () => {
	const fixture = await mountedFixture();
	try {
		await fixture.render();
		await fixture.choosePitchUnit(ENGLISH_COPY.clipPitchUnitPercent);

		await fixture.commitPitch('100');
		await fixture.commitPitch('-50');

		assert.deepEqual(fixture.timePitchCalls, [
			{ pitchCents: 1_200 },
			{ pitchCents: -1_200 },
		]);
	} finally {
		await fixture.cleanup();
	}
});

test('a percentage that would silence the clip is refused rather than committed', async () => {
	const fixture = await mountedFixture();
	try {
		await fixture.render();
		await fixture.choosePitchUnit(ENGLISH_COPY.clipPitchUnitPercent);
		await fixture.commitPitch('-100');

		assert.deepEqual(fixture.timePitchCalls, []);
		assert.equal(fixture.errorText(), ENGLISH_COPY.clipPitchRange);
	} finally {
		await fixture.cleanup();
	}
});

test('clearing the pitch field is refused instead of wiping the shift', async () => {
	const fixture = await mountedFixture({ pitchCents: 200 });
	try {
		await fixture.render();
		await fixture.commitPitch('');

		assert.deepEqual(fixture.timePitchCalls, [], 'an empty field asks for nothing, not for no shift');
		assert.equal(fixture.errorText(), ENGLISH_COPY.clipPitchRangeSemitones);
	} finally {
		await fixture.cleanup();
	}
});

test('a semitone shift past the octave is refused in semitones, not in cents', async () => {
	const fixture = await mountedFixture({ pitchCents: 200 });
	try {
		await fixture.render();
		assert.equal(fixture.pitchLabel(), ENGLISH_COPY.clipPitchSemitones);
		await fixture.commitPitch('13');

		assert.deepEqual(fixture.timePitchCalls, []);
		assert.equal(fixture.errorText(), ENGLISH_COPY.clipPitchRangeSemitones);
		assert.doesNotMatch(fixture.errorText(), /cents/u, 'the dialog never shows the reader cents');
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
	const timePitchCalls: Array<Record<string, unknown>> = [];
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
				setTimePitch: (_clipId: string, changes: Record<string, unknown>) => {
					timePitchCalls.push(changes);
				},
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
	// The unit menu is a portalled listbox, so its options only exist while the
	// trigger has been clicked open; the trigger has to be measurable first
	// because the menu positions itself against the trigger's box.
	const togglePitchUnitMenu = async () => {
		const trigger = dom.one('[data-clip-pitch-unit]').querySelector('button');
		assert.ok(trigger, 'Missing mounted pitch unit trigger.');
		Object.defineProperty(trigger, 'getBoundingClientRect', {
			configurable: true,
			value: () => ({ bottom: 28, left: 0, width: 240 }),
		});
		await click(trigger);
		return descendants(document.body as unknown as ReactTestElement)
			.filter((candidate) => candidate.getAttribute('role') === 'option');
	};
	const pitchField = () => dom.one('[data-clip-field="pitchCents"]');
	const pitchInput = () => {
		const input = pitchField().querySelector('input');
		assert.ok(input, 'Missing mounted pitch input.');
		return input;
	};
	return {
		calls,
		timePitchCalls,
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
		errorText: () => dom.find('.audio-editor-field-error')?.textContent ?? '',
		pitchLabel: () => pitchField().querySelectorAll('span')[0]?.textContent ?? '',
		pitchValue: () => pitchInput().value,
		commitPitch: async (typed: string) => {
			const input = pitchInput();
			await act(async () => {
				reactProps(input).onChange({ target: { value: typed } });
				await Promise.resolve();
			});
			await act(async () => {
				reactProps(pitchInput()).onBlur();
				await Promise.resolve();
			});
		},
		pitchUnitOptions: async () => {
			const labels = (await togglePitchUnitMenu()).map((option) => option.textContent);
			await togglePitchUnitMenu();
			return labels;
		},
		choosePitchUnit: async (optionLabel: string) => {
			const option = (await togglePitchUnitMenu())
				.find((candidate) => candidate.textContent === optionLabel);
			assert.ok(option, `Missing mounted pitch unit option ${optionLabel}.`);
			await click(option);
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


function descendants(root: ReactTestElement): ReactTestElement[] {
	const children = root.childNodes.filter((node): node is ReactTestElement => 'tagName' in node);
	return children.flatMap((child) => [child, ...descendants(child)]);
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import GeneratorDialog from '../src/common/editor/ui/dialogs/GeneratorDialog.jsx';
import EditorMusicalTimeCodeProvider from '../src/common/editor/ui/EditorMusicalTimeCodeProvider.tsx';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { createMusicalDurationTimeCodeMap, createMusicalTimeCodeMap,
	type MusicalTimeCodeProject } from '../src/common/editor/ui/time-code-musical-map.ts';
import { secondsToSampleFrame } from '../src/common/editor/timeline-time.ts';

test('native generator Duration bar editing measures from the insertion playhead after a tempo change', async () => {
	const dom = installReactTestDom();
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const keys = new Set<EventListenerOrEventListenerObject>();
	document.addEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => { if (kind === 'keydown' && listener) keys.add(listener); };
	document.removeEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => { if (kind === 'keydown' && listener) keys.delete(listener); };
	const project = createSoundscaperProject({ id: 'musical-generator',
		tempoMap: { mode: 'musical', events: [
			{ beat: { num: 0, den: 1 }, bpm: { num: 60, den: 1 } },
			{ beat: { num: 4, den: 1 }, bpm: { num: 120, den: 1 } },
		] }, signatureMap: { events: [{ bar: 0, numerator: 4, denominator: 4 }] },
	});
	const durations: number[] = [];
	try {
		for (const origin of [0, 4, 2]) {
			const snapshot = { project };
			const telemetry = { positionFrame: origin * 48_000 };
			const controller = {
				project, getSnapshot: () => snapshot, subscribe: () => () => undefined,
				getTelemetrySnapshot: () => telemetry,
				actions: { generators: { generate: (_type: string, options: { durationSeconds: number }) => {
					durations.push(options.durationSeconds);
				} } },
			};
			await act(async () => { root.render(<EditorMusicalTimeCodeProvider controller={controller}>
				<GeneratorDialog key={origin} type="tone" controller={controller} snapshot={{ project }}
					copy={ENGLISH_COPY} locale="en" run={(operation: () => unknown) => operation()} onClose={() => undefined} />
			</EditorMusicalTimeCodeProvider>); });
			const duration = dom.one('[data-generator-field="durationSeconds"]');
			const formatButton = duration.querySelector('.timecode__format-button');
			assert.ok(formatButton);
			await act(async () => { reactProps(formatButton).onClick({ detail: 1 }); });
			const formatItem = dom.container.querySelectorAll('[role="menuitem"]').find(item => item.textContent === 'beats:bars');
			assert.ok(formatItem);
			await act(async () => { reactProps(formatItem).onClick({}); });
			const first = duration.querySelector('.timecode-digit');
			assert.ok(first);
			first.focus();
			await act(async () => { reactProps(first).onClick(); });
			for (const key of ['0', '0', '1', '1', 'Enter']) await act(async () => {
				const event = Object.assign(new Event('keydown', { cancelable: true }), { key });
				for (const listener of [...keys]) {
					if (typeof listener === 'function') listener(event); else listener.handleEvent(event);
				}
			});
			assert.equal(duration.querySelectorAll('.timecode-digit').map(digit => digit.textContent).join(''), '0011');
			const generate = dom.container.querySelectorAll('button').find(button => button.textContent === ENGLISH_COPY.generate);
			assert.ok(generate);
			await act(async () => { reactProps(generate).onClick(); });
			assert.equal(durations.at(-1), origin === 0 ? 4 : origin === 4 ? 2 : 3,
				'one bar uses its genuine insertion tempo, with the zero-origin control retained');
		}
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
		if (previousObserver) Object.defineProperty(globalThis, 'MutationObserver', previousObserver); else Reflect.deleteProperty(globalThis, 'MutationObserver');
		dom.restore();
	}
});

for (const mode of ['musical', 'sampleLocked'] as const) test(`relative durations retain ${mode} tempo, signature changes and exact insertion phase`, () => {
	const project: MusicalTimeCodeProject = {
		sampleRate: 48_000,
		tempoMap: { mode, events: [
			{ beat: { num: 0, den: 1 }, bpm: { num: 60, den: 1 },
				...(mode === 'sampleLocked' ? { samplePosition: secondsToSampleFrame(0, 48_000) } : {}) },
			{ beat: { num: 4, den: 1 }, bpm: { num: 120, den: 1 },
				...(mode === 'sampleLocked' ? { samplePosition: secondsToSampleFrame(4, 48_000) } : {}) },
		] },
		signatureMap: { events: [{ bar: 0, numerator: 4, denominator: 4 }, { bar: 2, numerator: 3, denominator: 8 }] },
	};
	const late = createMusicalDurationTimeCodeMap(project, 288_000);
	assert.equal(late.toSeconds(1, 1), .75, 'a late 3/8 bar contains three local eighth notes');
	assert.deepEqual(late.fromSeconds(.75), { bar: 1, beat: 1, beatsPerBar: 3 });
	const beforeSignature = createMusicalDurationTimeCodeMap(project, 192_000);
	assert.equal(beforeSignature.toSeconds(1, 1), 2);
	assert.equal(beforeSignature.toSeconds(2, 1), 2.75);
	assert.deepEqual(beforeSignature.fromSeconds(2.75), { bar: 2, beat: 1, beatsPerBar: 3 });
	const betweenBeats = createMusicalDurationTimeCodeMap(project, 120_000);
	assert.equal(betweenBeats.toSeconds(1, 1), 2.75, 'tempo conversion preserves the exact fractional insertion beat');
	assert.deepEqual(betweenBeats.fromSeconds(2.75), { bar: 1, beat: 1, beatsPerBar: 4 });
	assert.deepEqual(createMusicalTimeCodeMap(project).fromSeconds(6.5), { bar: 2, beat: 3, beatsPerBar: 3 },
		'ordinary absolute project clocks retain their original map');
});

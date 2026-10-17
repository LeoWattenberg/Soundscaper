/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { clipPropertiesTimeFields } from '../src/common/editor/ui/inspector/ClipPropertiesTimeFields.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('native property time fields preserve exact project samples and the separate source clock', async () => {
	const f = await fixture();
	try {
		for (const [field, value] of [['startFrame', 192_001], ['durationFrame', 96_003], ['sourceInFrame', 44_101],
			['trimEndFrame', 88_197], ['fadeInFrame', 12_345], ['fadeOutFrame', 1]] as const) {
			assert.equal(f.input(field).value, String(value), field);
		}
		assert.match(f.field('sourceInFrame').textContent, /00h00m01\.000s/u, 'source samples use 44.1kHz rather than project 48kHz');
		for (const [field, value] of [['startFrame', 12_345], ['durationFrame', 24_001], ['sourceInFrame', 22_051],
			['trimEndFrame', 11_027], ['fadeInFrame', 2_401], ['fadeOutFrame', 3_001]] as const) {
			await f.enter(field, value);
		}
		assert.deepEqual(f.changes, [
			['start', 12_345], ['duration', 24_001], ['trim-start', 22_051], ['trim-end', 11_027],
			['fade-in', 2_401], ['fade-out', 3_001],
		]);
		assert.equal(f.dom.container.querySelectorAll('[data-clip-field="durationFrame"]').length, 1);
		assert.equal(f.dom.container.querySelectorAll('[data-clip-properties-field="length"]').length, 1);
	} finally { await f.cleanup(); }
});

test('native duration and fades offer musical duration formats at the clip placement', async () => {
	const f = await fixture(false, true);
	try {
		for (const name of ['durationFrame', 'fadeInFrame', 'fadeOutFrame']) {
			const field = f.field(name);
			const button = field.querySelector('.timecode__format-button');
			assert.ok(button);
			await act(async () => reactProps(button).onClick({ stopPropagation() {} }));
			const musical = f.dom.container.querySelectorAll('[role="menuitem"]').find(item => item.textContent === 'beats:bars');
			assert.ok(musical, 'native format menu retains musical duration entry');
			await act(async () => reactProps(musical).onClick({ stopPropagation() {} }));
			await f.enterDigits(name, '0011');
		}
		assert.deepEqual(f.changes, [['duration', 96_000], ['fade-in', 96_000], ['fade-out', 96_000]],
			'one elapsed bar uses the later clip tempo, rather than the four-second bar at project origin');
	} finally { await f.cleanup(); }
});

test('disabled native property fields retain values and disable every editing input', async () => {
	const f = await fixture(true);
	try {
		for (const input of f.dom.container.querySelectorAll('input')) assert.notEqual(input.getAttribute('disabled'), null);
		assert.equal(f.input('durationFrame').value, '96003');
	} finally { await f.cleanup(); }
});

async function fixture(disabled = false, musical = false) {
	const dom = installReactTestDom();
	const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
	Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class { observe() {} disconnect() {} } });
	const keys = new Set<EventListenerOrEventListenerObject>();
	document.addEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => { if (kind === 'keydown' && listener) keys.add(listener); };
	document.removeEventListener = (kind: string, listener: EventListenerOrEventListenerObject | null) => { if (kind === 'keydown' && listener) keys.delete(listener); };
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const changes: Array<readonly [string, number]> = [];
	const project = { sampleRate: 48_000,
		tempoMap: { mode: 'musical', events: [
			{ beat: { num: 0, den: 1 }, bpm: { num: 60, den: 1 } },
			{ beat: { num: 4, den: 1 }, bpm: { num: 120, den: 1 } },
		] }, signatureMap: { events: [{ bar: 0, numerator: 4, denominator: 4 }] } };
	const snapshot = { project };
	const slots = clipPropertiesTimeFields({
		controller: { subscribe: () => () => undefined, getSnapshot: () => snapshot },
		clip: { timelineStartFrame: musical ? 192_000 : 192_001, durationFrames: musical ? 144_000 : 96_003, sourceStartFrame: 44_101,
			sourceDurationFrames: 88_202, fadeInFrames: musical ? 0 : 12_345, fadeOutFrames: musical ? 0 : 1 },
		source: { sampleRate: 44_100, frameCount: 220_500 }, sampleRate: 48_000,
		copy: ENGLISH_COPY, disabled,
		onStart: value => { changes.push(['start', value]); },
		onDuration: value => { changes.push(['duration', value]); },
		onTrimStart: value => { changes.push(['trim-start', value]); },
		onTrimEnd: value => { changes.push(['trim-end', value]); },
		onFade: (side, value) => { changes.push([`fade-${side}`, value]); },
	});
	await act(async () => root.render(<>{Object.values(slots)}</>));
	const field = (name: string) => dom.one(`[data-clip-field="${name}"]`);
	const input = (name: string) => {
		const node = field(name).querySelector('input');
		assert.ok(node);
		return node;
	};
	return { dom, changes, field, input,
		async enterDigits(name: string, digits: string) {
			const first = field(name).querySelector('.timecode-digit');
			assert.ok(first);
			first.focus();
			await act(async () => reactProps(first).onClick());
			for (const key of [...digits, 'Enter']) await act(async () => {
				const event = Object.assign(new Event('keydown', { cancelable: true }), { key });
				for (const listener of [...keys]) {
					if (typeof listener === 'function') listener(event); else listener.handleEvent(event);
				}
			});
		},
		async enter(name: string, value: number) {
			const node = input(name);
			await act(async () => reactProps(node).onChange({ currentTarget: { valueAsNumber: value } }));
			const wrapper = field(name).querySelector('.audio-editor-timecode-input');
			assert.ok(wrapper);
			await act(async () => reactProps(wrapper).onBlur({ currentTarget: wrapper, relatedTarget: null }));
		},
		async cleanup() {
			await act(async () => root.unmount());
			actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
			if (previousObserver) Object.defineProperty(globalThis, 'MutationObserver', previousObserver);
			else Reflect.deleteProperty(globalThis, 'MutationObserver');
			dom.restore();
		},
	};
}

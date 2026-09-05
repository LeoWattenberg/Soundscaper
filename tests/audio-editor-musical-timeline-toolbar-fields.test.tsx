/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';

import { MusicalTimelineControls } from '../src/common/editor/ui/toolbar/MusicalTimelineControls.jsx';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

// The .jsx modules compile against the global React the browser build provides.
(globalThis as unknown as { React: unknown }).React = React;

interface Rational { readonly num: number; readonly den: number }
interface TempoEvent { readonly id: string; readonly beat: Rational; readonly bpm: Rational }
interface SignatureEvent {
	readonly id: string;
	readonly bar: number;
	readonly numerator: number;
	readonly denominator: number;
}

const COPY = Object.freeze({
	projectTempo: 'Project tempo (BPM)',
	timeSignature: 'Time signature',
	numerator: 'numerator',
	denominator: 'denominator',
	musicalTimeline: 'Musical timeline',
	tempoMapMode: 'Tempo anchoring',
	tempoMusicalAnchor: 'Musical',
	sampleLockedAnchor: 'Sample locked',
	tempoEvents: 'Tempo events',
	addTempoEvent: 'Add tempo event',
	tempoEvent: 'Tempo event',
	removeTempoEvent: 'Remove tempo event',
	signatureEvents: 'Time signature events',
	addSignatureEvent: 'Add time signature event',
	signatureEvent: 'Time signature event',
	removeSignatureEvent: 'Remove time signature event',
	beatPosition: 'Beat position',
	samplePosition: 'Sample position',
	barPosition: 'Bar position',
	tempoBpm: 'Tempo (BPM)',
	save: 'Save',
});

interface MusicalToolbarHarness {
	readonly commits: string[];
	readonly errors: string[];
	readonly tempo: () => TempoEvent;
	readonly signature: () => SignatureEvent;
	readonly field: (label: string) => ReactTestElement;
	readonly actionField: (actionId: string) => ReactTestElement;
	readonly focus: (locate: () => ReactTestElement) => void;
	readonly type: (locate: () => ReactTestElement, keys: readonly string[]) => Promise<void>;
	readonly blur: (locate: () => ReactTestElement) => Promise<void>;
}

/**
 * The musical toolbar's tempo and time-signature fields are edited keystroke by
 * keystroke, so they are driven here exactly as a browser drives them: each key
 * rewrites the DOM value, fires whatever change handler the field exposes, and
 * then — for a controlled field only — has its DOM value restored from the
 * rendered `value` prop, which is what React DOM does after every change event.
 */
async function withMusicalToolbar(
	body: (harness: MusicalToolbarHarness) => Promise<void>,
): Promise<void> {
	let tempo: TempoEvent = { id: 'tempo-root', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } };
	let signature: SignatureEvent = { id: 'signature-root', bar: 0, numerator: 4, denominator: 4 };
	const commits: string[] = [];
	const errors: string[] = [];
	// The real command runtime rejects these values, and the toolbar's `run`
	// routes the refusal to the status line instead of throwing.
	const controller = {
		actions: {
			project: {
				updateTempoEvent(id: string, changes: { bpm: Rational }): void {
					assert.equal(id, tempo.id);
					if (changes.bpm.num / changes.bpm.den < 1) {
						throw new RangeError('The root tempo event cannot be below 1 BPM.');
					}
					tempo = { ...tempo, bpm: changes.bpm };
					commits.push(`tempo ${String(changes.bpm.num)}/${String(changes.bpm.den)}`);
				},
				updateSignatureEvent(
					id: string,
					changes: { numerator?: number; denominator?: number },
				): void {
					assert.equal(id, signature.id);
					const next = { ...signature, ...changes };
					if (!Number.isSafeInteger(next.numerator) || next.numerator < 1 || next.numerator > 1_000) {
						throw new RangeError('signature event.numerator must be between 1 and 1000.');
					}
					if (!isPowerOfTwo(next.denominator)) {
						throw new RangeError('signature event.denominator must be a positive safe power of two.');
					}
					signature = next;
					commits.push(`signature ${String(next.numerator)}/${String(next.denominator)}`);
				},
			},
		},
	};
	const run = (command: () => void): void => {
		try {
			command();
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
		}
	};
	const view = (): React.ReactElement => <MusicalTimelineControls
		project={{
			sampleRate: 48_000,
			tempo: {
				bpm: tempo.bpm.num / tempo.bpm.den,
				timeSignature: { numerator: signature.numerator, denominator: signature.denominator },
			},
			tempoMap: { mode: 'musical', events: [tempo] },
			signatureMap: { events: [signature] },
		}}
		snapshot={{ readOnly: false, recording: false }}
		controller={controller}
		copy={COPY}
		run={run}
	/>;

	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const rerender = async (): Promise<void> => {
		await act(async () => { root.render(view()); });
	};
	const settle = (locate: () => ReactTestElement): void => {
		const input = locate();
		const rendered = (reactProps(input) as unknown as { value?: unknown }).value;
		if (rendered !== undefined && rendered !== null) input.value = String(rendered);
	};
	try {
		await rerender();
		await body({
			commits,
			errors,
			tempo: () => tempo,
			signature: () => signature,
			field: (label) => {
				const found = dom.container.querySelectorAll('input')
					.find((input) => input.getAttribute('aria-label') === label);
				assert.ok(found, `Missing toolbar field ${label}`);
				return found;
			},
			actionField: (actionId) => {
				const found = dom.one(`[data-action-id="${actionId}"]`).querySelector('input');
				assert.ok(found, `Missing toolbar field for ${actionId}`);
				return found;
			},
			focus: (locate) => locate().focus(),
			type: async (locate, keys) => {
				for (const key of keys) {
					const input = locate();
					input.value = key === 'Backspace' ? input.value.slice(0, -1) : `${input.value}${key}`;
					const onChange = reactProps(input).onChange;
					if (typeof onChange === 'function') {
						await act(async () => { onChange({ currentTarget: input, target: input }); });
					}
					await rerender();
					settle(locate);
				}
			},
			blur: async (locate) => {
				const input = locate();
				dom.container.ownerDocument.activeElement = null;
				const onBlur = reactProps(input).onBlur;
				if (typeof onBlur === 'function') {
					await act(async () => { onBlur({ currentTarget: input, target: input }); });
				}
				await rerender();
				settle(locate);
			},
		});
	} finally {
		await act(async () => { root.unmount(); });
		actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
}

function isPowerOfTwo(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 1 && (value & (value - 1)) === 0;
}

test('clearing the time signature numerator neither errors nor appends to the old digit', async () => {
	await withMusicalToolbar(async (harness) => {
		const numerator = (): ReactTestElement => harness.field('Time signature: numerator');
		assert.equal(numerator().value, '4');
		harness.focus(numerator);
		await harness.type(numerator, ['Backspace', '3']);
		assert.equal(numerator().value, '3', 'the emptied field keeps the draft instead of snapping back to 4');
		assert.deepEqual(harness.errors, [], 'an emptied field is not a rejected command');
		await harness.blur(numerator);
		assert.deepEqual(harness.commits, ['signature 3/4']);
		assert.equal(harness.signature().numerator, 3);
	});
});

test('retyping the project tempo commits the finished value once', async () => {
	await withMusicalToolbar(async (harness) => {
		const tempo = (): ReactTestElement => harness.actionField('playback-bpm');
		assert.equal(tempo().value, '120');
		harness.focus(tempo);
		await harness.type(tempo, ['Backspace', 'Backspace', 'Backspace', '9', '0']);
		assert.equal(tempo().value, '90', 'the partially retyped field keeps the draft');
		await harness.blur(tempo);
		assert.deepEqual(harness.commits, ['tempo 90/1'], 'intermediate digits are not separate undo entries');
		assert.deepEqual(harness.errors, []);
		assert.equal(harness.tempo().bpm.num / harness.tempo().bpm.den, 90);
	});
});

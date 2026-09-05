/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { audacityActionDefinition } from '../src/common/editor/audacity-action-parity.js';
import { generatorName } from '../src/common/editor/controller/app-helpers.ts';
import {
	AUDIO_EDITOR_GENERATOR_TYPES,
	generateAudioEditorSignal,
} from '../src/common/editor/generators.js';
import {
	MORSE_CODE_ALPHABET,
	encodeMorseCode,
	morseCodeDotSeconds,
	morseCodeKeying,
	morseCodeText,
	morseCodeUnitCount,
	morseCodeUnsupportedCharacters,
	summarizeMorseCode,
} from '../src/common/editor/morse-code.ts';
import { AUDIO_EDITOR_DEFAULT_SHORTCUTS } from '../src/common/editor/preferences.js';
import createApplicationMenus from '../src/common/editor/ui/application-menus.js';
import { WORKSPACE_PANEL_IDS } from '../src/common/editor/ui/workspace/workspace-panel-model.ts';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';

type MenuItem = Record<string, unknown> & { items?: MenuItem[] };

test('the encoder speaks ITU-R M.1677-1 and refuses what Morse cannot send', () => {
	assert.equal(MORSE_CODE_ALPHABET.S, '...');
	assert.equal(MORSE_CODE_ALPHABET.O, '---');
	assert.equal(MORSE_CODE_ALPHABET['5'], '.....');
	assert.equal(MORSE_CODE_ALPHABET['?'], '..--..');

	assert.deepEqual(encodeMorseCode('sos'), [['...', '---', '...']]);
	assert.equal(morseCodeText(encodeMorseCode('SOS')), '... --- ...');
	assert.equal(morseCodeText(encodeMorseCode('  cq   dx  ')), '-.-. --.- / -.. -..-');

	assert.deepEqual(morseCodeUnsupportedCharacters('SOS'), []);
	assert.deepEqual(morseCodeUnsupportedCharacters('sos ✳ %'), ['✳', '%']);
	assert.throws(() => encodeMorseCode('hello ✳'), /unsupported character: ✳/u);
	assert.throws(() => encodeMorseCode('   '), /at least one character/u);
});

test('the keying schedule spends the units the recommendation prescribes', () => {
	// One dot, then three dots of character gap, then one dot.
	assert.equal(morseCodeUnitCount(encodeMorseCode('EE')), 5);
	// The seven units between words replace the character gap rather than adding to it.
	assert.equal(morseCodeUnitCount(encodeMorseCode('E T')), 1 + 7 + 3);
	// "PARIS" plus its trailing word gap is the fifty units a speed is defined against.
	assert.equal(morseCodeUnitCount(encodeMorseCode('PARIS')) + 7, 50);

	assert.deepEqual(morseCodeKeying(encodeMorseCode('A')), [
		{ tone: true, units: 1 },
		{ tone: false, units: 1 },
		{ tone: true, units: 3 },
	]);
	assert.equal(morseCodeDotSeconds(20), 0.06);
	assert.equal(morseCodeDotSeconds(5), 0.24);
	assert.throws(() => morseCodeDotSeconds(0), /wordsPerMinute/u);
});

test('the dialog summary survives a half-typed message instead of throwing', () => {
	const sos = summarizeMorseCode('SOS', 20);
	assert.equal(sos.code, '... --- ...');
	assert.equal(sos.empty, false);
	assert.deepEqual(sos.unsupported, []);
	assert.ok(Math.abs(sos.durationSeconds - morseCodeUnitCount(encodeMorseCode('SOS')) * 0.06) < 1e-9);

	const empty = summarizeMorseCode('   ', 20);
	assert.equal(empty.empty, true);
	assert.equal(empty.code, '');
	assert.equal(empty.durationSeconds, 0);

	const broken = summarizeMorseCode('SOS ✳', 20);
	assert.deepEqual(broken.unsupported, ['✳']);
	assert.equal(broken.code, '');
	assert.equal(summarizeMorseCode('SOS', 'not a speed').dotSeconds, 0);
});

test('the morse generator keys a real tone into the schedule it encodes', () => {
	assert.ok(AUDIO_EDITOR_GENERATOR_TYPES.includes('morse'));
	const generated = generateAudioEditorSignal('morse', {
		sampleRate: 8_000,
		text: 'ee',
		wordsPerMinute: 60,
		frequency: 500,
		amplitude: 0.5,
		channelCount: 2,
	});

	// Five units at 60 words per minute: 0.02 s each, 160 frames each.
	assert.equal(generated.frameCount, 800);
	assert.equal(generated.channelCount, 2);
	assert.deepEqual(generated.channels[1], generated.channels[0]);

	const mono = generated.channels[0];
	const peak = (from: number, to: number) => Math.max(...[...mono.slice(from, to)].map(Math.abs));
	assert.ok(peak(0, 160) > 0.49 && peak(0, 160) <= 0.5, 'the first dot reaches its amplitude');
	assert.equal(peak(160, 640), 0, 'the character gap is silent');
	assert.ok(peak(640, 800) > 0.49, 'the second dot is keyed');
	// A keying envelope, not a hard switch: the element opens and closes at zero.
	assert.equal(mono[0], 0);
	assert.ok(Math.abs(mono[159]) < 0.05);
});

test('morse timing follows the sending speed and validates its parameters', () => {
	const units = morseCodeUnitCount(encodeMorseCode('SOS'));
	for (const wordsPerMinute of [5, 20, 60]) {
		const generated = generateAudioEditorSignal('morse', {
			sampleRate: 48_000,
			text: 'SOS',
			wordsPerMinute,
		});
		assert.equal(generated.frameCount, Math.round(units * morseCodeDotSeconds(wordsPerMinute) * 48_000));
	}

	assert.throws(() => generateAudioEditorSignal('morse', { text: 'hello ✳' }), /unsupported character/u);
	assert.throws(() => generateAudioEditorSignal('morse', { text: 'SOS', wordsPerMinute: 0 }), /wordsPerMinute/u);
	assert.throws(() => generateAudioEditorSignal('morse', { text: 'SOS', amplitude: 2 }), /amplitude/u);
	assert.throws(() => generateAudioEditorSignal('morse', {
		sampleRate: 8_000,
		text: 'SOS',
		frequency: 100_000,
	}), /frequency/u);
	// A message nobody could sit through is refused rather than allocated.
	assert.throws(() => generateAudioEditorSignal('morse', {
		text: 'SOS '.repeat(20_000),
		wordsPerMinute: 1,
	}), /too long/u);
});

test('the morse generator is reachable from the Generate menu in both locales', () => {
	for (const copy of [ENGLISH_COPY, GERMAN_COPY]) {
		const opened: string[] = [];
		const generate = menus(copy, opened).find((menu) => menu.id === 'generate');
		const item = generate?.items?.find((entry) => entry.id === 'morse-generator');

		assert.ok(item, 'the Generate menu offers the Morse code generator');
		assert.equal(item.label, copy.morseGenerator);
		assert.equal(item.disabled, false);
		(item.onClick as () => void)();
		assert.deepEqual(opened, ['morse']);
	}

	assert.equal(ENGLISH_COPY.morseGenerator, 'Morse code');
	assert.equal(GERMAN_COPY.morseGenerator, 'Morsecode');
	assert.equal(generatorName('morse', ENGLISH_COPY), 'Morse code');
});

test('the morse generator carries a local parity record, not an Audacity one', () => {
	const definition = audacityActionDefinition('morse-generator');

	assert.equal(definition?.id, 'local://morse-generator');
	assert.equal(definition?.handler, 'generators.morse');
	assert.equal(definition?.origin, 'local');
	assert.equal(definition?.upstreamSource, null);
	assert.deepEqual(definition?.locations, ['Generate']);
});

function menus(copy: Record<string, string>, opened: string[]): MenuItem[] {
	const project = {
		id: 'project',
		sampleRate: 48_000,
		sources: [],
		clips: [{ id: 'clip', kind: 'audio' }],
		tracks: [{ id: 'track-a', type: 'audio', clipIds: ['clip'], effects: [] }],
		selection: { trackIds: [], clipIds: [] },
		loop: { enabled: false },
		snap: { enabled: false, division: 'samples' },
	};
	return createApplicationMenus({
		productId: 'soundscaper',
		aboutLabel: 'About',
		capabilities: { audioGenerators: true },
		locale: copy === ENGLISH_COPY ? 'en' : 'de',
		copy,
		project,
		snapshot: {
			project,
			selectedTrackId: 'track-a',
			preferences: {
				workspace: {
					activeId: 'editing',
					custom: [],
					panels: Object.fromEntries(WORKSPACE_PANEL_IDS.map((id: string) => [id, { visible: false }])),
				},
				view: {},
				shortcuts: AUDIO_EDITOR_DEFAULT_SHORTCUTS,
			},
			history: { canUndo: false, canRedo: false, hasClipboard: false },
			effects: { selectionTypes: [], canRepeatLast: false },
		},
		blocked: false,
		editBlocked: false,
		handoffBlocked: false,
		showArmControls: false,
		selectionActive: true,
		selectedClip: null,
		durationFrames: 10_000,
		effectsPanelOpen: false,
		projectBinEffectivelyOpen: false,
		uiFlags: {},
		actionRuntime: null,
		actions: new Proxy({
			openGenerator: (type: string) => { opened.push(type); },
		} as Record<string, unknown>, {
			get: (target, property, receiver) => (Reflect.has(target, property)
				? Reflect.get(target, property, receiver)
				: () => undefined),
		}),
	}) as MenuItem[];
}

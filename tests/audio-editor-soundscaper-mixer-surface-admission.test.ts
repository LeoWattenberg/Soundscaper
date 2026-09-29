/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

const NOW = '2026-09-29T12:00:00.000Z';

function project() {
	return createSoundscaperProject({
		id: 'mixer-surface-admission', title: 'Mixer surface admission', now: NOW,
		tracks: [{ type: 'audio', id: 'voice', name: 'Voice' }],
	});
}

function assertRejectedBusField(field: string, value: unknown): void {
	const original = project();
	const before = JSON.stringify(original);
	assert.throws(() => applySoundscaperProjectCommand(original, {
		type: 'mixer/bus-add', busType: 'group',
		bus: { id: 'dialogue', name: 'Dialogue', [field]: value },
	} as never), /mixer bus|mixer node|must be|unsupported|strip envelopes/iu);
	assert.equal(JSON.stringify(original), before);
}

for (const [name, field, value] of [
	['numeric text gain', 'gain', '0.5'],
	['null gain', 'gain', null],
	['numeric text pan', 'pan', '0.5'],
	['null pan', 'pan', null],
	['numeric name', 'name', 42],
	['null color', 'color', null],
	['text mute flag', 'mute', 'false'],
	['text solo flag', 'solo', 'false'],
	['text collapsed flag', 'collapsed', 'false'],
	['text effects-active flag', 'effectsActive', 'false'],
	['non-array effect rack', 'effects', { id: 'compressor' }],
	['legacy envelope', 'envelope', [{ time: 0, value: 1 }]],
	['unsupported channel count', 'channelCount', 1],
	['explicit undefined gain', 'gain', undefined],
] as const) {
	test(`mixer bus addition rejects ${name} without changing the project`, () => {
		assertRejectedBusField(field, value);
	});
}

test('mixer send update rejects numeric text instead of accepting a coerced level', () => {
	assertRejectedSendLevel('0.5');
});

test('mixer send update rejects boolean instead of accepting a coerced level', () => {
	assertRejectedSendLevel(false);
});

function assertRejectedSendLevel(level: unknown): void {
	const original = applySoundscaperProjectCommand(project(), {
		type: 'mixer/bus-add', busType: 'send', bus: { id: 'reverb', name: 'Reverb' },
	} as never);
	const before = JSON.stringify(original);
	assert.throws(() => applySoundscaperProjectCommand(original, {
		type: 'mixer/route-update', trackId: 'voice',
		changes: { sends: { reverb: level } },
	} as never), /send level|canonical number|must be/iu);
	assert.equal(JSON.stringify(original), before);
}

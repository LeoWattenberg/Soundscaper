/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audacityLinkedToneGain,
	audacityPitchParts,
	audacityPitchPercent,
	audacitySemitonesFromPercent,
	audacitySemitonesFromFrequencies,
	commitAudacityLinkedTone,
	audacityVinylRateAvailable,
	audacityPitchPercentGesture,
} from '../src/common/editor/ui/audacity-derived-controls.ts';

test('pitch views agree across semitones, cents, percent and frequency pairs', () => {
	assert.deepEqual(audacityPitchParts(-0.25), { semitones: -1, cents: 75 });
	assert.deepEqual(audacityPitchParts(3.999), { semitones: 4, cents: 0 });
	assert.equal(audacityPitchPercent(12), 100);
	assert.equal(audacityPitchPercent(-12), -50);
	assert.equal(audacitySemitonesFromPercent(100), 12);
	assert.equal(audacitySemitonesFromFrequencies(440, 880), 12);
	assert.equal(audacitySemitonesFromFrequencies(440, 220), -12);
	assert.throws(() => audacitySemitonesFromPercent(-100), RangeError);
	assert.throws(() => audacitySemitonesFromFrequencies(0, 440), RangeError);
});

test('a derived percentage gesture delivers semitones through every phase of the original pitch gesture', () => {
	const phases: Array<Readonly<{ phase: string; value?: number }>> = [];
	const gesture = audacityPitchPercentGesture({
		onGestureBegin: value => { phases.push({ phase: 'begin', value }); },
		onGesturePreview: value => { phases.push({ phase: 'preview', value }); },
		onGestureCommit: value => { phases.push({ phase: 'commit', value }); },
		onGestureCancel: () => { phases.push({ phase: 'cancel' }); },
	});
	gesture.onGestureBegin?.(-50);
	gesture.onGesturePreview?.(100);
	gesture.onGestureCommit?.(0);
	gesture.onGestureCancel?.();
	assert.deepEqual(phases, [
		{ phase: 'begin', value: -12 },
		{ phase: 'preview', value: 12 },
		{ phase: 'commit', value: 0 },
		{ phase: 'cancel' },
	]);
	assert.deepEqual(audacityPitchPercentGesture({}), {});
});

test('vinyl conversions only admit speeds the current effect parameter can represent', () => {
	const rateRange = [-50, 100] as const;
	assert.equal(audacityVinylRateAvailable(100 / 3, 45, rateRange), true);
	assert.equal(audacityVinylRateAvailable(100 / 3, 78, rateRange), false);
	assert.equal(audacityVinylRateAvailable(78, 100 / 3, rateRange), false);
	assert.equal(audacityVinylRateAvailable(45, 78, rateRange), true);
	assert.equal(audacityVinylRateAvailable(100 / 3, 78, [-99, 4900]), true);
	assert.equal(audacityVinylRateAvailable(0, 45, rateRange), false);
});

test('linked tone edits finish the original tone commit before committing the compensated output', async () => {
	const commits: Array<Readonly<{ name: string; value: number; controlValue: number }>> = [];
	let releaseTone: (() => void) | undefined;
	const pending = new Promise<void>(resolve => { releaseTone = resolve; });
	const finished = commitAudacityLinkedTone(0, 12, 0, async (value, automation) => {
		commits.push({ name: 'bass', value, controlValue: automation.controlValue });
		await pending;
	}, (value, automation) => {
		commits.push({ name: 'output', value, controlValue: automation.controlValue });
	});
	assert.deepEqual(commits, [{ name: 'bass', value: 12, controlValue: 12 }]);
	releaseTone?.();
	await finished;
	assert.deepEqual(commits, [
		{ name: 'bass', value: 12, controlValue: 12 },
		{ name: 'output', value: -6, controlValue: -6 },
	]);
});

test('a rejected linked tone commit leaves output gain untouched', async () => {
	let outputCommits = 0;
	await assert.rejects(commitAudacityLinkedTone(0, 12, 0,
		() => { throw new Error('Tone edit rejected'); },
		() => { outputCommits += 1; }), /Tone edit rejected/u);
	assert.equal(outputCommits, 0);
});

test('a handled linked tone failure leaves output gain untouched', async () => {
	let outputCommits = 0;
	await commitAudacityLinkedTone(0, 12, 0,
		() => Promise.resolve(false),
		() => { outputCommits += 1; });
	assert.equal(outputCommits, 0);
});

test('linked tone gain compensates boosts and cuts by Audacitys original weighting and clamps output', () => {
	assert.equal(audacityLinkedToneGain(0, 12, 0), -6);
	assert.equal(audacityLinkedToneGain(0, -12, 0), 3);
	assert.equal(audacityLinkedToneGain(12, -12, -6), 3);
	assert.equal(audacityLinkedToneGain(0, 30, -30), -30);
	assert.equal(audacityLinkedToneGain(0, -30, 30), 30);
});

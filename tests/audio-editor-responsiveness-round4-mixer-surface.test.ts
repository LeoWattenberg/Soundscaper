/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { applySoundscaperMixerSurfaceCommand } from '../src/soundscaper/editor-project-mixer-surface.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { mixerSurfaceFixture } from './helpers/responsiveness-round4-surface-fixtures.ts';

void test('Soundscaper bus addition checks separate admitted node collections without a combined node array', () => {
	const project = mixerSurfaceFixture(), original = Array.prototype.some;
	let combined = 0;
	Array.prototype.some = function (predicate: (value: unknown, index: number, array: unknown[]) => unknown, thisArg?: unknown) {
		if (this.length === 60 && (this[0] as { id?: unknown } | undefined)?.id === 'group-0' && (this[59] as { id?: unknown } | undefined)?.id === 'send-29') combined++;
		return Reflect.apply(original, this, [predicate, thisArg]) as boolean;
	};
	try { applySoundscaperMixerSurfaceCommand(project, { type: 'mixer/bus-add', busType: 'group', bus: { id: 'added' } }); }
	finally { Array.prototype.some = original; }
	assert.equal(combined, 0);
});

void test('Soundscaper group routing resolves the selected strip once for endpoint and channel width', () => {
	const project = mixerSurfaceFixture(), original = Array.prototype.find;
	let searches = 0;
	Array.prototype.find = function <T>(predicate: (value: unknown, index: number, array: unknown[]) => unknown, thisArg?: unknown): T | undefined {
		if (this.length === 30 && (this[0] as { id?: unknown } | undefined)?.id === 'group-0') searches++;
		return Reflect.apply(original, this, [predicate, thisArg]) as T | undefined;
	};
	try { applySoundscaperMixerSurfaceCommand(project, { type: 'mixer/route-update', trackId: 'track', changes: { groupId: 'group-29' } }); }
	finally { Array.prototype.find = original; }
	assert.equal(searches, 1);
});

void test('Soundscaper new sends skip the second edge filter when no old matching edge exists', context => {
	const project = mixerSurfaceFixture(120), original = Array.prototype.filter;
	let filters = 0;
	Array.prototype.filter = function (predicate: (value: unknown, index: number, array: unknown[]) => unknown, thisArg?: unknown) {
		if ((this[0] as { kind?: unknown } | undefined)?.kind === 'assignment') filters++;
		return Reflect.apply(original, this, [predicate, thisArg]) as unknown[];
	};
	try { applySoundscaperMixerSurfaceCommand(project, { type: 'mixer/route-update', trackId: 'track',
		changes: { sends: Object.fromEntries(project.mixer.sends.map(send => [send.id, 1])) } }); }
	finally { Array.prototype.filter = original; }
	context.diagnostic(`120 new sends: ${String(filters)} assignment/send edge filters`);
	assert.equal(filters, 120);
});

void test('Soundscaper public mixer commands reach the optimized surface and keep caller ownership on errors', () => {
	const before = mixerSurfaceFixture(2), snapshot = JSON.stringify(before);
	const added = applySoundscaperProjectCommand(before, { type: 'mixer/bus-add', busType: 'group', bus: { id: 'added' } }, { now: '2026-10-07T00:00:00.000Z' });
	assert.equal(added.mixer.groups.length, 3);
	assert.equal(JSON.stringify(before), snapshot);
	assert.throws(() => applySoundscaperProjectCommand(before, { type: 'mixer/route-update', trackId: 'track', changes: { sends: { absent: 1 } } }));
	assert.equal(JSON.stringify(before), snapshot);
});

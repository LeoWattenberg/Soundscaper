/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSequenceTimingService } from '../src/common/editor/controller/sequence-timing-service.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

const NTSC = { num: 30_000, den: 1_001 };

function harness(options: Readonly<{ blocked?: boolean; sequence?: Record<string, unknown> }> = {}) {
	const commands: AudioEditorCommand[] = [];
	const seeks: number[] = [];
	const published: number[] = [];
	let position = 0;
	const service = createSequenceTimingService({
		lifetime: { assertActive: () => undefined },
		getProject: () => ({
			sampleRate: 48_000,
			primarySequenceId: 'main',
			sequences: [{
				id: 'main',
				name: 'Main sequence',
				rate: { num: 25, den: 1 },
				dropFrame: false,
				startTimecode: { negative: false, hours: 0, minutes: 0, seconds: 0, frames: 0 },
				...options.sequence,
			}],
		}),
		editingBlocked: () => options.blocked === true,
		commit: (command) => { commands.push(command); return command; },
		publishProjectState: () => published.push(published.length + 1),
		getPositionFrames: () => position,
		seek: (frame) => { seeks.push(frame); position = frame; return frame; },
	});
	return { service, commands, seeks, published, setPosition: (value: number) => { position = value; } };
}

test('the service resolves the document sequence into one shared view', () => {
	const { service } = harness({ sequence: { rate: NTSC, dropFrame: true } });
	const view = service.view();

	assert.equal(view.id, 'main');
	assert.deepEqual(view.rate, NTSC);
	assert.equal(view.dropFrame, true);
	assert.equal(view.nominalFrameRate, 30);
});

test('an update commits exactly one detached sequence timing command', () => {
	const changes = { rate: { num: 24, den: 1 }, name: 'Programme' };
	const { service, commands, published } = harness();
	service.update('main', changes);
	changes.name = 'mutated after commit';

	assert.deepEqual(commands, [{
		type: 'sequence/update',
		sequenceId: 'main',
		changes: { rate: { num: 24, den: 1 }, name: 'Programme' },
	}]);
	assert.equal(published.length, 1);
});

test('blocked editing refuses a sequence timing update', () => {
	const { service, commands } = harness({ blocked: true });
	assert.throws(() => service.update('main', { dropFrame: false }), /Editing is blocked/);
	assert.equal(commands.length, 0);
});

test('labels report the frame containing a position, offset by the start timecode', () => {
	const { service, setPosition } = harness({
		sequence: { startTimecode: { negative: false, hours: 1, minutes: 0, seconds: 0, frames: 0 } },
	});

	assert.equal(service.label(0), '01:00:00:00');
	assert.equal(service.label(1_919), '01:00:00:00');
	assert.equal(service.label(1_920), '01:00:00:01');
	setPosition(1_920);
	assert.equal(service.playheadLabel(), '01:00:00:01');
});

test('frame stepping seeks whole frames and reverses exactly', () => {
	const { service, seeks, setPosition } = harness();

	assert.equal(service.stepPlayhead(1), 1_920);
	assert.equal(service.stepPlayhead(1), 3_840);
	assert.equal(service.stepPlayhead(-1), 1_920);
	setPosition(2_000);
	assert.equal(service.stepPlayhead(-1), 1_920);
	assert.equal(service.stepPlayhead(-5), 0);
	assert.deepEqual(seeks, [1_920, 3_840, 1_920, 1_920, 0]);
});

test('typed labels and snapping resolve onto the same frame grid', () => {
	const { service, seeks } = harness();

	assert.equal(service.seekLabel('00:00:02:00'), 96_000);
	assert.equal(service.snapSample(2_000, 'previous'), 1_920);
	assert.equal(service.snapSample(2_000, 'next'), 3_840);
	assert.equal(service.snapSample(2_000), 1_920);
	assert.deepEqual(seeks, [96_000]);
});

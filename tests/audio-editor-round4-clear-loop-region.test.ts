/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTransportFixture } from './helpers/audio-editor-transport-fixture.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';

test('canonical loop command honors a cleared range while bare disable retains it', () => {
	const project = createSoundscaperProject({ id: 'clear-loop' });
	const stored = applySoundscaperProjectCommand(project, { type: 'loop/set', enabled: true, startFrame: 100, endFrame: 400 });
	const disabled = applySoundscaperProjectCommand(stored, { type: 'loop/set', enabled: false });
	assert.deepEqual(disabled.loop, { enabled: false, startFrame: 100, endFrame: 400 });
	const cleared = applySoundscaperProjectCommand(stored, { type: 'loop/set', enabled: false, startFrame: 0, endFrame: 0 });
	assert.deepEqual(cleared.loop, { enabled: false, startFrame: 0, endFrame: 0 });
	assert.deepEqual(stored.loop, { enabled: true, startFrame: 100, endFrame: 400 });
	assert.throws(() => applySoundscaperProjectCommand(stored, { type: 'loop/set', enabled: true, startFrame: 0, endFrame: 0 }), /positive duration/u);
});

for (const followsLoop of [false, true]) {
	test(`Clear loop removes the stored range without changing selection when follow is ${followsLoop}`, async () => {
		const fixture = createTransportFixture();
		fixture.state.selectionFollowsLoop = followsLoop;
		fixture.setProject({ ...fixture.project(),
			selection: { startFrame: 20, endFrame: 60, trackIds: ['track'], clipIds: [],
				frequencyRange: { minimumFrequency: 100, maximumFrequency: 1000 } },
			loop: { enabled: true, startFrame: 100, endFrame: 400 },
		});
		const original = structuredClone(fixture.project());
		assert.deepEqual(fixture.service.clearLoopRegion(), { enabled: false, startFrame: 0, endFrame: 0 });
		assert.deepEqual(fixture.project().selection, original.selection);
		assert.deepEqual(fixture.calls.loops, [{ enabled: false, startFrame: 0, endFrame: 0 }]);
		await fixture.service.handleTransport('loop');
		assert.deepEqual(fixture.project().loop, { enabled: true, startFrame: 20, endFrame: 60 });
		assert.deepEqual(original.loop, { enabled: true, startFrame: 100, endFrame: 400 });
	});
}

test('ordinary loop toggle preserves its disabled range for later reuse', async () => {
	const fixture = createTransportFixture();
	fixture.setProject({ ...fixture.project(), loop: { enabled: true, startFrame: 100, endFrame: 400 } });
	await fixture.service.handleTransport('loop');
	assert.deepEqual(fixture.project().loop, { enabled: false, startFrame: 100, endFrame: 400 });
	await fixture.service.handleTransport('loop');
	assert.deepEqual(fixture.project().loop, { enabled: true, startFrame: 100, endFrame: 400 });
});

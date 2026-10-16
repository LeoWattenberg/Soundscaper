/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { EditorControllerLifetime } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createTakeCompPreviewService } from '../src/common/editor/controller/track-audio/internal/take-comp/take-comp-preview-service.ts';
import { createTakeCompService } from '../src/common/editor/controller/track-audio/internal/take-comp/take-comp-service.ts';
import { createCycleProducedTakeFixture } from './helpers/cycle-produced-take-fixture.ts';

for (const mode of ['sync', 'complete', 'cancel', 'failure'] as const) {
	test(`recorded take audition retires the previous transport before starting (${mode})`, async context => {
		const fixture = await createCycleProducedTakeFixture();
		context.after(async () => { await fixture.store.close(); });
		const project = fixture.project;
		const original = structuredClone(project);
		const lifetime = new EditorControllerLifetime();
		let release: (() => void) | undefined;
		const retiring = new Promise<void>(resolve => { release = resolve; });
		let binAudible = true;
		const retired = retiring.then(() => {
			if (mode === 'failure') throw new Error('Previous audition could not retire.');
			binAudible = false;
		});
		void retired.catch(() => {});
		const playedWhileBinAudible: boolean[] = [];
		let retirements = 0;
		const service = createTakeCompService({ lifetime, getProject: () => project,
			editingBlocked: () => false, commit: () => assert.fail('Audition does not publish document edits.'),
		});
		const preview = createTakeCompPreviewService({ lifetime, service,
			sourceBuffers: new Map(), sourceChunkProviders: new Map(),
			getProject: () => project, createId: prefix => `${prefix}-preview`,
			captureProject: () => ({ generation: 1, projectId: project.id }), assertProject() {},
			stopPlayback: mode === 'sync' ? () => { retirements++; binAudible = false; } : () => { retirements++; return retired; },
			createPreviewEngine: () => ({ loadProject() {},
				async play() { playedWhileBinAudible.push(binAudible); }, pause() {}, stop() {}, dispose() {},
			}),
		});
		const playing = preview.auditionTake('cycle-produced-group', 'cycle-produced-take-a');
		const outcome = playing.then(value => ({ value }), (error: unknown) => ({ error }));
		try {
			await setImmediate();
			assert.equal(retirements, 1);
			assert.deepEqual(playedWhileBinAudible, mode === 'sync' ? [false] : [],
				'Actual take preview waits for the previous audible owner.');
			if (mode === 'cancel') await preview.stop();
			assert.ok(release); release();
			const result = await outcome;
			if (mode === 'cancel' || mode === 'failure') {
				assert.ok('error' in result);
				assert.ok(result.error instanceof Error);
				if (mode === 'failure') assert.match(result.error.message, /could not retire/u);
				else assert.equal(result.error.name, 'AbortError');
				assert.deepEqual(playedWhileBinAudible, [], 'Retired or failed requests never start PCM.');
			} else {
				assert.ok('value' in result);
				assert.equal(result.value.state, 'playing');
				assert.deepEqual(playedWhileBinAudible, [false]);
			}
			assert.deepEqual(project, original);
		} finally {
			release?.(); await outcome; await preview.dispose();
		}
	});
}

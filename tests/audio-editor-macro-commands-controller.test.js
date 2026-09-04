/* SPDX-License-Identifier: AGPL-3.0-only */

import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

import { MockAudioBuffer, createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';

const assetLoader = `
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/core?url' || specifier === '@ffmpeg/core/wasm?url') {
			return {
				url: 'data:text/javascript,export default "mock-ffmpeg-asset"',
				shortCircuit: true,
			};
		}
		return nextResolve(specifier, context);
	}
`;

register(`data:text/javascript,${encodeURIComponent(assetLoader)}`, import.meta.url);

const { createAudioEditorController } = await import('../src/common/editor/app.js');
const { createCurrentAudioEditorProject } = await import('../src/common/editor/project-current.ts');
const { createProjectStore } = await import('../src/common/editor/storage.js');
const { createMacroCommandStep } = await import('../src/common/editor/macro-command-steps.ts');
const { ENGLISH_COPY: COPY } = await import('../src/common/i18n/catalogs.js');

function createMemoryEngine() {
	return {
		positionFrame: 0,
		state: 'stopped',
		loadedProjects: [],
		appliedProjects: [],
		disposeCalls: 0,
		playAtSpeedCalls: [],
		loadProject(project) { this.loadedProjects.push(structuredClone(project)); },
		async applyProject(project) { this.appliedProjects.push(structuredClone(project)); },
		getPositionFrames() { return this.positionFrame; },
		getState() { return { state: this.state, loop: { enabled: false } }; },
		stop() { this.state = 'stopped'; },
		play() { this.state = 'playing'; },
		async playAtSpeed(rate, options) { this.playAtSpeedCalls.push({ rate, options }); this.state = 'playing'; },
		pause() { this.state = 'paused'; },
		seek(frame) { this.positionFrame = Math.max(0, Math.round(frame)); return this.positionFrame; },
		setLoop() {},
		setSourceResolver(resolver) { this.sourceResolver = resolver; return this; },
		async getAudioContext() {
			return {
				createBuffer: (channelCount, frameCount, sampleRate) => new MockAudioBuffer(channelCount, frameCount, sampleRate),
			};
		},
		async dispose() { this.disposeCalls += 1; },
	};
}

function audioBuffer(channels, sampleRate) {
	return {
		numberOfChannels: channels.length,
		length: channels[0]?.length ?? 0,
		sampleRate,
		getChannelData: (index) => channels[index],
	};
}

test('a macro moves the selection between its effect steps and undoes as one', async () => {
	// Audacity's macro is a command script: each step reads what the one before it
	// left behind. This is that, end to end — two selections, two effect runs, and
	// one undo that puts the whole thing back.
	const renderRanges = [];
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `controller-macro-commands-${Date.now()}-${Math.random()}`,
	});
	const sourceId = 'macro-command-source';
	const input = new Float32Array(96_000).fill(0.5);
	const writer = await store.beginSourceWrite(sourceId, {
		name: 'macro.wav', mimeType: 'audio/wav', sampleRate: 48_000, channelCount: 1,
	});
	for (let offset = 0; offset < input.length; offset += 48_000) {
		await writer.write([input.subarray(offset, offset + 48_000)]);
	}
	await writer.commit({ sampleRate: 48_000, channelCount: 1 });
	const project = createCurrentAudioEditorProject({
		id: 'macro-command-project',
		title: 'Macro commands',
		now: '2026-07-15T00:00:00.000Z',
		sampleRate: 48_000,
		sources: [{
			id: sourceId, name: 'macro.wav', mimeType: 'audio/wav', storageKey: sourceId,
			frameCount: input.length, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
			sampleFormat: 'float32', chunkFrames: 65_536,
		}],
		tracks: [{ type: 'audio', id: 'macro-command-track', name: 'Source', clipIds: ['macro-command-clip'] }],
		clips: [{
			id: 'macro-command-clip', sourceId, title: 'Source',
			timelineStartFrame: 0, sourceStartFrame: 0,
			sourceDurationFrames: input.length, durationFrames: input.length,
		}],
	});
	await store.saveProject(project);
	await store.saveSetting('last-project-id', project.id);
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
		renderSnapshot: async (_snapshot, range) => {
			renderRanges.push({ startFrame: range.startFrame, endFrame: range.endFrame });
			return audioBuffer([new Float32Array(range.outputFrames).fill(0.25)], 48_000);
		},
	});
	try {
		await controller.ready;
		controller.actions.timeline.selectTrack('macro-command-track');
		controller.actions.timeline.setSelection(0, 1, { trackIds: ['macro-command-track'] });
		const before = controller.getSnapshot();
		const clipsBefore = before.project.clips.map(({ sourceId: id }) => id);
		const historyBefore = before.history.undoEntries.length;

		assert.equal(await controller.actions.macros.run({
			name: 'Fade ends',
			effects: [
				createMacroCommandStep('SelectTime', { id: 'select-head', params: { start: 0, end: 1 } }),
				{ id: 'head', type: 'audacity-invert', enabled: true, params: {} },
				createMacroCommandStep('SelectTime', {
					id: 'select-tail', params: { start: 1, end: 0, relativeTo: 'project-end' },
				}),
				{ id: 'tail', type: 'audacity-invert', enabled: true, params: {} },
			],
		}), true);

		// Each run resolved its own target from whatever the command before it
		// selected: the first second, then the last.
		assert.deepEqual(renderRanges, [
			{ startFrame: 0, endFrame: 48_000 },
			{ startFrame: 48_000, endFrame: 96_000 },
		]);

		let snapshot = controller.getSnapshot();
		assert.equal(snapshot.history.undoEntries.length, historyBefore + 1,
			'two effect runs still undo as the one action the user asked for');
		assert.equal(snapshot.history.undoEntries[0].type, 'macro/run');

		controller.actions.edit.undo();
		snapshot = controller.getSnapshot();
		assert.deepEqual(snapshot.project.clips.map(({ sourceId: id }) => id), clipsBefore);
		assert.equal(snapshot.history.undoEntries.length, historyBefore);
	} finally {
		await controller.dispose();
	}
});

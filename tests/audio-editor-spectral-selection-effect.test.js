import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

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

const { ENGLISH_COPY } = await import('../src/i18n/catalogs.js');
const { createAudioEditorController } = await import('../src/lib/tools/audio-editor/app.js');
const { createAudioEditorProjectV2 } = await import('../src/lib/tools/audio-editor/project-v2.js');
const { createProjectStore } = await import('../src/lib/tools/audio-editor/storage.js');

test('selection effects process only spectral-box bins and preserve the box after replacement', async () => {
	const sampleRate = 8_192;
	const frameCount = sampleRate;
	const sourceId = 'spectral-effect-source';
	const trackId = 'spectral-effect-track';
	const clipId = 'spectral-effect-clip';
	const input = Float32Array.from({ length: frameCount }, (_, frame) => (
		0.1 * Math.sin(2 * Math.PI * 512 * frame / sampleRate)
		+ 0.1 * Math.sin(2 * Math.PI * 2_048 * frame / sampleRate)
	));
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `spectral-selection-effect-${Date.now()}-${Math.random()}`,
	});
	const writer = await store.beginSourceWrite(sourceId, {
		name: 'spectral.wav', mimeType: 'audio/wav', sampleRate, channelCount: 1,
	});
	await writer.write([input]);
	await writer.commit({ sampleRate, channelCount: 1 });
	const project = createAudioEditorProjectV2({
		id: 'spectral-effect-project',
		title: 'Spectral effect project',
		now: '2026-07-15T00:00:00.000Z',
		sampleRate,
		sources: [{
			id: sourceId,
			name: 'spectral.wav',
			mimeType: 'audio/wav',
			storageKey: sourceId,
			frameCount,
			channelCount: 1,
			sampleRate,
			originalSampleRate: sampleRate,
			sampleFormat: 'float32',
			chunkFrames: 65_536,
		}],
		tracks: [{
			type: 'audio',
			id: trackId,
			name: 'Spectral',
			clipIds: [clipId],
			displayMode: 'spectrogram',
			spectrogram: { windowSize: 1_024 },
		}],
		clips: [{
			id: clipId,
			sourceId,
			title: 'Spectral',
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			sourceDurationFrames: frameCount,
			durationFrames: frameCount,
		}],
	});
	await store.saveProject(project);
	await store.saveSetting('last-project-id', project.id);
	let renderCalls = 0;
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: ENGLISH_COPY,
		locale: 'en',
		store,
		engine: createMemoryEngine(),
		ffmpeg: { dispose() {} },
		renderSnapshot: async (_snapshot, range) => {
			renderCalls += 1;
			const startFrame = Math.max(0, Math.round(Number(range.startFrame) || 0));
			const outputFrames = Math.max(1, Math.round(Number(range.outputFrames)
				|| Number(range.endFrame) - startFrame));
			return audioBuffer([input.slice(startFrame, startFrame + outputFrames)], sampleRate);
		},
	});

	try {
		await controller.ready;
		controller.actions.timeline.selectTrack(trackId);
		controller.actions.timeline.setSelection(0, frameCount, {
			trackIds: [trackId],
			clipIds: [],
			frequencyRange: { minimumFrequency: 450, maximumFrequency: 575 },
		});
		await controller.actions.effects.applySelection({
			type: 'audacity-amplify',
			params: { gainDb: 6.020599913, allowClipping: true },
		});

		let snapshot = controller.getSnapshot();
		assert.deepEqual(snapshot.project.selection.frequencyRange, {
			minimumFrequency: 450,
			maximumFrequency: 575,
		});
		const replacement = snapshot.project.clips.find((clip) => (
			snapshot.project.tracks.find((track) => track.id === trackId).clipIds.includes(clip.id)
		));
		assert.notEqual(replacement.sourceId, sourceId);
		const output = await storedChannel(store, replacement.sourceId, 0);
		assert.ok(Math.abs(toneAmplitude(output, 512, sampleRate, 2_000, 6_000) - 0.2) < 0.02);
		assert.ok(Math.abs(toneAmplitude(output, 2_048, sampleRate, 2_000, 6_000) - 0.1) < 0.02);

		controller.actions.edit.undo();
		snapshot = controller.getSnapshot();
		assert.equal(snapshot.project.clips.find((clip) => clip.id === clipId).sourceId, sourceId);
		await assert.rejects(controller.actions.effects.applySelection({
			type: 'audacity-repeat',
			params: { count: 2 },
		}), /cannot be limited to a frequency range/);
		assert.equal(renderCalls, 1, 'length-changing effects reject before rendering');
	} finally {
		await controller.dispose();
	}
});

function audioBuffer(channels, sampleRate) {
	return {
		numberOfChannels: channels.length,
		length: channels[0].length,
		sampleRate,
		getChannelData(channel) { return channels[channel]; },
	};
}

function createMemoryEngine() {
	return {
		positionFrame: 0,
		state: 'stopped',
		loadProject() {},
		async applyProject() {},
		getPositionFrames() { return this.positionFrame; },
		getState() { return { state: this.state, loop: { enabled: false } }; },
		stop() { this.state = 'stopped'; },
		seek(frame) { this.positionFrame = Math.max(0, Math.round(frame)); return this.positionFrame; },
		setLoop() {},
		setSourceResolver() {},
		async getAudioContext() {
			return {
				createBuffer: (channelCount, frameCount, sampleRate) => (
					new MockAudioBuffer(channelCount, frameCount, sampleRate)
				),
			};
		},
		async dispose() {},
	};
}

class MockAudioBuffer {
	constructor(numberOfChannels, length, sampleRate) {
		this.numberOfChannels = numberOfChannels;
		this.length = length;
		this.sampleRate = sampleRate;
		this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
	}

	getChannelData(channel) { return this.channels[channel]; }
	copyToChannel(values, channel, offset = 0) { this.channels[channel].set(values, offset); }
}

async function storedChannel(store, sourceId, channel) {
	const metadata = await store.getSourceMetadata(sourceId);
	const output = new Float32Array(metadata.frameCount);
	let offset = 0;
	for await (const chunk of store.readSourceChunks(sourceId)) {
		output.set(chunk.channels[channel], offset);
		offset += chunk.frames;
	}
	return output;
}

function toneAmplitude(samples, frequency, sampleRate, start, end) {
	let sine = 0;
	let cosine = 0;
	for (let frame = start; frame < end; frame += 1) {
		const angle = 2 * Math.PI * frequency * frame / sampleRate;
		sine += samples[frame] * Math.sin(angle);
		cosine += samples[frame] * Math.cos(angle);
	}
	return 2 * Math.hypot(sine, cosine) / (end - start);
}

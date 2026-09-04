/* SPDX-License-Identifier: AGPL-3.0-only */

// The headless controller harness the audio editor controller suites share: the
// FFmpeg asset loader they must register before importing the controller, the
// English copy they assert against, and the in-memory engine, render engine and
// clip cache they drive it with. Split out of audio-editor-controller.test.js so
// its suites can sit in separate files.

import { register } from 'node:module';

import { MockAudioBuffer, abortError, waitWithSignal } from './audio-editor-controller-fixtures.js';

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

export const { createAudioEditorController } = await import('../../src/common/editor/app.js');
export const {
	createAudioClip,
	createVideoClip,
} = await import('../../src/common/editor/project-media-factory.ts');
export const {
	createCurrentAudioEditorProject,
	validateCurrentAudioEditorProject,
} = await import('../../src/common/editor/project-current.ts');
export const { resolveRuntimeProjectProjection } = await import('../../src/common/editor/runtime-clip-projection.ts');
export const { createProjectStore } = await import('../../src/common/editor/storage.js');
export const { createPersistedVideoProject } = await import('./persisted-video-project-fixture.ts');
export const { availableDesktopVideoExportCapabilities } = await import('./desktop-video-export-capabilities.js');
export const { CANONICAL_VIDEO_EXPORT_PLAN_VERSION } = await import('../../src/common/editor/video-export-plan-version.ts');

export const COPY = Object.freeze({
	ready: 'Ready',
	untitledProject: 'Untitled project',
	track: 'Track',
	projectSaving: 'Saving',
	projectSaved: 'Saved',
	projectDirty: 'Unsaved',
	storage: 'Storage',
	genericError: 'Error: {message}',
	unknownError: 'Unknown error',
	timeSelectionRequired: 'Create a time selection first.',
	projectOpenOtherTab: 'This project is already open in another tab.',
	analysisRendering: 'Rendering audio for analysis',
	analysisCached: 'Loaded cached analysis.',
	contrastAnalyzing: 'Analyzing contrast range',
	contrastForegroundRole: 'foreground',
	contrastBackgroundRole: 'background',
	contrastStored: 'Stored contrast {role}.',
	zeroCrossingsAligned: 'Moved selection to zero crossings.',
	labels: 'Labels',
	labelsImporting: 'Importing labels',
	labelsImported: 'Imported {count} labels.',
	labelsExported: 'Exported {count} labels.',
	labelsImportEmpty: 'No readable labels.',
	labelTrackMissing: 'No label track.',
	labelsRequireV2: 'Labels require V2.',
	v2Required: 'This feature requires V2.',
	sampleEditSaving: 'Saving sample edit',
	sampleEditDone: 'Edited samples.',
	sampleEditCancelled: 'Sample editing cancelled.',
	sampleEditZoomRequired: 'Zoom in until individual samples are shown.',
	audioClipNotFound: 'The selected audio clip could not be found.',
	rewritingChannels: 'Rewriting channels',
	channelsSwapped: 'channels swapped',
	leftChannel: 'Left',
	rightChannel: 'Right',
	stereoTrackRequired: 'Select a stereo track first.',
	monoTrackRequired: 'Select a mono track first.',
	compatibleMonoTrackRequired: 'Two mono tracks are required.',
	effectMemoryTooLarge: 'This effect needs too much memory.',
	generatingAudio: 'Generating audio',
	toneGenerator: 'Tone',
	done: 'Done.',
});

export function runtimeClip(project, clipId) {
	return resolveRuntimeProjectProjection(project).clips.find(({ id }) => id === clipId);
}

export function audioBuffer(channels, sampleRate) {
	return {
		numberOfChannels: channels.length,
		length: channels[0].length,
		sampleRate,
		getChannelData(channel) { return channels[channel]; },
	};
}

export function createMemoryEngine() {
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

export function installSelectionPreviewFixture(controller) {
	const trackId = controller.getSnapshot().project.tracks[0].id;
	controller.actions.edit.commit({
		type: 'batch',
		commands: [{
			type: 'source/add',
			source: {
				id: 'selection-preview-source',
				name: 'preview.wav',
				storageKey: 'selection-preview-source',
				mimeType: 'audio/wav',
				frameCount: 4_800,
				channelCount: 1,
				sampleRate: 48_000,
				originalSampleRate: 48_000,
			},
		}, {
			type: 'clip/add',
			trackId,
			clip: {
				id: 'selection-preview-clip',
				sourceId: 'selection-preview-source',
				title: 'Preview',
				timelineStartFrame: 0,
				sourceStartFrame: 0,
				sourceDurationFrames: 4_800,
				durationFrames: 4_800,
			},
		}],
	});
	controller.actions.timeline.selectTrack(trackId);
	controller.actions.timeline.setSelection(0, 4_800);
}

export function createMemoryRenderEngine(options = {}) {
	return {
		sourceResolver: options.sourceResolver || null,
		project: null,
		setSourceResolver(resolver) { this.sourceResolver = resolver; return this; },
		loadProject(project) { this.project = structuredClone(project); },
		async renderMix(range = {}) {
			const length = Math.max(1, Number(range.outputFrames) || Number(range.endFrame) - Number(range.startFrame) || 48_000);
			return new MockAudioBuffer(2, length, this.project?.sampleRate || 48_000);
		},
		async dispose() {},
	};
}

export function createMemoryClipTimePitchCache() {
	const entries = new Map();
	const playback = [];
	const sourceResolver = () => null;
	const cache = {
		sourceResolver,
		resolveCalls: [],
		prepareCalls: [],
		attachedKeys: [],
		disposeCalls: 0,
		queuePlayback(value) { playback.push(value); },
		createEngineSourceResolver() { return sourceResolver; },
		retainClipIds() {},
		clear() { entries.clear(); },
		getProtectedSourceIds() { return new Set(['time-pitch-cache-protected']); },
		getCommitted(key) { return entries.get(key) || null; },
		attachAudioBuffer(key, buffer) {
			const entry = entries.get(key);
			if (entry) entry.audioBuffer = buffer;
			this.attachedKeys.push(key);
			return entry;
		},
		async loadCommittedChannels(entry) { return entry.channels; },
		async resolveForPlayback(clip, source, options = {}) {
			this.resolveCalls.push({ clip, source, signal: options.signal });
			const response = playback.shift() || { stale: false, revision: 'immediate' };
			const exact = cacheEntry(`cache-${response.revision}`, clip, source);
			entries.set(exact.cacheKey, exact);
			if (!response.stale) {
				if (response.gate) await waitWithSignal(response.gate.promise, options.signal);
				return { ...exact, stale: false, pending: Promise.resolve(exact) };
			}
			const previous = cacheEntry('cache-previous', clip, source);
			entries.set(previous.cacheKey, previous);
			const pending = waitWithSignal(response.gate.promise, options.signal).then(() => exact);
			return { ...previous, stale: true, desiredCacheKey: exact.cacheKey, pending };
		},
		async prepareCommittedOutput(clip, source, options = {}) {
			this.prepareCalls.push({ clip, source, signal: options.signal });
			if (options.signal?.aborted) throw abortError();
			const entry = cacheEntry(`cache-export-${clip.renderCacheRevision || 0}`, clip, source);
			entries.set(entry.cacheKey, entry);
			return entry;
		},
		dispose() { this.disposeCalls += 1; },
	};
	return cache;
}

export function cacheEntry(cacheKey, clip, source) {
	const frameCount = Math.max(1, Math.round((clip.sourceDurationFrames || clip.durationFrames) / (clip.speedRatio || 1)));
	return {
		cacheKey,
		cacheSourceId: `${cacheKey}-source`,
		sourceId: source.id,
		sampleRate: source.sampleRate || 48_000,
		channelCount: source.channelCount || 1,
		frameCount,
		audioBuffer: new MockAudioBuffer(source.channelCount || 1, frameCount, source.sampleRate || 48_000),
		channels: null,
	};
}

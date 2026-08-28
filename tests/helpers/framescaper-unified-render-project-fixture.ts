/* SPDX-License-Identifier: AGPL-3.0-only */

import { fingerprintNativeMediaPlan } from '../../src/common/editor/native-media-plan-canonical-form.ts';
import { normalizeNativeMediaImageSequenceSourceV25 } from '../../src/common/editor/native-media-image-sequence-v25.ts';
import { createUnreportedVideoSourceCharacteristicsV25 } from '../../src/common/editor/video-source-professional-characteristics-v25.ts';
import type { VideoFreezeFallbackV1 } from '../../src/common/editor/video-freeze-v24.ts';
import { createDefaultDissolveVideoTransitionV1 } from '../../src/common/editor/video-transition-registry.ts';
import type { VideoSourceTimingView } from '../../src/common/editor/video-source-timing-view.ts';
import type { FramescaperUnifiedExactRenderAuthority } from '../../src/framescaper/editor-project-unified-render-authority.ts';
import { FRAMESCAPER_TRANSITIONS_PROJECT_CANDIDATE_PROFILE } from '../../src/framescaper/editor-domain-runtime-profile.ts';
import { FRAMESCAPER_VISUAL_PROJECT_CANDIDATE_PROFILE } from '../../src/framescaper/editor-domain-runtime-profile.ts';
import { FRAMESCAPER_PROFESSIONAL_MEDIA_PROJECT_RUNTIME_PROFILE } from '../../src/framescaper/editor-domain-runtime-profile.ts';
import { FRAMESCAPER_OPENFX_PROJECT_CANDIDATE_PROFILE } from '../../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectTransitions, type FramescaperProjectTransitions } from '../../src/framescaper/editor-project-transitions.ts';
import { createFramescaperProjectVisual, type FramescaperProjectVisual } from '../../src/framescaper/editor-project-visual.ts';
import { createFramescaperProjectProfessionalMedia, type FramescaperProjectProfessionalMedia } from '../../src/framescaper/editor-project-professional-media.ts';
import { createFramescaperProjectOpenFx } from '../../src/framescaper/editor-project-openfx.ts';
import { framescaperV20Options } from './framescaper-model-fixture.ts';

export const UNIFIED_RENDER_SHA_A = 'aa'.repeat(32);
export const UNIFIED_RENDER_SHA_B = 'bb'.repeat(32);
export const UNIFIED_RENDER_SHA_C = 'cc'.repeat(32);
export const UNIFIED_RENDER_SHA_D = 'dd'.repeat(32);
const RATE_10 = Object.freeze({ num: 10, den: 1 });

export function transitionProject(): FramescaperProjectTransitions {
	return createFramescaperProjectTransitions(
		FRAMESCAPER_TRANSITIONS_PROJECT_CANDIDATE_PROFILE, transitionProjectOptions(),
	);
}

export function transitionProjectOptions(): Record<string, unknown> {
	const options = framescaperV20Options();
	const clips = options.clips as Record<string, unknown>[];
	clips[0]!.id = 'outgoing-clip';
	clips.push({
		kind: 'video', id: 'incoming-clip', sourceId: 'video-source', title: 'Incoming',
		sequenceId: 'main-sequence', sequenceStartFrame: 6, sequenceFrameCount: 10,
		sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
	});
	const track = (options.tracks as Record<string, unknown>[])[0]!;
	track.clipIds = ['outgoing-clip', 'incoming-clip'];
	return {
		...options,
		videoTransitionsByTrackId: {
			'video-track': [createDefaultDissolveVideoTransitionV1({
				id: 'transition', outgoingClipId: 'outgoing-clip', incomingClipId: 'incoming-clip',
				durationFrames: 4,
			})],
		},
	};
}

export function candidateTransitionProject(generation: 22 | 24 | 25 | 26): unknown {
	const options = transitionProjectOptions();
	if (generation === 22) {
		return createFramescaperProjectTransitions(FRAMESCAPER_TRANSITIONS_PROJECT_CANDIDATE_PROFILE, options);
	}
	if (generation === 24) {
		return createFramescaperProjectVisual(FRAMESCAPER_VISUAL_PROJECT_CANDIDATE_PROFILE, options);
	}
	if (generation === 25) {
		return createFramescaperProjectProfessionalMedia(FRAMESCAPER_PROFESSIONAL_MEDIA_PROJECT_RUNTIME_PROFILE, options);
	}
	return createFramescaperProjectOpenFx(FRAMESCAPER_OPENFX_PROJECT_CANDIDATE_PROFILE, {
		...options, ofxEffects: [],
	});
}

export function candidateProfile(generation: 22 | 24 | 25 | 26): unknown {
	if (generation === 22) return FRAMESCAPER_TRANSITIONS_PROJECT_CANDIDATE_PROFILE;
	if (generation === 24) return FRAMESCAPER_VISUAL_PROJECT_CANDIDATE_PROFILE;
	if (generation === 25) return FRAMESCAPER_PROFESSIONAL_MEDIA_PROJECT_RUNTIME_PROFILE;
	return FRAMESCAPER_OPENFX_PROJECT_CANDIDATE_PROFILE;
}

export function visualProject(
	freezeFallback?: VideoFreezeFallbackV1,
	repeatStill = false,
): FramescaperProjectVisual {
	return createFramescaperProjectVisual(
		FRAMESCAPER_VISUAL_PROJECT_CANDIDATE_PROFILE,
		visualProjectOptions(freezeFallback, repeatStill),
	);
}

export function visualProjectOptions(
	freezeFallback?: VideoFreezeFallbackV1,
	repeatStill = false,
): Record<string, unknown> {
	const options = framescaperV20Options();
	const still = stillSource();
	const stillClip = visualClip('still', 'still-clip', 'still-source', 10);
	const generator = generatorSource();
	const generatorClip = {
		...visualClip('generator', 'generator-clip', 'generator-source', 20),
		sourceInFrame: 0, sourceFrameCount: 10,
	};
	(options.clips as Record<string, unknown>[]).push(stillClip, generatorClip);
	((options.tracks as Record<string, unknown>[])[0]!.clipIds as string[]).push('still-clip', 'generator-clip');
	if (repeatStill) {
		(options.clips as Record<string, unknown>[]).push(
			visualClip('still', 'still-clip-upper', 'still-source', 10),
		);
		const tracks = options.tracks as Record<string, unknown>[];
		tracks.splice(1, 0, {
			...structuredClone(tracks[0]!), id: 'upper-track', name: 'Upper',
			clipIds: ['still-clip-upper'], mute: false, solo: false, hidden: false,
		});
		(options.sequences as Record<string, unknown>[])[0]!.trackIds = [
			'video-track', 'upper-track', 'audio-track',
		];
	}
	return {
		...options,
		videoTransitionsByTrackId: { 'video-track': [] },
		visualModel: {
			stillSources: [still], generatorSources: [generator],
			adjustmentLayers: [adjustment()], presets: [preset()], maskMattes: [mask()],
			freezeFallbacks: freezeFallback === undefined ? [] : [freezeFallback],
		},
	};
}

export function professionalProject(): FramescaperProjectProfessionalMedia {
	const options = framescaperV20Options();
	const source = (options.sources as Record<string, unknown>[])[0]!;
	const characteristics = createUnreportedVideoSourceCharacteristicsV25();
	source.storageKey = `image-sequence-pack-sha256:${UNIFIED_RENDER_SHA_A}`;
	source.contentSha256 = UNIFIED_RENDER_SHA_A;
	source.characteristics = characteristics;
	source.imageSequence = normalizeNativeMediaImageSequenceSourceV25({
		kind: 'video', sourceType: 'image-sequence', version: 1,
		id: 'video-source', name: 'Video', stem: 'shot_', extension: 'png',
		frameNumberWidth: 4, firstFrameNumber: 1, lastFrameNumber: 10,
		frameCount: 10, frameRate: RATE_10,
		inventory: {
			kind: 'image-sequence-inventory', version: 1,
			storageKey: `image-sequence-inventory-sha256:${UNIFIED_RENDER_SHA_B}`,
			sha256: UNIFIED_RENDER_SHA_B, byteLength: 512, frameCount: 10,
			firstFrameNumber: 1, lastFrameNumber: 10,
		},
		sourcePack: {
			kind: 'image-sequence-source-pack', storageKey: `image-sequence-pack-sha256:${UNIFIED_RENDER_SHA_A}`,
			sha256: UNIFIED_RENDER_SHA_A, byteLength: 8_192,
		},
		characteristics,
	});
	return createFramescaperProjectProfessionalMedia(FRAMESCAPER_PROFESSIONAL_MEDIA_PROJECT_RUNTIME_PROFILE, {
		...options, videoTransitionsByTrackId: { 'video-track': [] },
	});
}

export function openFxProject(inputSourceId: string) {
	return createFramescaperProjectOpenFx(FRAMESCAPER_OPENFX_PROJECT_CANDIDATE_PROFILE, {
		...framescaperV20Options(),
		videoTransitionsByTrackId: { 'video-track': [] },
		ofxEffects: [{
			schemaVersion: 1, instanceId: 'ofx-instance', pluginId: 'net.example.Filter',
			binarySha256: UNIFIED_RENDER_SHA_A, context: 'filter',
			attachment: { kind: 'filter', targetId: 'video-clip' },
			inputs: [{ name: 'Source', sourceRef: inputSourceId }],
			parameters: [], customEncodings: {}, enabled: true,
			freshness: {
				authoredStateSha256: UNIFIED_RENDER_SHA_A,
				inputIdentitiesSha256: UNIFIED_RENDER_SHA_B,
				renderPlanFingerprintSha256: UNIFIED_RENDER_SHA_C,
				nativeEffectFingerprintSha256: UNIFIED_RENDER_SHA_D,
			},
			frozenFallback: null,
		}],
	});
}

export function renderAuthority(
	project: Readonly<Record<string, unknown>>,
	frameCount: number,
): FramescaperUnifiedExactRenderAuthority {
	const timingViews = new Map<string, VideoSourceTimingView>();
	for (const source of project.sources as readonly Readonly<Record<string, unknown>>[]) {
		if (source.kind !== 'video') continue;
		timingViews.set(String(source.id), Object.freeze({
			kind: 'cfr', rate: source.frameRate as typeof RATE_10,
			frameCount: Number(source.sourceFrameCount),
		}));
	}
	return {
		sequenceId: 'main-sequence', sampleStart: 0,
		sampleDuration: frameCount * 4_800, outputRate: RATE_10,
		format: { container: 'mp4', extension: 'mp4', mimeType: 'video/mp4' },
		codecs: {
			video: 'h264', videoEncoder: 'libx264', audio: null, audioEncoder: null,
			pixelFormat: 'yuv420p',
		},
		canvas: {
			width: 1_920, height: 1_080, fit: 'contain', pixelFormat: 'yuv420p',
			backgroundColor: '#000000',
		},
		quality: 'balanced', includeAudio: false, audioLayout: null, timingViews,
	};
}

export function visualFreshness(project: FramescaperProjectVisual) {
	const sourceById = new Map(project.sources.map((source) => [String(source.id), source]));
	const states = new Map<string, unknown>();
	for (const clip of project.clips) {
		if (clip.kind !== 'still' && clip.kind !== 'generator') continue;
		states.set(String(clip.id), { source: sourceById.get(String(clip.sourceId)), clip });
	}
	for (const state of project.videoAdjustmentLayers) states.set(state.id, state);
	for (const state of project.videoVisualPresets) states.set(state.id, state);
	for (const state of project.videoMaskMattes) states.set(state.id, state);
	for (const fallback of project.videoFreezeFallbacks) {
		states.set(`video-freeze:${fallback.renderedSourceId}`, videoFreezeState(fallback.renderedSourceId));
	}
	return new Map([...states].map(([id, state]) => [id, freshness(state)]));
}

export function freshness(state: unknown) {
	return Object.freeze({
		authoredStateSha256: fingerprintNativeMediaPlan(state).sha256,
		inputIdentitiesSha256: UNIFIED_RENDER_SHA_B,
		renderPlanFingerprintSha256: UNIFIED_RENDER_SHA_C,
		nativeEffectFingerprintSha256: UNIFIED_RENDER_SHA_D,
	});
}

export function videoFreezeState(renderedSourceId: string) {
	return Object.freeze({ schemaVersion: 1 as const, kind: 'video-freeze' as const, renderedSourceId });
}

function stillSource() {
	return {
		schemaVersion: 1, kind: 'still', id: 'still-source', name: 'Plate',
		mimeType: 'image/png', storageKey: 'still-storage', contentSha256: UNIFIED_RENDER_SHA_A,
		width: 1_920, height: 1_080, hasAlpha: true,
	};
}

function generatorSource() {
	return {
		schemaVersion: 1, kind: 'generator', id: 'generator-source', name: 'Title',
		width: 1_920, height: 1_080, frameRate: RATE_10, frameCount: 100,
		generator: {
			kind: 'title', text: 'Framescaper', fontFamily: 'soundscaper-sans', fontSize: 72,
			color: '#ffffffff', horizontalAlign: 'center', verticalAlign: 'middle',
		},
	};
}

function visualClip(kind: 'still' | 'generator', id: string, sourceId: string, start: number) {
	return {
		schemaVersion: 1, kind, id, sourceId, sequenceId: 'main-sequence',
		sequenceStartFrame: start, sequenceFrameCount: 10,
	};
}

function adjustment() {
	return {
		schemaVersion: 1, kind: 'adjustment-layer', id: 'adjustment',
		sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 30,
		targetTrackIds: ['video-track'], effectIds: [],
	};
}

function preset() {
	return {
		schemaVersion: 1, kind: 'video-preset', id: 'preset', name: 'Look',
		modelKind: 'adjustment-layer', authoredStateSha256: UNIFIED_RENDER_SHA_A,
	};
}

function mask() {
	return {
		schemaVersion: 1, id: 'mask', kind: 'mask',
		inputs: [{ name: 'plate', sourceRef: 'still-source', kind: 'alpha' }],
		nodes: [{
			id: 'shape', kind: 'vector-shape', shape: 'rectangle',
			x: 0, y: 0, width: 1_920, height: 1_080,
		}],
		outputNodeId: 'shape',
	};
}

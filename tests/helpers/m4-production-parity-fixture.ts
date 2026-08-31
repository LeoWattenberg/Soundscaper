import {
	createM4ProductionParityAudioFixture,
	encodeM4ProductionParityAudio,
} from '../../src/common/editor/quality/m4-production-parity-workload.ts';
import { createVideoEffectParityFixture } from '../browser/video-effect-parity-helpers.js';

export const M4_PARITY_VIDEO_CASES = Object.freeze([
	Object.freeze({ name: 'gradient-color-adjust', fixtureArtifactId: 'gradient', effectId: 'm4-parity-color-adjust' }),
	Object.freeze({ name: 'edge-gaussian-blur', fixtureArtifactId: 'edge', effectId: 'm4-parity-gaussian-blur' }),
	Object.freeze({ name: 'transparency-vignette', fixtureArtifactId: 'transparency', effectId: 'm4-parity-vignette' }),
	Object.freeze({ name: 'color-chart-baseline', fixtureArtifactId: 'color-chart', effectId: null }),
	...[
		'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference', 'exclusion',
	].map((blendMode) => Object.freeze({
		name: `composition-blend-${blendMode}`,
		fixtureArtifactId: 'transparency',
		effectId: null,
		compositionBlendModes: Object.freeze(['normal', blendMode]),
	})),
	Object.freeze({
		name: 'composition-combined-transform-order',
		fixtureArtifactId: 'gradient',
		effectId: null,
		compositionBlendModes: Object.freeze(['normal', 'normal']),
	}),
]);

export function makeM4ProductionParityDiagnostic(omittedEffectId: string | null = null) {
	const audio = createM4ProductionParityAudioFixture();
	return {
		schemaVersion: 1,
		profile: 'deterministic-production-parity-v1',
		observationClass: 'complete-pcm-rgba-render-ledger-v1',
		workloadId: 'm4-production-render-parity',
		fixtureId: 'm4-production-parity-v1',
		environmentId: 'local-runtime-diagnostics',
		rendererClass: 'hardware',
		environmentFingerprint: {
			browserVersion: 'Chromium 149.0.7827.55',
			platform: 'linux',
			architecture: 'x64',
			osRelease: 'test-kernel',
			webglVendor: 'diagnostic-vendor',
			webglRenderer: 'diagnostic-gpu',
		},
		fixture: {
			generatorRevision: 1,
			seed: 1_294_994_497,
			sampleRate: 48_000,
			frameCount: 48_000,
			channelCount: 2,
			pdcLatencyFrames: 37,
			automationChangeFrame: 24_000,
			inputImpulseFrames: [1_024, 4_096],
			outputImpulseFrames: [1_061, 4_133],
			inputChannelSha256: [
				'626e70475d9328e0026faac70afb036004ebaa4dfe0404f0da9fba84397a9884',
				'7d2725992a5afeb23416a37f735bc4311589b89f97bb1e71c843ea0dbcad72b2',
			],
			referenceChannelSha256: [
				'8704074d600c3331096c1505a8c22e2428ba2cb3a4e0682f3f432670c5479292',
				'b7e68494b462e5ab8a3999349aacc1bb24919384b5fadb6e581a2a91c8865bf1',
			],
			videoFixtureId: 'video-effect-parity-rgba-v1',
			videoWidth: 128,
			videoHeight: 72,
		},
		audio: {
			previewBase64: toBase64(encodeM4ProductionParityAudio(audio.reference)),
			exportBase64: toBase64(encodeM4ProductionParityAudio(audio.reference)),
			referenceBase64: toBase64(encodeM4ProductionParityAudio(audio.reference)),
		},
		videoCases: M4_PARITY_VIDEO_CASES.map((definition, index) => {
			const video = createVideoEffectParityFixture(definition.fixtureArtifactId);
			const effectId = index === 0 && omittedEffectId !== null
				? omittedEffectId
				: definition.effectId;
			const rendered = effectId === null || (index === 0 && omittedEffectId !== null)
				? []
				: [effectId];
			const omitted = index === 0 && omittedEffectId !== null ? [effectId] : [];
			const compositionBlendModes = 'compositionBlendModes' in definition
				? definition.compositionBlendModes
				: null;
			const compositionClipIds = compositionBlendModes?.map((_, clipIndex) => (
				`${definition.name}-${clipIndex === 0 ? 'background' : 'foreground'}`
			)) ?? [];
			return {
				name: definition.name,
				fixtureArtifactId: definition.fixtureArtifactId,
				fixtureBase64: toBase64(video.bytes),
				width: video.width,
				height: video.height,
				previewBase64: toBase64(video.bytes),
				exportBase64: toBase64(video.bytes),
				renderReport: {
					status: omitted.length ? 'fallback' : 'rendered',
					rendererStatus: 'available',
					renderedEntryCount: compositionClipIds.length || 1,
					effects: {
						requested: effectId === null ? [] : [effectId],
						rendered,
						fallbackRendered: [] as string[],
						omitted,
					},
					...(compositionBlendModes === null ? {} : {
						composition: {
							requested: compositionClipIds.map((clipId, compositionIndex) => ({
								clipId,
								blendMode: compositionBlendModes[compositionIndex],
							})),
							rendered: compositionClipIds,
							fallbackRendered: [] as string[],
							omitted: [] as string[],
						},
					}),
				},
			};
		}),
	};
}

export function toBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('base64');
}

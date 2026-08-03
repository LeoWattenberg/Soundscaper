/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { ProjectFeatureAudioEffectBypassMetadata } from '../src/common/editor/project-feature-audio-effect-bypass.ts';
import type { ProjectFeatureAudioRenderedFallbackMetadata } from '../src/common/editor/project-feature-audio-rendered-fallback.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import type { ProjectFeatureRequirementsReport } from '../src/common/editor/project-feature-requirements.ts';
import type { ProjectFeatureVideoEffectBypassMetadata } from '../src/common/editor/project-feature-video-effect-bypass.ts';
import type { ProjectFeatureVideoRenderedFallbackMetadata } from '../src/common/editor/project-feature-video-rendered-fallback.ts';
import { ENGLISH_COPY, GERMAN_COPY } from '../src/common/i18n/catalogs.js';
import ProjectFeatureCompatibilityNotice from '../src/common/editor/ui/workspace/ProjectFeatureCompatibilityNotice.tsx';
import {
	createProjectFeatureCompatibilityNotice,
	projectFeatureAvailabilityLabel,
	projectFeatureDispositionLabel,
} from '../src/common/editor/ui/workspace/project-feature-compatibility-notice.ts';

const COPY = Object.freeze({
	scapeCompatibilityUnavailable: 'Unavailable',
	scapeCompatibilityUnknown: 'Unknown',
	scapeCompatibilityBypassed: 'Bypass declared',
	scapeCompatibilityRenderedFallback: 'Rendered fallback declared',
});

test('compatible and future-schema null reports do not produce a post-open notice', () => {
	assert.equal(createProjectFeatureCompatibilityNotice(null), null);
	assert.equal(createProjectFeatureCompatibilityNotice(undefined), null);
	assert.equal(createProjectFeatureCompatibilityNotice(report(true, [])), null);
	assert.equal(createProjectFeatureCompatibilityNotice(report(false, [
		item('native', 'org.soundscaper.capability.audio-effects', 'Audio effects', 'available', 'native'),
	])), null);
});

test('an incompatible report becomes a frozen structured notice without evaluator messages', () => {
	let excludedFieldReads = 0;
	const native = item('native', 'org.soundscaper.capability.audio-effects', 'Audio effects', 'available', 'native');
	const bypassed = item('bypassed', 'org.soundscaper.capability.video-effects', 'Video effects', 'unavailable', 'bypassed');
	const rendered = item('rendered', 'org.example.native.spectral-repair', 'Spectral repair', 'unknown', 'rendered-fallback');
	for (const candidate of [native, bypassed, rendered]) {
		Object.defineProperty(candidate, 'message', {
			enumerable: true,
			get() { excludedFieldReads += 1; return 'Provider-authored evaluator text'; },
		});
		Object.defineProperty(candidate, 'fallback', {
			enumerable: true,
			get() { excludedFieldReads += 1; return { sourceId: 'secret-source', sha256: '0'.repeat(64) }; },
		});
	}

	const notice = createProjectFeatureCompatibilityNotice(report(false, [native, bypassed, rendered]));

	assert.ok(notice);
	assert.deepEqual(notice.counts, { unavailable: 1, unknown: 1 });
	assert.deepEqual(notice.items, [{
		requirementId: 'bypassed',
		featureId: 'org.soundscaper.capability.video-effects',
		displayName: 'Video effects',
		availability: 'unavailable',
		declaredDisposition: 'bypass',
		effectiveDisposition: 'bypassed',
	}, {
		requirementId: 'rendered',
		featureId: 'org.example.native.spectral-repair',
		displayName: 'Spectral repair',
		availability: 'unknown',
		declaredDisposition: 'rendered-fallback',
		effectiveDisposition: 'rendered-fallback',
	}]);
	assert.equal(excludedFieldReads, 0);
	assert.equal(Object.isFrozen(notice), true);
	assert.equal(Object.isFrozen(notice.counts), true);
	assert.equal(Object.isFrozen(notice.items), true);
	assert.equal(Object.isFrozen(notice.items[0]), true);
	assert.equal(projectFeatureAvailabilityLabel(notice.items[0], COPY), 'Unavailable');
	assert.equal(projectFeatureAvailabilityLabel(notice.items[1], COPY), 'Unknown');
	assert.equal(projectFeatureDispositionLabel(notice.items[0], COPY), 'Bypass declared');
	assert.equal(projectFeatureDispositionLabel(notice.items[1], COPY), 'Rendered fallback declared');
});

test('the post-open region stays structured, localized, and free of activation controls', () => {
	const incompatible = report(false, [
		item('bypassed', 'org.soundscaper.capability.video-effects', 'Video effects', 'unavailable', 'bypassed'),
		item('rendered', 'org.example.native.spectral-repair', 'Spectral repair', 'unknown', 'rendered-fallback'),
	]);
	const english = renderToStaticMarkup(React.createElement(ProjectFeatureCompatibilityNotice, {
		report: incompatible,
		copy: ENGLISH_COPY,
	}));
	const german = renderToStaticMarkup(React.createElement(ProjectFeatureCompatibilityNotice, {
		report: incompatible,
		copy: GERMAN_COPY,
	}));

	assert.match(english, /<aside[^>]*data-project-feature-compatibility/iu);
	assert.match(english, /<aside[^>]*tabindex="0"/iu);
	assert.match(english, /role="status"[^>]*aria-atomic="true"/iu);
	assert.match(english, /Video effects.*org\.soundscaper\.capability\.video-effects/isu);
	assert.match(english, /data-declared-disposition="bypass"/u);
	assert.match(english, /data-effective-disposition="bypassed"/u);
	assert.match(english, /Spectral repair.*Rendered fallback declared/isu);
	assert.doesNotMatch(english, /button|Install|Enable|Use fallback|secret-source|Provider-authored/iu);
	assert.match(german, /Projektfunktionen nicht verfügbar/u);
	assert.match(german, /Dieses Projekt ist schreibgeschützt/u);
});

test('audio-effect playback bypass renders localized affected-object placeholders without reading payloads', () => {
	let payloadReads = 0;
	const guardedEffect = (id: string, type: string) => {
		const effect: Record<string, unknown> = { id, type, enabled: true };
		for (const property of ['params', 'context', 'state', 'opaqueAudacityNode']) {
			Object.defineProperty(effect, property, {
				enumerable: true,
				get(): never {
					payloadReads += 1;
					throw new Error(`${property} payload was read`);
				},
			});
		}
		return effect;
	};
	const project = {
		tracks: [{
			id: 'track-a',
			type: 'audio',
			name: 'Dialogue',
			effects: [guardedEffect('track-effect', 'compressor')],
		}],
		mixer: {
			groups: [{
				id: 'group-a',
				name: 'Mix Group',
				effects: [guardedEffect('group-effect', 'eq')],
			}],
			sends: [{
				id: 'send-a',
				name: 'Reverb Send',
				effects: [guardedEffect('send-effect', 'reverb')],
			}],
		},
		master: { effects: [guardedEffect('master-effect', 'limiter')] },
	};
	const audioEffectPlaybackBypass = {
		schemaVersion: 1,
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
		requirementIds: ['audio-effects'],
		placeholders: [{
			scope: 'track', ownerId: 'track-a', effectId: 'track-effect', effectType: 'compressor',
		}, {
			scope: 'group', ownerId: 'group-a', effectId: 'group-effect', effectType: 'eq',
		}, {
			scope: 'send', ownerId: 'send-a', effectId: 'send-effect', effectType: 'reverb',
		}, {
			scope: 'master', ownerId: null, effectId: 'master-effect', effectType: 'limiter',
		}],
	} satisfies ProjectFeatureAudioEffectBypassMetadata;
	const incompatible = report(false, [
		item(
			'audio-effects',
			PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
			'Audio effects',
			'unavailable',
			'bypassed',
		),
	]);
	const english = renderToStaticMarkup(React.createElement(ProjectFeatureCompatibilityNotice, {
		report: incompatible,
		copy: ENGLISH_COPY,
		project,
		audioEffectPlaybackBypass,
	}));
	const german = renderToStaticMarkup(React.createElement(ProjectFeatureCompatibilityNotice, {
		report: incompatible,
		copy: GERMAN_COPY,
		project,
		audioEffectPlaybackBypass,
	}));

	assert.equal(payloadReads, 0);
	assert.match(english, /data-project-feature-audio-effect-placeholders/iu);
	assert.match(english, /<h4[^>]*>Affected audio effects<\/h4>/iu);
	assertPlaceholderAttributes(english, 'track-effect', 'track', 'track-a', 'compressor');
	assertPlaceholderAttributes(english, 'group-effect', 'group', 'group-a', 'eq');
	assertPlaceholderAttributes(english, 'send-effect', 'send', 'send-a', 'reverb');
	assertPlaceholderAttributes(english, 'master-effect', 'master', '', 'limiter');
	assert.match(placeholderMarkup(english, 'track-effect'), /Compressor.*Track.*Dialogue.*Bypassed during editor playback/isu);
	assert.match(placeholderMarkup(english, 'group-effect'), /Four-band parametric EQ.*Group bus.*Mix Group.*Bypassed during editor playback/isu);
	assert.match(placeholderMarkup(english, 'send-effect'), /Reverb.*Send bus.*Reverb Send.*Bypassed during editor playback/isu);
	assert.match(placeholderMarkup(english, 'master-effect'), /Limiter.*Master.*Bypassed during editor playback/isu);
	assert.doesNotMatch(english, /<button|<input|<select|<a\b/iu);
	assert.match(german, /Betroffene Audioeffekte/iu);
	assert.match(placeholderMarkup(german, 'track-effect'), /Kompressor.*Spur.*Dialogue.*Bei der Wiedergabe im Editor umgangen/isu);
	assert.match(placeholderMarkup(german, 'group-effect'), /Parametrischer 4-Band-EQ.*Gruppenbus.*Mix Group/isu);
	assert.match(placeholderMarkup(german, 'send-effect'), /Hall.*Send-Bus.*Reverb Send/isu);
});

test('audio-effect placeholders require qualifying playback-bypass metadata and disposition', () => {
	const project = {
		tracks: [{ id: 'track-a', type: 'audio', name: 'Dialogue' }],
		mixer: { groups: [], sends: [] },
		master: {},
	};
	const metadata = {
		schemaVersion: 1,
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
		requirementIds: ['audio-effects'],
		placeholders: [{
			scope: 'track', ownerId: 'track-a', effectId: 'track-effect', effectType: 'compressor',
		}],
	} satisfies ProjectFeatureAudioEffectBypassMetadata;
	const bypassed = report(false, [
		item(
			'audio-effects',
			PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
			'Audio effects',
			'unavailable',
			'bypassed',
		),
	]);
	const renderedFallback = report(false, [
		item(
			'audio-effects',
			PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
			'Audio effects',
			'unavailable',
			'rendered-fallback',
		),
	]);
	const withoutMetadata = renderToStaticMarkup(React.createElement(ProjectFeatureCompatibilityNotice, {
		report: bypassed,
		copy: ENGLISH_COPY,
		project,
		audioEffectPlaybackBypass: null,
	}));
	const withRenderedFallback = renderToStaticMarkup(React.createElement(ProjectFeatureCompatibilityNotice, {
		report: renderedFallback,
		copy: ENGLISH_COPY,
		project,
		audioEffectPlaybackBypass: metadata,
	}));
	const duplicateRequirements = renderToStaticMarkup(React.createElement(ProjectFeatureCompatibilityNotice, {
		report: report(false, [
			item('audio-effects', PROJECT_FEATURE_CAPABILITY_IDS.audioEffects, 'Audio effects', 'unavailable', 'bypassed'),
			item('audio-effects-copy', PROJECT_FEATURE_CAPABILITY_IDS.audioEffects, 'Audio effects copy', 'unavailable', 'bypassed'),
		]),
		copy: ENGLISH_COPY,
		project,
		audioEffectPlaybackBypass: { ...metadata, requirementIds: ['audio-effects', 'audio-effects-copy'] },
	}));

	assert.doesNotMatch(withoutMetadata, /data-audio-effect-placeholder/iu);
	assert.doesNotMatch(withRenderedFallback, /data-audio-effect-placeholder/iu);
	assert.equal(duplicateRequirements.match(/data-audio-effect-placeholder=/gu)?.length, 1);
});

test('audio rendered fallback activation is localized and bound to its exact requirement', () => {
	let internalReads = 0;
	const metadata = {
		schemaVersion: 1,
		role: 'project-audio-mix-v1',
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioSpectralEditing,
		requirementId: 'audio-spectral-editing',
		get sourceId() { internalReads += 1; return 'rendered-source'; },
		get trackId() { internalReads += 1; return 'soundscaper:rendered-audio-fallback:track' as const; },
		get clipId() { internalReads += 1; return 'soundscaper:rendered-audio-fallback:clip' as const; },
	} satisfies ProjectFeatureAudioRenderedFallbackMetadata;
	const incompatible = report(false, [
		item(
			'audio-spectral-editing',
			PROJECT_FEATURE_CAPABILITY_IDS.audioSpectralEditing,
			'Audio spectral editing',
			'unavailable',
			'rendered-fallback',
		),
		item('other', 'org.example.other', 'Other', 'unknown', 'rendered-fallback'),
	]);
	const english = renderToStaticMarkup(React.createElement(ProjectFeatureCompatibilityNotice, {
		report: incompatible,
		copy: ENGLISH_COPY,
		audioRenderedFallback: metadata,
	}));
	const german = renderToStaticMarkup(React.createElement(ProjectFeatureCompatibilityNotice, {
		report: incompatible,
		copy: GERMAN_COPY,
		audioRenderedFallback: metadata,
	}));
	assert.equal(internalReads, 0);
	const mismatched = renderToStaticMarkup(React.createElement(ProjectFeatureCompatibilityNotice, {
		report: incompatible,
		copy: ENGLISH_COPY,
		audioRenderedFallback: { ...metadata, requirementId: 'missing' },
	}));
	const malformed = [
		{ report: incompatible, metadata: { ...metadata, schemaVersion: 2 } },
		{ report: incompatible, metadata: { ...metadata, featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects } },
		{ report: incompatible, metadata: { ...metadata, featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioAnalysis } },
		{ report: report(false, [{
			...item('audio-spectral-editing', PROJECT_FEATURE_CAPABILITY_IDS.audioSpectralEditing, 'Audio spectral editing', 'unavailable', 'rendered-fallback'),
			declaredDisposition: 'bypass',
		}]), metadata },
		{ report: report(false, [item('audio-spectral-editing', PROJECT_FEATURE_CAPABILITY_IDS.audioSpectralEditing, 'Audio spectral editing', 'unavailable', 'bypassed')]), metadata },
	].map((candidate) => renderToStaticMarkup(React.createElement(ProjectFeatureCompatibilityNotice, {
		report: candidate.report,
		copy: ENGLISH_COPY,
		audioRenderedFallback: candidate.metadata as never,
	})));

	assert.equal(english.match(/data-project-feature-audio-rendered-fallback/gu)?.length, 1);
	assert.match(english, /Rendered fallback active during editor playback/u);
	assert.match(german, /Gerenderte Ersatzwiedergabe im Editor aktiv/u);
	assert.doesNotMatch(english, /rendered-source|soundscaper:rendered-audio-fallback/iu);
	assert.doesNotMatch(mismatched, /data-project-feature-audio-rendered-fallback/iu);
	for (const markup of malformed) assert.doesNotMatch(markup, /data-project-feature-audio-rendered-fallback/iu);
});

test('an unknown closed whole-mix role receives the active playback indicator', () => {
	const featureId = 'org.example.future-mixer';
	const requirementId = 'future-mixer';
	const markup = renderToStaticMarkup(React.createElement(ProjectFeatureCompatibilityNotice, {
		report: report(false, [item(
			requirementId,
			featureId,
			'Future mixer',
			'unknown',
			'rendered-fallback',
		)]),
		copy: ENGLISH_COPY,
		audioRenderedFallback: {
			schemaVersion: 1,
			role: 'project-audio-mix-v1',
			featureId,
			requirementId,
			sourceId: 'rendered-source',
			trackId: 'soundscaper:rendered-audio-fallback:track',
			clipId: 'soundscaper:rendered-audio-fallback:clip',
		},
	}));

	assert.equal(markup.match(/data-project-feature-audio-rendered-fallback/gu)?.length, 1);
	assert.match(markup, /Unknown.*Rendered fallback declared.*Rendered fallback active during editor playback/isu);
	assert.doesNotMatch(markup, /rendered-source|soundscaper:rendered-audio-fallback/iu);
});

test('video rendered fallback activation is localized and bound to its exact requirement', () => {
	const metadata = {
		schemaVersion: 1,
		role: 'project-video-render-v1',
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoCompositing,
		requirementId: 'video-compositing',
		sourceId: 'rendered-video',
		trackId: 'framescaper:rendered-video-fallback:track',
		clipId: 'framescaper:rendered-video-fallback:clip',
	} satisfies ProjectFeatureVideoRenderedFallbackMetadata;
	const incompatible = report(false, [
		item('video-compositing', PROJECT_FEATURE_CAPABILITY_IDS.videoCompositing, 'Video compositing', 'unavailable', 'rendered-fallback'),
		item('other', 'org.example.other', 'Other', 'unknown', 'rendered-fallback'),
	]);
	const english = renderToStaticMarkup(React.createElement(ProjectFeatureCompatibilityNotice, {
		report: incompatible,
		copy: ENGLISH_COPY,
		videoRenderedFallback: metadata,
	}));
	const mismatched = renderToStaticMarkup(React.createElement(ProjectFeatureCompatibilityNotice, {
		report: incompatible,
		copy: ENGLISH_COPY,
		videoRenderedFallback: { ...metadata, requirementId: 'missing' },
	}));
	const malformed = [
		{ ...metadata, schemaVersion: 2 },
		{ ...metadata, featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects },
		{ ...metadata, featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects },
	].map((candidate) => renderToStaticMarkup(React.createElement(ProjectFeatureCompatibilityNotice, {
		report: incompatible,
		copy: ENGLISH_COPY,
		videoRenderedFallback: candidate as never,
	})));

	assert.equal(english.match(/data-project-feature-video-rendered-fallback/gu)?.length, 1);
	assert.match(english, /Rendered fallback active during editor playback/u);
	assert.doesNotMatch(english, /rendered-video|framescaper:rendered-video-fallback/iu);
	assert.doesNotMatch(mismatched, /data-project-feature-video-rendered-fallback/iu);
	for (const markup of malformed) assert.doesNotMatch(markup, /data-project-feature-video-rendered-fallback/iu);
});

test('video-effect playback bypass renders localized timeline and Project Bin placeholders', () => {
	let payloadReads = 0;
	const guardedClip = (id: string, title: string) => {
		const clip: Record<string, unknown> & { id: string; kind: string; title: string } = {
			id, kind: 'video', title,
		};
		Object.defineProperty(clip, 'videoEffects', {
			enumerable: true,
			get(): never {
				payloadReads += 1;
				throw new Error('videoEffects payload was read');
			},
		});
		return clip;
	};
	const project = {
		clips: [guardedClip('timeline-clip', 'Opening shot')],
		projectBin: { clips: [guardedClip('bin-clip', 'Library shot')] },
	};
	const videoEffectPlaybackBypass = {
		schemaVersion: 1,
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
		requirementIds: ['video-effects'],
		placeholders: [{
			location: 'timeline', clipId: 'timeline-clip', effectId: 'pixelate-effect', effectType: 'pixelate',
		}, {
			location: 'project-bin', clipId: 'bin-clip', effectId: 'vignette-effect', effectType: 'vignette',
		}],
	} satisfies ProjectFeatureVideoEffectBypassMetadata;
	const incompatible = report(false, [item(
		'video-effects',
		PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
		'Video effects',
		'unavailable',
		'bypassed',
	)]);
	const english = renderToStaticMarkup(React.createElement(ProjectFeatureCompatibilityNotice, {
		report: incompatible,
		copy: ENGLISH_COPY,
		project,
		videoEffectPlaybackBypass,
	}));
	const german = renderToStaticMarkup(React.createElement(ProjectFeatureCompatibilityNotice, {
		report: incompatible,
		copy: GERMAN_COPY,
		project,
		videoEffectPlaybackBypass,
	}));

	assert.equal(payloadReads, 0);
	assert.match(english, /data-project-feature-video-effect-placeholders/iu);
	assert.match(english, /<h4[^>]*>Affected video effects<\/h4>/iu);
	assertVideoPlaceholderAttributes(english, 'pixelate-effect', 'timeline', 'timeline-clip', 'pixelate');
	assertVideoPlaceholderAttributes(english, 'vignette-effect', 'project-bin', 'bin-clip', 'vignette');
	assert.match(videoPlaceholderMarkup(english, 'pixelate-effect'), /Pixelate.*Timeline.*Opening shot.*Bypassed during editor playback/isu);
	assert.match(videoPlaceholderMarkup(english, 'vignette-effect'), /Vignette.*Project bin.*Library shot.*Bypassed during editor playback/isu);
	assert.doesNotMatch(english, /<button|<input|<select|<textarea|<a\b/iu);
	assert.match(german, /Betroffene Videoeffekte/iu);
	assert.match(videoPlaceholderMarkup(german, 'pixelate-effect'), /Verpixeln.*Timeline.*Opening shot.*Bei der Wiedergabe im Editor umgangen/isu);
});

test('video-effect placeholders require exact qualifying metadata and render once for duplicate requirements', () => {
	const project = { clips: [{ id: 'clip', kind: 'video', title: 'Clip' }] };
	const metadata = {
		schemaVersion: 1,
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
		requirementIds: ['video-effects', 'video-effects-copy'],
		placeholders: [{
			location: 'timeline', clipId: 'clip', effectId: 'effect', effectType: 'pixelate',
		}],
	} satisfies ProjectFeatureVideoEffectBypassMetadata;
	const duplicateRequirements = renderToStaticMarkup(React.createElement(ProjectFeatureCompatibilityNotice, {
		report: report(false, [
			item('video-effects', PROJECT_FEATURE_CAPABILITY_IDS.videoEffects, 'Video effects', 'unavailable', 'bypassed'),
			item('video-effects-copy', PROJECT_FEATURE_CAPABILITY_IDS.videoEffects, 'Video effects copy', 'unavailable', 'bypassed'),
		]),
		copy: ENGLISH_COPY,
		project,
		videoEffectPlaybackBypass: metadata,
	}));
	const wrongFeature = renderToStaticMarkup(React.createElement(ProjectFeatureCompatibilityNotice, {
		report: report(false, [
			item('video-effects', PROJECT_FEATURE_CAPABILITY_IDS.videoEffects, 'Video effects', 'unavailable', 'bypassed'),
		]),
		copy: ENGLISH_COPY,
		project,
		videoEffectPlaybackBypass: { ...metadata, featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioEffects } as never,
	}));

	assert.equal(duplicateRequirements.match(/data-video-effect-placeholder=/gu)?.length, 1);
	assert.doesNotMatch(wrongFeature, /data-video-effect-placeholder/iu);
});

function assertPlaceholderAttributes(
	markup: string,
	effectId: string,
	scope: string,
	ownerId: string,
	effectType: string,
): void {
	const row = markup.match(new RegExp(
		`<[^>]+(?=[^>]*data-audio-effect-placeholder="${effectId}")(?=[^>]*data-scope="${scope}")(?=[^>]*data-owner-id="${ownerId}")(?=[^>]*data-effect-type="${effectType}")(?=[^>]*data-effective-disposition="bypassed")[^>]*>`,
		'iu',
	));
	assert.ok(row, `Missing stable placeholder attributes for ${effectId}.`);
}

function placeholderMarkup(markup: string, effectId: string): string {
	const row = markup.match(new RegExp(
		`<li(?=[^>]*data-audio-effect-placeholder="${effectId}")[^>]*>[\\s\\S]*?<\\/li>`,
		'iu',
	));
	assert.ok(row, `Missing placeholder row for ${effectId}.`);
	return row[0];
}

function assertVideoPlaceholderAttributes(
	markup: string,
	effectId: string,
	location: string,
	clipId: string,
	effectType: string,
): void {
	const row = markup.match(new RegExp(
		`<[^>]+(?=[^>]*data-video-effect-placeholder="${effectId}")(?=[^>]*data-location="${location}")(?=[^>]*data-clip-id="${clipId}")(?=[^>]*data-effect-type="${effectType}")(?=[^>]*data-effective-disposition="bypassed")[^>]*>`,
		'iu',
	));
	assert.ok(row, `Missing stable video placeholder attributes for ${effectId}.`);
}

function videoPlaceholderMarkup(markup: string, effectId: string): string {
	const row = markup.match(new RegExp(
		`<li(?=[^>]*data-video-effect-placeholder="${effectId}")[^>]*>[\\s\\S]*?<\\/li>`,
		'iu',
	));
	assert.ok(row, `Missing video placeholder row for ${effectId}.`);
	return row[0];
}

function report(
	compatible: boolean,
	items: readonly Record<string, unknown>[],
): ProjectFeatureRequirementsReport {
	return {
		schemaVersion: 1,
		format: 'soundscaper-project',
		compatible,
		counts: { available: 0, unavailable: 0, unknown: 0 },
		items,
	} as unknown as ProjectFeatureRequirementsReport;
}

function item(
	requirementId: string,
	featureId: string,
	displayName: string,
	availability: string,
	disposition: string,
): Record<string, unknown> {
	return {
		requirementId,
		featureId,
		displayName,
		availability,
		declaredDisposition: disposition === 'rendered-fallback' ? 'rendered-fallback' : 'bypass',
		disposition,
	};
}

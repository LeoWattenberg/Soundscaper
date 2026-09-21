import test from 'node:test';
import assert from 'node:assert/strict';

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import {
	isProjectFeatureRenderedFallbackQualified,
	type ProjectFeatureRenderedFallbackQualificationPolicy,
} from '../src/common/editor/project-feature-rendered-fallback-qualification.ts';

const audioPolicies = Object.freeze([
	'audio-playback', 'audio-export', 'audio-ui',
] satisfies readonly ProjectFeatureRenderedFallbackQualificationPolicy[]);
const videoPolicies = Object.freeze([
	'video-playback', 'video-export', 'video-ui',
] satisfies readonly ProjectFeatureRenderedFallbackQualificationPolicy[]);

function qualified(
	policy: ProjectFeatureRenderedFallbackQualificationPolicy,
	role: string,
	featureId: string,
	availability: string = 'unavailable',
	declaredDisposition: string = 'rendered-fallback',
	effectiveDisposition: string = 'rendered-fallback',
): boolean {
	return isProjectFeatureRenderedFallbackQualified({
		role, featureId, availability, declaredDisposition, effectiveDisposition,
	}, policy);
}

test('whole-project rendered fallbacks admit unavailable and unknown requirements', () => {
	for (const policy of audioPolicies) {
		assert.equal(qualified(policy, 'project-audio-mix-v1', 'org.example.future'), true);
		assert.equal(qualified(policy, 'project-audio-mix-v1', 'org.example.future', 'unknown'), true);
		assert.equal(qualified(policy, 'project-audio-mix-v1', 'org.example.future', 'available'), false);
	}
	for (const policy of videoPolicies) {
		assert.equal(qualified(policy, 'project-video-render-v1', 'org.example.future'), true);
		assert.equal(qualified(policy, 'project-video-render-v1', 'org.example.future', 'unknown'), true);
		assert.equal(qualified(policy, 'project-video-render-v1', 'org.example.future', 'available'), false);
	}
	assert.equal(qualified('video-playback', 'project-audio-mix-v1', 'org.example.future'), false);
	assert.equal(qualified('audio-playback', 'project-video-render-v1', 'org.example.future'), false);
});

test('audio relationship policy distinguishes playback/UI from export', () => {
	for (const featureId of [
		PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
		PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze,
	]) {
		assert.equal(qualified('audio-playback', 'audio-track-render-v1', featureId), true);
		assert.equal(qualified('audio-ui', 'audio-track-render-v1', featureId), true);
	}
	assert.equal(qualified(
		'audio-export', 'audio-track-render-v1', PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
	), true);
	assert.equal(qualified(
		'audio-export', 'audio-track-render-v1', PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze,
	), false);
	assert.equal(qualified(
		'audio-playback', 'audio-track-render-v1', PROJECT_FEATURE_CAPABILITY_IDS.audioEffects, 'unknown',
	), false);
	assert.equal(qualified('audio-playback', 'audio-track-render-v1', 'org.example.future'), false);
});

test('video relationships admit only unavailable video effects', () => {
	for (const policy of videoPolicies) {
		assert.equal(qualified(
			policy, 'video-clip-render-v1', PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
		), true);
		assert.equal(qualified(
			policy, 'video-clip-render-v1', PROJECT_FEATURE_CAPABILITY_IDS.videoEffects, 'unknown',
		), false);
		assert.equal(qualified(policy, 'video-clip-render-v1', 'org.example.future'), false);
	}
});

test('rendered fallback qualification requires both declared and effective dispositions', () => {
	assert.equal(qualified(
		'audio-playback', 'project-audio-mix-v1', 'org.example.future',
		'unavailable', 'bypass', 'rendered-fallback',
	), false);
	assert.equal(qualified(
		'audio-playback', 'project-audio-mix-v1', 'org.example.future',
		'unavailable', 'rendered-fallback', 'bypassed',
	), false);
	assert.equal(qualified('audio-playback', 'future-role', 'org.example.future'), false);
});

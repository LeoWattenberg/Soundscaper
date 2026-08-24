/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	EXTERNAL_FFMPEG_CLI_COMPATIBILITY_LAB,
	assertExternalFfmpegCliDecodedSilence,
	normalizeExternalFfmpegCliCompatibilityLab,
} from '../scripts/lib/external-ffmpeg-cli-compatibility-lab.mjs';

test('the external FFmpeg CLI witness is digest-pinned and scoped to six Linux x64 releases', () => {
	const evidence = EXTERNAL_FFMPEG_CLI_COMPATIBILITY_LAB;
	assert.equal(evidence.scope.hostTarget, 'linux-x64');
	assert.equal(evidence.scope.containerPlatform, 'linux/amd64');
	assert.equal(evidence.architecture.audacityCommit,
		'c016d6e1f8f018a39f7c5c1ee56a961fec4055c2');
	assert.match(evidence.architecture.audacityReference,
		/^https:\/\/github\.com\/audacity\/audacity\/commit\/c016d6e1/u);
	assert.match(evidence.architecture.audacityApproach, /ABI-major wrappers/iu);
	assert.match(evidence.architecture.soundscaperApproach, /out of process.*released CLI/iu);
	assert.deepEqual(evidence.releases.map(({ release }) => release), [
		'4.4.0', '5.1.0', '6.1.0', '7.1.0', '8.0.0', '9.0.0',
	]);
	assert.deepEqual(evidence.formats.map(({ id }) => id), [
		'flac', 'mp3', 'ogg-vorbis', 'opus', 'wavpack', 'mp2', 'aac-m4a',
	]);
	assert.deepEqual(evidence.formats[0]?.encodeSettings, {
		bitDepth: 24, compressionLevel: 5,
	});
	for (const row of evidence.releases) {
		assert.match(row.image, /^docker\.io\/mwader\/static-ffmpeg@sha256:[0-9a-f]{64}$/u);
		assert.equal(row.probeResult, 'passed');
		assert.equal(row.boundedExecutionResult, 'passed');
		assert.deepEqual(row.observations.map(({ format }) => format),
			evidence.formats.map(({ id }) => id));
	}
	const profiles = new Map(evidence.observationProfiles.map((profile) => [profile.id, profile]));
	assert.equal(evidence.releases.every((row) => (
		profiles.get(row.observations[2].profile).sampleCountPreserved === false
	)), true, 'every Vorbis witness must retain its explicit non-preserving result');
	assert.match(evidence.limitations.join(' '), /Linux x64 CLI compatibility evidence only/u);
	assert.match(evidence.limitations.join(' '), /does not qualify.*Homebrew.*winget/iu);
	assert.match(evidence.limitations.join(' '), /not sample-count-preserving.*Vorbis/iu);
	assert.match(evidence.limitations.join(' '), /patent status/iu);
});

test('the witness rejects scope expansion, mutable images, stale source pins, and partial results', () => {
	const evidence = EXTERNAL_FFMPEG_CLI_COMPATIBILITY_LAB;
	for (const mutation of [
		{ ...evidence, scope: { ...evidence.scope, hostTarget: 'mac-x64' } },
		{ ...evidence, implementation: { ...evidence.implementation, planSha256: '0'.repeat(64) } },
		{ ...evidence, implementation: { ...evidence.implementation, runnerSha256: '0'.repeat(64) } },
		{ ...evidence, releases: evidence.releases.map((row, index) => index === 0
			? { ...row, image: 'docker.io/mwader/static-ffmpeg:4.4' } : row) },
		{ ...evidence, observationProfiles: evidence.observationProfiles.map((profile, index) => index === 0
			? { ...profile, decodedByteLength: profile.decodedByteLength - 8 } : profile) },
		{ ...evidence, releases: evidence.releases.map((row, index) => index === 0
			? { ...row, observations: row.observations.map((observation, observationIndex) => (
				observationIndex === 0 ? { ...observation, profile: 'missing-profile' } : observation
			)) } : row) },
		{ ...evidence, releases: evidence.releases.map((row, index) => index === 5
			? { ...row, boundedExecutionResult: 'pending' } : row) },
	]) assert.throws(() => normalizeExternalFfmpegCliCompatibilityLab(mutation), /evidence|scope|digest|result/iu);
});

test('the lab rejects truncated, non-finite, and non-silent decoded witnesses', () => {
	const expected = new Uint8Array(16);
	assert.doesNotThrow(() => assertExternalFfmpegCliDecodedSilence(expected, expected));
	assert.throws(
		() => assertExternalFfmpegCliDecodedSilence(expected.subarray(0, 8), expected),
		/exact PCM byte length/iu,
	);
	const nonSilent = new Uint8Array(new Float32Array([0, 0.25, 0, 0]).buffer);
	assert.throws(() => assertExternalFfmpegCliDecodedSilence(nonSilent, expected), /silent finite PCM/iu);
	const nonFinite = new Uint8Array(new Float32Array([0, Number.NaN, 0, 0]).buffer);
	assert.throws(() => assertExternalFfmpegCliDecodedSilence(nonFinite, expected), /silent finite PCM/iu);
});

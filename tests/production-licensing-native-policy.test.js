/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-licensing-matrix.json', import.meta.url);
const noticesUrl = new URL('../THIRD_PARTY_LICENSES.md', import.meta.url);
const repositoryUrl = new URL('../', import.meta.url);

const FUTURE_GATE_IDS = [
	'local-models',
	'native-audio',
	'native-codecs',
	'native-plugins',
	'web-effect-packages',
];

/**
 * What the licensing matrix says about the surfaces npm cannot see.
 *
 * `tests/production-licensing-matrix.test.js` holds the npm half: that the matrix covers
 * the package-lock runtime closure exactly, and tracks the shipped Electron beside it.
 * These are the rest — the gates for surfaces not yet shipped, the reviewed browser codec
 * notices, and the native policy rows whose distribution requirements are separate from
 * what a test may activate.
 */

test('only the evidenced local-model surface is enabled among future distribution gates', async () => {
	const matrix = await readJson(matrixUrl);
	const gates = new Map(matrix.futureDistributionGates.map((gate) => [gate.id, gate]));

	assert.deepEqual(matrix.futureDistributionGates.map(({ id }) => id).sort(), FUTURE_GATE_IDS);
	// Each enabled gate is named here, never matched by a pattern, so a gate
	// cannot become enabled by resembling one whose review was actually done.
	const REVIEWED_GATES = ['local-models', 'native-audio', 'native-plugins'];
	for (const gate of matrix.futureDistributionGates) {
		assert.equal(gate.status, REVIEWED_GATES.includes(gate.id) ? 'enabled' : 'disabled', gate.id);
		assert.ok(gate.enableRequires.length >= 3, `${gate.id} needs concrete enablement requirements`);
		if (gate.status === 'enabled') {
			assert.equal(gate.blocker, undefined, `${gate.id} is enabled and cannot still name a blocker`);
		}
		await assertEvidence(gate.evidence);
	}
	assert.equal(gates.get('web-effect-packages').scope, 'externally-authored-or-non-repository-owned-packages');
	assert.match(gates.get('web-effect-packages').blocker, /Utility Gain.*repository-owned.*does not admit/iu);
	assert.equal(gates.get('native-codecs').scope,
		'additional-bundled-video-codec-execution');
	assert.match(gates.get('native-codecs').blocker,
		/Seven exact reviewed compressed-audio WebAssembly providers.*isolated.*utility process.*libsndfile is not bundled.*Media Foundation.*AudioToolbox.*target-native.*macOS ARM64.*Windows x64.*Windows ARM64.*ad-hoc.*manifest.*payload.*Linux.*no uniform OS tier.*external.*keyed-RGBA.*H\.264\/AAC MP4.*VP9\/Opus WebM.*no libwebm.*dav1d.*SVT-AV1.*libaom.*bundled and operating-system WebM\/AV1 execution fails closed.*Electron.*rather than a provider tier.*user-installed external FFmpeg.*outside/iu);
	for (const path of [
		'src/common/editor/reviewed-effects/catalog.ts',
		'src/common/editor/reviewed-effects/utility-gain-package.ts',
		'tests/audio-editor-reviewed-effects.test.ts',
	]) assert.ok(gates.get('web-effect-packages').evidence.includes(path));
});

test('reviewed browser codec notices name the web and Electron renderer surfaces', async () => {
	const notices = await readFile(noticesUrl, 'utf8');
	for (const heading of [
		'libFLAC 1.5.0 WebAssembly',
		'libopus 1.6.1 and libogg 1.3.6 WebAssembly',
		'libvorbis 1.3.7 and libogg 1.3.6 WebAssembly',
		'LAME 4.0 WebAssembly',
		'mpg123 1.33.7 WebAssembly',
		'TwoLAME 0.4.0 WebAssembly',
	]) {
		const start = notices.indexOf(`## ${heading}`);
		assert.ok(start >= 0, `${heading} notice is missing`);
		const next = notices.indexOf('\n## ', start + 4);
		assert.match(notices.slice(start, next < 0 ? undefined : next), /Web\s+and\s+Electron\s+renderer/u, heading);
	}
});

test('native policy rows separate distribution requirements from test activation', async () => {
	const matrix = await readJson(matrixUrl);

	assert.deepEqual(matrix.nativeFormatPolicies.map(({ id }) => id), [
		'plugin-format-soundscaper-fixture',
		'native-audio-stack',
		'audio-backend-coreaudio',
		'audio-backend-wasapi',
		'audio-backend-asio',
		'audio-backend-pipewire',
		'audio-backend-alsa',
		'plugin-format-vst3',
		'plugin-format-clap',
		'plugin-format-audio-units',
		'plugin-format-lv2',
		'plugin-format-ofx',
		'codec-native-ffmpeg-current-set',
		'codec-hardware-acceleration',
		'codec-decode-h264-mp4',
		'codec-decode-h264-mov',
		'codec-decode-hevc-mp4',
		'codec-decode-hevc-mov',
		'codec-decode-vp9-webm',
		'codec-decode-av1-mp4',
		'codec-decode-av1-webm',
		'codec-decode-prores-mov',
		'codec-decode-dnxhr-mxf',
		'codec-decode-png-image-sequence',
		'codec-decode-tiff-image-sequence',
		'codec-decode-openexr-image-sequence',
		'codec-encode-h264-mp4',
		'codec-encode-vp9-webm',
		'codec-encode-hevc-mp4-main10-hdr10',
		'codec-encode-hevc-mp4-main10-sdr',
		'codec-encode-prores-mov-proxy',
		'codec-encode-prores-mov-422-hq',
		'codec-encode-prores-mov-4444',
		'codec-encode-dnxhr-mxf-hqx',
		'codec-encode-ffv1-matroska',
		'codec-encode-png-image-sequence',
		'codec-encode-tiff-image-sequence',
		'codec-encode-openexr-image-sequence',
	]);
	// Every implemented row is named here rather than exempted by a pattern, so
	// a future row cannot become implemented by resembling one of these. The
	// fixture format is this project's own work with no third-party code and so
	// no review to wait on; the rest carry the owner's recorded native-audio and
	// native-plugins review. Codec rows may retain blocked stable-release status
	// without disabling their implemented build and test paths.
	const REVIEWED_ROWS = [
		'plugin-format-soundscaper-fixture',
		'native-audio-stack',
		'audio-backend-coreaudio', 'audio-backend-wasapi', 'audio-backend-asio',
		'audio-backend-pipewire', 'audio-backend-alsa',
		'plugin-format-vst3', 'plugin-format-clap', 'plugin-format-audio-units',
		'plugin-format-lv2', 'plugin-format-ofx',
	];
	assert.equal(REVIEWED_ROWS.some((id) => id.startsWith('codec-')), false);
	for (const row of matrix.nativeFormatPolicies) {
		assert.match(row.kind, /^(?:plugin-format|native-audio-stack|audio-backend|codec-capability)$/u, row.id);
		if (REVIEWED_ROWS.includes(row.id)) {
			assert.equal(row.status, 'implemented', row.id);
			assert.equal(row.blocker, null, `${row.id} is implemented and cannot still name a blocker`);
			await assertEvidence(row.evidence);
			continue;
		}
		assert.equal(row.status, 'blocked', `${row.id} retains an unresolved distribution status`);
		assert.ok(row.blocker.length > 0, `${row.id} needs a named blocker`);
		assert.ok(row.upstreamLicensing.length > 0, `${row.id} needs its upstream licensing form`);
		assert.ok(row.agplCompatibilityDirection.length > 0, `${row.id} needs its compatibility direction`);
		assert.ok(row.redistribution.length > 0, `${row.id} needs its redistribution posture`);
		await assertEvidence(row.evidence);
	}
	for (const row of matrix.nativeFormatPolicies.filter(({ kind }) =>
		kind === 'native-audio-stack' || kind === 'audio-backend')) {
		assert.ok(row.evidence.includes('config/milestone-5-native-source-acquisitions.json'),
			`${row.id} must bind the authenticated Milestone 5 source register`);
		// A row still awaiting review has to say which gate it waits on; a
		// reviewed row carries no blocker at all.
		if (row.status === 'blocked') assert.match(row.blocker, /native-audio/u, row.id);
	}
	const ffmpegRow = matrix.nativeFormatPolicies.find(({ id }) => id === 'codec-native-ffmpeg-current-set');
	assert.equal(ffmpegRow.testActivation, 'enabled');
	assert.equal(Object.hasOwn(ffmpegRow, 'humanReviewMilestone'), false);
	assert.match(ffmpegRow.blocker, /enabled for build and testing/iu);
	for (const id of [
		'codec-hardware-acceleration',
		'codec-decode-png-image-sequence', 'codec-decode-tiff-image-sequence',
		'codec-decode-openexr-image-sequence', 'codec-encode-png-image-sequence',
		'codec-encode-tiff-image-sequence', 'codec-encode-openexr-image-sequence',
	]) {
		const row = matrix.nativeFormatPolicies.find((candidate) => candidate.id === id);
		assert.equal(row.testActivation, 'enabled', id);
		assert.equal(Object.hasOwn(row, 'humanReviewMilestone'), false, id);
		assert.match(row.blocker, /enabled.*test/iu, id);
	}
	const exactCodecRows = matrix.nativeFormatPolicies.filter(({ id }) => /^codec-(?:decode|encode)-/u.test(id));
	assert.equal(exactCodecRows.length, 24);
	assert.equal(new Set(exactCodecRows.map((row) => [
		row.operation, row.codec, row.container, row.profile, row.execution,
	].join(':'))).size, exactCodecRows.length, 'every operation tuple must be unique');
	for (const row of exactCodecRows) {
		assert.match(row.operation, /^(?:decode|encode)$/u, row.id);
		assert.match(row.codec, /^[a-z0-9][a-z0-9-]*$/u, row.id);
		assert.match(row.container, /^(?:mp4|mov|webm|mxf|matroska|image-sequence)$/u, row.id);
		assert.match(row.profile, /^(?:decode|encode)-[a-z0-9-]+$/u, row.id);
		assert.equal(row.execution, 'software', row.id);
	}
	assert.equal(matrix.nativeFormatPolicies.some(({ id }) => [
		'codec-mezzanine-and-longform',
		'codec-hevc-and-av1',
		'codec-image-sequence-still-formats',
		'container-mov-mxf-matroska',
	].includes(id)), false, 'grouped professional-media blockers must not survive');
});

async function assertEvidence(references) {
	for (const reference of references) {
		const [path] = reference.split('#');
		await assert.doesNotReject(access(new URL(path, repositoryUrl)), `Missing evidence: ${reference}`);
	}
}

async function readJson(url) {
	return JSON.parse(await readFile(url, 'utf8'));
}

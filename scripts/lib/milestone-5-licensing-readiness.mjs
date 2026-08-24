/* SPDX-License-Identifier: AGPL-3.0-only */

const NATIVE_GATE_IDS = Object.freeze(['native-audio', 'native-codecs', 'native-plugins']);
const NATIVE_POLICY_IDS = Object.freeze([
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

export function validateMilestone5LicensingReadiness(matrix) {
	assertRecord(matrix, 'Milestone 5 production licensing matrix');
	assert(Array.isArray(matrix.futureDistributionGates) && Array.isArray(matrix.nativeFormatPolicies),
		'Milestone 5 licensing collections are invalid.');
	const gates = NATIVE_GATE_IDS.map((id) => {
		const matches = matrix.futureDistributionGates.filter((gate) => gate.id === id);
		assert(matches.length === 1, `Milestone 5 licensing gate ${id} must occur exactly once.`);
		assert(['disabled', 'enabled'].includes(matches[0].status),
			`Milestone 5 licensing gate ${id} has an invalid status.`);
		return matches[0];
	});
	assert(JSON.stringify(matrix.nativeFormatPolicies.map(({ id }) => id))
		=== JSON.stringify(NATIVE_POLICY_IDS),
	'Milestone 5 native licensing policy IDs are incomplete, duplicated, or out of order.');
	const policyRows = matrix.nativeFormatPolicies
		.filter(({ id }) => id !== 'plugin-format-soundscaper-fixture');
	for (const row of policyRows) {
		assert(['blocked', 'implemented'].includes(row.status),
			`Milestone 5 native policy row ${row.id} has an invalid status.`);
	}
	return Object.freeze({
		disabledGates: Object.freeze(gates
			.filter(({ status }) => status !== 'enabled').map(({ id }) => id)),
		blockedPolicyRows: Object.freeze(policyRows
			.filter(({ status }) => status !== 'implemented').map(({ id }) => id)),
	});
}

function assertRecord(value, label) {
	assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

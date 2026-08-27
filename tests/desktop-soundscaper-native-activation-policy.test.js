/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import licensing from '../config/production-licensing-matrix.json' with { type: 'json' };
import sources from '../config/milestone-5-native-source-acquisitions.json' with { type: 'json' };
import {
	createSoundscaperNativeActivationPolicy,
	productionSoundscaperAudioBackendActivated,
	productionSoundscaperPluginFormatActivated,
} from '../desktop/soundscaper-native-activation-policy.mjs';

test('checked-in native policy keeps payload-backed audio closed and exposes platform plug-in formats', () => {
	for (const backend of ['coreaudio', 'wasapi', 'asio', 'pipewire', 'alsa', 'jack']) {
		assert.equal(productionSoundscaperAudioBackendActivated(backend), false, backend);
	}
	const expected = {
		vst3: ['darwin', 'win32', 'linux'].includes(process.platform),
		clap: ['darwin', 'win32', 'linux'].includes(process.platform),
		au: process.platform === 'darwin',
		lv2: process.platform === 'linux',
		fixture: false,
	};
	for (const [format, available] of Object.entries(expected)) {
		assert.equal(productionSoundscaperPluginFormatActivated(format), available, format);
	}
});

test('activation requires the platform and every authenticated source, not human review state', () => {
	const mutableLicensing = structuredClone(licensing);
	const mutableSources = structuredClone(sources);
	activate(mutableLicensing.futureDistributionGates, 'native-audio', 'blocked');
	activate(mutableLicensing.nativeFormatPolicies, 'native-audio-stack', 'blocked');
	activate(mutableLicensing.nativeFormatPolicies, 'audio-backend-asio', 'blocked');
	activate(mutableSources.sources, 'asio-sdk', 'blocked', 'activationStatus');
	const sourceAudit = authenticatedSourceAudit(mutableSources);
	const policy = createSoundscaperNativeActivationPolicy({
		licensing: mutableLicensing, sources: mutableSources, sourceAudit, platform: 'win32',
	});
	assert.equal(policy.audioBackend('asio'), true,
		'Milestone 9 licensing and source-acceptance review cannot block test execution');
	sourceAudit.sources.find(({ id }) => id === 'asio-sdk').archiveEvidence.sha256 = '0'.repeat(64);
	assert.equal(policy.audioBackend('asio'), false, 'runtime evidence must exactly match the pinned archive');
	assert.equal(policy.audioBackend('pipewire'), false, 'a cleared backend stays OS-scoped');
});

test('fixture stays test-only even if its implemented evidence row exists', () => {
	const mutableLicensing = structuredClone(licensing);
	activate(mutableLicensing.futureDistributionGates, 'native-plugins', 'enabled');
	const policy = createSoundscaperNativeActivationPolicy({ licensing: mutableLicensing, sources, platform: 'linux' });
	assert.equal(policy.pluginFormat('fixture'), false);
});

test('third-party format visibility is platform-scoped and independent of release review', () => {
	const mutableLicensing = structuredClone(licensing);
	const mutableSources = structuredClone(sources);
	activate(mutableLicensing.futureDistributionGates, 'native-plugins', 'enabled');
	activate(mutableLicensing.nativeFormatPolicies, 'plugin-format-vst3', 'implemented');
	for (const id of ['electron-node-api-headers', 'juce', 'vst3-sdk']) {
		activate(mutableSources.sources, id, 'accepted', 'activationStatus');
	}
	const common = {
		licensing: mutableLicensing, sources: mutableSources,
		sourceAudit: authenticatedSourceAudit(mutableSources), platform: 'linux',
		productionReadiness: {
			status: 'pending-human-review',
			evidence: {
				osIsolationAttested: false,
				hostilePluginDenialAttested: false,
				realThirdPartyExecutionAttested: false,
			},
		},
	};
	assert.equal(createSoundscaperNativeActivationPolicy(common).pluginFormat('vst3'), true,
		'the format surface is visible before a payload is selected');
	assert.equal(createSoundscaperNativeActivationPolicy({
		...common, pluginIsolationEnforced: true,
	}).pluginFormat('vst3'), true,
	'Milestone 9 release review does not change the test surface');
	assert.equal(createSoundscaperNativeActivationPolicy({ ...common, platform: 'freebsd' })
		.pluginFormat('vst3'), false, 'unsupported platforms remain machine-unavailable');
});

function activate(rows, id, value, field = 'status') {
	const matches = rows.filter((row) => row.id === id);
	assert.equal(matches.length, 1);
	matches[0][field] = value;
}

function authenticatedSourceAudit(register) {
	return {
		status: 'authenticated',
		sources: register.sources.map((source) => ({
			id: source.id,
			authenticationStatus: 'authenticated',
			archiveEvidence: {
				byteLength: source.archive.byteLength, sha256: source.archive.sha256,
			},
			extractedTreeEvidence: { ...source.extractedTree },
		})),
	};
}

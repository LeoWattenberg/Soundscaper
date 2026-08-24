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

test('checked-in native policy keeps every backend and user plug-in format closed', () => {
	for (const backend of ['coreaudio', 'wasapi', 'asio', 'pipewire', 'alsa', 'jack']) {
		assert.equal(productionSoundscaperAudioBackendActivated(backend), false, backend);
	}
	for (const format of ['vst3', 'clap', 'au', 'lv2', 'fixture']) {
		assert.equal(productionSoundscaperPluginFormatActivated(format), false, format);
	}
});

test('activation requires the exact gate, policy stack, platform and every source row', () => {
	const mutableLicensing = structuredClone(licensing);
	const mutableSources = structuredClone(sources);
	activate(mutableLicensing.futureDistributionGates, 'native-audio', 'enabled');
	activate(mutableLicensing.nativeFormatPolicies, 'native-audio-stack', 'implemented');
	activate(mutableLicensing.nativeFormatPolicies, 'audio-backend-asio', 'implemented');
	activate(mutableSources.sources, 'juce', 'accepted', 'activationStatus');
	activate(mutableSources.sources, 'electron-node-api-headers', 'accepted', 'activationStatus');
	const sourceAudit = authenticatedSourceAudit(mutableSources);
	const policy = createSoundscaperNativeActivationPolicy({
		licensing: mutableLicensing, sources: mutableSources, sourceAudit, platform: 'win32',
	});
	assert.equal(policy.audioBackend('asio'), false, 'the ASIO SDK activation is independently required');
	activate(mutableSources.sources, 'asio-sdk', 'accepted', 'activationStatus');
	assert.equal(policy.audioBackend('asio'), true);
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

test('third-party formats require signed readiness and an actually enforced OS launcher', () => {
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
			status: 'authenticated',
			evidence: {
				osIsolationAttested: true,
				hostilePluginDenialAttested: true,
				realThirdPartyExecutionAttested: true,
			},
		},
	};
	assert.equal(createSoundscaperNativeActivationPolicy(common).pluginFormat('vst3'), false,
		'signed prose cannot activate the current same-UID utility process');
	assert.equal(createSoundscaperNativeActivationPolicy({
		...common, pluginIsolationEnforced: true,
	}).pluginFormat('vst3'), true);
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

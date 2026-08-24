/* SPDX-License-Identifier: AGPL-3.0-only */

export function nativeTierPluginObservation({ format = 'fixture' } = {}) {
	return {
		format, stableId: `${format}:production-route`, bundleStableIds: [`${format}:production-route`],
		name: 'Production route',
		vendor: 'Soundscaper', version: '1.0.0', platform: process.platform, architecture: process.arch,
		binaryPath: '/opt/soundscaper/production-route.fixture', binaryBytes: 4_096,
		binarySha256: 'e'.repeat(64), identity: { dev: 9, ino: 11 }, classification: 'effect',
		topologies: [{ inputChannels: 2, outputChannels: 2 }], realtimeSupported: true,
		offlineSupported: true, reportedLatencyFrames: 0, signature: 'trusted',
		compatibility: 'compatible', descriptorVersion: 1,
	};
}

export function nativeTierScanEntry({ binaryPath = '/opt/plug-ins/reverb.fixture' } = {}) {
	return {
		stableId: 'fixture:reverb', name: 'Fixture Reverb', vendor: 'Soundscaper', version: '1.0.0',
		binaryPath, binaryBytes: 4_096, binarySha256: 'd'.repeat(64), classification: 'effect',
		channelSupport: [{ inputs: 2, outputs: 2 }], realtime: true, offline: true,
		reportedLatencyFrames: 0, signature: 'signed-valid', compatibility: 'compatible',
		descriptorVersion: 1,
	};
}

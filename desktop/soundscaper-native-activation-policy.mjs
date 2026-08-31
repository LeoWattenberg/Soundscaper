/* SPDX-License-Identifier: AGPL-3.0-only */

/** Runtime activation derived only from authenticated implementation evidence. */

import sourceAcquisitions from '../config/milestone-5-native-source-acquisitions.json' with { type: 'json' };

const BACKENDS = Object.freeze({
	coreaudio: Object.freeze({ platforms: ['darwin'], policy: 'audio-backend-coreaudio', sources: ['electron-node-api-headers', 'juce'] }),
	wasapi: Object.freeze({ platforms: ['win32'], policy: 'audio-backend-wasapi', sources: ['electron-node-api-headers', 'juce'] }),
	asio: Object.freeze({ platforms: ['win32'], policy: 'audio-backend-asio', sources: ['electron-node-api-headers', 'juce', 'asio-sdk'] }),
	pipewire: Object.freeze({ platforms: ['linux'], policy: 'audio-backend-pipewire', sources: ['electron-node-api-headers', 'juce'] }),
	alsa: Object.freeze({ platforms: ['linux'], policy: 'audio-backend-alsa', sources: ['electron-node-api-headers', 'juce'] }),
});

const FORMATS = Object.freeze({
	vst3: Object.freeze({ platforms: ['darwin', 'win32', 'linux'], policy: 'plugin-format-vst3', sources: ['electron-node-api-headers', 'juce', 'vst3-sdk'] }),
	clap: Object.freeze({ platforms: ['darwin', 'win32', 'linux'], policy: 'plugin-format-clap', sources: ['electron-node-api-headers', 'clap'] }),
	au: Object.freeze({ platforms: ['darwin'], policy: 'plugin-format-audio-units', sources: ['electron-node-api-headers', 'juce'] }),
	lv2: Object.freeze({ platforms: ['linux'], policy: 'plugin-format-lv2', sources: ['electron-node-api-headers', 'juce', 'lv2'] }),
});

export function createSoundscaperNativeActivationPolicy({
	sources = sourceAcquisitions,
	sourceAudit = null,
	platform = process.platform,
} = {}) {
	const source = (id) => {
		const row = exactRow(sources.sources, id, 'native source');
		if (row.authenticationStatus !== 'pinned-metadata'
			|| sourceAudit?.status !== 'authenticated') return false;
		const evidence = exactRow(sourceAudit.sources, id, 'authenticated native source');
		return evidence.authenticationStatus === 'authenticated'
			&& evidence.archiveEvidence?.byteLength === row.archive?.byteLength
			&& evidence.archiveEvidence?.sha256 === row.archive?.sha256
			&& evidence.extractedTreeEvidence?.algorithm === row.extractedTree?.algorithm
			&& evidence.extractedTreeEvidence?.fileCount === row.extractedTree?.fileCount
			&& evidence.extractedTreeEvidence?.sha256 === row.extractedTree?.sha256;
	};
	const activated = (entry) => Boolean(entry)
		&& entry.platforms.includes(platform)
		&& entry.sources.every(source);
	const surfaceAvailable = (entry) => Boolean(entry) && entry.platforms.includes(platform);
	return Object.freeze({
		audioBackend: (backend) => activated(BACKENDS[backend]),
		// Format visibility is not execution authority. The helper reopens the
		// exact payload and plug-in bytes and enforces the target OS launcher at
		// each scan/host operation; those execution checks must not hide the surface.
		pluginFormat: (format) => format !== 'fixture' && surfaceAvailable(FORMATS[format]),
	});
}

const PRODUCTION_POLICY = createSoundscaperNativeActivationPolicy();

export const productionSoundscaperAudioBackendActivated = (backend) => {
	try { return PRODUCTION_POLICY.audioBackend(backend); } catch { return false; }
};

export const productionSoundscaperPluginFormatActivated = (format) => {
	try { return PRODUCTION_POLICY.pluginFormat(format); } catch { return false; }
};

function exactRow(rows, id, label) {
	if (!Array.isArray(rows)) throw new TypeError(`The ${label} register is absent.`);
	const matches = rows.filter((row) => row?.id === id);
	if (matches.length !== 1 || typeof matches[0]?.status !== 'string'
		&& typeof matches[0]?.activationStatus !== 'string'
		&& typeof matches[0]?.authenticationStatus !== 'string') {
		throw new TypeError(`The ${label} ${id} is absent or duplicated.`);
	}
	return matches[0];
}

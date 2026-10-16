/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * A built Soundscaper professional row stages its whole verified closure —
 * plug-in peer, isolation launcher, sandbox profile, broker policy, and
 * runtime libraries — and the payload-manifest validator requires them, so a
 * package audit that admits only the payload rejects every genuine built
 * release as unexpected files under its closed prefix.
 */
export function assertProfessionalNativeBuiltClosure({ professional, target, prefix, requireFile, pluginOnly = false }) {
	const relative = (path) => {
		const sourcePrefix = `native/soundscaper-professional-host/prebuilt/${target}/`;
		if (typeof path !== 'string' || !path.startsWith(sourcePrefix)) {
			throw new Error('A professional native artifact escaped its target root.');
		}
		return path.slice(sourcePrefix.length);
	};
	const isolation = professional.isolation;
	if (!plainRecord(professional.buildResult) || !plainRecord(professional.pluginPeer)
		|| (pluginOnly ? professional.deliveryFilesystem !== null : !plainRecord(professional.deliveryFilesystem))
		|| !plainRecord(isolation)
		|| (pluginOnly || target.startsWith('linux-') ? professional.osAudioCodec !== null
			: !plainRecord(professional.osAudioCodec))
		|| !Array.isArray(isolation.runtimeClosure)) {
		throw new Error('A built professional native target requires its verified isolation closure.');
	}
	for (const [label, artifact] of [
		['build-result receipt', professional.buildResult],
		...(pluginOnly || professional.osAudioCodec === null ? []
			: [['operating-system audio codec addon', professional.osAudioCodec]]),
		['plug-in peer', professional.pluginPeer],
		...(pluginOnly ? [] : [['persistent-delivery filesystem helper', professional.deliveryFilesystem]]),
		['isolation launcher', isolation.launcher],
		['isolation sandbox profile', isolation.sandboxProfile],
		['isolation broker policy', isolation.brokerPolicy],
		...isolation.runtimeClosure.map((entry, index) => [`runtime closure entry ${index}`, entry]),
	]) {
		requireFile(`${prefix}${relative(artifact?.path)}`, artifact,
			`professional native ${label}`, prefix);
	}
}

function plainRecord(value) {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Framescaper carries the isolated audio plug-in peer without device or delivery executables. */
export function assertDesktopProfessionalNativePayloadClosure({ runtime, target, requireFile }) {
	const professional = runtime.soundscaperProfessionalNative;
	const pluginOnly = runtime.productId === 'framescaper';
	if (pluginOnly && professional == null) return null;
	if (!plainRecord(professional) || professional.target !== target
		|| !plainRecord(professional.payloadManifest)
		|| pluginOnly && professional.hostingScope !== 'audio-plugin-host') {
		throw new Error('The desktop runtime manifest has no professional native payload authority.');
	}
	const prefix = `runtime/native/soundscaper-professional-host/${target}/`;
	requireFile(`${prefix}soundscaper-professional-native-payload-manifest.json`,
		professional.payloadManifest, 'professional native payload manifest', prefix);
	if (professional.status === 'built') {
		if (pluginOnly) {
			if (professional.payload !== null) throw new Error('Framescaper audio plug-in hosting cannot carry a device addon.');
		} else requireFile(`${prefix}${professional.payload?.name}`, professional.payload,
			'professional native payload', prefix);
		assertProfessionalNativeBuiltClosure({ professional, target, prefix, requireFile, pluginOnly });
	} else if (professional.status !== 'ci-generated' || professional.payload !== null || professional.blockedBy !== null) {
		throw new Error('The desktop runtime manifest has invalid professional native target state.');
	}
	return professional;
}

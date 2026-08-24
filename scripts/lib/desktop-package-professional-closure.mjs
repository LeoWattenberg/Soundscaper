/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * A built Soundscaper professional row stages its whole reviewed closure —
 * plug-in peer, isolation launcher, sandbox profile, broker policy, and
 * runtime libraries — and the payload-manifest validator requires them, so a
 * package audit that admits only the payload rejects every genuine built
 * release as unexpected files under its closed prefix.
 */
export function assertProfessionalNativeBuiltClosure({ professional, target, prefix, requireFile }) {
	const relative = (path) => {
		const sourcePrefix = `native/soundscaper-professional-host/prebuilt/${target}/`;
		if (typeof path !== 'string' || !path.startsWith(sourcePrefix)) {
			throw new Error('A professional native artifact escaped its target root.');
		}
		return path.slice(sourcePrefix.length);
	};
	const isolation = professional.isolation;
	if (!plainRecord(professional.pluginPeer) || !plainRecord(isolation)
		|| !Array.isArray(isolation.runtimeClosure)) {
		throw new Error('A built professional native target requires its reviewed isolation closure.');
	}
	for (const [label, artifact] of [
		['plug-in peer', professional.pluginPeer],
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

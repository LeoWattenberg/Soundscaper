/* SPDX-License-Identifier: AGPL-3.0-only */

/** Target-specific installed names owned by the professional payload manifest. */
export function deliveryFilesystemName(manifest, target) {
	return targetNativeExecutableName(manifest.deliveryFilesystem.payloadName, target);
}

export function professionalPluginPeerName(manifest, target) {
	return targetNativeExecutableName(manifest.pluginPeer.payloadName, target);
}

export function professionalIsolationLauncherName(manifest, target) {
	return targetNativeExecutableName(manifest.isolation.launcherName, target);
}

export function targetNativeExecutableName(name, target) {
	return `${name}${target.startsWith('win-') ? '.exe' : ''}`;
}

export function professionalNativeSummaryArtifact(value) {
	return value === null ? null : Object.freeze({
		path: value.path, byteLength: value.byteLength, sha256: value.sha256,
	});
}

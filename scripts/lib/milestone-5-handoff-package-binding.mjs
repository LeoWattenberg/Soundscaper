/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bind an extracted package runtime to the independently authenticated payload audit. */

export function validateMilestone5PackagePayloadBinding(packageAudit, payloadAudit, inputPaths) {
	const targetId = packageAudit.targetId;
	const runtime = packageAudit.runtimeManifest.value;
	const nativeManifest = payloadAudit.manifests.nativeAddon;
	const nativeTarget = exactTarget(nativeManifest, targetId, 'native addon');
	const nativeDigest = payloadAudit.inputDigests[inputPaths.nativeAddonPayload]?.sha256;
	assert(runtime.nativeAddons?.payloadManifest?.id === nativeManifest.id
		&& runtime.nativeAddons.payloadManifest.sha256 === nativeDigest,
	'Milestone 5 package native-addon manifest pin disagrees with the authenticated payload audit.');
	assert(runtime.nativeAddons.target === targetId
		&& runtime.nativeAddons.status === nativeTarget.status
		&& runtime.nativeAddons.blockedBy === nativeTarget.blockedBy
		&& JSON.stringify(runtime.nativeAddons.payload) === JSON.stringify(
			nativeTarget.payload === null ? null : packagePayload(nativeTarget.payload),
		), 'Milestone 5 package native-addon target disagrees with the authenticated payload audit.');

	if (packageAudit.productId === 'soundscaper') {
		const professionalManifest = payloadAudit.manifests.soundscaperProfessional;
		const professionalTarget = exactTarget(professionalManifest, targetId, 'professional native addon');
		const professional = runtime.soundscaperProfessionalNative;
		const professionalManifestDescriptor = payloadAudit.inputDigests[
			inputPaths.soundscaperProfessionalPayload
		];
		assert(professional?.payloadManifest?.id === professionalManifest.id
			&& professional.payloadManifest.byteLength === professionalManifestDescriptor?.byteLength
			&& professional.payloadManifest.sha256 === professionalManifestDescriptor?.sha256,
		'Milestone 5 package professional native manifest pin disagrees with the authenticated payload audit.');
		assert(professional.target === targetId
			&& ['declared', 'build-host'].includes(professional.targetSource)
			&& professional.status === professionalTarget.status
			&& professional.blockedBy === professionalTarget.blockedBy
			&& JSON.stringify(professional.sourceAuthentication)
				=== JSON.stringify(professionalTarget.sourceAuthentication)
			&& JSON.stringify(professional.payload) === JSON.stringify(
				professionalTarget.payload === null ? null : packagePayload(professionalTarget.payload),
			), 'Milestone 5 package professional native target disagrees with the authenticated payload audit.');
		assert(runtime.framescaperNativeHosts === null
			|| runtime.framescaperNativeHosts === undefined,
		'Milestone 5 Soundscaper package unexpectedly carries Framescaper native hosts.');
		return;
	}
	assert(packageAudit.productId === 'framescaper',
		'Milestone 5 package audit has an unsupported product.');
	assert(runtime.soundscaperProfessionalNative === null
		|| runtime.soundscaperProfessionalNative === undefined,
	'Milestone 5 Framescaper package unexpectedly carries the Soundscaper professional native host.');
	assert(runtime.framescaperNativeHosts?.target === targetId,
		'Milestone 5 Framescaper package native-host target is inconsistent.');
	for (const [manifestKey, inputKey, summaryKey, label] of [
		['mediaHost', 'mediaHostPayload', 'mediaHost', 'media host'],
		['openFxHost', 'openFxHostPayload', 'openFxHost', 'OpenFX host'],
	]) {
		const manifest = payloadAudit.manifests[manifestKey];
		const target = exactTarget(manifest, targetId, label);
		const summary = runtime.framescaperNativeHosts[summaryKey];
		assert(summary?.payloadManifest?.id === manifest.id
			&& summary.payloadManifest.sha256 === payloadAudit.inputDigests[inputPaths[inputKey]]?.sha256,
		`Milestone 5 package ${label} manifest pin disagrees with the authenticated payload audit.`);
		assert(summary.status === target.status && summary.blockedBy === target.blockedBy
			&& JSON.stringify(summary.payloads) === JSON.stringify(hostPayloads(target, manifestKey)),
		`Milestone 5 package ${label} target disagrees with the authenticated payload audit.`);
	}
}

function exactTarget(manifest, targetId, label) {
	const matches = manifest.targets.filter(({ id }) => id === targetId);
	assert(matches.length === 1, `Milestone 5 authenticated ${label} target is missing.`);
	return matches[0];
}

function packagePayload(descriptor) {
	return {
		name: descriptor.path.slice(descriptor.path.lastIndexOf('/') + 1),
		byteLength: descriptor.byteLength,
		sha256: descriptor.sha256,
	};
}

function hostPayloads(target, manifestKey) {
	if (target.payload === null) return [];
	const openFx = manifestKey === 'openFxHost';
	const isolation = openFx ? target.payload.isolationPayload : target.isolationPayload;
	assert(isolation && Array.isArray(isolation.runtimeLibraryPayloads),
		'Milestone 5 built native-host target has no authenticated isolation payload closure.');
	return [
		...(openFx ? [target.payload.scannerPayload, target.payload.runtimeHostPayload] : [target.payload]),
		isolation.launcherPayload,
		isolation.sandboxProfilePayload,
		isolation.brokerPolicyPayload,
		...isolation.runtimeLibraryPayloads,
	].map(packagePayload);
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

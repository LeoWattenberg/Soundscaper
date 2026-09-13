/* SPDX-License-Identifier: AGPL-3.0-only */

const OWNER_ENVIRONMENT_FIELDS = Object.freeze({
	gpuDriverVersion: 'SOUNDSCAPER_PACKAGED_RUNTIME_GPU_DRIVER_VERSION',
	gpuDeviceId: 'SOUNDSCAPER_PACKAGED_RUNTIME_GPU_DEVICE_ID',
	powerMode: 'SOUNDSCAPER_PACKAGED_RUNTIME_POWER_MODE',
	displayMode: 'SOUNDSCAPER_PACKAGED_RUNTIME_DISPLAY_MODE',
});

export function packagedRuntimeEnvironmentFingerprint(browser, renderer, environment = process.env) {
	const ownerIdentity = Object.fromEntries(Object.entries(OWNER_ENVIRONMENT_FIELDS).map(([field, name]) => {
		const value = environment[name];
		return [field, typeof value === 'string' && value.length > 0
			? value
			: 'not-recorded-local-correctness'];
	}));
	return Object.freeze({
		browserVersion: browser.version(),
		platform: environment.SOUNDSCAPER_PACKAGED_RUNTIME_PLATFORM ?? process.platform,
		architecture: environment.SOUNDSCAPER_PACKAGED_RUNTIME_ARCH ?? process.arch,
		webglVendor: String(renderer.vendor ?? ''),
		webglRenderer: String(renderer.renderer ?? ''),
		...ownerIdentity,
	});
}

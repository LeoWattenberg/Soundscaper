/* SPDX-License-Identifier: AGPL-3.0-only */

// Kept CommonJS because electron-builder loads its configuration with require.
function desktopSigningConfig(env = process.env, platform = process.platform) {
	const mac = env.SCAPE_MAC_SIGNING === 'true' && platform === 'darwin';
	const windows = platform === 'win32' ? (env.SCAPE_WIN_SIGNING || 'none') : 'none';
	if (env.SCAPE_MAC_SIGNING && !['true', 'false'].includes(env.SCAPE_MAC_SIGNING)) {
		throw new Error('SCAPE_MAC_SIGNING must be true or false.');
	}
	if (!['none', 'azure', 'certificate'].includes(windows)) throw new Error('Invalid SCAPE_WIN_SIGNING mode.');
	const requireValues = (names) => {
		for (const name of names) if (!env[name]?.trim()) throw new Error(`Signed release requires ${name}.`);
	};
	if (mac) {
		requireValues(['CSC_NAME', 'CSC_KEYCHAIN', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']);
		if (!env.CSC_NAME.startsWith('Developer ID Application: ')
			|| !env.CSC_NAME.endsWith(`(${env.APPLE_TEAM_ID})`)) throw new Error('Developer ID identity must belong to APPLE_TEAM_ID.');
	}
	if (windows === 'certificate') requireValues(['WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD']);
	if (windows === 'azure') requireValues(['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET',
		'AZURE_SIGNING_ENDPOINT', 'AZURE_SIGNING_ACCOUNT', 'AZURE_SIGNING_PROFILE', 'WINDOWS_PUBLISHER_NAME']);
	return {
		forceCodeSigning: mac || windows !== 'none',
		// electron-builder selects the certificate type itself and rejects the
		// Developer ID prefix in its qualifier; codesign uses the full name.
		mac: { identity: mac ? env.CSC_NAME.slice('Developer ID Application: '.length) : '-', notarize: mac },
		win: windows === 'azure' ? {
			azureSignOptions: {
				endpoint: env.AZURE_SIGNING_ENDPOINT,
				codeSigningAccountName: env.AZURE_SIGNING_ACCOUNT,
				certificateProfileName: env.AZURE_SIGNING_PROFILE,
				publisherName: env.WINDOWS_PUBLISHER_NAME,
			},
		} : {},
	};
}

module.exports = { desktopSigningConfig };

import assert from 'node:assert/strict';
import test from 'node:test';
import { desktopSigningConfig } from '../scripts/lib/desktop-signing-config.cjs';

test('ordinary builds retain ad-hoc mac sealing without notarization', () => {
	assert.deepEqual(desktopSigningConfig({}, 'darwin'), {
		forceCodeSigning: false, mac: { identity: '-', notarize: false }, win: {},
	});
});
test('requested signing fails closed on missing credentials and wrong teams', () => {
	assert.throws(() => desktopSigningConfig({ SCAPE_MAC_SIGNING: 'true' }, 'darwin'), /CSC_NAME/);
	assert.throws(() => desktopSigningConfig({ SCAPE_WIN_SIGNING: 'azure' }, 'win32'), /AZURE_TENANT_ID/);
	assert.throws(() => desktopSigningConfig({ SCAPE_WIN_SIGNING: 'certificate' }, 'win32'), /WIN_CSC_LINK/);
	assert.throws(() => desktopSigningConfig({ SCAPE_WIN_SIGNING: 'typo' }, 'win32'), /Invalid/);
	const env = { SCAPE_MAC_SIGNING: 'true', CSC_NAME: 'Developer ID Application: Example (TEAM)',
		CSC_KEYCHAIN: '/tmp/keychain', APPLE_ID: 'account', APPLE_APP_SPECIFIC_PASSWORD: 'secret', APPLE_TEAM_ID: 'TEAM' };
	assert.equal(desktopSigningConfig(env, 'darwin').forceCodeSigning, true);
	assert.equal(desktopSigningConfig(env, 'darwin').mac.identity, 'Example (TEAM)');
	assert.throws(() => desktopSigningConfig({ ...env, APPLE_TEAM_ID: 'OTHER' }, 'darwin'), /identity/);
	assert.equal(desktopSigningConfig(env, 'linux').forceCodeSigning, false);
});
test('Azure uses the selected public trust profile', () => {
	const env = Object.fromEntries(['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET',
		'AZURE_SIGNING_ENDPOINT', 'AZURE_SIGNING_ACCOUNT', 'AZURE_SIGNING_PROFILE', 'WINDOWS_PUBLISHER_NAME']
		.map(name => [name, name]));
	const config = desktopSigningConfig({ ...env, SCAPE_WIN_SIGNING: 'azure' }, 'win32');
	assert.equal(config.forceCodeSigning, true);
	assert.equal(config.win.azureSignOptions.certificateProfileName, 'AZURE_SIGNING_PROFILE');
	assert.equal(JSON.stringify(config).includes('AZURE_CLIENT_SECRET'), false);
});

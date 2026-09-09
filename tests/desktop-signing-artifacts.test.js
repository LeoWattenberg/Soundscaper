import assert from 'node:assert/strict';
import test from 'node:test';
import verifyReleaseArtifacts from '../scripts/desktop-verify-release-artifacts.mjs';

test('a release disk image is verified, accepted by Apple and stapled before completion', async () => {
	const calls = [];
	await verifyReleaseArtifacts({ artifactPaths: ['/tmp/release.dmg'] }, {
		platform: 'darwin', env: { SCAPE_MAC_SIGNING: 'true', APPLE_TEAM_ID: 'ABCDEFGHIJ',
			APPLE_ID: 'account', APPLE_APP_SPECIFIC_PASSWORD: 'secret' },
		executeFile: async (command, args) => {
			calls.push([command, args[0], args[1]]);
			return { stdout: JSON.stringify({ status: 'Accepted' }) };
		},
	});
	assert.deepEqual(calls, [
		['codesign', '--verify', '--strict'], ['xcrun', 'notarytool', 'submit'],
		['xcrun', 'stapler', 'staple'], ['xcrun', 'stapler', 'validate'],
	]);
});

test('notary rejection prevents stapling and process failures never expose passwords', async () => {
	for (const fail of [false, true]) {
		const calls = [];
		await assert.rejects(verifyReleaseArtifacts({ artifactPaths: ['/tmp/release.dmg'] }, {
			platform: 'darwin', env: { SCAPE_MAC_SIGNING: 'true', APPLE_APP_SPECIFIC_PASSWORD: 'PRIVATE-PASSWORD' },
			executeFile: async (command, args) => {
				calls.push(args[0]);
				if (command === 'xcrun' && fail) throw new Error('argv contains PRIVATE-PASSWORD');
				return { stdout: JSON.stringify({ status: 'Invalid' }) };
			},
		}), error => {
			assert.match(error.message, /did not accept/);
			assert.equal(String(error.stack).includes('PRIVATE-PASSWORD'), false);
			assert.equal(error.cause, undefined);
			return true;
		});
		assert.equal(calls.includes('stapler'), false);
	}
});

test('Windows release completion requires verification of every installer', async () => {
	const paths = [];
	await verifyReleaseArtifacts({ artifactPaths: ['one.exe', 'two.exe', 'app.zip'] }, {
		platform: 'win32', env: { SCAPE_WIN_SIGNING: 'azure' },
		executeFile: async (_command, args) => { paths.push(args.at(-1)); },
	});
	assert.deepEqual(paths, ['one.exe', 'two.exe']);
	await assert.rejects(verifyReleaseArtifacts({ artifactPaths: ['app.zip'] }, {
		platform: 'win32', env: { SCAPE_WIN_SIGNING: 'azure' },
	}), /no installer/);
});

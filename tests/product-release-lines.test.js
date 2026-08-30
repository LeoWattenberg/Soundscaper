/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	expectedProductReleaseTag,
	resolveProductApplicationVersion,
	resolveProductDesktopMetadata,
	resolveProductReleaseTag,
	validateProductReleaseLines,
} from '../scripts/lib/product-release-lines.mjs';
import { desktopReleaseTargetPackageInventory } from '../scripts/desktop-release-assets.mjs';
import { selectUpdate } from '../desktop/update-check.js';

const ROOT = new URL('../', import.meta.url);
const RELEASE_LINES = validateProductReleaseLines(JSON.parse(
	await readFile(new URL('config/product-release-lines.json', ROOT), 'utf8'),
));

test('product release lines keep Soundscaper selection synchronized with stable admission', () => {
	const soundscaper = RELEASE_LINES.products.soundscaper;
	assert.equal(resolveProductApplicationVersion('soundscaper', RELEASE_LINES),
		soundscaper[soundscaper.applicationVersionChannel].version);
	assert.equal(resolveProductApplicationVersion('framescaper', RELEASE_LINES), '1.0.0-rc.1');
	assert.equal(expectedProductReleaseTag('soundscaper', RELEASE_LINES, 'candidate'),
		'soundscaper-v1.0.0-rc.1');
	assert.equal(expectedProductReleaseTag('soundscaper', RELEASE_LINES, 'stable'),
		'v1.0.0');
	assert.match(soundscaper.stable.status, /^(?:pending-admission|admitted)$/u);
	assert.equal(RELEASE_LINES.products.soundscaper.stable.admissionProfile, 'soundscaper-stable-1');
	assert.equal(RELEASE_LINES.products.framescaper.releaseChannel, 'deferred');
	assert.equal(RELEASE_LINES.products.framescaper.stable.status, 'deferred');
	if (soundscaper.stable.status === 'admitted') {
		assert.equal(resolveProductReleaseTag('v1.0.0', RELEASE_LINES).channel, 'stable');
	} else {
		assert.throws(() => resolveProductReleaseTag('v1.0.0', RELEASE_LINES), /not admitted/iu);
	}
});

test('the resolver supports divergent product versions without package metadata', () => {
	const divergent = structuredClone(RELEASE_LINES);
	divergent.products.soundscaper.applicationVersionChannel = 'candidate';
	divergent.products.soundscaper.releaseChannel = 'candidate';
	divergent.products.soundscaper.stable.status = 'pending-admission';
	divergent.products.soundscaper.candidate.version = '1.0.0-rc.2';
	const validated = validateProductReleaseLines(divergent);
	assert.equal(resolveProductApplicationVersion('soundscaper', validated), '1.0.0-rc.2');
	assert.equal(resolveProductApplicationVersion('framescaper', validated), '1.0.0-rc.1');
	assert.deepEqual(resolveProductDesktopMetadata('soundscaper', validated), {
		schemaVersion: 1,
		id: 'soundscaper',
		applicationVersion: '1.0.0-rc.2',
		applicationVersionChannel: 'candidate',
		releaseChannel: 'candidate',
		updateTagPrefix: 'soundscaper-v',
	});
	assert.equal(resolveProductDesktopMetadata('framescaper', validated).releaseChannel, 'deferred');

	const stable = structuredClone(validated);
	stable.products.soundscaper.stable.status = 'admitted';
	stable.products.soundscaper.applicationVersionChannel = 'stable';
	stable.products.soundscaper.releaseChannel = 'stable';
	const admitted = validateProductReleaseLines(stable);
	assert.equal(resolveProductApplicationVersion('soundscaper', admitted), '1.0.0');
	assert.equal(resolveProductDesktopMetadata('soundscaper', admitted).updateTagPrefix, 'v');
	assert.deepEqual(resolveProductReleaseTag('v1.0.0', admitted), {
		productId: 'soundscaper',
		channel: 'stable',
		version: '1.0.0',
	});
});

test('release-line validation is strict and does not redefine project schema families', async () => {
	for (const mutate of [
		(value) => { value.products.soundscaper.extra = true; },
		(value) => { value.products.framescaper.candidate.version = 'latest'; },
		(value) => {
			value.products.soundscaper.applicationVersionChannel =
				value.products.soundscaper.applicationVersionChannel === 'stable' ? 'candidate' : 'stable';
		},
	]) {
		const changed = structuredClone(RELEASE_LINES);
		mutate(changed);
		assert.throws(() => validateProductReleaseLines(changed), /release|exact|version|admitted/iu);
	}
	const configText = await readFile(new URL('config/product-release-lines.json', ROOT), 'utf8');
	assert.doesNotMatch(configText, /schemaFamily|projectFormat|family-v1/iu);
});

test('browser and desktop builds resolve the selected product version from release lines', async () => {
	const [vite, desktop, constants, main] = await Promise.all([
		readFile(new URL('vite.config.mjs', ROOT), 'utf8'),
		readFile(new URL('scripts/desktop-prepare.mjs', ROOT), 'utf8'),
		readFile(new URL('desktop/constants.js', ROOT), 'utf8'),
		readFile(new URL('desktop/main.mjs', ROOT), 'utf8'),
	]);
	assert.match(vite, /resolveProductApplicationVersion\(\s*productId/iu);
	assert.doesNotMatch(vite, /package\.json[^\n]+version/iu);
	assert.match(desktop, /resolveProductApplicationVersion\(\s*PRODUCT_ID/iu);
	assert.doesNotMatch(desktop, /applicationVersion:\s*projectPackage\.version/iu);
	assert.match(desktop, /version:\s*applicationVersion/iu, 'Electron package metadata uses the selected version');
	assert.match(desktop, /applicationVersion,/u, 'the runtime stage manifest uses the selected version');
	assert.match(desktop, /desktop\/product\.json'\), productMetadata/u);
	assert.match(constants, /productConfig\.updateTagPrefix/u);
	assert.match(main, /currentVersion:\s*app\.getVersion\(\).*tagPrefix:\s*UPDATE_TAG_PREFIX/u);
	assert.match(main, /version:\s*app\.getVersion\(\)/u, 'diagnostics/environment reports the Electron version');
	assert.match(main, /app\.getVersion\(\) !== DECLARED_APPLICATION_VERSION/u);

	const divergent = structuredClone(RELEASE_LINES);
	divergent.products.soundscaper.candidate.version = '1.0.0-rc.7';
	const metadata = resolveProductDesktopMetadata('soundscaper', divergent);
	assert.equal(selectUpdate([
		{ tag_name: 'v1.0.0', prerelease: false, draft: false },
		{ tag_name: 'soundscaper-v1.0.0-rc.8', prerelease: true, draft: false },
	], metadata.applicationVersion, metadata.updateTagPrefix).tag_name,
	'soundscaper-v1.0.0-rc.8');
	const packagePattern = desktopReleaseTargetPackageInventory(
		'soundscaper', 'mac-arm64', metadata.applicationVersion,
	)[0].pattern;
	assert.equal(packagePattern.test('Soundscaper-1.0.0-rc.7-mac-arm64.dmg'), true);
	assert.equal(packagePattern.test('Soundscaper-1.0.0-rc.1-mac-arm64.dmg'), false);
});

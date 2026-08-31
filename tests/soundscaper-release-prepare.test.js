/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertSoundscaperReleaseMetadataSynchronized,
	createSoundscaperReleasePreparation,
	parseSoundscaperReleasePrepareArguments,
} from '../scripts/prepare-soundscaper-release.mjs';

function documents() {
	return {
		releaseLines: {
			schemaVersion: 2,
			products: {
				soundscaper: {
					productId: 'soundscaper', applicationVersionChannel: 'candidate',
					releaseChannel: 'candidate',
					candidate: { version: '1.0.0-rc.1', tagPrefix: 'soundscaper-v' },
					stable: { version: '1.0.0', tagPrefix: 'v' },
				},
				framescaper: {
					productId: 'framescaper', applicationVersionChannel: 'candidate',
					releaseChannel: 'deferred',
					candidate: { version: '1.0.0-rc.1', tagPrefix: 'framescaper-v' },
					stable: { version: '1.0.0', tagPrefix: 'framescaper-v' },
				},
			},
		},
		packageMetadata: { name: 'soundscaper', version: '1.0.0-rc.1', private: true },
		packageLock: {
			name: 'soundscaper', version: '1.0.0-rc.1', lockfileVersion: 3,
			packages: { '': { name: 'soundscaper', version: '1.0.0-rc.1' } },
		},
		desktopProduct: {
			schemaVersion: 1, id: 'soundscaper', applicationVersion: '1.0.0-rc.1',
			applicationVersionChannel: 'candidate', releaseChannel: 'candidate',
			updateTagPrefix: 'soundscaper-v',
		},
	};
}

test('release preparation selects the stable line and synchronizes version metadata', () => {
	const prepared = createSoundscaperReleasePreparation(documents(), '1.0.0');
	assert.equal(prepared.releaseLines.products.soundscaper.applicationVersionChannel, 'stable');
	assert.equal(prepared.releaseLines.products.soundscaper.releaseChannel, 'stable');
	assert.equal(prepared.releaseLines.products.soundscaper.stable.version, '1.0.0');
	assert.equal(prepared.packageMetadata.version, '1.0.0');
	assert.equal(prepared.packageLock.version, '1.0.0');
	assert.equal(prepared.packageLock.packages[''].version, '1.0.0');
	assert.deepEqual(prepared.desktopProduct, {
		schemaVersion: 1, id: 'soundscaper', applicationVersion: '1.0.0',
		applicationVersionChannel: 'stable', releaseChannel: 'stable', updateTagPrefix: 'v',
	});
	assert.doesNotMatch(JSON.stringify(prepared), /admission|status|review/iu);
});

test('stable release verification binds the tag to every synchronized metadata surface without mutation', () => {
	const prepared = createSoundscaperReleasePreparation(documents(), '1.0.0');
	const before = structuredClone(prepared);
	assert.deepEqual(assertSoundscaperReleaseMetadataSynchronized(prepared, 'v1.0.0'), {
		productId: 'soundscaper', channel: 'stable', version: '1.0.0',
	});
	assert.deepEqual(prepared, before);

	for (const [label, mutate] of [
		['release line', (value) => { value.releaseLines.products.soundscaper.releaseChannel = 'candidate'; }],
		['package metadata', (value) => { value.packageMetadata.version = '1.0.1'; }],
		['package-lock root', (value) => { value.packageLock.version = '1.0.1'; }],
		['package-lock package', (value) => { value.packageLock.packages[''].version = '1.0.1'; }],
		['desktop metadata', (value) => { value.desktopProduct.applicationVersion = '1.0.1'; }],
	]) {
		const drifted = structuredClone(prepared);
		mutate(drifted);
		assert.throws(
			() => assertSoundscaperReleaseMetadataSynchronized(drifted, 'v1.0.0'),
			/release|synchron|metadata/iu,
			label,
		);
	}
	assert.throws(
		() => assertSoundscaperReleaseMetadataSynchronized(prepared, 'v1.0.1'),
		/release tag/iu,
	);
});

test('release preparation refuses invalid versions and unsynchronized inputs', () => {
	for (const version of ['v1.0.0', '1.0.0-rc.1', 'latest']) {
		assert.throws(() => createSoundscaperReleasePreparation(documents(), version), /stable version/iu);
	}
	const drifted = documents();
	drifted.packageLock.packages[''].version = '0.0.0';
	assert.throws(() => createSoundscaperReleasePreparation(drifted, '1.0.0'), /synchronized/iu);
});

test('release preparation CLI accepts exactly one stable version', () => {
	assert.deepEqual(parseSoundscaperReleasePrepareArguments(['1.2.3']), { version: '1.2.3' });
	for (const args of [[], ['1.0.0', 'extra'], ['--version=1.0.0']]) {
		assert.throws(() => parseSoundscaperReleasePrepareArguments(args), /one stable version/iu);
	}
});

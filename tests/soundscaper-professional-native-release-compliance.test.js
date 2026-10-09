/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	soundscaperProfessionalNativeNoticeSummary,
} from '../scripts/lib/soundscaper-professional-native-notices.mjs';
import {
	stageSoundscaperProfessionalNativeReleaseCompliance,
} from '../scripts/lib/soundscaper-professional-native-release-compliance.mjs';
import {
	soundscaperProfessionalNativeSourceIdsForTarget,
} from '../scripts/lib/soundscaper-professional-native-build-result-contract.mjs';

const TARGETS = ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'];
const FORBIDDEN = ['x264', 'x265', 'libvpx', 'libopus'];
const BASE_NOTICES = '# Third-party licenses\n\nExisting browser notices.\n';

test('Stable assembly embeds authenticated native texts in one third-party license document', async (context) => {
	const fixture = await releaseFixture(context);
	const result = await stageSoundscaperProfessionalNativeReleaseCompliance({
		repositoryRoot: fixture.repositoryRoot,
		sourceRoot: fixture.sourceRoot,
		outputRoot: fixture.outputRoot,
		runtimeManifests: fixture.runtimeManifests,
	}, fixture.dependencies);
	assert.equal(result.status, 'authenticated');
	assert.equal(Object.hasOwn(result, 'legalApproval'), false);
	assert.deepEqual(result.sources.map(({ id }) => id).sort(),
		['ara-api', 'ara-library', 'asio-sdk', 'clap', 'electron-node-api-headers', 'juce', 'ladspa-sdk', 'lv2',
			'vamp-plugin-sdk', 'vst3-sdk']);
	assert.equal(result.sources.some(({ id }) => FORBIDDEN.includes(id)), false);
	assert.equal(result.targetBindings.length, 5);
	const outputNames = (await readdir(fixture.outputRoot)).sort();
	assert.equal(outputNames.filter((name) => name.includes('-source-')).length, 10);
	assert.equal(outputNames.some((name) => name.includes('-native-notice-')), false);
	assert.equal(outputNames.length, 12);
	assert.equal(outputNames.some((name) => /x264|x265|libvpx|libopus/iu.test(name)), false);
	assert.equal(outputNames.includes('Soundscaper-professional-native-compliance.json'), true);
	for (const name of outputNames) assert.equal((await lstat(join(fixture.outputRoot, name))).isSymbolicLink(), false);
	const compliance = JSON.parse(await readFile(
		join(fixture.outputRoot, 'Soundscaper-professional-native-compliance.json'), 'utf8',
	));
	assert.equal(Object.hasOwn(compliance, 'legalApproval'), false);
	assert.deepEqual(compliance.sources.map(({ archive }) => archive.sha256),
		result.sources.map(({ archive }) => archive.sha256));
	assert.equal(compliance.schemaVersion, 2);
	const document = await readFile(join(fixture.outputRoot, 'THIRD_PARTY_LICENSES.md'));
	assert.equal(document.subarray(0, Buffer.byteLength(BASE_NOTICES)).toString(), BASE_NOTICES);
	assert.match(document.toString(), /\n`{7}text\n/u);
	assert.deepEqual(compliance.noticeDocument, { name: 'THIRD_PARTY_LICENSES.md', ...descriptor(document) });
	assert.equal(compliance.notices.length, fixture.sourceRegister.sources.length);
	for (const notice of compliance.notices) {
		const source = fixture.sourceRegister.sources.find(({ id }) => id === notice.sourceId);
		assert.deepEqual(document.subarray(notice.byteOffset, notice.byteOffset + notice.byteLength),
			source.noticeBytes);
		assert.deepEqual(descriptor(source.noticeBytes), { byteLength: notice.byteLength, sha256: notice.sha256 });
		assert.equal(notice.installedName, `${source.id}.txt`);
		assert.equal(Object.hasOwn(notice, 'name'), false);
	}
});

test('Framescaper release assembly publishes the same pinned audio-host sources and notices', async (context) => {
	const fixture = await releaseFixture(context);
	for (const manifest of fixture.runtimeManifests) {
		manifest.name = manifest.name.replace('soundscaper', 'framescaper');
		manifest.value.productId = 'framescaper';
		manifest.value.releaseChannel = 'nightly';
		manifest.value.applicationVersionChannel = 'nightly';
		manifest.value.soundscaperProfessionalNative.hostingScope = 'audio-plugin-host';
		delete manifest.bytes;
	}
	const result = await stageSoundscaperProfessionalNativeReleaseCompliance({
		repositoryRoot: fixture.repositoryRoot, sourceRoot: fixture.sourceRoot,
		outputRoot: fixture.outputRoot, runtimeManifests: fixture.runtimeManifests, productId: 'framescaper',
	}, fixture.dependencies);
	assert.equal(result.kind, 'framescaper-professional-native-release-compliance');
	assert.equal(result.sources.length, 10);
	assert.equal((await readdir(fixture.outputRoot)).every((name) =>
		name.startsWith('Framescaper-') || name === 'THIRD_PARTY_LICENSES.md'), true);
});

test('suite assembly shares one native license document across both product receipts', async (context) => {
	const fixture = await releaseFixture(context);
	const options = {
		repositoryRoot: fixture.repositoryRoot, sourceRoot: fixture.sourceRoot,
		outputRoot: fixture.outputRoot, runtimeManifests: fixture.runtimeManifests,
	};
	const soundscaper = await stageSoundscaperProfessionalNativeReleaseCompliance(options, fixture.dependencies);
	const originalDocument = await readFile(join(fixture.outputRoot, 'THIRD_PARTY_LICENSES.md'));
	const framescaperManifests = fixture.runtimeManifests.map(({ name, value }) => ({
		name: name.replace('soundscaper', 'framescaper'),
		value: {
			...value, productId: 'framescaper',
			soundscaperProfessionalNative: { ...value.soundscaperProfessionalNative, hostingScope: 'audio-plugin-host' },
		},
	}));
	const framescaper = await stageSoundscaperProfessionalNativeReleaseCompliance({
		...options, productId: 'framescaper', runtimeManifests: framescaperManifests,
	}, fixture.dependencies);
	assert.deepEqual(framescaper.noticeDocument, soundscaper.noticeDocument);
	assert.deepEqual(framescaper.notices, soundscaper.notices);
	assert.deepEqual(await readFile(join(fixture.outputRoot, 'THIRD_PARTY_LICENSES.md')), originalDocument);
	assert.equal((await readdir(fixture.outputRoot)).length, 23);
});

test('release assembly refuses a changed or symbolic consolidated notice document', async (context) => {
	for (const failure of ['changed', 'symbolic']) {
		const fixture = await releaseFixture(context);
		const document = join(fixture.outputRoot, 'THIRD_PARTY_LICENSES.md');
		if (failure === 'symbolic') {
			await symlink(join(fixture.repositoryRoot, 'THIRD_PARTY_LICENSES.md'), document);
		} else {
			await writeFile(document, 'different notices');
		}
		await assert.rejects(stageSoundscaperProfessionalNativeReleaseCompliance({
			repositoryRoot: fixture.repositoryRoot, sourceRoot: fixture.sourceRoot,
			outputRoot: fixture.outputRoot, runtimeManifests: fixture.runtimeManifests,
		}, fixture.dependencies), /third.party license document/iu, failure);
	}
});

test('Stable compliance assembly refuses Frames source input, symbolic archives, and receipt drift', async (context) => {
	for (const failure of ['frames-source', 'symbolic-archive', 'receipt-drift', 'manifest-bytes', 'notice-bytes']) {
		const fixture = await releaseFixture(context);
		if (failure === 'frames-source') {
			await mkdir(join(fixture.sourceRoot, 'x264'));
		} else if (failure === 'symbolic-archive') {
			const source = fixture.sourceRegister.sources[0];
			const archive = join(fixture.sourceRoot, source.id, source.archive.fileName);
			await rm(archive);
			await writeFile(join(fixture.repositoryRoot, 'foreign-archive'), source.archive.bytes);
			await symlink(join(fixture.repositoryRoot, 'foreign-archive'), archive);
		} else if (failure === 'receipt-drift') {
			fixture.runtimeManifests[0].value.soundscaperProfessionalNative
				.sourceAuthentication.sources[0].archiveEvidence.sha256 = '0'.repeat(64);
		} else if (failure === 'notice-bytes') {
			const source = fixture.sourceRegister.sources[0];
			await writeFile(join(fixture.sourceRoot, source.id, 'source', `${source.id}.txt`), 'different notice');
		} else {
			fixture.runtimeManifests[0].bytes = Buffer.from('{}\n');
		}
		await assert.rejects(stageSoundscaperProfessionalNativeReleaseCompliance({
			repositoryRoot: fixture.repositoryRoot,
			sourceRoot: fixture.sourceRoot,
			outputRoot: fixture.outputRoot,
			runtimeManifests: fixture.runtimeManifests,
		}, fixture.dependencies), /unexpected|symbolic|regular file|source authentication|archive|disagree|notice/iu, failure);
	}
});

test('the Stable desktop assembler invokes professional compliance only with its source root', async () => {
	const source = await readFile(new URL('../scripts/desktop-release-assets.mjs', import.meta.url), 'utf8');
	assert.match(source, /stageSoundscaperProfessionalNativeReleaseCompliance\(\{/u);
	assert.match(source, /professionalProducts = stableSoundscaper/u);
	assert.doesNotMatch(source, /admissionProfile|effectiveAdmissionProfile/iu);
	assert.match(source, /SOUNDSCAPER_M5_NATIVE_SOURCE_ROOT/u);
	assert.match(source, /runtimeManifests: manifests/u);
});

async function releaseFixture(context) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-professional-release-compliance-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const repositoryRoot = join(root, 'repository');
	const sourceRoot = join(root, 'sources');
	const outputRoot = join(root, 'output');
	await Promise.all([mkdir(repositoryRoot), mkdir(sourceRoot), mkdir(outputRoot)]);
	await writeFile(join(repositoryRoot, 'THIRD_PARTY_LICENSES.md'), BASE_NOTICES);
	const { sourceRegister, noticeRegister } = fixtureRegisters();
	for (const source of sourceRegister.sources) {
		const entry = join(sourceRoot, source.id);
		await mkdir(join(entry, 'source'), { recursive: true });
		await writeFile(join(entry, source.archive.fileName), source.archive.bytes);
		await writeFile(join(entry, 'source', `${source.id}.txt`), source.noticeBytes);
	}
	const runtimeManifests = TARGETS.map((target) => {
		const authentication = sourceAuthentication(sourceRegister, target);
		const summary = soundscaperProfessionalNativeNoticeSummary({
			target, sourceAuthentication: authentication,
		}, { sourceRegister, noticeRegister });
		const value = {
			productId: 'soundscaper', target: targetRecord(target),
			applicationVersionChannel: 'stable', releaseChannel: 'stable',
			desktopNotices: { professionalNative: summary },
			soundscaperProfessionalNative: {
				target, status: 'built', sourceAuthentication: authentication,
			},
		};
		const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
		return { name: `runtime-manifest-soundscaper-${target}.json`, value, bytes };
	});
	return {
		repositoryRoot, sourceRoot, outputRoot, runtimeManifests, sourceRegister, noticeRegister,
		dependencies: {
			sourceRegister, noticeRegister,
			authenticateSourceInput: ({ sourceId }) => {
				const source = sourceRegister.sources.find(({ id }) => id === sourceId);
				return { id: sourceId, archive: descriptor(source.archive.bytes), extractedTree: source.extractedTree };
			},
		},
	};
}

function fixtureRegisters() {
	const ids = [
		'electron-node-api-headers', 'juce', 'clap', 'vst3-sdk', 'vamp-plugin-sdk', 'ara-api', 'ara-library',
		'asio-sdk', 'ladspa-sdk', 'lv2',
	];
	const sources = ids.map((id, index) => {
		const archiveBytes = Buffer.from(`archive-${id}`);
		const noticeBytes = Buffer.from(`notice-${id}\r\nCopyright © Fixture\r\n\`\`\`\`\`\`\r\n`);
		return {
			id, version: `v${index + 1}`, licenseSelection: 'test-license',
			archive: { fileName: `${id}.tar.gz`, ...descriptor(archiveBytes), bytes: archiveBytes },
			extractedTree: {
				algorithm: 'framescaper-portable-source-tree-sha256-v1',
				fileCount: 1, sha256: sha256(noticeBytes),
			},
			noticeBytes,
		};
	});
	return {
		sourceRegister: { schemaVersion: 1, sources },
		noticeRegister: {
			schemaVersion: 1, id: 'fixture-notices-v1',
			sources: sources.map((source) => ({
				id: source.id,
				targets: TARGETS.filter((target) =>
					soundscaperProfessionalNativeSourceIdsForTarget(target).includes(source.id)),
				notices: [{
					name: `${source.id}.txt`, origin: 'authenticated-source',
					path: `${source.id}.txt`, ...descriptor(source.noticeBytes),
				}],
			})),
		},
	};
}

function sourceAuthentication(register, target) {
	return {
		schemaVersion: 1, status: 'authenticated',
		sources: soundscaperProfessionalNativeSourceIdsForTarget(target).map((id) => {
			const source = register.sources.find((entry) => entry.id === id);
			return {
				id, authenticationStatus: 'authenticated',
				archiveEvidence: { byteLength: source.archive.byteLength, sha256: source.archive.sha256 },
				extractedTreeEvidence: { ...source.extractedTree },
			};
		}),
	};
}

function targetRecord(target) {
	const [platform, arch] = target.split('-');
	return { platform, arch };
}

function descriptor(bytes) { return { byteLength: bytes.byteLength, sha256: sha256(bytes) }; }
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

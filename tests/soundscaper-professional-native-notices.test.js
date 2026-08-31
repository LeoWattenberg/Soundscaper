/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import sourceRegister from '../config/milestone-5-native-source-acquisitions.json' with { type: 'json' };
import {
	soundscaperProfessionalNativeNoticeSummary,
	stageSoundscaperProfessionalNativePackageNotices,
	typedUnavailableSoundscaperProfessionalNativeNotices,
} from '../scripts/lib/soundscaper-professional-native-notices.mjs';
import {
	soundscaperProfessionalNativeSourceIdsForTarget,
} from '../scripts/lib/soundscaper-professional-native-build-result-contract.mjs';

const TARGETS = ['linux-x64', 'linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64'];

test('professional-native notice summaries are exact, target-specific, and receipt-bound', () => {
	for (const target of TARGETS) {
		const authentication = sourceAuthentication(sourceRegister, target);
		const summary = soundscaperProfessionalNativeNoticeSummary({
			target, sourceAuthentication: authentication,
		});
		assert.equal(summary.status, 'authenticated');
		assert.equal(summary.target, target);
		assert.equal(summary.legalApproval, null);
		assert.deepEqual(summary.sources.map(({ id }) => id),
			soundscaperProfessionalNativeSourceIdsForTarget(target));
		assert.equal(summary.sources.some(({ id }) => ['x264', 'x265', 'libvpx', 'libopus'].includes(id)), false);
		assert.equal(summary.notices.some(({ name }) => name === 'AGPL-3.0.txt'), true);
		assert.equal(summary.notices.some(({ name }) => name === 'ASIO-SDK-LICENSE.txt'),
			target.startsWith('win-'));
		assert.equal(summary.notices.some(({ name }) => name === 'LV2-ISC.txt'),
			target.startsWith('linux-'));
	}
	const tampered = sourceAuthentication(sourceRegister, 'win-x64');
	tampered.sources[0].archiveEvidence.sha256 = '0'.repeat(64);
	assert.throws(() => soundscaperProfessionalNativeNoticeSummary({
		target: 'win-x64', sourceAuthentication: tampered,
	}), /source authentication|archive/iu);
});

test('preview notice state stays explicitly unavailable and cannot claim legal approval', () => {
	assert.deepEqual(typedUnavailableSoundscaperProfessionalNativeNotices('mac-arm64'), {
		schemaVersion: 1,
		status: 'typed-unavailable',
		target: 'mac-arm64',
		inventoryId: null,
		legalApproval: null,
		blockedBy: 'Professional-native installed notices are emitted only by Stable Soundscaper packaging.',
		sources: [],
		notices: [],
	});
});

test('Stable package staging installs exactly the authenticated target notice inventory', async (context) => {
	const fixture = await noticeFixture(context, 'linux-x64');
	const summary = await stageSoundscaperProfessionalNativePackageNotices({
		repositoryRoot: fixture.repositoryRoot,
		sourceRoot: fixture.sourceRoot,
		outputRoot: fixture.outputRoot,
		target: 'linux-x64',
		sourceAuthentication: fixture.sourceAuthentication,
	}, fixture.dependencies);
	assert.equal(summary.status, 'authenticated');
	assert.deepEqual((await readdir(fixture.outputRoot)).sort(),
		summary.notices.map(({ name }) => name).sort());
	for (const notice of summary.notices) {
		const bytes = await readFile(join(fixture.outputRoot, notice.name));
		assert.equal(bytes.byteLength, notice.byteLength);
		assert.equal(sha256(bytes), notice.sha256);
	}

	const symbolic = await noticeFixture(context, 'linux-x64');
	const sourceId = symbolic.sourceAuthentication.sources[0].id;
	const notice = symbolic.noticeRegister.sources.find(({ id }) => id === sourceId).notices[0];
	const noticePath = join(symbolic.sourceRoot, sourceId, 'source', notice.path);
	await writeFile(join(symbolic.repositoryRoot, 'foreign-notice'), 'foreign');
	await rm(noticePath);
	await symlink(join(symbolic.repositoryRoot, 'foreign-notice'), noticePath);
	await assert.rejects(stageSoundscaperProfessionalNativePackageNotices({
		repositoryRoot: symbolic.repositoryRoot,
		sourceRoot: symbolic.sourceRoot,
		outputRoot: symbolic.outputRoot,
		target: 'linux-x64',
		sourceAuthentication: symbolic.sourceAuthentication,
	}, symbolic.dependencies), /symbolic|regular file/iu);
});

async function noticeFixture(context, target) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-professional-notices-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const repositoryRoot = join(root, 'repository');
	const sourceRoot = join(root, 'sources');
	const outputRoot = join(root, 'output');
	await Promise.all([mkdir(repositoryRoot), mkdir(sourceRoot), mkdir(outputRoot)]);
	const registers = fixtureRegisters();
	for (const source of registers.sourceRegister.sources) {
		const entry = join(sourceRoot, source.id);
		await mkdir(join(entry, 'source'), { recursive: true });
		await writeFile(join(entry, source.archive.fileName), source.archive.bytes);
		await writeFile(join(entry, 'source', `${source.id}.txt`), source.noticeBytes);
	}
	const dependencies = {
		sourceRegister: registers.sourceRegister,
		noticeRegister: registers.noticeRegister,
		authenticateSourceInput: ({ sourceId }) => {
			const source = registers.sourceRegister.sources.find(({ id }) => id === sourceId);
			return {
				id: sourceId,
				archive: descriptor(source.archive.bytes),
				extractedTree: { ...source.extractedTree },
			};
		},
	};
	return {
		repositoryRoot, sourceRoot, outputRoot, dependencies,
		sourceRegister: registers.sourceRegister,
		noticeRegister: registers.noticeRegister,
		sourceAuthentication: sourceAuthentication(registers.sourceRegister, target),
	};
}

function fixtureRegisters() {
	const ids = ['electron-node-api-headers', 'juce', 'clap', 'vst3-sdk', 'asio-sdk', 'lv2'];
	const sources = ids.map((id, index) => {
		const archiveBytes = Buffer.from(`archive-${id}`);
		const noticeBytes = Buffer.from(`notice-${id}`);
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
			schemaVersion: 1, id: 'fixture-notices-v1', legalApproval: null,
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
		schemaVersion: 1,
		status: 'authenticated',
		sources: soundscaperProfessionalNativeSourceIdsForTarget(target).map((id) => {
			const source = register.sources.find((entry) => entry.id === id);
			return {
				id,
				authenticationStatus: 'authenticated',
				archiveEvidence: {
					byteLength: source.archive.byteLength, sha256: source.archive.sha256,
				},
				extractedTreeEvidence: { ...source.extractedTree },
			};
		}),
	};
}

function descriptor(bytes) {
	return { byteLength: bytes.byteLength, sha256: sha256(bytes) };
}

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

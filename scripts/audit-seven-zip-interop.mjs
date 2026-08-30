/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
	createSevenZipStemArchivePlan,
	createStreamingStemArchive,
} from '../src/common/editor/controller/stem-archive.ts';
import {
	SEVEN_ZIP_COPY_GOLDEN_BASE64,
	SEVEN_ZIP_COPY_GOLDEN_PROVENANCE,
	SEVEN_ZIP_COPY_GOLDEN_SHA256,
} from '../tests/fixtures/seven-zip-copy-golden.ts';

const execFileAsync = promisify(execFile);
const COPY = {
	temporaryExportClosed: 'temporary export closed',
	largeStemsStorageRequired: 'large stems require persistent storage',
	stemArchiveClosed: 'stem archive closed',
};
const LIBARCHIVE_READER = fileURLToPath(new URL('./lib/read-libarchive.py', import.meta.url));
const REQUIRE_NATIVE = process.argv.includes('--require-native');

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'soundscaper-seven-zip-audit-'));
try {
	const generated = await generateGoldenArchive();
	const golden = Buffer.from(SEVEN_ZIP_COPY_GOLDEN_BASE64, 'base64');
	assert.deepEqual(generated, golden);
	assert.equal(generated.byteLength, SEVEN_ZIP_COPY_GOLDEN_PROVENANCE.byteLength);
	assert.equal(sha256(generated), SEVEN_ZIP_COPY_GOLDEN_SHA256);

	const archivePath = join(temporaryDirectory, 'soundscaper-copy-golden.7z');
	await writeFile(archivePath, generated);
	const expectedEntries = SEVEN_ZIP_COPY_GOLDEN_PROVENANCE.entries.map((entry) => ({
		fileName: entry.fileName,
		bytes: Buffer.from(entry.bytes),
	}));
	const sevenZip = await auditSevenZip(archivePath, expectedEntries);
	const libarchive = await auditLibarchive(archivePath, expectedEntries);
	const report = {
		fixture: {
			byteLength: generated.byteLength,
			sha256: SEVEN_ZIP_COPY_GOLDEN_SHA256,
		},
		sevenZip,
		libarchive,
		nativeInteropPassed: sevenZip.status === 'passed' && libarchive.status === 'passed',
	};
	console.log(JSON.stringify(report, null, 2));
	if (REQUIRE_NATIVE && !report.nativeInteropPassed) process.exitCode = 2;
} finally {
	await rm(temporaryDirectory, { force: true, recursive: true });
}

async function generateGoldenArchive() {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { storage: {} } });
	try {
		const plan = createSevenZipStemArchivePlan('session', [
			{ fileName: 'lead.wav', expectedByteLength: 3 },
			{ fileName: 'Bäs.wav', expectedByteLength: 2 },
		]);
		const archive = await createStreamingStemArchive(plan, COPY);
		await archive.add('lead.wav', Uint8Array.of(1, 2, 3));
		await archive.add('Bäs.wav', Uint8Array.of(4, 5));
		const result = await archive.finish();
		try {
			return Buffer.from(await result.blob.arrayBuffer());
		} finally {
			await result.cleanup();
		}
	} finally {
		if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
		else Reflect.deleteProperty(globalThis, 'navigator');
	}
}

async function auditSevenZip(archivePath, expectedEntries) {
	const executable = process.env.SEVEN_ZIP_BIN || '7zz';
	let information;
	try {
		information = await run(executable, ['i']);
	} catch (error) {
		if (!isUnavailable(error)) throw error;
		return { status: 'unavailable', reason: String(error.message || error) };
	}
	await run(executable, ['t', '-bd', '-y', archivePath]);
	const extractionDirectory = join(temporaryDirectory, 'seven-zip');
	await mkdir(extractionDirectory);
	await run(executable, ['x', '-bd', '-y', `-o${extractionDirectory}`, archivePath]);
	await assertExtractedEntries(extractionDirectory, expectedEntries);
	return {
		status: 'passed',
		version: information.split('\n').find((line) => line.trim())?.trim() || executable,
	};
}

async function auditLibarchive(archivePath, expectedEntries) {
	const executable = process.env.LIBARCHIVE_PYTHON_BIN || 'python3';
	try {
		const output = await run(executable, [LIBARCHIVE_READER, archivePath]);
		const report = JSON.parse(output);
		assert.deepEqual(report.entries.map((entry) => ({
			fileName: entry.fileName,
			bytes: Buffer.from(entry.base64, 'base64'),
		})), expectedEntries);
		return { status: 'passed', version: report.version };
	} catch (error) {
		if (!isUnavailable(error)) throw error;
		return { status: 'unavailable', reason: String(error.message || error) };
	}
}

async function assertExtractedEntries(directory, expectedEntries) {
	for (const entry of expectedEntries) {
		assert.deepEqual(await readFile(join(directory, entry.fileName)), entry.bytes);
	}
}

async function run(executable, arguments_) {
	const { stdout } = await execFileAsync(executable, arguments_, {
		encoding: 'utf8',
		maxBuffer: 4 * 1024 * 1024,
	});
	return stdout;
}

function isUnavailable(error) {
	return error?.code === 'ENOENT'
		|| /cannot open shared object file|No such file or directory/u.test(String(error?.stderr || error?.message || error));
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

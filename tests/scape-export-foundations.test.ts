/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import * as limits from '../src/common/editor/scape-archive-limits.ts';
import * as legacyEnvelope from '../src/common/editor/scape-archive-envelope.ts';
import * as bytes from '../src/common/editor/scape-byte-stream.ts';
import * as legacyMedia from '../src/common/editor/scape-archive-media.ts';
import { maximumScapeStoreArchiveBytes } from '../src/common/editor/scape-export-estimate.ts';
import { maximumScapeStoreCentralDirectoryBytes } from '../src/common/editor/scape-archive-zip-profile.ts';
import { DESKTOP_EXPECTED_RUNTIME_FILES } from '../scripts/lib/desktop-project-library-runtime.mjs';
import { DESKTOP_PROJECT_LIBRARY_BASELINE_RUNTIME_FILES } from '../scripts/lib/desktop-project-library-baseline-runtime-files.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const EDITOR = 'src/common/editor/';
const FOUNDATIONS = ['scape-archive-limits.ts', 'scape-byte-stream.ts', 'scape-export-estimate.ts',
	'scape-archive-zip-profile.ts', 'scape-blob-budget.ts'];

test('neutral archive limits preserve the exact frozen format-1 public contract', () => {
	assert.equal(limits.SCAPE_FORMAT, 'scape-project');
	assert.equal(limits.SCAPE_FORMAT_VERSION, 1);
	assert.equal(limits.SCAPE_MANIFEST_ENTRY, 'manifest.json');
	assert.equal(limits.SCAPE_PROJECT_ENTRY, 'project.json');
	const expected: Readonly<limits.ScapeArchiveLimits> = {
		maximumEntryCount: 4_096,
		maximumManifestBytes: 32 * 1024 * 1024,
		maximumProjectBytes: 256 * 1024 * 1024,
		maximumExpandedBytes: 64 * 1024 * 1024 * 1024,
	};
	assert.deepEqual(limits.SCAPE_ARCHIVE_LIMITS, expected);
	assert.equal(Object.isFrozen(limits.SCAPE_ARCHIVE_LIMITS), true);
	for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
		assert.equal(legacyEnvelope[key], limits[key], key);
	}
});

test('byte and digest exports share their implementation with the existing media API', () => {
	for (const key of Object.keys(bytes) as (keyof typeof bytes)[]) {
		assert.equal(legacyMedia[key], bytes[key], key);
	}
	assert.equal(bytes.scapeHex(Uint8Array.of(0, 1, 15, 16, 255)), '00010f10ff');
	assert.equal(bytes.digestScapeBytes(new Uint8Array()),
		'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
	const input = new TextEncoder().encode('abc');
	assert.equal(bytes.digestScapeBytes(input),
		'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
	const digest = bytes.createScapeDigest();
	digest.update(input.subarray(0, 1));
	digest.update(input.subarray(1));
	assert.equal(bytes.scapeHex(digest.digest()), bytes.digestScapeBytes(input));
});

test('byte streams snapshot exactly the supplied view before later source mutation', async () => {
	const backing = Uint8Array.of(99, 0, 17, 255, 88);
	const stream = bytes.scapeBytesStream(backing.subarray(1, 4));
	backing.fill(42);
	assert.deepEqual(new Uint8Array(await new Response(stream).arrayBuffer()), Uint8Array.of(0, 17, 255));
	assert.equal((await new Response(bytes.scapeBytesStream(new Uint8Array())).arrayBuffer()).byteLength, 0);
});

test('archive estimates retain the UTF-8 profile and entry-count ceilings', () => {
	const entries = [{ filename: 'média/ß.bin', payloadBytes: 13 }];
	const filenameBytes = new TextEncoder().encode(entries[0]!.filename).byteLength;
	assert.equal(maximumScapeStoreArchiveBytes(entries), 98 + 238 + 13 + 2 * filenameBytes);
	assert.equal(maximumScapeStoreCentralDirectoryBytes(entries), 46 + 65 + 8 + filenameBytes);
	const tooMany = Array.from({ length: limits.SCAPE_ARCHIVE_LIMITS.maximumEntryCount + 1 },
		(_, index) => ({ filename: String(index), payloadBytes: 0 }));
	assert.throws(() => maximumScapeStoreArchiveBytes(tooMany), /too many entries/iu);
	assert.throws(() => maximumScapeStoreCentralDirectoryBytes(tooMany), /too many entries/iu);
});

test('the actual emitted export foundation graph contains only neutral leaves and SHA-256', () => {
	const pending = FOUNDATIONS.map(name => EDITOR + name), seen = new Set<string>(), packages = new Set<string>();
	while (pending.length) {
		const member = pending.pop()!;
		if (seen.has(member)) continue;
		seen.add(member);
		for (const specifier of emittedDependencies(member)) {
			if (specifier.startsWith('.')) {
				pending.push(relative(ROOT, resolve(ROOT, dirname(member), specifier)).split(sep).join('/').replace(/\.js$/u, '.ts'));
			} else packages.add(specifier);
		}
	}
	assert.deepEqual([...seen].sort(), FOUNDATIONS.map(name => EDITOR + name).sort());
	assert.deepEqual([...packages], ['@noble/hashes/sha2.js']);
});

test('existing desktop archive modules emit references to staged neutral leaf files', () => {
	for (const [owner, leaf] of [['scape-archive-envelope.ts', 'scape-archive-limits'],
		['scape-archive-media.ts', 'scape-byte-stream']] as const) {
		assert.ok(emittedDependencies(EDITOR + owner).includes(`./${leaf}.js`));
		const output = EDITOR + leaf + '.js';
		assert.ok(DESKTOP_PROJECT_LIBRARY_BASELINE_RUNTIME_FILES.includes(output), output);
		assert.ok(DESKTOP_EXPECTED_RUNTIME_FILES.includes(output), output);
	}
});

function emittedDependencies(member: string): string[] {
	const output = ts.transpileModule(readFileSync(resolve(ROOT, member), 'utf8'), {
		fileName: member,
		compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2024,
			rewriteRelativeImportExtensions: true },
	}).outputText;
	const parsed = ts.createSourceFile(member, output, ts.ScriptTarget.ES2024);
	const specifiers: string[] = [];
	for (const statement of parsed.statements) {
		if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
		if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) specifiers.push(statement.moduleSpecifier.text);
	}
	return specifiers;
}

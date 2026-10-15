#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { auditLightscaperLibRawWasmV1 } from './audit-lightscaper-libraw-wasm.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'config/lightscaper-libraw-runtime-manifest.json'), 'utf8'));
const arguments_ = process.argv.slice(2);
if (arguments_.length !== 0 && (arguments_.length !== 2 || arguments_[0] !== '--output' || !arguments_[1])) {
	throw new Error('Usage: node scripts/package-lightscaper-libraw-source.mjs [--output PATH]');
}
const output = resolve(root, arguments_[1] ?? 'runtime-assets/libraw/0.22.2/corresponding-source.tar.gz');
const findings = await auditLightscaperLibRawWasmV1();
if (findings.length) throw new Error(`LibRaw source packaging requires a passing audit:\n${findings.join('\n')}`);
const files = [...new Set([
	'LICENSE', 'config/lightscaper-libraw-runtime-manifest.json', manifest.upstream.sourceArchive.path, manifest.bridge.path,
	manifest.buildRecipe.path, 'scripts/lib/wasm-binary-inspection.mjs',
	'scripts/audit-lightscaper-libraw-wasm.mjs', 'scripts/package-lightscaper-libraw-source.mjs',
	'src/common/editor/raw/NOTICE.md', 'docs/architecture/lightscaper-raw-decoder.md',
	...manifest.licenseFiles.map(file => file.path),
])].sort();
if (files.some(path => typeof path !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(path) || path.startsWith('/') || path.split('/').includes('..'))) {
	throw new Error('LibRaw source bundle requires a closed relative file inventory.');
}
const temporary = mkdtempSync(join(tmpdir(), 'lightscaper-libraw-source-'));
try {
	const inventory = join(temporary, 'files.txt'), tar = join(temporary, 'source.tar');
	writeFileSync(inventory, `${files.join('\n')}\n`);
	const packed = spawnSync('tar', ['--format=ustar', '--sort=name', `--mtime=@${manifest.toolchain.sourceDateEpoch}`,
		'--owner=0', '--group=0', '--numeric-owner', '--mode=0644', '--no-recursion',
		'--transform=s|^|lightscaper-libraw-source/|', '-cf', tar, '-T', inventory], { cwd: root, encoding: 'utf8' });
	if (packed.error) throw packed.error;
	if (packed.status !== 0) throw new Error(`LibRaw source archive failed: ${packed.stderr}`);
	const bytes = gzipSync(readFileSync(tar), { level: 9 });
	const hash = createHash('sha256').update(bytes).digest('hex');
	mkdirSync(dirname(output), { recursive: true });
	const pending = `${output}.${process.pid}.tmp`;
	try { writeFileSync(pending, bytes, { flag: 'wx' }); renameSync(pending, output); }
	finally { rmSync(pending, { force: true }); }
	writeFileSync(`${output}.sha256`, `${hash}  ${output.split('/').at(-1)}\n`);
	process.stdout.write(`${JSON.stringify({ path: output, byteLength: bytes.byteLength, sha256: hash, files })}\n`);
} finally { rmSync(temporary, { recursive: true, force: true }); }

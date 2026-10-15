/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import manifest from '../config/lightscaper-libraw-recovery-runtime-manifest.json' with { type: 'json' };
import { auditLightscaperLibRawRecoveryWasmV2 } from '../scripts/audit-lightscaper-libraw-recovery-wasm.mjs';
import { LIBRAW_ALLOWED_IMPORTS_V2, LIBRAW_AUXILIARY_EXPORTS_V2,
	LIBRAW_REQUIRED_EXPORTS_V2 } from '../src/common/editor/raw/libraw-wasm-instance-v2.ts';

const SOURCE = 'runtime-assets/libraw/0.22.2/recovery-abi2/corresponding-source.tar.gz';
const PREFIX = 'lightscaper-libraw-recovery-source/';
const LICENSES = ['COMPILER_RT.txt', 'COPYRIGHT', 'EMSCRIPTEN.txt', 'LIBCXX.txt', 'LIBCXXABI.txt', 'LICENSE.CDDL', 'LICENSE.LGPL', 'MUSL.txt'];
// This independent redistribution inventory deliberately does not import or
// execute the packager's file-list construction. A valid runtime audit alone
// cannot prove that its corresponding-source download is complete or current.
const EXPECTED_SOURCE_FILES = [
	'LICENSE',
	'config/lightscaper-libraw-recovery-runtime-manifest.json',
	'docs/architecture/lightscaper-raw-recovery.md',
	'runtime-assets/libraw/0.22.2/LibRaw-0.22.2.tar.gz',
	'scripts/audit-lightscaper-libraw-recovery-wasm.mjs',
	'scripts/build-lightscaper-libraw-recovery-wasm.mjs',
	'scripts/lib/lightscaper-libraw-recovery-profile.mjs',
	'scripts/lib/wasm-binary-inspection.mjs',
	'scripts/package-lightscaper-libraw-recovery-source.mjs',
	'src/common/editor/raw/RECOVERY-NOTICE.md',
	'src/common/editor/raw/native/libraw_recovery_wasm.cpp',
	...LICENSES.map(name => `src/common/editor/raw/licenses/${name}`),
].sort();

// ABI1's released closure is immutable. ABI2 must remain an adjacent release,
// rather than repinning/repackaging the canonical decoder or its old guide.
const ABI1_RELEASE = [
	['config/lightscaper-libraw-runtime-manifest.json', '4aa8c5377f3b6774cce23f9961c864fae798723a6c09a18dd17aa2f581fb27da'],
	['docs/architecture/lightscaper-raw-decoder.md', '211aa3b01330b5f5ae0b65f23f4c0bee0b3e76b9027f27b793c15a7269c97c94'],
	['runtime-assets/libraw/0.22.2/LibRaw-0.22.2.tar.gz', 'de86b035655accff8d4010f1a221fdf50d353cb7b1422ba26f14a0db92612cfa'],
	['runtime-assets/libraw/0.22.2/corresponding-source.tar.gz', 'c5fa0c9743b2699f8893cdc1597dfa27966bed5b56baabac2b7464c4f827e1c9'],
	['runtime-assets/libraw/0.22.2/corresponding-source.tar.gz.sha256', 'c2b84d204590777bbac26decd56d9981cbad5d88bc89764053c21244912ea4c7'],
	['runtime-assets/libraw/0.22.2/libraw.wasm', '7f9f4e791177114e5224e52c85f7be8b5d79bc5e48e1f87a4f69b1f6edf52c29'],
	['scripts/audit-lightscaper-libraw-wasm.mjs', '3603272393ccf3c9f65a201a6f58c2de329e97ed2d8fcdfcfd2b7889b26a18e1'],
	['scripts/build-lightscaper-libraw-wasm.mjs', '5b76bdd3ca78386a86f3fc90868b31007eb9a23067d8748cc8d76905ac1793a3'],
	['scripts/package-lightscaper-libraw-source.mjs', '7972adbc49f64df84766ea58d735046ee6f4c1e5e912dc30a32bda2508ae38c1'],
	['src/common/editor/raw/NOTICE.md', '87f9943ac79c6b0548f2b0c7a83cba7efbfb3cb80f4fd6350bfb7cf9d459162e'],
	['src/common/editor/raw/licenses/COMPILER_RT.txt', '1a8f1058753f1ba890de984e48f0242a3a5c29a6a8f2ed9fd813f36985387e8d'],
	['src/common/editor/raw/licenses/COPYRIGHT', '574c88f5dd59414cfc896293a63defbc2d525a418ed413d7ab7dcc43cf79c509'],
	['src/common/editor/raw/licenses/EMSCRIPTEN.txt', '620a78084fc7ca97c0b5dea9abf891f3ffcadfdbf305276f099c9c4e12fc1d86'],
	['src/common/editor/raw/licenses/LIBCXX.txt', '539dd7aed86e8a4f12cbdd0e6c50c189c7d74847e4fecc64ce2c6ee3a01da38b'],
	['src/common/editor/raw/licenses/LIBCXXABI.txt', 'e2b35be49f7284a45b7baca8fc7b3ab7440e7902392b2528a457816b5bb2a15c'],
	['src/common/editor/raw/licenses/LICENSE.CDDL', '0e3098d2d54a12434715f6679ea408d57da5e8d613c385c58ecc6fe5d30cc81f'],
	['src/common/editor/raw/licenses/LICENSE.LGPL', 'eea173a556abac0370461e57e12aab266894ea6be3874c2be05fd87871f75449'],
	['src/common/editor/raw/licenses/MUSL.txt', 'f9bc4423732350eb0b3f7ed7e91d530298476f8fec0c6c427a1c04ade22655af'],
	['src/common/editor/raw/native/libraw_wasm.cpp', '98ea306941ddc214548eed1e300c3f4cf1b717e0e29a1e85ec7d4a3b5924eede'],
] as const;

const readRepo = (path: string) => readFile(new URL(`../${path}`, import.meta.url));
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('Recovery publication audits actual source, bridge, build, licenses and the same bounded ABI admitted by the browser', async () => {
	assert.deepEqual(await auditLightscaperLibRawRecoveryWasmV2(), []);
	assert.deepEqual(manifest.profiles, [{ id: 'linear-headroom-v1', highlightMode: 1 }, { id: 'highlight-recovery-v1', highlightMode: 3 }]);
	assert.deepEqual([...manifest.wasm.requiredExports].sort(), [...LIBRAW_REQUIRED_EXPORTS_V2].sort());
	assert.deepEqual([...manifest.wasm.allowedImports].sort(), [...LIBRAW_ALLOWED_IMPORTS_V2].sort());
	assert.deepEqual(manifest.wasm.auxiliaryExports, LIBRAW_AUXILIARY_EXPORTS_V2);
	const bytes = await readRepo(manifest.runtime.path), module = await WebAssembly.compile(bytes);
	assert.equal(bytes.byteLength, manifest.runtime.byteLength); assert.equal(digest(bytes), manifest.runtime.sha256);
	assert.deepEqual(WebAssembly.Module.imports(module).map(entry => `${entry.module}.${entry.name}`).sort(), [...LIBRAW_ALLOWED_IMPORTS_V2].sort());
	assert.deepEqual(WebAssembly.Module.exports(module).map(entry => entry.name).sort(),
		[...LIBRAW_REQUIRED_EXPORTS_V2, ...Object.keys(LIBRAW_AUXILIARY_EXPORTS_V2)].sort());
	assert.ok(!WebAssembly.Module.exports(module).some(entry => entry.name.startsWith('raw_preview')));
	assert.equal(manifest.runtime.path, 'runtime-assets/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm');
	assert.equal(manifest.runtime.url, 'https://assets.soundscaper.org/runtime/libraw/0.22.2/recovery-abi2/libraw-recovery.wasm');
});

test('Recovery publication audit rejects same-length executable substitution and the distinct ABI1 artifact', async () => {
	const temporary = await mkdtemp(join(tmpdir(), 'lightscaper-raw-recovery-publication-'));
	try {
		const bytes = await readRepo(manifest.runtime.path); bytes[0] = bytes[0]! ^ 1;
		const path = join(temporary, 'substitution.wasm'); await writeFile(path, bytes);
		const findings = await auditLightscaperLibRawRecoveryWasmV2({ runtimePath: path });
		assert.ok(findings.some(finding => finding.includes('SHA-256 differs')));
		assert.ok(findings.some(finding => finding.includes('Cannot compile')));
		const legacy = await auditLightscaperLibRawRecoveryWasmV2({ runtimePath: fileURLToPath(new URL('../runtime-assets/libraw/0.22.2/libraw.wasm', import.meta.url)) });
		assert.ok(legacy.some(finding => finding.includes('byte length differs')));
	} finally { await rm(temporary, { recursive: true, force: true }); }
});

test('Recovery corresponding source has its own exact sidecar and complete current redistribution inventory', async () => {
	const compressed = await readRepo(SOURCE), sidecar = await readRepo(`${SOURCE}.sha256`);
	assert.equal(sidecar.toString('utf8'), `${digest(compressed)}  corresponding-source.tar.gz\n`);
	const members = sourceMembers(compressed);
	assert.deepEqual([...members.keys()], EXPECTED_SOURCE_FILES.map(path => `${PREFIX}${path}`));
	for (const path of EXPECTED_SOURCE_FILES) {
		const archived = members.get(`${PREFIX}${path}`); assert.ok(archived, `Missing corresponding source: ${path}`);
		assert.deepEqual(archived, new Uint8Array(await readRepo(path)), `Stale or substituted corresponding source: ${path}`);
	}
	const upstream = members.get(`${PREFIX}${manifest.upstream.sourceArchive.path}`); assert.ok(upstream);
	assert.equal(upstream.byteLength, manifest.upstream.sourceArchive.byteLength); assert.equal(digest(upstream), manifest.upstream.sourceArchive.sha256);
	assert.ok(!members.has(`${PREFIX}src/common/editor/raw/native/libraw_wasm.cpp`));
	assert.ok(!members.has(`${PREFIX}config/lightscaper-libraw-runtime-manifest.json`));
	assert.notEqual(digest(compressed), ABI1_RELEASE.find(([path]) => path === 'runtime-assets/libraw/0.22.2/corresponding-source.tar.gz')![1]);
});

test('Recovery publication preserves all nineteen immutable ABI1 release files byte for byte', async () => {
	assert.equal(ABI1_RELEASE.length, 19);
	for (const [path, expected] of ABI1_RELEASE) assert.equal(digest(await readRepo(path)), expected, `ABI1 release changed: ${path}`);
});

/** Independent POSIX ustar reader: no shell extraction, packager imports or
 * filesystem writes. Reject links/extensions, aliases, duplicates and bad
 * checksums instead of trusting a listing command or the packager's own report. */
function sourceMembers(compressed: Uint8Array): ReadonlyMap<string, Uint8Array<ArrayBuffer>> {
	const tar = new Uint8Array(gunzipSync(compressed, { maxOutputLength: 8 * 1024 * 1024 })), members = new Map<string, Uint8Array<ArrayBuffer>>();
	const decoder = new TextDecoder('utf-8', { fatal: true });
	const text = (header: Uint8Array, offset: number, length: number) => {
		const field = header.subarray(offset, offset + length), end = field.indexOf(0); return decoder.decode(end < 0 ? field : field.subarray(0, end));
	};
	const octal = (header: Uint8Array, offset: number, length: number) => {
		const value = text(header, offset, length).trim(); assert.match(value, /^[0-7]+$/u);
		const result = Number.parseInt(value, 8); assert.ok(Number.isSafeInteger(result)); return result;
	};
	let offset = 0;
	while (offset + 512 <= tar.byteLength) {
		const header = tar.subarray(offset, offset + 512);
		if (header.every(byte => byte === 0)) {
			assert.ok(offset + 1024 <= tar.byteLength, 'ustar requires two closing zero blocks.');
			assert.ok(tar.subarray(offset).every(byte => byte === 0), 'No data may follow the closing archive blocks.'); return members;
		}
		assert.equal(text(header, 257, 6), 'ustar'); assert.equal(text(header, 263, 2), '00');
		assert.ok(header[156] === 0 || header[156] === 48, 'Corresponding source must contain only regular files.');
		let checksum = 0;
		for (let index = 0; index < 512; index++) checksum += index >= 148 && index < 156 ? 32 : header[index]!;
		assert.equal(octal(header, 148, 8), checksum, 'Invalid source archive header checksum.');
		const prefix = text(header, 345, 155), name = `${prefix ? `${prefix}/` : ''}${text(header, 0, 100)}`;
		assert.ok(name.startsWith(PREFIX)); assert.match(name, /^[A-Za-z0-9_./-]+$/u);
		assert.ok(!name.split('/').some(part => part === '..' || part === '.' || part === ''));
		assert.ok(!members.has(name), `Duplicate source archive member: ${name}`);
		assert.equal(octal(header, 100, 8), 0o644); assert.equal(octal(header, 108, 8), 0); assert.equal(octal(header, 116, 8), 0);
		assert.equal(octal(header, 136, 12), Number(manifest.toolchain.sourceDateEpoch));
		const size = octal(header, 124, 12), begin = offset + 512, end = begin + size;
		assert.ok(end <= tar.byteLength, 'Source archive member exceeds its physical extent.');
		members.set(name, tar.subarray(begin, end)); offset = begin + Math.ceil(size / 512) * 512;
	}
	assert.fail('Corresponding source archive is missing its closing blocks.');
}

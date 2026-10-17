/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import manifest from '../config/lightscaper-libraw-runtime-manifest.json' with { type: 'json' };
import { auditLightscaperLibRawWasmV1 } from '../scripts/audit-lightscaper-libraw-wasm.mjs';
import { LIBRAW_ALLOWED_IMPORTS_V1, LIBRAW_AUXILIARY_EXPORTS_V1, LIBRAW_REQUIRED_EXPORTS_V1 } from '../src/common/editor/raw/libraw-wasm-instance-v1.ts';

test('LibRaw publication and browser admission agree on the actual pinned native ABI and import authority', async () => {
	const bytes = await readFile(new URL('../runtime-assets/libraw/0.22.2/libraw.wasm', import.meta.url));
	const module = await WebAssembly.compile(bytes);
	assert.deepEqual([...manifest.wasm.allowedImports].sort(), [...LIBRAW_ALLOWED_IMPORTS_V1].sort());
	assert.deepEqual([...manifest.wasm.requiredExports].sort(), [...LIBRAW_REQUIRED_EXPORTS_V1].sort());
	assert.deepEqual(manifest.wasm.auxiliaryExports, LIBRAW_AUXILIARY_EXPORTS_V1);
	assert.deepEqual(WebAssembly.Module.imports(module).map(item => `${item.module}.${item.name}`).sort(), [...LIBRAW_ALLOWED_IMPORTS_V1].sort());
	assert.deepEqual(await auditLightscaperLibRawWasmV1(), []);
});

test('LibRaw publication audit refuses a same-length executable substitution outside the reviewed runtime digest', async () => {
	const temporary = await mkdtemp(join(tmpdir(), 'lightscaper-raw-publication-'));
	try {
		const bytes = await readFile(new URL('../runtime-assets/libraw/0.22.2/libraw.wasm', import.meta.url));
		bytes[0] = 1; const path = join(temporary, 'substitution.wasm'); await writeFile(path, bytes);
		const findings = await auditLightscaperLibRawWasmV1({ runtimePath: path });
		assert.ok(findings.some(finding => finding.includes('SHA-256 differs')));
		assert.ok(findings.some(finding => finding.includes('Cannot compile')));
	} finally { await rm(temporary, { recursive: true, force: true }); }
});

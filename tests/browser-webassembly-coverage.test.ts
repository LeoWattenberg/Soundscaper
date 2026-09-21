/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createBrowserWebAssemblyAuthenticator } from '../scripts/lib/browser-webassembly-coverage.mjs';

const REVISION = 'a'.repeat(40);
const WASM = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

test('exact inventoried built WebAssembly is admitted for both browser products', async (context) => {
	const workspace = temporaryWorkspace(context);
	for (const [productId, port] of [['soundscaper', 4332], ['framescaper', 4333]] as const) {
		const origin = `http://127.0.0.1:${String(port)}`;
		const outputDirectory = join(workspace, productId);
		writeSite({ origin, outputDirectory, productId });
		const authenticate = authenticator(workspace, [{ origin, outputDirectory, productId }]);
		assert.equal(await authenticate({
			bytes: WASM,
			url: `${origin}/assets/pffft-BbtAeRsi.wasm`,
		}), true);
	}
});

test('built WebAssembly admission rejects URL aliases and unconfigured assets', async (context) => {
	const workspace = temporaryWorkspace(context);
	const origin = 'http://127.0.0.1:4332';
	const outputDirectory = join(workspace, 'soundscaper');
	writeSite({ origin, outputDirectory, productId: 'soundscaper' });
	const authenticate = authenticator(workspace, [{ origin, outputDirectory, productId: 'soundscaper' }]);
	for (const url of [
		`${origin}/assets/pffft-BbtAeRsi.wasm?cache=1`,
		`${origin}/assets/pffft-BbtAeRsi.wasm#fragment`,
		`http://user@127.0.0.1:4332/assets/pffft-BbtAeRsi.wasm`,
		`http://LOCALHOST:4332/assets/pffft-BbtAeRsi.wasm`,
		`${origin}/assets/%70ffft-BbtAeRsi.wasm`,
		`${origin}/assets/../assets/pffft-BbtAeRsi.wasm`,
		`${origin}/assets%2Fpffft-BbtAeRsi.wasm`,
		`${origin}\\assets\\pffft-BbtAeRsi.wasm`,
		`${origin}/assets/Pffft-BbtAeRsi.wasm`,
		`${origin}/assets/unknown.wasm`,
	]) {
		await assert.rejects(authenticate({ bytes: WASM, url }), /unapproved WebAssembly URL|does not inventory/u);
	}
});

test('built WebAssembly admission binds the manifest, file, revision, and captured bytes', async (context) => {
	for (const mutation of ['bytes', 'file', 'origin', 'product', 'revision', 'record', 'record-shape'] as const) {
		const workspace = temporaryWorkspace(context);
		const origin = 'http://127.0.0.1:4332';
		const outputDirectory = join(workspace, mutation);
		writeSite({ origin, outputDirectory, productId: 'soundscaper', mutation });
		const authenticate = authenticator(workspace, [{ origin, outputDirectory, productId: 'soundscaper' }]);
		const bytes = mutation === 'bytes' ? Buffer.from([...WASM.slice(0, -1), 1]) : WASM;
		await assert.rejects(
			authenticate({ bytes, url: `${origin}/assets/pffft-BbtAeRsi.wasm` }),
			/authenticate WebAssembly|authenticated byte identity|differ from the inventoried|does not inventory/u,
			mutation,
		);
	}
});

test('an inventoried WebAssembly symlink cannot escape the authenticated build', async (context) => {
	const workspace = temporaryWorkspace(context);
	const origin = 'http://127.0.0.1:4332';
	const outputDirectory = join(workspace, 'soundscaper');
	writeSite({ origin, outputDirectory, productId: 'soundscaper' });
	const artifact = join(outputDirectory, 'assets/pffft-BbtAeRsi.wasm');
	rmSync(artifact);
	writeFileSync(join(workspace, 'outside.wasm'), WASM);
	symlinkSync(join(workspace, 'outside.wasm'), artifact);
	await assert.rejects(
		authenticator(workspace, [{ origin, outputDirectory, productId: 'soundscaper' }])({
			bytes: WASM, url: `${origin}/assets/pffft-BbtAeRsi.wasm`,
		}),
		/not a regular file/u,
	);
});

test('external FFmpeg WebAssembly remains a disjoint exact digest-pinned identity', async (context) => {
	const workspace = temporaryWorkspace(context);
	const url = 'https://assets.soundscaper.org/runtime/ffmpeg/0.12.10/ffmpeg-core.wasm';
	const authenticate = createBrowserWebAssemblyAuthenticator({
		expectedSourceRevision: REVISION,
		ffmpegCoverage: { wasm: record(WASM, { url }) },
		repositoryRoot: workspace,
	});
	assert.equal(await authenticate({ bytes: WASM, url }), true);
	await assert.rejects(
		authenticate({ bytes: Buffer.from([...WASM.slice(0, -1), 1]), url }),
		/pinned FFmpeg WebAssembly does not match/u,
	);
	await assert.rejects(
		authenticate({ bytes: WASM, url: `${url}?cache=1` }),
		/unapproved WebAssembly URL/u,
	);
});

function authenticator(repositoryRoot: string, sites: object[]) {
	return createBrowserWebAssemblyAuthenticator({
		expectedSourceRevision: REVISION,
		ffmpegCoverage: { wasm: record(WASM, { url: 'https://assets.invalid/ffmpeg-core.wasm' }) },
		repositoryRoot,
		sites,
	});
}

function writeSite({
	mutation = null,
	origin,
	outputDirectory,
	productId,
}: {
	mutation?: 'file' | 'origin' | 'product' | 'revision' | 'record' | 'record-shape' | 'bytes' | null,
	origin: string,
	outputDirectory: string,
	productId: string,
}) {
	const artifactPath = 'assets/pffft-BbtAeRsi.wasm';
	mkdirSync(join(outputDirectory, 'assets'), { recursive: true });
	writeFileSync(join(outputDirectory, artifactPath), mutation === 'file'
		? Buffer.from([...WASM.slice(0, -1), 1]) : WASM);
	writeFileSync(join(outputDirectory, '.browser-product-build.json'), JSON.stringify({
		files: { [artifactPath]: mutation === 'record'
			? { ...record(WASM), sha256: '0'.repeat(64) }
			: mutation === 'record-shape' ? { ...record(WASM), extra: true } : record(WASM) },
		origin: mutation === 'origin' ? 'http://127.0.0.1:4999' : origin,
		productId: mutation === 'product' ? 'framescaper' : productId,
		schemaVersion: 2,
		sourceRevision: mutation === 'revision' ? 'b'.repeat(40) : REVISION,
	}));
}

function record(bytes: Buffer, extra: object = {}) {
	return {
		byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		...extra,
	};
}

function temporaryWorkspace(context: { after(callback: () => void): void }) {
	const workspace = mkdtempSync(join(tmpdir(), 'soundscaper-browser-wasm-auth-'));
	context.after(() => rmSync(workspace, { recursive: true, force: true }));
	return workspace;
}

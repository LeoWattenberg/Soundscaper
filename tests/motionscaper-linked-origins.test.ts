/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { recordBrowserProductBuildEvidence } from '../scripts/lib/browser-product-site-evidence.mjs';
import { NIGHTLY_TEST_PAYLOAD_INPUTS } from '../scripts/lib/desktop-nightly-tests-staging.mjs';
import { createMotionLinkedOrigins, type MotionLinkedSite } from './browser/helpers/motionscaper-linked-origins.ts';
const revision = 'a'.repeat(40);
async function availablePort(): Promise<number> {
	const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const address = server.address(); assert.ok(address && typeof address !== 'string');
	await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); return address.port;
}
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), 'motion-owned-origins-')); const sites: MotionLinkedSite[] = [];
	for (const productId of ['framescaper', 'motionscaper'] as const) {
		const outputDirectory = join(root, productId); await mkdir(join(outputDirectory, 'en'), { recursive: true });
		for (const [name, contents] of Object.entries({ 'en/index.html': `<body data-product="${productId}">${productId}</body>`,
			'_headers': '/*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: credentialless\n', '_redirects': '',
			'offline-shell.json': '{}', 'service-worker.js': '', [`manifest-${productId}.webmanifest`]: '{}' })) await writeFile(join(outputDirectory, name), contents);
		const site = { productId, outputDirectory, origin: `http://127.0.0.1:${await availablePort()}` };
		await recordBrowserProductBuildEvidence({ ...site, sourceRevision: revision }); sites.push(site);
	}
	return { root, sites };
}
test('Motion paired origins own exact authenticated sites and close both real listeners idempotently', async () => {
	const { root, sites } = await fixture();
	try {
		const owned = await createMotionLinkedOrigins(sites, revision);
		try {
			for (const site of sites) assert.match(await (await fetch(`${site.origin}/en/`)).text(), new RegExp(site.productId, 'u'));
			assert.deepEqual(owned.sites, sites); await owned.close(); await owned.close();
			for (const site of sites) await assert.rejects(fetch(`${site.origin}/en/`));
		} finally { await owned.dispose(); }
	} finally { await rm(root, { recursive: true, force: true }); }
});
test('Motion paired origin startup refuses stale/tampered bytes before opening either listener', async () => {
	const { root, sites } = await fixture();
	try {
		await assert.rejects(createMotionLinkedOrigins(sites, 'b'.repeat(40)), /wrong build/u);
		await writeFile(join(sites[1]!.outputDirectory, 'en/index.html'), 'changed');
		await assert.rejects(createMotionLinkedOrigins(sites, revision), /file changed/u);
		for (const site of sites) await assert.rejects(fetch(`${site.origin}/en/`));
	} finally { await rm(root, { recursive: true, force: true }); }
});
test('Motion paired origin bind failure releases its first server and leaves the foreign listener alive', async () => {
	const { root, sites } = await fixture(); const foreign = createServer((_request, response) => response.end('foreign'));
	await new Promise<void>(resolve => foreign.listen(Number(new URL(sites[1]!.origin).port), '127.0.0.1', resolve));
	try {
		await assert.rejects(createMotionLinkedOrigins(sites, revision), /EADDRINUSE/u);
		await assert.rejects(fetch(`${sites[0]!.origin}/en/`));
		assert.equal(await (await fetch(sites[1]!.origin)).text(), 'foreign');
	} finally {
		await new Promise<void>((resolve, reject) => foreign.close(error => error ? reject(error) : resolve()));
		await rm(root, { recursive: true, force: true });
	}
});

test('Motion owned-origin and native-pixel helpers retain a closed exact nightly local-import inventory', async () => {
	const repository = resolve(import.meta.dirname, '..');
	const result = await build({ absWorkingDir: repository, entryPoints: [
		'tests/browser/helpers/motionscaper-linked-fixture.ts', 'tests/browser/helpers/motion-linked-video-pixels.ts',
	], outdir: 'unused-output', write: false, bundle: true, platform: 'node', format: 'esm', packages: 'external', metafile: true });
	const inputs = Object.keys(result.metafile.inputs).map(path => relative(repository, resolve(repository, path)).replaceAll('\\', '/'));
	type Entry = { source: string; kind: string; exclude?: ReadonlySet<string> };
	const requireInventory = (entries: readonly Entry[]) => {
		for (const file of inputs) assert.ok(entries.some(entry => file === entry.source
			|| entry.kind === 'directory' && file.startsWith(`${entry.source}/`) && !entry.exclude?.has(file.slice(entry.source.length + 1).split('/')[0]!)), `Unstaged linked dependency: ${file}`);
	};
	requireInventory(NIGHTLY_TEST_PAYLOAD_INPUTS);
	for (const dependency of ['scripts/lib/pages-site-static-server.mjs', 'scripts/lib/browser-product-site-evidence.mjs']) {
		assert.ok(inputs.includes(dependency));
		assert.throws(() => requireInventory(NIGHTLY_TEST_PAYLOAD_INPUTS.filter((entry: Entry) => entry.source !== dependency)), /Unstaged linked dependency/u);
	}
});

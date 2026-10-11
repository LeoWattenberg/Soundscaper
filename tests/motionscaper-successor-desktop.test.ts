/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FRAMESCAPER_SUCCESSOR_DESKTOP, framescaperSuccessorDesktopEnvironment, framescaperSuccessorDesktopDocumentUrl, normalizeFramescaperSuccessorDesktopMetadata } from '../desktop/framescaper-successor-contract.ts';
import { createIsolatedRendererProtocolHandler } from '../desktop/isolated-renderer-protocol.ts';
test('Motion link consumer desktop profile isolates the explicit successor owner from baseline native authority', () => {
	const profile = FRAMESCAPER_SUCCESSOR_DESKTOP;
	assert.equal(profile.appId, 'org.framescaper.successor.desktop'); assert.equal(profile.partition, 'persist:framescaper-successor-v2'); assert.equal(profile.origin, 'framescaper-successor-app://bundle');
	const metadata = { schemaVersion: 1, id: 'framescaper', line: 'successor', desktopProfile: 'framescaper-successor-v2', applicationVersion: '1.1.0-dev.1', projectSchemaVersion: 2, releaseEligible: false };
	assert.deepEqual(normalizeFramescaperSuccessorDesktopMetadata(metadata), metadata);
	for (const invalid of [{ ...metadata, line: 'baseline' }, { ...metadata, releaseEligible: true }, { ...metadata, applicationVersion: '1.0.0' }, { ...metadata, projectSchemaVersion: 1 }, { ...metadata, nativeServices: true }]) assert.throws(() => normalizeFramescaperSuccessorDesktopMetadata(invalid), /identity/iu);
	const environment = framescaperSuccessorDesktopEnvironment('1.1.0-dev.1', 'linux'); assert.deepEqual(environment.nativeCapabilities, ['motion-saved-files-v1']); assert.equal(environment.projectSchemaVersion, 2);
	assert.equal(framescaperSuccessorDesktopDocumentUrl(`${profile.origin}/embed/en/`), true);
	for (const url of ['framescaper-app://bundle/', 'motionscaper-app://bundle/', `${profile.origin}/assets/index.html`, `${profile.origin}/?foreign=1`, `${profile.origin}/composition-link-bridge.html`]) assert.equal(framescaperSuccessorDesktopDocumentUrl(url), false, url);
});
test('Motion successor renderer mount permits only its own confined origin with no external runtime authority', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-successor-protocol-')); try {
		await mkdir(join(root, 'embed/en'), { recursive: true }); await writeFile(join(root, 'embed/en/index.html'), '<script>window.local = true</script>');
		const handler = createIsolatedRendererProtocolHandler(root, FRAMESCAPER_SUCCESSOR_DESKTOP.scheme), response = await handler(new Request(`${FRAMESCAPER_SUCCESSOR_DESKTOP.origin}/embed/en/`));
		assert.equal(response.status, 200); assert.match(response.headers.get('Content-Security-Policy')!, /connect-src 'self' blob:/u); assert.equal(response.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
		assert.equal((await handler(new Request('framescaper-app://bundle/embed/en/'))).status, 403);
	} finally { await rm(root, { force: true, recursive: true }); }
});
test('Motion successor packaged evidence refuses baseline stores, foreign bridges and invented native authority', async () => {
	const { assertFramescaperSuccessorSmoke } = await import('../desktop/framescaper-successor-smoke-evidence.ts');
	const expected = { version: '1.1.0-dev.1', platform: 'linux', arch: 'x64' }, environment = framescaperSuccessorDesktopEnvironment(expected.version, expected.platform);
	const valid = { origin: FRAMESCAPER_SUCCESSOR_DESKTOP.origin, arch: 'x64', environment, foreignBridge: false, bridgeMethods: ['getEnvironment'], fileBridge: true,
		rejection: 'Unknown Motion saved-file renderer owner.', databases: ['kw-media-framescaper-editor-v2', 'kw-media-framescaper-editor-v2-media'] };
	const report = (value: unknown) => `FRAMESCAPER_SUCCESSOR_SHELL_SMOKE ${JSON.stringify(value)}`;
	assert.deepEqual(assertFramescaperSuccessorSmoke(report(valid), expected), valid);
	for (const value of [{ ...valid, foreignBridge: true }, { ...valid, databases: [...valid.databases, 'kw-media-framescaper-editor-v1'] }, { ...valid, environment: { ...environment, nativeCapabilities: ['project-library-v1'] } }]) assert.throws(() => assertFramescaperSuccessorSmoke(report(value), expected), /authority/iu);
});

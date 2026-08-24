/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { FramescaperOpenFxHostDescriptor } from '../desktop/framescaper-openfx-host-payload.ts';
import { createOpenFxHelperJobRunner } from '../desktop/openfx-helper-job.ts';
import type { OpenFxHostProcessInvocation } from '../desktop/openfx-host-process-contract.ts';
import type { HelperOfxInteractJobResultV1 } from '../desktop/helper-native-job-result.ts';
import { framescaperOpenFxInteractEffectStateSha256V1 } from '../src/common/editor/native-ofx-interact-contract.ts';
import { openFxProductionReadinessFixture } from './helpers/openfx-production-readiness-fixture.ts';

test('the isolated Interact helper authenticates one zero-port offscreen request', async (context) => {
	const fixture = await createFixture(context);
	const invocations: OpenFxHostProcessInvocation[] = [];
	const runner = createOpenFxHelperJobRunner({
		descriptor: fixture.descriptor,
		mode: 'runtime',
		pluginFingerprint: `net.example.Interact@${fixture.plugin.sha256}`,
		invokeHost: (invocation, authority) => {
			invocations.push(invocation);
			if (invocation.arguments[0] === '--scan') return handle({
				exitCode: 0, stderr: '', stdout: JSON.stringify({
					pluginId: 'net.example.Interact', vendor: 'Example',
					version: { major: 1, minor: 0 },
					bundleIdentity: `sha256:${fixture.plugin.sha256}`,
					binarySha256: fixture.plugin.sha256,
					architectureDirectory: 'Linux-x86-64', supportedContexts: ['filter'],
					parameters: [
						{ name: 'parameter0', type: 'integer', animates: true },
						{ name: 'parameter15', type: 'custom', animates: false },
					],
					components: ['RGBA'], pixelDepths: ['byte'], threading: 'fully-safe',
					renderBackends: ['cpu'],
					requestedSuites: ['OfxImageEffectSuite', 'OfxPropertySuite',
						'OfxParameterSuite', 'OfxInteractSuite', 'OfxDrawSuite'],
				}),
			});
			assert.equal(authority.writeOnly.length, 0);
			assert.equal(authority.readOnly.length, 1);
			const nativeGrant = JSON.parse(readFileSync(invocation.arguments[1]!, 'utf8')) as Record<string, unknown>;
			assert.deepEqual(nativeGrant.project, { id: 'project-v28', revision: 7 });
			assert.deepEqual(nativeGrant.parameters, effect(fixture.plugin.sha256).parameters);
			return handle({ exitCode: 0, stderr: '', stdout: JSON.stringify({
				accepted: true, protocolVersion: 1, width: 64, height: 64, rowBytes: 256,
				project: { id: 'project-v28', revision: 7 }, instanceId: 'effect-1',
				effectStateSha256: framescaperOpenFxInteractEffectStateSha256V1(effect(fixture.plugin.sha256)),
				target: 'custom-parameter', parameterName: 'parameter15', acceptedSequences: [4],
				redrawRequested: true, surfaceDisposition: 'drawn', parameterMutations: [{
					parameter: { name: 'parameter15', type: 'custom', value: 'updated', keyframes: [] },
				}], drawCalls: 1, pixelsTouched: 2,
				rgbaHex: '11'.repeat(64 * 64 * 4), vendorTopLevelWindowCreated: false,
			}) });
		},
	});
	const job = runner.run({
		kind: 'ofx-host',
		grant: {
			executable: executable('ofx-host', fixture.descriptor.runtimeHost),
			pluginBinary: executable('ofx-plugin', fixture.plugin),
			pluginFingerprint: `net.example.Interact@${fixture.plugin.sha256}`,
			pluginId: 'net.example.Interact',
			interact: {
				protocolVersion: 1, project: { id: 'project-v28', revision: 7 },
				pluginHandle: 'ab'.repeat(20), effect: effect(fixture.plugin.sha256),
				effectStateSha256: framescaperOpenFxInteractEffectStateSha256V1(
					effect(fixture.plugin.sha256),
				), context: 'filter',
				target: 'custom-parameter', parameterName: 'parameter15',
				events: [{ kind: 'focus', sequence: 4, focused: true }],
			},
			scratch: fixture.scratch,
		},
		ports: [],
	});
	const result = await job.completion as HelperOfxInteractJobResultV1;
	assert.equal(result.interact.rgba.byteLength, 16_384);
	assert.deepEqual(result.interact.acceptedSequences, [4]);
	assert.equal(result.interact.parameterMutations[0]?.parameter.value, 'updated');
	assert.equal(invocations.length, 2);
	assert.deepEqual(invocations[1]?.arguments.slice(0, 1), ['--interact-v1-grant']);
	await assert.rejects(async () => readFile(join(
		fixture.scratch.rootPath, fixture.scratch.reservationId, 'interact-v1-grant.json',
	)), /ENOENT/u);
});

async function createFixture(context: test.TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-ofx-interact-helper-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const scannerPath = join(root, 'scanner');
	const runtimePath = join(root, 'runtime');
	const pluginPath = join(root, 'plugin.ofx');
	const scratchPath = join(root, 'scratch');
	await Promise.all([
		writeFile(scannerPath, 'scanner'), writeFile(runtimePath, 'runtime'),
		writeFile(pluginPath, 'plugin'), mkdir(scratchPath),
	]);
	const [scanner, runtimeHost, plugin, scratch] = await Promise.all([
		descriptor(scannerPath), descriptor(runtimePath), descriptor(pluginPath), stat(scratchPath),
	]);
	const host: FramescaperOpenFxHostDescriptor = {
		target: 'linux-x64', runtime: 'linux-x64', hostVersion: '1.0.0',
		openfxVersion: '1.5.1', openfxCommit: 'ab77951', scanner, runtimeHost,
		isolation: { launcher: scanner, sandboxProfile: scanner,
			brokerPolicy: scanner, runtimeLibraries: [] },
		productionReadiness: openFxProductionReadinessFixture(scanner.sha256, runtimeHost.sha256),
	};
	return { descriptor: host, plugin, scratch: {
		rootPath: scratchPath, rootIdentity: { dev: scratch.dev, ino: scratch.ino },
		reservationId: '78'.repeat(20), maximumBytes: 20 * 1024 * 1024,
	} };
}

async function descriptor(path: string) {
	const [bytes, details] = await Promise.all([readFile(path), stat(path)]);
	return { path, byteLength: bytes.byteLength, sha256: digest(bytes),
		identity: { dev: details.dev, ino: details.ino } };
}

function executable(role: 'ofx-host' | 'ofx-plugin', value: Awaited<ReturnType<typeof descriptor>>) {
	return { role, path: value.path, bytes: value.byteLength,
		sha256: value.sha256, identity: value.identity };
}

function handle(result: Readonly<{ exitCode: number; stdout: string; stderr: string }>) {
	return { completion: Promise.resolve(result), cancel: async () => undefined };
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function effect(binarySha256: string) {
	const sha = '11'.repeat(32);
	return {
		schemaVersion: 1 as const, instanceId: 'effect-1', pluginId: 'net.example.Interact',
		binarySha256, context: 'filter' as const,
		attachment: { kind: 'filter' as const, targetId: 'video-clip' }, inputs: [],
		parameters: [
			{ name: 'parameter0', type: 'integer' as const, value: 3,
				keyframes: [{ frame: 12, value: 9 }] },
			{ name: 'parameter15', type: 'custom' as const, value: 'current', keyframes: [] },
		], customEncodings: { parameter15: 'vendor-v1' },
		enabled: true, freshness: { authoredStateSha256: sha, inputIdentitiesSha256: sha,
			renderPlanFingerprintSha256: sha, nativeEffectFingerprintSha256: sha },
		frozenFallback: null,
	};
}

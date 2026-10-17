/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { MOTION_PRORES_DELIVERY_PROFILE } from '../src/motionscaper/desktop-delivery-contract.ts';
import { assertMotionscaperPackagedSmoke, runMotionscaperSmokeProcess } from '../desktop/motionscaper-packaged-smoke.ts';

const expected = { platform: process.platform, arch: process.arch, version: '0.1.0-alpha.1' };
const evidence = {
	arch: process.arch, origin: 'motionscaper-app://bundle', foreignBridge: false, fileBridge: true,
	fileRejection: 'Unknown Motionscaper read capability.', deliveryRejection: 'Unknown Motionscaper delivery capability.', deliveryProfile: null, nativeSmoke: null,
	environment: { productId: 'motionscaper', appName: 'Motionscaper', version: expected.version,
		platform: process.platform, nativeCapabilities: ['project-files-v1'] },
};
const marker = (value: unknown) => `MOTIONSCAPER_SHELL_SMOKE ${JSON.stringify(value)}\n`;

test('Motionscaper packaged smoke requires the exact product, architecture and native authority', () => {
	assert.deepEqual(assertMotionscaperPackagedSmoke(marker(evidence), expected), evidence);
	for (const invalid of [
		{ ...evidence, foreignBridge: true }, { ...evidence, fileBridge: false },
		{ ...evidence, fileRejection: '' }, { ...evidence, arch: 'unexpected' },
		{ ...evidence, origin: 'framescaper-app://bundle' },
		{ ...evidence, environment: { ...evidence.environment, productId: 'framescaper' } },
		{ ...evidence, environment: { ...evidence.environment, version: '9.0.0' } },
		{ ...evidence, environment: { ...evidence.environment, nativeCapabilities: ['project-files-v1', 'video-codec'] } },
	]) assert.throws(() => assertMotionscaperPackagedSmoke(marker(invalid), expected), /evidence/iu);
	assert.throws(() => assertMotionscaperPackagedSmoke('no result', expected), /exactly one/iu);
	assert.throws(() => assertMotionscaperPackagedSmoke(marker(evidence).repeat(2), expected), /exactly one/iu);
});

test('Motionscaper packaged smoke supervises exit, deadlines, output bounds and Electron environment', async () => {
	const options = { command: process.execPath, cwd: process.cwd(), environment: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--trace-warnings' }, timeoutMs: 5_000 };
	const output = await runMotionscaperSmokeProcess({ ...options, args: ['-e', 'console.log(JSON.stringify({node:process.env.ELECTRON_RUN_AS_NODE,options:process.env.NODE_OPTIONS,product:process.env.SCAPE_PRODUCT}))'] });
	assert.deepEqual(JSON.parse(output), { product: 'motionscaper' });
	await assert.rejects(runMotionscaperSmokeProcess({ ...options, args: ['-e', 'console.error("bad startup");process.exit(7)'] }), /7.*bad startup/su);
	await assert.rejects(runMotionscaperSmokeProcess({ ...options, timeoutMs: 50, args: ['-e', 'setInterval(()=>{},1000)'] }), /timed out/iu);
	await assert.rejects(runMotionscaperSmokeProcess({ ...options, args: ['-e', 'console.log("x".repeat(1048577))'] }), /output bound/iu);
	await assert.rejects(runMotionscaperSmokeProcess({ ...options, command: '/absent/motionscaper', args: [] }), /ENOENT/u);
});

test('Motionscaper packaged native smoke requires an actual published MOV and exact precision', () => {
	const native = { ...evidence, deliveryProfile: MOTION_PRORES_DELIVERY_PROFILE,
		nativeSmoke: { status: 'passed', frameCount: 2, sha256: 'a'.repeat(64), profile: MOTION_PRORES_DELIVERY_PROFILE, audio: { sampleRate: 48000, channels: 2, sampleCount: 3204 } },
		environment: { ...evidence.environment, nativeCapabilities: ['project-files-v1', 'prores-4444-v1'] } };
	assert.deepEqual(assertMotionscaperPackagedSmoke(marker(native), { ...expected, nativeProres: true }), native);
	assert.throws(() => assertMotionscaperPackagedSmoke(marker(native), expected), /evidence/u);
	assert.throws(() => assertMotionscaperPackagedSmoke(marker({ ...native, nativeSmoke: { ...native.nativeSmoke, frameCount: 0 } }), { ...expected, nativeProres: true }), /evidence/u);
	assert.throws(() => assertMotionscaperPackagedSmoke(marker({ ...native, nativeSmoke: { ...native.nativeSmoke, audio: null } }), { ...expected, nativeProres: true }), /evidence/u);
});

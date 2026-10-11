/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { main as buildReference } from '../scripts/motionscaper-reference-artifact-build.ts';
import { resolveMotionQualificationPaths } from '../desktop/motionscaper-native-qualification-paths.ts';
import { validateMotionReferenceReceipt } from '../scripts/lib/motionscaper-reference-artifact.ts';
import { MOTION_LINUX_QUALIFICATIONS, motionQualificationReceipts } from '../scripts/motionscaper-linux-qualification.ts';

test('Motion qualifiers keep own default stages and explicitly select separate package locations', () => {
	assert.deepEqual(resolveMotionQualificationPaths('/checkout', 'motionscaper', 'x64', {}), { stage: '/checkout/.desktop-build', package: '/checkout/release/desktop-nightly-products/motionscaper/linux-unpacked', executable: '/checkout/release/desktop-nightly-products/motionscaper/linux-unpacked/motionscaper' });
	const custom = resolveMotionQualificationPaths('/checkout', 'motionscaper', 'arm64', { MOTIONSCAPER_QUALIFICATION_STAGE: '/stage', MOTIONSCAPER_QUALIFICATION_PACKAGE: '/candidate/linux-arm64-unpacked' });
	assert.equal(custom.stage, '/stage'); assert.equal(custom.executable, '/candidate/linux-arm64-unpacked/motionscaper');
	const successor = resolveMotionQualificationPaths('/checkout', 'framescaper-successor', 'x64', {});
	assert.equal(successor.stage, '/checkout/.desktop-build/framescaper-successor'); assert.equal(successor.executable, '/checkout/release/framescaper-successor/linux-unpacked/framescaper-successor');
	for (const path of ['relative', '/tmp/../stage', '/tmp/\0stage', '']) assert.throws(() => resolveMotionQualificationPaths('/checkout', 'motionscaper', 'x64', { MOTIONSCAPER_QUALIFICATION_STAGE: path }), /path/u);
	assert.throws(() => resolveMotionQualificationPaths('/checkout', 'motionscaper', 'ia32', {}), /architecture/u);
});

test('Motion CI cannot complete without every unique source-bound native workflow receipt', () => {
	const revision = 'a'.repeat(40); const markers = MOTION_LINUX_QUALIFICATIONS.flatMap(phase => [...phase.markers]);
	assert.equal(markers.length, 4);
	const output = markers.map(marker => `${marker} ${JSON.stringify({ sourceRevision: revision })}`).join('\n');
	assert.equal(motionQualificationReceipts(output, markers, revision).length, 4);
	assert.throws(() => motionQualificationReceipts('', markers, revision), /receipt/u);
	assert.throws(() => motionQualificationReceipts(`${output}\n${output}`, markers, revision), /exactly one/u);
	assert.throws(() => motionQualificationReceipts(output, markers, 'b'.repeat(40)), /source revision/u);
});

test('Motion reference receipts bind exact source, native helper, target, notices and decoder bytes', () => {
	const pin = { path: 'motion-reference-decoder', byteLength: 20, sha256: '1'.repeat(64) };
	const expected = { schemaVersion: 1, artifactKind: 'motionscaper-reference-decoder', target: 'linux-x64', sourceRevision: 'a'.repeat(40),
		nativeBuildReceiptSha256: '2'.repeat(64), nativeHelperSha256: '3'.repeat(64), nativeSourceManifestSha256: '4'.repeat(64),
		sourceFiles: [{ path: 'scripts/lib/motionscaper-native-reference.cpp', byteLength: 5, sha256: '5'.repeat(64) }],
		decoder: pin, notices: { path: 'THIRD_PARTY_NOTICES.md', byteLength: 3, sha256: '6'.repeat(64) } };
	assert.doesNotThrow(() => validateMotionReferenceReceipt(JSON.parse(JSON.stringify(expected)) as unknown, expected));
	for (const change of [{ target: 'linux-arm64' }, { sourceRevision: 'b'.repeat(40) }, { nativeHelperSha256: '9'.repeat(64) },
		{ decoder: { ...pin, sha256: '8'.repeat(64) } }, { sourceFiles: [] }, { extra: true }]) {
		assert.throws(() => validateMotionReferenceReceipt({ ...expected, ...change }, expected), /receipt/u);
	}
});

test('Motion reference artifact build requires an explicit Linux target and exact build inputs', async () => {
	await assert.rejects(buildReference([]), /requires Linux/u);
	await assert.rejects(buildReference(['--target=darwin-arm64', '--native-result=/result', '--ffmpeg-prefix=/prefix', '--output=/output']), /requires Linux/u);
});

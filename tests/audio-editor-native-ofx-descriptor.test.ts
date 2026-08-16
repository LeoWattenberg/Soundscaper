/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertOfxPluginDescriptorV1,
	ofxDescriptorsShareFingerprint,
	ofxPluginFingerprint,
	ofxStandardParameterForContext,
	OFX_CONTEXTS,
	OFX_CONTEXT_BINDINGS,
	OFX_HOST_SUITES,
	OFX_MANDATORY_SUITES,
	OfxDescriptorError,
	type OfxPluginDescriptorV1,
} from '../src/common/editor/native-ofx-descriptor.ts';
import {
	ofxArchitectureDirectory,
	ofxBundleBinaryPath,
	ofxRequiredQualifications,
	ofxTargetIsQualified,
	OFX_DEFERRED_TARGETS,
	OFX_TARGETS,
	OFX_TARGET_ARCHITECTURE_DIRECTORIES,
	OFX_UNIVERSAL_QUALIFICATIONS,
} from '../src/common/editor/native-ofx-packaging.ts';

const DIGEST = 'a'.repeat(64);
const OTHER_DIGEST = 'b'.repeat(64);

test('every OpenFX image-effect context has a Framescaper binding', () => {
	assert.deepEqual([...OFX_CONTEXTS], [
		'generator', 'filter', 'transition', 'paint', 'retimer', 'general',
	]);
	for (const context of OFX_CONTEXTS) {
		assert.ok(OFX_CONTEXT_BINDINGS[context].length > 0, context);
	}
	assert.equal(ofxStandardParameterForContext('transition'), 'Transition');
	assert.equal(ofxStandardParameterForContext('retimer'), 'SourceTime');
	assert.equal(ofxStandardParameterForContext('filter'), null);
});

test('a well-formed descriptor is admitted', () => {
	assert.doesNotThrow(() => assertOfxPluginDescriptorV1(descriptor()));
});

test('a plug-in that asks for a suite this host does not implement is refused', () => {
	assert.throws(
		() => assertOfxPluginDescriptorV1(descriptor({
			requestedSuites: [...OFX_MANDATORY_SUITES, 'OfxVendorSecretSuite'],
		})),
		/does not implement/u,
	);
	assert.equal(OFX_HOST_SUITES.includes('OfxDrawSuite'), true);
	assert.equal(OFX_HOST_SUITES.includes('OfxParametricParameterSuite'), true);
});

test('a descriptor missing a mandatory suite is refused', () => {
	assert.throws(
		() => assertOfxPluginDescriptorV1(descriptor({ requestedSuites: ['OfxPropertySuite', 'OfxParameterSuite'] })),
		/mandatory suite OfxImageEffectSuite/u,
	);
});

test('hostile descriptor input is rejected before it reaches the host', () => {
	for (const [overrides, pattern] of [
		[{ supportedContexts: ['nodegraph'] }, /not a known OpenFX value/u],
		[{ supportedContexts: [] }, /must declare its supportedContexts/u],
		[{ supportedContexts: ['filter', 'filter'] }, /repeats a supportedContexts entry/u],
		[{ pixelDepths: ['double'] }, /not a known OpenFX value/u],
		[{ components: ['YUV'] }, /not a known OpenFX value/u],
		[{ threading: 'mostly-safe' }, /known threading safety level/u],
		[{ binarySha256: 'not-a-digest' }, /binarySha256 is not in its canonical form/u],
		[{ version: { major: -1, minor: 0 } }, /non-negative integers/u],
		[{ parameters: [{ name: 'gain', type: 'quaternion', animates: true }] }, /known OpenFX type/u],
		[{
			parameters: [
				{ name: 'gain', type: 'double', animates: true },
				{ name: 'gain', type: 'double', animates: true },
			],
		}, /same parameter twice/u],
		[{ parameters: Array.from({ length: 4_097 }, (_, index) => ({
			name: `p${String(index)}`, type: 'double', animates: false,
		})) }, /parameter ceiling/u],
	] as const) {
		assert.throws(
			() => assertOfxPluginDescriptorV1(descriptor(overrides as Record<string, unknown>)),
			pattern,
			JSON.stringify(Object.keys(overrides)),
		);
	}
	assert.throws(() => assertOfxPluginDescriptorV1({ ...descriptor(), extra: 1 }), OfxDescriptorError);
	assert.throws(() => assertOfxPluginDescriptorV1(null), OfxDescriptorError);
});

test('every architecture directory this host packages is admitted, and nothing else', () => {
	for (const target of OFX_TARGETS) {
		const directory = OFX_TARGET_ARCHITECTURE_DIRECTORIES[target];
		assert.doesNotThrow(
			() => assertOfxPluginDescriptorV1(descriptor({ architectureDirectory: directory })),
			`${target} reports ${directory}`,
		);
	}
	for (const directory of [
		'Linux_x86_64', 'Linux-x86_64', 'linux-x86-64', 'Win32', 'MacOS ',
		'Contents/MacOS', '../Win64', 'Win64/../..', '', 64, null,
	]) {
		assert.throws(
			() => assertOfxPluginDescriptorV1(descriptor({ architectureDirectory: directory })),
			OfxDescriptorError,
			JSON.stringify(directory),
		);
	}
});

test('identity is the plug-in id bound to its exact binary digest', () => {
	const original = descriptor();
	const rebuilt = descriptor({ binarySha256: OTHER_DIGEST });
	const sibling = descriptor({ pluginId: 'net.example.Sharpen' });

	assert.equal(ofxPluginFingerprint(original), `net.example.Blur@${DIGEST}`);
	assert.equal(ofxDescriptorsShareFingerprint(original, descriptor()), true);
	// A replaced bundle is a different capability, even at the same version.
	assert.equal(ofxDescriptorsShareFingerprint(original, rebuilt), false);
	// Two plug-ins shipped in one binary are not interchangeable either.
	assert.equal(ofxDescriptorsShareFingerprint(original, sibling), false);
});

test('a version bump alone does not change identity, but a rebuild does', () => {
	const sameBytes = descriptor({ version: { major: 2, minor: 0 } });
	assert.equal(ofxDescriptorsShareFingerprint(descriptor(), sameBytes), true);
	assert.equal(
		ofxDescriptorsShareFingerprint(descriptor(), descriptor({ binarySha256: OTHER_DIGEST })),
		false,
	);
});

test('each target maps to its exact OpenFX architecture directory', () => {
	assert.deepEqual([...OFX_TARGETS], [
		'win32-x64', 'win32-arm64', 'darwin-arm64', 'linux-x64', 'linux-arm64',
	]);
	assert.deepEqual(OFX_TARGET_ARCHITECTURE_DIRECTORIES, {
		'win32-x64': 'Win64',
		'win32-arm64': 'Win-arm64ec',
		'darwin-arm64': 'MacOS',
		'linux-x64': 'Linux-x86-64',
		'linux-arm64': 'Linux-aarch64',
	});
});

test('a deferred or unknown target returns null rather than a plausible guess', () => {
	assert.deepEqual([...OFX_DEFERRED_TARGETS], ['darwin-x64']);
	assert.equal(ofxArchitectureDirectory('darwin-x64'), null);
	assert.equal(ofxArchitectureDirectory('linux-riscv64'), null);
	assert.equal(ofxBundleBinaryPath('Blur', 'darwin-x64'), null);
});

test('a bundle binary path follows the OpenFX bundle layout', () => {
	assert.equal(
		ofxBundleBinaryPath('Blur', 'win32-arm64'),
		'Blur.ofx.bundle/Contents/Win-arm64ec/Blur.ofx',
	);
	assert.equal(
		ofxBundleBinaryPath('Blur', 'linux-arm64'),
		'Blur.ofx.bundle/Contents/Linux-aarch64/Blur.ofx',
	);
	assert.throws(() => ofxBundleBinaryPath('../Blur', 'linux-x64'), RangeError);
});

test('CPU and Interact qualification is required on every target', () => {
	for (const target of OFX_TARGETS) {
		const required = ofxRequiredQualifications(target);
		for (const universal of OFX_UNIVERSAL_QUALIFICATIONS) {
			assert.ok(required.includes(universal), `${target}/${universal}`);
		}
	}
});

test('a GPU mechanism qualifies only where its hardware is provisioned', () => {
	// Metal is applicable on macOS and nowhere else.
	assert.ok(ofxRequiredQualifications('darwin-arm64', ['metal-render']).includes('metal-render'));
	assert.ok(!ofxRequiredQualifications('linux-x64', ['metal-render']).includes('metal-render'));
	// An unprovisioned mechanism is simply not required, never counted as passed.
	assert.ok(!ofxRequiredQualifications('linux-x64').includes('cuda-render'));
});

test('a target is qualified only when every requirement actually passed', () => {
	assert.equal(ofxTargetIsQualified('linux-x64', [...OFX_UNIVERSAL_QUALIFICATIONS]), true);
	assert.equal(
		ofxTargetIsQualified('linux-x64', OFX_UNIVERSAL_QUALIFICATIONS.filter((value) => value !== 'packaging')),
		false,
	);
	assert.equal(
		ofxTargetIsQualified('linux-x64', [...OFX_UNIVERSAL_QUALIFICATIONS], ['cuda-render']),
		false,
		'a provisioned GPU mechanism must actually pass',
	);
	assert.equal(
		ofxTargetIsQualified('linux-x64', [...OFX_UNIVERSAL_QUALIFICATIONS, 'cuda-render'], ['cuda-render']),
		true,
	);
});

function descriptor(overrides: Record<string, unknown> = {}): OfxPluginDescriptorV1 {
	return {
		pluginId: 'net.example.Blur',
		vendor: 'Example',
		version: { major: 1, minor: 0 },
		bundleIdentity: 'dev:1|ino:77',
		binarySha256: DIGEST,
		architectureDirectory: 'Linux-x86-64',
		supportedContexts: ['filter'],
		parameters: [{ name: 'radius', type: 'double', animates: true }],
		components: ['RGBA'],
		pixelDepths: ['float'],
		threading: 'fully-safe',
		requestedSuites: [...OFX_MANDATORY_SUITES],
		...overrides,
	} as OfxPluginDescriptorV1;
}

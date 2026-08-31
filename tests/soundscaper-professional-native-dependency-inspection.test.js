/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	parseSoundscaperProfessionalLinuxDynamicSection,
	validateSoundscaperProfessionalNativeDependencyClosure,
} from '../scripts/lib/soundscaper-professional-native-dependency-inspection.mjs';

const WINDOWS_ARCHITECTURE = Object.freeze({
	schemaVersion: 1,
	target: 'win-x64',
	architecture: 'x64',
	format: 'pe32-plus',
	machine: 'IMAGE_FILE_MACHINE_AMD64',
});

const LINUX_ARCHITECTURE = Object.freeze({
	schemaVersion: 1,
	target: 'linux-x64',
	architecture: 'x64',
	format: 'elf64-le',
	machine: 'EM_X86_64',
});

const LINUX_ARM64_ARCHITECTURE = Object.freeze({
	schemaVersion: 1,
	target: 'linux-arm64',
	architecture: 'arm64',
	format: 'elf64-le',
	machine: 'EM_AARCH64',
});

test('Linux dependency inspection reads both GNU readelf RPATH labels', () => {
	assert.deepEqual(parseSoundscaperProfessionalLinuxDynamicSection(`
 0x0000000000000001 (NEEDED)             Shared library: [libc.so.6]
 0x000000000000001d (RUNPATH)            Library runpath: [$ORIGIN/runtime]
`), { imports: ['libc.so.6'], rpaths: ['$ORIGIN/runtime'] });
	assert.deepEqual(parseSoundscaperProfessionalLinuxDynamicSection(`
 0x000000000000000f (RPATH)              Library rpath: [/reviewed/runtime]
`), { imports: [], rpaths: ['/reviewed/runtime'] });
});

test('Windows dependency closure admits the exact JUCE system libraries', async () => {
	const imports = [
		'api-ms-win-shcore-scaling-l1-1-1.DLL', 'COMCTL32.dll', 'D2D1.dll', 'D3D11.dll', 'DCOMP.dll',
		'DWRITE.dll', 'DXGI.dll', 'SHCORE.dll', 'VFW32.dll', 'WININET.dll',
	];
	const inspections = await validateSoundscaperProfessionalNativeDependencyClosure({
		target: 'win-x64',
		artifacts: [{ path: 'payload/soundscaper_professional_peer.exe', absolutePath: '/unused' }],
		runtimeArtifacts: [],
		root: '/candidate',
		inspectDependencies: async () => ({
			architecture: WINDOWS_ARCHITECTURE, imports, rpaths: [],
		}),
	});
	assert.deepEqual(inspections[0].imports, imports.slice().sort());
	await assert.rejects(validateSoundscaperProfessionalNativeDependencyClosure({
		target: 'win-x64',
		artifacts: [{ path: 'payload/soundscaper_professional_peer.exe', absolutePath: '/unused' }],
		runtimeArtifacts: [],
		root: '/candidate',
		inspectDependencies: async () => ({
			architecture: WINDOWS_ARCHITECTURE, imports: ['foreign.dll'], rpaths: [],
		}),
	}), /undeclared runtime dependency foreign\.dll/iu);
});

test('Windows dependency closure admits only the exact registry capability API set', async () => {
	const artifacts = [{
		path: 'payload/milestone5-native-isolation-launcher.exe', absolutePath: '/unused',
	}];
	const validate = (imports) => validateSoundscaperProfessionalNativeDependencyClosure({
		target: 'win-x64', artifacts, runtimeArtifacts: [], root: '/candidate',
		inspectDependencies: async () => ({
			architecture: WINDOWS_ARCHITECTURE, imports, rpaths: [],
		}),
	});
	const admitted = await validate(['api-ms-win-security-base-l1-2-2.DLL']);
	assert.deepEqual(admitted[0].imports, ['api-ms-win-security-base-l1-2-2.DLL']);
	await assert.rejects(validate(['api-ms-win-security-base-l1-2-1.dll']),
		/undeclared runtime dependency api-ms-win-security-base-l1-2-1\.dll/iu);
});

test('Linux dependency closure admits only slash-free case-sensitive system SONAMEs', async () => {
	const artifacts = [{
		path: 'payload/soundscaper_professional_peer', absolutePath: '/unused',
	}];
	const validate = (imports) => validateSoundscaperProfessionalNativeDependencyClosure({
		target: 'linux-x64', artifacts, runtimeArtifacts: [], root: '/candidate',
		inspectDependencies: async () => ({
			architecture: LINUX_ARCHITECTURE, imports, rpaths: ['$ORIGIN/runtime'],
		}),
	});
	const admitted = await validate(['libX11.so.6', 'libXcursor.so.1']);
	assert.deepEqual(admitted[0].imports, ['libX11.so.6', 'libXcursor.so.1']);
	await assert.rejects(validate(['/opt/attacker/libc.so.6']),
		/ambient runtime dependency \/opt\/attacker\/libc\.so\.6/u);
	await assert.rejects(validate(['libx11.so.6']),
		/undeclared runtime dependency libx11\.so\.6/u);
});

test('Linux arm64 dependency closure admits only its exact loader SONAME', async () => {
	const artifacts = [{
		path: 'payload/soundscaper_professional_peer', absolutePath: '/unused',
	}];
	const validate = (imports) => validateSoundscaperProfessionalNativeDependencyClosure({
		target: 'linux-arm64', artifacts, runtimeArtifacts: [], root: '/candidate',
		inspectDependencies: async () => ({
			architecture: LINUX_ARM64_ARCHITECTURE, imports, rpaths: ['$ORIGIN/runtime'],
		}),
	});
	const admitted = await validate(['ld-linux-aarch64.so.1']);
	assert.deepEqual(admitted[0].imports, ['ld-linux-aarch64.so.1']);
	await assert.rejects(validate(['ld-linux-x86-64.so.2']),
		/undeclared runtime dependency ld-linux-x86-64\.so\.2/u);
	await assert.rejects(validate(['/lib/ld-linux-aarch64.so.1']),
		/ambient runtime dependency \/lib\/ld-linux-aarch64\.so\.1/u);
});

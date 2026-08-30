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

test('Linux dependency inspection reads both GNU readelf RPATH labels', () => {
	assert.deepEqual(parseSoundscaperProfessionalLinuxDynamicSection(`
 0x0000000000000001 (NEEDED)             Shared library: [libc.so.6]
 0x000000000000001d (RUNPATH)            Library runpath: [$ORIGIN/runtime]
`), { imports: ['libc.so.6'], rpaths: ['$ORIGIN/runtime'] });
	assert.deepEqual(parseSoundscaperProfessionalLinuxDynamicSection(`
 0x000000000000000f (RPATH)              Library rpath: [/reviewed/runtime]
`), { imports: [], rpaths: ['/reviewed/runtime'] });
});

test('Windows dependency closure admits the exact JUCE GUI system libraries', async () => {
	const imports = [
		'COMCTL32.dll', 'D2D1.dll', 'D3D11.dll', 'DCOMP.dll',
		'DWRITE.dll', 'DXGI.dll', 'SHCORE.dll', 'VFW32.dll',
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

/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..');
const sources = join(repositoryRoot, 'native/framescaper-openfx-host/src');

test('production sources bind to the pinned SDK ABI and contain no ambient authority APIs', () => {
	const abi = readFileSync(join(sources, 'openfx_abi.hpp'), 'utf8');
	for (const header of [
		'ofxCore.h', 'ofxImageEffect.h', 'ofxProperty.h', 'ofxParam.h',
		'ofxMemory.h', 'ofxMultiThread.h', 'ofxMessage.h', 'ofxProgress.h',
		'ofxTimeLine.h', 'ofxInteract.h', 'ofxDrawSuite.h',
	]) assert.match(abi, new RegExp(`#include <${header.replace('.', '\\.')}>`, 'u'));
	const allSources = [
		'isolation_contract.hpp', 'openfx_abi.hpp', 'sha256.cpp', 'sha256.hpp',
		'dynamic_library.cpp', 'dynamic_library.hpp', 'host_runtime.cpp',
		'host_runtime.hpp', 'host_parameter_hydration.hpp', 'host_scan_inspection.inc',
		'host_standard_parameters.inc', 'loaded_plugin_binary.cpp', 'ofx_scanner.cpp',
		'ofx_runtime_host.cpp', 'rgba_frame.hpp', 'gpu_runtime.cpp', 'gpu_runtime.hpp',
		'v12_gpu_support.cpp', 'v12_gpu_support.hpp',
		'v12_cancellation_channel.cpp', 'v12_cancellation_channel.hpp',
		'v12_host_invocation.cpp', 'v12_host_invocation.hpp',
		'v12_output_file.cpp', 'v12_output_file.hpp',
		'v12_retime_authority.cpp', 'v12_retime_authority.hpp',
		'v12_transition_authority.cpp', 'v12_transition_authority.hpp',
	].map((file) => readFileSync(join(sources, file), 'utf8')).join('\n');
	assert.doesNotMatch(allSources, /\b(?:socket|connect|listen|accept|popen|system|ShellExecute)\s*\(/u);
	assert.doesNotMatch(allSources, /CreateWindow|NSWindow|XCreateWindow/u);
	for (const authority of [
		'kOfxImageEffectActionRender', 'kOfxImageEffectActionGetFramesNeeded',
		'kOfxInteractSuite', 'kOfxImageEffectPluginPropOverlayInteractV2',
		'kOfxInteractActionDraw', 'kOfxDrawSuite', 'exact_retime_ordinal\\.hpp',
		'SourceTime differs from the exact ordinal oracle',
		'output ordinal is outside its attached transition overlap',
	]) assert.match(allSources, new RegExp(authority, 'u'));
	const retimeAuthority = readFileSync(join(sources, 'v12_retime_authority.cpp'), 'utf8');
	assert.ok(retimeAuthority.indexOf('SourceTime differs from the exact ordinal oracle')
		< retimeAuthority.indexOf('return ofx_time(expected)'),
	'OFX conversion must occur only after exact SourceTime equality succeeds');
	const cmake = readFileSync(join(repositoryRoot, 'native/framescaper-openfx-host/CMakeLists.txt'), 'utf8');
	assert.match(cmake, /find_package\(Boost 1\.92\.0 EXACT REQUIRED\)/u);
	assert.match(cmake, /media_plan\.cpp/u);
});

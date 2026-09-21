/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SOURCE = readFileSync(new URL(
	'../native/soundscaper-professional-host/src/vamp_analyzer_adapter.cpp', import.meta.url,
), 'utf8');
const LOADER_SOURCE = readFileSync(new URL(
	'../native/soundscaper-professional-host/src/vamp_exact_library.cpp', import.meta.url,
), 'utf8');
const HEADER = readFileSync(new URL(
	'../native/soundscaper-professional-host/src/vamp_analyzer_adapter.h', import.meta.url,
), 'utf8');

test('Vamp adapter loads only the granted exact library and never invokes ambient discovery', () => {
	assert.doesNotMatch(SOURCE, /PluginLoader/u);
	assert.match(SOURCE, /vampGetPluginDescriptor/u);
	assert.doesNotMatch(LOADER_SOURCE, /PluginLoader/u);
	assert.match(LOADER_SOURCE, /RTLD_NOW\s*\|\s*RTLD_LOCAL/u);
	assert.match(LOADER_SOURCE, /LoadLibraryExW/u);
	assert.match(LOADER_SOURCE, /is_absolute/u);
	assert.match(SOURCE, /PluginHostAdapter/u);
	assert.match(SOURCE, /PluginInputDomainAdapter/u);
});

test('Vamp adapter surface remains an analyzer stream rather than an audio effect API', () => {
	assert.match(HEADER, /class ExactVampAnalyzer/u);
	assert.match(HEADER, /configure/u);
	assert.match(HEADER, /processPcm/u);
	assert.match(HEADER, /finish/u);
	assert.match(HEADER, /cancel/u);
	assert.doesNotMatch(HEADER, /latency|vendor|bypass|saveState|loadState/iu);
});

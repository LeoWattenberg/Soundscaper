import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	parseNyquistPlugin,
	parseNyquistPluginHeader,
	stripNyquistPluginHeader,
} from '../src/common/editor/nyquist/plugin-parser.js';
import {
	NYQUIST_BUNDLED_PLUGINS,
	getNyquistPlugin,
	listNyquistPlugins,
	loadNyquistPlugin,
	loadNyquistPluginSource,
} from '../src/common/editor/nyquist/plugin-registry.js';

const SOURCE_COMMIT = '5ef610ed23260d6d648175735bb16b32536eb30b';
const EXCLUDED_FILES = [
	'nyquist-plug-in-installer.ny',
	'sample-data-export.ny',
	'sample-data-import.ny',
];

test('bundled Nyquist inventory pins all 25 browser-compatible Audacity 3.7.7 scripts', async () => {
	assert.equal(NYQUIST_BUNDLED_PLUGINS.length, 25);
	assert.equal(new Set(NYQUIST_BUNDLED_PLUGINS.map(({ id }) => id)).size, 25);
	assert.ok(NYQUIST_BUNDLED_PLUGINS.every(({ sourceCommit }) => sourceCommit === SOURCE_COMMIT));
	assert.ok(NYQUIST_BUNDLED_PLUGINS.every(({ actionId, id }) => actionId === id));
	assert.ok(NYQUIST_BUNDLED_PLUGINS.every(({ id }) => /^nyquist:[a-z0-9-]+$/.test(id)));
	assert.ok(NYQUIST_BUNDLED_PLUGINS.every(({ fileName }) => !EXCLUDED_FILES.includes(fileName)));
	assert.ok(Object.isFrozen(NYQUIST_BUNDLED_PLUGINS));
	assert.ok(Object.isFrozen(NYQUIST_BUNDLED_PLUGINS[0].controls));

	const manifest = JSON.parse(await readFile(
		new URL('../src/common/editor/nyquist/plugins/source-manifest.json', import.meta.url),
		'utf8',
	));
	assert.equal(manifest.upstream.commit, SOURCE_COMMIT);
	assert.deepEqual(manifest.excluded.map(({ file }) => file).sort(), EXCLUDED_FILES.sort());
	assert.equal(manifest.included.length, 25);
	assert.deepEqual(
		manifest.included.map(({ file }) => file).sort(),
		NYQUIST_BUNDLED_PLUGINS.map(({ fileName }) => fileName).sort(),
	);
	const manifestHashes = new Map(manifest.included.map(({ file, sha256 }) => [file, sha256]));
	assert.ok(NYQUIST_BUNDLED_PLUGINS.every(({ fileName, sha256 }) => (
		manifestHashes.get(fileName) === sha256
	)));
});

test('every Nyquist processor is in Legacy while generators and analyzers retain their groups', () => {
	const processors = listNyquistPlugins({ role: 'process' });
	const generators = listNyquistPlugins({ role: 'generate' });
	const analyzers = listNyquistPlugins({ role: 'analyze' });
	assert.equal(processors.length, 18);
	assert.equal(generators.length, 3);
	assert.equal(analyzers.length, 4);
	assert.ok(processors.every(({ category }) => category === 'legacy'));
	assert.ok(generators.every(({ category }) => category === 'generate'));
	assert.ok(analyzers.every(({ category }) => category === 'analyze'));
	assert.equal(listNyquistPlugins({ category: 'legacy' }).length, 18);
	assert.equal(listNyquistPlugins({ spectral: true }).length, 4);
	assert.ok(NYQUIST_BUNDLED_PLUGINS.every(({ controls }) => (
		controls.every(({ kind }) => kind !== 'file' && kind !== 'unknown')
	)));
});

test('header parser understands translated text, multiline choices, static text, and legacy comments', async () => {
	const adjustable = getNyquistPlugin('nyquist:adjustable-fade');
	assert.equal(adjustable.name, 'Adjustable Fade');
	assert.deepEqual(adjustable.preview, ['linear', 'selection']);
	assert.deepEqual(adjustable.controls[0].options, [
		{ value: 0, symbol: 'Up', label: 'Fade Up' },
		{ value: 1, symbol: 'Down', label: 'Fade Down' },
		{ value: 2, symbol: 'SCurveUp', label: 'S-Curve Up' },
		{ value: 3, symbol: 'SCurveDown', label: 'S-Curve Down' },
	]);
	assert.deepEqual(adjustable.controls[1], {
		variable: 'CURVE',
		type: 'real',
		kind: 'number',
		label: 'Mid-fade Adjust (%)',
		unit: '',
		defaultValue: 0,
		min: -100,
		max: 100,
		options: [],
		fileFilters: null,
		line: 23,
	});

	const rhythm = getNyquistPlugin('nyquist:rhythmtrack');
	assert.equal(rhythm.controls.find(({ kind }) => kind === 'text').label, (
		"Set 'Number of bars' to zero to enable the 'Rhythm track duration'."
	));
	assert.equal(rhythm.controls.find(({ variable }) => variable === 'CLICK-TRACK-DUR').type, 'time');

	const labelSounds = getNyquistPlugin('nyquist:label-sounds');
	assert.deepEqual(labelSounds.controls.find(({ variable }) => variable === 'TEXT'), {
		variable: 'TEXT',
		type: 'string',
		kind: 'string',
		label: 'Label text',
		unit: '',
		defaultValue: 'Sound ##1',
		options: [],
		fileFilters: null,
		line: 31,
	});

	const rmsSource = await loadNyquistPluginSource('nyquist:rms');
	const rms = parseNyquistPluginHeader(rmsSource);
	assert.equal(rms.name, 'Measure RMS');
	assert.equal(rms.version, 4);
	assert.equal(rms.role, 'analyze');
});

test('plug-in loader preserves pinned bytes and returns evaluator-ready code with line numbers intact', async () => {
	for (const plugin of NYQUIST_BUNDLED_PLUGINS) {
		const source = await loadNyquistPluginSource(plugin);
		const digest = createHash('sha256').update(source).digest('hex');
		assert.equal(digest, plugin.sha256, plugin.fileName);
		const loaded = await loadNyquistPlugin(plugin.id);
		assert.equal(loaded.source, source);
		assert.equal(loaded.id, plugin.id);
		assert.equal(loaded.code.split(/\r\n|\r|\n/).length, source.split(/\r\n|\r|\n/).length);
		assert.doesNotMatch(loaded.code, /^\s*\$(?:nyquist|control|type|name|mergeclips|restoresplits)\b/m);
	}
	assert.match((await loadNyquistPlugin('nyquist:pluck')).code, /\(snd-pluck \*sound-srate\* \(step-to-hz PITCH\)/);
});

test('parser exposes evaluator code separately and rejects malformed plug-ins', async () => {
	const source = `$nyquist plug-in
$version 4
$type process spectral
$name (_ "Translated name")
$control MODE (_ "Mode") choice (("fast" (_ "Fast")) (_ "Careful")) 1
$control AMOUNT (_ "Amount") float (_ "dB") -3 -12 nil

(mult *track* (db-to-linear AMOUNT))
`;
	const plugin = parseNyquistPlugin(source);
	assert.equal(plugin.name, 'Translated name');
	assert.equal(plugin.spectral, true);
	assert.equal(plugin.controls[0].options[1].label, 'Careful');
	assert.equal(plugin.controls[1].max, null);
	assert.equal(plugin.code.split('\n').length, source.split('\n').length);
	assert.match(plugin.code, /\(mult \*track\*/);
	assert.equal(plugin.code, stripNyquistPluginHeader(source));
	assert.throws(() => parseNyquistPluginHeader('(print "not a plug-in")'), /Missing 'nyquist plug-in' header/);
	assert.throws(() => parseNyquistPluginHeader(null), /must be a string/);
	assert.equal(getNyquistPlugin('missing'), null);
	await assert.rejects(() => loadNyquistPlugin('missing'), /Unknown bundled Nyquist plug-in/);
});

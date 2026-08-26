import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, readFile, readdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';

const SITE_ROOT = new URL('../src/common/site/', import.meta.url);
const EDITOR_CSS_ROOT = new URL('../src/common/editor/ui/audio-editor-design-system/', import.meta.url);
const PROJECT_ROOT = new URL('../', import.meta.url);
const execFileAsync = promisify(execFile);

const SUBSETS = ['cyrillic-ext', 'cyrillic', 'latin-ext', 'latin'];

function fontFileNames(family, weights) {
	return weights.flatMap((weight) => SUBSETS.map((subset) => (
		`${family}-${subset}-${weight}-normal.woff2`
	)));
}

test('the site loads only the four retained Ubuntu WOFF2 subsets', async () => {
	const siteCss = await readFile(new URL('site.css', SITE_ROOT), 'utf8');
	assert.match(siteCss, /^@import ['"]\.\/fonts\.css['"];$/m);

	const fontsCss = await readFile(new URL('fonts.css', SITE_ROOT), 'utf8');
	const expected = fontFileNames('ubuntu', [400, 700]);
	assert.deepEqual(fontUrls(fontsCss).map(fileName).sort(), expected.sort());
	assert.doesNotMatch(fontsCss, /font-family:\s*['"]Inter|\.woff(?:['")])/u);
	for (const name of expected) {
		await access(new URL(`node_modules/@fontsource/ubuntu/files/${name}`, PROJECT_ROOT));
	}
});

test('the lazy editor stylesheet loads only the four retained Inter WOFF2 subsets', async () => {
	const editorStyles = await readFile(new URL('../src/common/editor/ui/audio-editor-design-system.css', import.meta.url), 'utf8');
	assert.match(editorStyles, /^@import ['"]\.\/editor-fonts\.css['"];$/m);
	const fontsCss = await readFile(new URL('../src/common/editor/ui/editor-fonts.css', import.meta.url), 'utf8');
	const expected = fontFileNames('inter', [400, 600, 700]);
	assert.deepEqual(fontUrls(fontsCss).map(fileName).sort(), expected.sort());
	assert.doesNotMatch(fontsCss, /font-family:\s*['"]Ubuntu|\.woff(?:['")])/u);
	for (const name of expected) {
		await access(new URL(`node_modules/@fontsource/inter/files/${name}`, PROJECT_ROOT));
	}
});

test('the icon font is a deterministic WOFF2 derivation with TTF provenance retained', async () => {
	const fontRoot = new URL('../vendor/audacity-design-system/components/src/assets/fonts/', import.meta.url);
	const iconCss = await readFile(new URL('musescore-icon.css', fontRoot), 'utf8');
	assert.match(iconCss, /url\(['"]\.\/MusescoreIcon\.woff2['"]\) format\(['"]woff2['"]\)/u);
	assert.doesNotMatch(iconCss, /url\([^)]*\.ttf/u);
	await access(new URL('MusescoreIcon.ttf', fontRoot));
	await access(new URL('MusescoreIcon.woff2', fontRoot));
	const { stderr } = await execFileAsync(process.execPath, [
		new URL('../scripts/build-musescore-icon-font.mjs', import.meta.url).pathname,
		'--check',
	], { cwd: new URL('..', import.meta.url).pathname });
	assert.equal(stderr, '');
});

test('editor sans-serif text does not fall back to host fonts', async () => {
	const cssFiles = (await readdir(EDITOR_CSS_ROOT))
		.filter((name) => name.endsWith('.css'));
	for (const name of cssFiles) {
		const css = await readFile(new URL(name, EDITOR_CSS_ROOT), 'utf8');
		assert.doesNotMatch(css, /(?:system-ui|Segoe UI)/, `${name} contains a host-dependent sans-serif font`);
	}

	const tokensCss = await readFile(new URL('01-tokens-base.css', EDITOR_CSS_ROOT), 'utf8');
	assert.match(tokensCss, /\.kw-audio-editor__application-header\s*\{[^}]*font-family:\s*Inter, sans-serif;/);
	assert.match(tokensCss, /\.application-header__menu-item\s*\{[^}]*font-family:\s*Inter, sans-serif;/);
});

function fontUrls(css) {
	return [...css.matchAll(/url\(['"]?(?<url>[^)'"\s]+)['"]?\)/gu)]
		.map((match) => match.groups.url);
}

function fileName(path) {
	return path.slice(path.lastIndexOf('/') + 1);
}

test('CI browser snapshots use the immutable Playwright Noble image', async () => {
	const workflow = await readFile(new URL('.github/workflows/quality.yml', PROJECT_ROOT), 'utf8');
	assert.match(workflow, /container:\s*\n\s+image: mcr\.microsoft\.com\/playwright:v1\.62\.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e/);
	assert.doesNotMatch(workflow, /name: Install Chromium/);

	const lockfile = JSON.parse(await readFile(new URL('package-lock.json', PROJECT_ROOT), 'utf8'));
	assert.equal(lockfile.packages['node_modules/@playwright/test'].version, '1.62.1');
	assert.equal(lockfile.packages['node_modules/playwright-core'].version, '1.62.1');
});

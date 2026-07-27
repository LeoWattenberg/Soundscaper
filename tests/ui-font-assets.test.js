import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const SITE_ROOT = new URL('../src/common/site/', import.meta.url);
const EDITOR_CSS_ROOT = new URL('../src/common/editor/ui/audio-editor-design-system/', import.meta.url);
const PROJECT_ROOT = new URL('../', import.meta.url);

test('the site serves deterministic Ubuntu and Inter font faces', async () => {
	const siteCss = await readFile(new URL('site.css', SITE_ROOT), 'utf8');
	assert.match(siteCss, /^@import ['"]\.\/fonts\.css['"];$/m);

	const fontsCss = await readFile(new URL('fonts.css', SITE_ROOT), 'utf8');
	const fontImports = [
		'@fontsource/inter/400.css',
		'@fontsource/inter/600.css',
		'@fontsource/inter/700.css',
		'@fontsource/ubuntu/400.css',
		'@fontsource/ubuntu/700.css',
	];
	for (const fontImport of fontImports) {
		assert.match(fontsCss, new RegExp(`@import ['"]${fontImport.replaceAll('/', '\\/')}['"];`));
		await access(new URL(`node_modules/${fontImport}`, PROJECT_ROOT));
	}
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

test('CI browser snapshots use the immutable Playwright Noble image', async () => {
	const workflow = await readFile(new URL('.github/workflows/quality.yml', PROJECT_ROOT), 'utf8');
	assert.match(workflow, /container:\s*\n\s+image: mcr\.microsoft\.com\/playwright:v1\.61\.1-noble@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48/);
	assert.doesNotMatch(workflow, /name: Install Chromium/);

	const lockfile = JSON.parse(await readFile(new URL('package-lock.json', PROJECT_ROOT), 'utf8'));
	assert.equal(lockfile.packages['node_modules/@playwright/test'].version, '1.61.1');
	assert.equal(lockfile.packages['node_modules/playwright-core'].version, '1.61.1');
});

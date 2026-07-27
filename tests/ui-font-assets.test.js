import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const SITE_ROOT = new URL('../src/common/site/', import.meta.url);
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

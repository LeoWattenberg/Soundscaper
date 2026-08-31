import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const checkedFiles = [
	'desktop/display-capture.js',
	'desktop/plugin-binary-authentication.mjs',
	'src/common/editor/analysis-worker.js',
	'src/common/editor/parametric-eq/wasm-loader.js',
	'src/common/editor/parametric-eq/worker.js',
	'src/common/editor/pffft-wasm-loader.js',
	'src/common/editor/spectral-edit-worker.js',
];

test('the checked JavaScript gate pins its strict runtime boundary inventory', async () => {
	const project = JSON.parse(readFileSync('tsconfig.javascript.json', 'utf8'));
	assert.deepEqual(project.files, checkedFiles);
	assert.equal(project.compilerOptions.checkJs, false);
	assert.equal(project.compilerOptions.allowJs, true);

	const result = spawnSync(process.execPath, ['scripts/check-checked-javascript.mjs'], {
		cwd: process.cwd(),
		encoding: 'utf8',
	});
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /Checked 7 strict JavaScript runtime boundaries\./u);

	for (const path of checkedFiles) {
		assert.match(readFileSync(path, 'utf8'), /^\/\/ @ts-check\n/u, path);
	}

	const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
	assert.equal(
		packageJson.scripts['typecheck:javascript'],
		'node scripts/check-checked-javascript.mjs && tsc -p tsconfig.javascript.json',
	);
	assert.match(packageJson.scripts.typecheck, /npm run typecheck:javascript$/u);

	const eslintConfigurations = (await import('../eslint.config.mjs')).default;
	const promiseLint = eslintConfigurations.find(({ files, rules }) => (
		Array.isArray(files)
		&& files.length === checkedFiles.length
		&& checkedFiles.every((path, index) => files[index] === path)
		&& rules?.['@typescript-eslint/no-floating-promises']
	));
	assert.ok(promiseLint, 'checked JavaScript files must have an exact typed promise-lint override');
	assert.equal(promiseLint.rules['@typescript-eslint/no-misused-promises'], 'error');
	assert.deepEqual(promiseLint.languageOptions.parserOptions.project, ['./tsconfig.javascript.json']);
});

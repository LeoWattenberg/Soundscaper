import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stampSessionTranslation } from '../scripts/docs-ai/session-provenance.mjs';
import { parseProvenance } from '../scripts/docs-ai/provenance.mjs';

test('session translation stamps truthful provenance and validates before replacing the draft', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'docs-ai-session-'));
	const sourcePath = join(directory, 'source.md');
	const targetPath = join(directory, 'zh-CN.md');
	const source = '---\ntitle: Try Soundscaper\ndescription: Edit audio locally.\n---\n\n# Try Soundscaper\n\nEdit audio in your browser.\n';
	const translation = '---\ntitle: 试用 Soundscaper\ndescription: 在本地编辑音频。\n---\n\n# 试用 Soundscaper\n\n在浏览器中编辑音频。\n';
	try {
		await writeFile(sourcePath, source);
		await writeFile(targetPath, translation);
		const provenance = await stampSessionTranslation({ sourcePath, targetPath, targetLocale: 'zh-CN' });
		const output = await readFile(targetPath, 'utf8');
		assert.equal(provenance.model, 'gpt-6-luna');
		assert.equal(provenance.modelProvider, 'codex-subagent');
		assert.equal(Object.hasOwn(provenance, 'modelDigest'), false);
		assert.match(output, /modelProvider":"codex-subagent"/u);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('session translation leaves an invalid draft unstamped', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'docs-ai-session-invalid-'));
	const sourcePath = join(directory, 'source.md');
	const targetPath = join(directory, 'zh-CN.md');
	const source = '---\ntitle: Source\n---\n\n# Source\n\nA paragraph.\n';
	const invalid = '---\ntitle: 标题\n---\n\n## 标题\n\n一个段落。\n';
	try {
		await writeFile(sourcePath, source);
		await writeFile(targetPath, invalid);
		await assert.rejects(stampSessionTranslation({ sourcePath, targetPath, targetLocale: 'zh-CN' }));
		assert.equal(await readFile(targetPath, 'utf8'), invalid);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('session translation accepts explicit model and provider identity', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'docs-ai-session-model-'));
	const sourcePath = join(directory, 'source.md');
	const targetPath = join(directory, 'zh-CN.md');
	try {
		await writeFile(sourcePath, '---\ntitle: Source\n---\n\n# Source\n\nA paragraph.\n');
		await writeFile(targetPath, '---\ntitle: 标题\n---\n\n# 标题\n\n一个段落。\n');
		const provenance = await stampSessionTranslation({
			sourcePath,
			targetPath,
			targetLocale: 'zh-CN',
			model: 'gpt-6-astra',
			modelProvider: 'codex-session',
		});
		assert.equal(provenance.model, 'gpt-6-astra');
		assert.equal(provenance.modelProvider, 'codex-session');
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('session translation preserves the identity of a model whose prose it revises', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'docs-ai-session-based-on-'));
	const sourcePath = join(directory, 'source.md');
	const targetPath = join(directory, 'zh-CN.md');
	const oldProvenance = {
		schemaVersion: 1,
		operation: 'translate',
		model: 'aya-expanse:32b',
		modelDigest: 'aya-exact-digest',
		promptVersion: 'docs-translate-v1',
		sourceSha256: 'old-source-hash',
		sourceLocale: 'en',
		targetLocale: 'zh-CN',
	};
	try {
		await writeFile(sourcePath, '---\ntitle: Source\n---\n\n# Source\n\nA paragraph.\n');
		await writeFile(targetPath, `---\ntitle: 标题\n---\n<!-- docs-ai-provenance: ${JSON.stringify(oldProvenance)} -->\n\n# 标题\n\n一个段落。\n`);
		await stampSessionTranslation({ sourcePath, targetPath, targetLocale: 'zh-CN' });
		const output = parseProvenance(await readFile(targetPath, 'utf8'));
		assert.deepEqual(output.basedOnProvenance, {
			model: 'aya-expanse:32b',
			modelDigest: 'aya-exact-digest',
		});
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

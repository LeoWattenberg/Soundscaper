import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';

import { assertDocumentationLocale } from './locale.mjs';
import { localizeFrontmatterLinks, parseTranslatableFrontmatter, replaceTranslatableFrontmatter } from './frontmatter.mjs';
import { checkTranslation, TRANSLATE_PROMPT_VERSION } from './workflows.mjs';
import { createProvenance, embedProvenance, parseProvenance, sha256 } from './provenance.mjs';

const FRONTMATTER_PATTERN = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u;

/** Stamp and validate a translation written directly during a Codex session. */
export async function stampSessionTranslation({
	sourcePath,
	targetPath,
	targetLocale,
	model = 'gpt-6-luna',
	modelProvider = 'codex-subagent',
	basedOnProvenance,
}) {
	if (resolve(sourcePath) === resolve(targetPath)) throw new Error('Translation source and target paths must differ.');
	if (typeof model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u.test(model)) {
		throw new Error('Session model must be a nonempty model identifier.');
	}
	if (typeof modelProvider !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/u.test(modelProvider)) {
		throw new Error('Session model provider must be a nonempty provider identifier.');
	}
	const locale = assertDocumentationLocale(targetLocale);
	if (locale === 'en') throw new Error('A translation target locale must differ from the English source.');
	const source = await readFile(sourcePath, 'utf8');
	const target = await readFile(targetPath, 'utf8');
	const previousProvenance = basedOnProvenance ?? parseProvenance(target);
	const sourceFrontmatter = source.match(FRONTMATTER_PATTERN);
	const frontmatterMatch = target.match(FRONTMATTER_PATTERN);
	if (!sourceFrontmatter || !frontmatterMatch || !target.slice(frontmatterMatch[0].length).trim()) {
		throw new Error('A session translation needs YAML frontmatter and a non-empty body.');
	}
	const translatedFields = parseTranslatableFrontmatter(frontmatterMatch[0]);
	const localizedFrontmatter = localizeFrontmatterLinks(
		replaceTranslatableFrontmatter(sourceFrontmatter[0], translatedFields),
		locale,
	);
	const localizedTarget = `${localizedFrontmatter}${target.slice(frontmatterMatch[0].length)}`;
	const provenance = createProvenance({
		operation: 'translate',
		model,
		modelProvider,
	...(previousProvenance && typeof previousProvenance.model === 'string' && (previousProvenance.model !== model
			|| previousProvenance.modelProvider !== modelProvider
			|| previousProvenance.modelDigest)
			? { basedOnProvenance: previousProvenance }
			: {}),
		promptVersion: TRANSLATE_PROMPT_VERSION,
		source,
		factPacketSha256: sha256(source),
		sourceLocale: 'en',
		targetLocale: locale,
	});
	const stamped = embedProvenance(localizedTarget, provenance);
	const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
	await mkdir(dirname(targetPath), { recursive: true });
	try {
		await writeFile(temporaryPath, stamped, { flag: 'wx' });
		await checkTranslation({ sourcePath, targetPath: temporaryPath });
		await rename(temporaryPath, targetPath);
	} finally {
		await rm(temporaryPath, { force: true });
	}
	return provenance;
}

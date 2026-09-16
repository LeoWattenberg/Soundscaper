/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { EDITOR_ENGLISH_COPY, EDITOR_GERMAN_COPY } from '../src/common/i18n/editor-copy-inventory.ts';
import {
	assessTranslationContribution, createContributionSnapshot, parseTranslationContribution, publishedTranslationOrigin,
	type TranslationContribution,
} from '../src/common/i18n/community-translations.ts';
import { createTranslationPoManifest, emitTranslationPo } from '../src/common/i18n/community-translations-po.ts';
import { currentTranslations } from '../src/common/i18n/translation-catalog.js';
import {
	readTranslationCatalog, writeTranslationCatalog, writeTranslationCatalogIndex,
	TRANSLATION_CATALOG_DIRECTORY,
} from './i18n-ai/catalog.mjs';
import { selectCommunityTranslations, type CommunityWritableCatalog } from './community-translations-import.ts';
import { importTranslationPo } from './community-translations-po.ts';

export interface CommunityTranslationToolOptions {
	readonly catalogDirectory?: string;
	readonly englishCopy?: Readonly<Record<string, string>>;
	readonly germanCopy?: Readonly<Record<string, string>>;
}
export interface CommunityTranslationImportOptions extends CommunityTranslationToolOptions {
	readonly file: string;
	readonly manifest?: string;
	readonly contributor?: string;
	readonly apply?: boolean;
	readonly keys?: readonly string[];
}

export async function importCommunityTranslationFile(options: CommunityTranslationImportOptions) {
	const contribution = await readContribution(options);
	const directory = options.catalogDirectory ?? TRANSLATION_CATALOG_DIRECTORY;
	const catalog = await readTranslationCatalog(contribution.locale, directory) as CommunityWritableCatalog | null;
	const snapshot = currentSnapshot(contribution.locale, catalog, options);
	const assessment = assessTranslationContribution(contribution, snapshot);
	const applied = options.apply ? [...new Set(options.keys ?? [])] : [];
	if (options.apply) {
		const next = selectCommunityTranslations(contribution, snapshot, catalog, applied);
		await writeTranslationCatalog(next, directory);
		await writeTranslationCatalogIndex(directory);
	}
	return { locale: contribution.locale,
		clean: assessment.clean.map((entry) => entry.key), stale: assessment.stale.map((entry) => entry.key),
		conflicts: assessment.conflicts.map((entry) => entry.key), invalid: assessment.invalid.map((entry) => entry.key), applied,
		diffs: contribution.entries.map((entry) => ({ key: entry.key, source: entry.source,
			currentSource: snapshot.entries[entry.key]?.source ?? null,
			before: entry.baselineText, current: snapshot.entries[entry.key]?.baselineText ?? null,
			after: entry.translation, origin: publishedTranslationOrigin(snapshot.entries[entry.key],
				contribution.locale === 'de' ? (options.germanCopy ?? EDITOR_GERMAN_COPY)[entry.key] : undefined),
			...(entry.note ? { note: entry.note } : {}),
		})),
	};
}

export async function exportCommunityTranslationPo(locale: string, output: string, options: CommunityTranslationToolOptions = {}): Promise<void> {
	const directory = options.catalogDirectory ?? TRANSLATION_CATALOG_DIRECTORY;
	const catalog = await readTranslationCatalog(locale, directory) as CommunityWritableCatalog | null;
	const snapshot = currentSnapshot(locale, catalog, options);
	const [notice, license] = await Promise.all([
		readFile(new URL('../src/common/i18n/translations/NOTICE.md', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/i18n/translations/LICENSE.txt', import.meta.url), 'utf8'),
	]);
	const archive = zipSync({
		'messages.pot': strToU8(emitTranslationPo(snapshot, true)),
		'messages.po': strToU8(emitTranslationPo(snapshot)),
		'manifest.json': strToU8(createTranslationPoManifest(snapshot)),
		'NOTICE.md': strToU8(notice), 'LICENSE.txt': strToU8(license),
		'README.txt': strToU8('Edit messages.po with a PO editor. Keep manifest.json unchanged. Return messages.po and manifest.json together. Only changed translations are imported; fuzzy and obsolete entries are skipped. Contributions use AGPL-3.0-only; existing Audacity translations retain their upstream notices.\n'),
	});
	await writeFile(output, archive);
}

async function readContribution(options: CommunityTranslationImportOptions): Promise<TranslationContribution> {
	const contents = await readFile(options.file);
	let contribution: TranslationContribution;
	switch (extname(options.file).toLowerCase()) {
		case '.json': contribution = parseTranslationContribution(contents.toString('utf8')); break;
		case '.po': {
			if (!options.manifest) throw new TypeError('Importing a PO file requires its original --manifest file.');
			contribution = importTranslationPo(contents, await readFile(options.manifest, 'utf8'), options.contributor);
			break;
		}
		case '.zip': {
			const archive = unzipSync(contents);
			if (!archive['messages.po'] || !archive['manifest.json']) throw new TypeError('PO ZIP requires messages.po and manifest.json.');
			contribution = importTranslationPo(Buffer.from(archive['messages.po']), strFromU8(archive['manifest.json']), options.contributor);
			break;
		}
		default: throw new TypeError('Choose a contribution JSON file, a PO file with manifest, or a PO ZIP.');
	}
	return options.contributor ? Object.freeze({ ...contribution, contributor: options.contributor }) : contribution;
}

function currentSnapshot(locale: string, catalog: CommunityWritableCatalog | null, options: CommunityTranslationToolOptions) {
	const english = options.englishCopy ?? EDITOR_ENGLISH_COPY;
	const german = options.germanCopy ?? EDITOR_GERMAN_COPY;
	const published = { ...english, ...(new Intl.Locale(locale).language === 'de' ? german : {}),
		...(catalog ? currentTranslations(catalog, english, { locale }) : {}),
	};
	return createContributionSnapshot(locale, english, published, catalog);
}

export async function runCommunityTranslationCli(args: readonly string[]): Promise<void> {
	const command = args[0];
	const flags = new Map<string, string>();
	let apply = false;
	for (let index = 1; index < args.length; index++) {
		const flag = args[index]!;
		if (flag === '--apply') { apply = true; continue; }
		if (!['--locale', '--output', '--file', '--manifest', '--contributor', '--keys'].includes(flag)) throw new TypeError(`Unknown option ${flag}`);
		const value = args[++index];
		if (!value || value.startsWith('--')) throw new TypeError(`Option ${flag} requires a value.`);
		if (flags.has(flag)) throw new TypeError(`Duplicate option ${flag}`);
		flags.set(flag, value);
	}
	if (command === 'export') {
		if (apply) throw new TypeError('--apply is available only for import.');
		await exportCommunityTranslationPo(requiredFlag('--locale'), requiredFlag('--output'));
		return;
	}
	if (command !== 'import') throw new TypeError('Usage: i18n:community export --locale fr --output fr.zip | import --file contribution.json [--apply --keys key1,key2]');
	const report = await importCommunityTranslationFile({ file: requiredFlag('--file'), manifest: flags.get('--manifest'),
		contributor: flags.get('--contributor'), apply, keys: flags.get('--keys')?.split(',').filter(Boolean) });
	process.stdout.write(`${JSON.stringify(report, null, '\t')}\n`);

	function requiredFlag(flag: string): string {
		const value = flags.get(flag);
		if (!value) throw new TypeError(`Missing ${flag}`);
		return value;
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await runCommunityTranslationCli(process.argv.slice(2)).catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}

function decodeYamlString(rawValue, key) {
	const value = rawValue.trim();
	if (!value || value === '|' || value === '>') {
		throw new Error(`Frontmatter ${key} must be a nonempty single-line string.`);
	}
	if (value.startsWith('"')) {
		try {
			const parsed = JSON.parse(value);
			if (typeof parsed === 'string') return parsed;
		} catch (error) {
			throw new Error(`Frontmatter ${key} uses an unsupported double-quoted scalar.`, { cause: error });
		}
	}
	if (value.startsWith("'")) {
		if (!value.endsWith("'") || value.length < 2) throw new Error(`Frontmatter ${key} has an unterminated quoted scalar.`);
		return value.slice(1, -1).replace(/''/gu, "'");
	}
	if (/\s+#/u.test(value)) {
		throw new Error(`Frontmatter ${key} must not use an ambiguous inline comment.`);
	}
	return value;
}

function hasControlCharacters(value) {
	return [...value].some((character) => character.codePointAt(0) < 0x20);
}

export function parseTranslatableFrontmatter(frontmatter) {
	if (!frontmatter.startsWith('---\n') && !frontmatter.startsWith('---\r\n')) {
		throw new Error('A Starlight Markdown translation requires YAML frontmatter.');
	}
	const fields = new Map();
	for (const match of frontmatter.matchAll(/^(title|description):[ \t]*([^\r\n]*)(?:\r?\n|$)/gmu)) {
		const [, key, rawValue] = match;
		if (fields.has(key)) throw new Error(`Frontmatter contains duplicate ${key} fields.`);
		fields.set(key, decodeYamlString(rawValue, key));
	}
	if (!fields.has('title')) throw new Error('Starlight frontmatter must contain one translatable title.');
	return {
		title: fields.get('title'),
		description: fields.get('description'),
	};
}

export function replaceTranslatableFrontmatter(frontmatter, translated) {
	const expected = parseTranslatableFrontmatter(frontmatter);
	if (typeof translated.title !== 'string' || translated.title.trim().length === 0) {
		throw new Error('Translated frontmatter title must be a nonempty string.');
	}
	if (translated.title.length > 200 || hasControlCharacters(translated.title)) {
		throw new Error('Translated frontmatter title exceeds its bound or contains control characters.');
	}
	if (expected.description !== undefined) {
		if (typeof translated.description !== 'string' || translated.description.trim().length === 0) {
			throw new Error('Translated frontmatter description must be a nonempty string.');
		}
		if (translated.description.length > 500 || hasControlCharacters(translated.description)) {
			throw new Error('Translated frontmatter description exceeds its bound or contains control characters.');
		}
	} else if (translated.description !== undefined) {
		throw new Error('The model added a frontmatter description that the source does not contain.');
	}

	return frontmatter.replace(
		/^(title|description):[ \t]*[^\r\n]*(\r?\n|$)/gmu,
		(_line, key, newline) => `${key}: ${JSON.stringify(translated[key])}${newline}`,
	);
}

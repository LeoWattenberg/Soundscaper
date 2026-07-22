export const AUDIO_EDITOR_SEARCH_RESULT_LIMIT = 50;

/**
 * Natural-language aliases intentionally stay small and auditable. They cover
 * common editing intents without shipping a model or making a network request.
 */
export const AUDIO_EDITOR_COMMAND_SEARCH_ALIASES = Object.freeze({
	'audacity-amplify': Object.freeze([
		'amplify', 'make louder', 'make this louder', 'turn up', 'turn it up',
		'increase volume', 'boost volume', 'raise volume', 'more volume', 'volume up',
		'lauter', 'lauter machen', 'mach lauter', 'mach das lauter',
		'lautstärke erhöhen', 'pegel erhöhen', 'verstärken',
	]),
	'audacity-normalize': Object.freeze([
		'normalize volume', 'even out volume', 'set peak level',
		'lautstärke normalisieren', 'pegel normalisieren',
	]),
	'audacity-loudness-normalization': Object.freeze([
		'normalize loudness', 'target loudness', 'match loudness',
		'lautheit normalisieren', 'lautheit angleichen',
	]),
	'audacity-noise-reduction': Object.freeze([
		'remove background noise', 'reduce noise', 'clean up noise',
		'hintergrundrauschen entfernen', 'rauschen reduzieren', 'rauschen entfernen',
	]),
	'audacity-compressor': Object.freeze([
		'compress audio', 'reduce dynamic range', 'control dynamics',
		'audio komprimieren', 'dynamik reduzieren',
	]),
	'audacity-limiter': Object.freeze([
		'limit peaks', 'stop clipping', 'prevent clipping',
		'spitzen begrenzen', 'übersteuerung verhindern',
	]),
	'audacity-fade-in': Object.freeze([
		'fade in', 'start quietly', 'gradually get louder',
		'einblenden', 'langsam lauter werden',
	]),
	'audacity-fade-out': Object.freeze([
		'fade out', 'end quietly', 'gradually get quieter',
		'ausblenden', 'langsam leiser werden',
	]),
	'audacity-change-pitch': Object.freeze([
		'change pitch', 'higher pitch', 'lower pitch',
		'tonhöhe ändern', 'höher stimmen', 'tiefer stimmen',
	]),
	'effect://builtin/change-pitch': Object.freeze([
		'change pitch', 'higher pitch', 'lower pitch',
		'tonhöhe ändern', 'höher stimmen', 'tiefer stimmen',
	]),
	'audacity-change-tempo': Object.freeze([
		'change tempo', 'make faster', 'make slower', 'speed up without pitch',
		'tempo ändern', 'schneller machen', 'langsamer machen',
	]),
	'effect://builtin/change-tempo': Object.freeze([
		'change tempo', 'make faster', 'make slower', 'speed up without pitch',
		'tempo ändern', 'schneller machen', 'langsamer machen',
	]),
	'audacity-reverse': Object.freeze([
		'reverse audio', 'play backwards', 'rückwärts abspielen', 'audio umkehren',
	]),
	'silence-audio-selection': Object.freeze([
		'silence selection', 'mute this section', 'make this silent',
		'auswahl stummschalten', 'diesen bereich stummschalten',
	]),
});

/** Normalize user-visible search text without changing the source entry. */
export function normalizeAudioEditorSearchText(value) {
	return String(value ?? '')
		.normalize('NFKD')
		.replace(/\p{M}+/gu, '')
		.toLowerCase()
		.replace(/ß/g, 'ss')
		.replace(/æ/g, 'ae')
		.replace(/œ/g, 'oe')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()
		.replace(/\s+/g, ' ');
}

/**
 * Convert the current product-filtered application menus to command entries.
 * Container disabled state is inherited by every descendant leaf.
 */
export function flattenAudioEditorSearchMenus(menus, options = {}) {
	const startOrder = safeStartOrder(options.startOrder);
	const candidates = [];
	let sourceOrder = startOrder;

	for (const menu of arrayOrEmpty(menus)) {
		if (!menu || menu.divider) continue;
		const menuLabel = textValue(menu.label);
		walkMenuItems(menu.items, {
			breadcrumbs: menuLabel ? [menuLabel] : [],
			disabled: Boolean(menu.disabled),
			disabledReason: textValue(menu.disabledReason) || null,
		}, (item, context) => {
			const order = sourceOrder;
			sourceOrder += 1;
			if (typeof item.onClick !== 'function' && !context.disabled) return;
			const label = textValue(item.label) || textValue(item.id);
			if (!label) return;
			const commandId = commandIdentity(item, [...context.breadcrumbs, label]);
			const aliases = commandAliases(item, commandId);
			const path = [...context.breadcrumbs, label];
			const disabledReason = context.disabled
				? textValue(item.disabledReason) || context.disabledReason || null
				: null;
			const baseTerms = uniqueText([
				label,
				item.id,
				item.parityActionId,
				item.commandId,
				item.canonicalId,
				item.shortcut,
				...context.breadcrumbs,
				path.join(' '),
			]);
			candidates.push({
				kind: 'command',
				key: `command:${commandId}`,
				commandId,
				label,
				detail: context.breadcrumbs.join(' › '),
				terms: uniqueText([...baseTerms, ...aliases]),
				aliases,
				breadcrumbs: [...context.breadcrumbs],
				paths: [path],
				shortcut: textValue(item.shortcut) || null,
				checked: typeof item.checked === 'boolean' ? item.checked : null,
				disabled: context.disabled,
				disabledReason,
				state: context.disabled ? 'disabled' : 'enabled',
				reason: disabledReason,
				handler: typeof item.onClick === 'function' ? item.onClick : null,
				target: { commandId },
				sourceOrder: order,
			});
		});
	}

	return deduplicateCommands(candidates);
}

/** Create one entry per timeline clip and one per grouped Project Bin card. */
export function createAudioEditorMediaSearchEntries(project, options = {}) {
	if (!project || typeof project !== 'object') return [];
	let sourceOrder = safeStartOrder(options.startOrder);
	const entries = [];
	const sources = new Map(arrayOrEmpty(project.sources)
		.filter((source) => source && source.id != null)
		.map((source) => [String(source.id), source]));
	const tracksByClipId = indexTracksByClip(project.tracks);

	for (const clip of arrayOrEmpty(project.clips)) {
		if (!clip || clip.id == null) continue;
		const source = sources.get(String(clip.sourceId)) || null;
		const tracks = tracksByClipId.get(String(clip.id)) || [];
		const mediaKind = mediaKindOf(clip, source, tracks[0]);
		const label = mediaLabel(clip, source);
		const trackNames = uniqueText([
			...tracks.map((track) => track.name),
			clip.trackName,
		]);
		const sourceNames = sourceSearchNames(source);
		entries.push({
			kind: 'timeline',
			key: `timeline:${clip.id}`,
			label,
			detail: uniqueText([...trackNames, ...sourceNames, mediaKind]).join(' · '),
			terms: uniqueText([
				label, clip.id, clip.title, clip.sourceId, mediaKind,
				...sourceNames, ...trackNames, ...tracks.map((track) => track.id),
			]),
			aliases: [],
			disabled: false,
			disabledReason: null,
			state: 'enabled',
			reason: null,
			handler: null,
			target: {
				clipId: String(clip.id),
				trackId: tracks[0]?.id == null ? null : String(tracks[0].id),
				trackIds: tracks.map((track) => String(track.id)),
			},
			sourceOrder,
		});
		sourceOrder += 1;
	}

	const groupedBinClips = new Map();
	for (const clip of arrayOrEmpty(project.projectBin?.clips)) {
		if (!clip || clip.id == null) continue;
		const binItemId = String(clip.binItemId || clip.id);
		const clips = groupedBinClips.get(binItemId) || [];
		clips.push(clip);
		groupedBinClips.set(binItemId, clips);
	}
	for (const [binItemId, clips] of groupedBinClips) {
		const primaryClip = clips.find((clip) => mediaKindOf(clip, sources.get(String(clip.sourceId))) === 'video') || clips[0];
		const itemSources = clips.map((clip) => sources.get(String(clip.sourceId)) || null);
		const primarySource = sources.get(String(primaryClip.sourceId)) || null;
		const mediaKinds = uniqueText(clips.map((clip, index) => mediaKindOf(clip, itemSources[index])));
		const sourceNames = uniqueText(itemSources.flatMap(sourceSearchNames));
		const clipTitles = uniqueText(clips.map((clip) => clip.title));
		const label = mediaLabel(primaryClip, primarySource);
		entries.push({
			kind: 'project-bin',
			key: `project-bin:${binItemId}`,
			label,
			detail: uniqueText([...sourceNames, ...mediaKinds]).join(' · '),
			terms: uniqueText([
				label, binItemId, ...clipTitles, ...sourceNames, ...mediaKinds,
				...clips.flatMap((clip) => [clip.id, clip.sourceId]),
			]),
			aliases: [],
			disabled: false,
			disabledReason: null,
			state: 'enabled',
			reason: null,
			handler: null,
			target: {
				binItemId,
				clipId: String(primaryClip.id),
				clipIds: clips.map((clip) => String(clip.id)),
			},
			sourceOrder,
		});
		sourceOrder += 1;
	}

	return entries;
}

/** Build the complete search model for the active project. */
export function createAudioEditorSearchEntries({ menus = [], project = null } = {}) {
	const commands = flattenAudioEditorSearchMenus(menus);
	const mediaStartOrder = commands.reduce(
		(maximum, entry) => Math.max(maximum, entry.sourceOrder + 1),
		0,
	);
	return [
		...commands,
		...createAudioEditorMediaSearchEntries(project, { startOrder: mediaStartOrder }),
	];
}

/** Rank entries using deterministic text tiers and return at most 50 matches. */
export function searchAudioEditorEntries(entries, query, options = {}) {
	const limit = resultLimit(options.limit);
	if (!limit) return [];
	const normalizedQuery = normalizeAudioEditorSearchText(query);
	const source = arrayOrEmpty(entries).filter((entry) => entry && typeof entry === 'object');
	if (!normalizedQuery) return [...source]
		.sort(compareSourceOrder)
		.slice(0, limit);

	const queryTokens = normalizedQuery.split(' ');
	return source
		.map((entry) => ({ entry, score: scoreEntry(entry, normalizedQuery, queryTokens) }))
		.filter(({ score }) => Number.isFinite(score))
		.sort((left, right) => left.score - right.score || compareSourceOrder(left.entry, right.entry))
		.slice(0, limit)
		.map(({ entry }) => entry);
}

function walkMenuItems(items, parentContext, visit) {
	for (const item of arrayOrEmpty(items)) {
		if (!item || item.divider) continue;
		const ownDisabled = Boolean(item.disabled);
		const disabled = parentContext.disabled || ownDisabled;
		const disabledReason = ownDisabled
			? textValue(item.disabledReason) || parentContext.disabledReason
			: parentContext.disabledReason;
		const context = {
			breadcrumbs: parentContext.breadcrumbs,
			disabled,
			disabledReason: disabledReason || null,
		};
		if (Array.isArray(item.items) && item.items.length) {
			const label = textValue(item.label);
			walkMenuItems(item.items, {
				...context,
				breadcrumbs: label ? [...context.breadcrumbs, label] : [...context.breadcrumbs],
			}, visit);
			continue;
		}
		visit(item, context);
	}
}

function deduplicateCommands(entries) {
	const byCommand = new Map();
	for (const entry of entries) {
		const existing = byCommand.get(entry.commandId);
		if (!existing) {
			byCommand.set(entry.commandId, entry);
			continue;
		}
		const paths = uniquePaths([...existing.paths, ...entry.paths]);
		const terms = uniqueText([...existing.terms, ...entry.terms, ...paths.flat()]);
		const aliases = uniqueText([...existing.aliases, ...entry.aliases]);
		const representative = existing.disabled && !entry.disabled ? entry : existing;
		byCommand.set(entry.commandId, {
			...representative,
			key: existing.key,
			commandId: existing.commandId,
			paths,
			terms,
			aliases,
			sourceOrder: Math.min(existing.sourceOrder, entry.sourceOrder),
		});
	}
	return [...byCommand.values()].sort(compareSourceOrder);
}

function commandIdentity(item, path) {
	const value = item.parityActionId || item.canonicalId || item.commandId || item.id;
	if (textValue(value)) return textValue(value);
	return `menu://${normalizeAudioEditorSearchText(path.join('/')).replace(/ /g, '-')}`;
}

function commandAliases(item, commandId) {
	return uniqueText([
		...(AUDIO_EDITOR_COMMAND_SEARCH_ALIASES[commandId] || []),
		...(AUDIO_EDITOR_COMMAND_SEARCH_ALIASES[textValue(item.id)] || []),
	]);
}

function indexTracksByClip(tracks) {
	const indexed = new Map();
	for (const track of arrayOrEmpty(tracks)) {
		if (!track || track.id == null) continue;
		for (const clipId of arrayOrEmpty(track.clipIds)) {
			const key = String(clipId);
			const values = indexed.get(key) || [];
			values.push(track);
			indexed.set(key, values);
		}
	}
	return indexed;
}

function mediaKindOf(clip, source, track = null) {
	const kind = textValue(clip?.kind) || textValue(source?.kind) || textValue(track?.type);
	return kind === 'video' ? 'video' : 'audio';
}

function mediaLabel(clip, source) {
	return textValue(clip?.title) || sourceSearchNames(source)[0] || textValue(clip?.id) || 'Clip';
}

function sourceSearchNames(source) {
	if (!source) return [];
	return uniqueText([
		source.name,
		source.fileName,
		source.filename,
		source.originalName,
	]);
}

function scoreEntry(entry, query, queryTokens) {
	let best = Number.POSITIVE_INFINITY;
	const aliases = normalizedUnique(entry.aliases);
	for (const alias of aliases) {
		if (alias === query) best = Math.min(best, 5);
		else if (query.includes(alias)) best = Math.min(best, 70 + Math.max(0, query.length - alias.length));
		else if (alias.startsWith(query)) best = Math.min(best, 105 + alias.length - query.length);
		else if (tokensCovered(alias, queryTokens)) best = Math.min(best, 145 + alias.length);
	}

	const fields = [
		[entry.label, 0],
		[entry.commandId, 10],
		[entry.detail, 18],
		...arrayOrEmpty(entry.breadcrumbs).map(textValue).map((value) => [value, 20]),
		...arrayOrEmpty(entry.terms).map(textValue).map((value) => [value, 26]),
	];
	for (const [rawValue, weight] of fields) {
		const value = normalizeAudioEditorSearchText(rawValue);
		if (!value) continue;
		if (value === query) {
			best = Math.min(best, weight);
			continue;
		}
		if (value.startsWith(query)) {
			best = Math.min(best, 100 + weight + Math.min(40, value.length - query.length));
			continue;
		}
		if (tokensCovered(value, queryTokens)) {
			best = Math.min(best, 200 + weight + tokenSpread(value, queryTokens));
			continue;
		}
		const substringIndex = value.indexOf(query);
		if (substringIndex >= 0) {
			best = Math.min(best, 300 + weight + Math.min(60, substringIndex));
			continue;
		}
		const fuzzyPenalty = fuzzySubsequencePenalty(value, query);
		if (Number.isFinite(fuzzyPenalty)) best = Math.min(best, 400 + weight + fuzzyPenalty);
	}
	return best;
}

function tokensCovered(value, queryTokens) {
	const valueTokens = value.split(' ');
	return queryTokens.every((queryToken) => valueTokens.some((valueToken) => (
		valueToken === queryToken || valueToken.startsWith(queryToken)
	)));
}

function tokenSpread(value, queryTokens) {
	const tokens = value.split(' ');
	const indexes = queryTokens.map((queryToken) => tokens.findIndex((token) => token.startsWith(queryToken)));
	return Math.min(50, Math.max(...indexes) - Math.min(...indexes) + value.length - queryTokens.join(' ').length);
}

function fuzzySubsequencePenalty(value, query) {
	const needle = query.replace(/ /g, '');
	const haystack = value.replace(/ /g, '');
	if (!needle || needle.length < 3) return Number.POSITIVE_INFINITY;
	let needleIndex = 0;
	let firstIndex = -1;
	let previousIndex = -1;
	let gaps = 0;
	for (let index = 0; index < haystack.length && needleIndex < needle.length; index += 1) {
		if (haystack[index] !== needle[needleIndex]) continue;
		if (firstIndex < 0) firstIndex = index;
		if (previousIndex >= 0) gaps += index - previousIndex - 1;
		previousIndex = index;
		needleIndex += 1;
	}
	if (needleIndex !== needle.length) return Number.POSITIVE_INFINITY;
	return Math.min(199, firstIndex * 3 + gaps * 2 + haystack.length - needle.length);
}

function normalizedUnique(values) {
	return [...new Set(arrayOrEmpty(values)
		.map(normalizeAudioEditorSearchText)
		.filter(Boolean))];
}

function uniqueText(values) {
	const result = [];
	const seen = new Set();
	for (const value of values) {
		const text = textValue(value);
		if (!text || seen.has(text)) continue;
		seen.add(text);
		result.push(text);
	}
	return result;
}

function uniquePaths(paths) {
	const seen = new Set();
	const result = [];
	for (const path of paths) {
		const normalized = arrayOrEmpty(path).map(textValue).filter(Boolean);
		const key = normalized.join('\u0000');
		if (!key || seen.has(key)) continue;
		seen.add(key);
		result.push(normalized);
	}
	return result;
}

function compareSourceOrder(left, right) {
	const orderDifference = (Number(left.sourceOrder) || 0) - (Number(right.sourceOrder) || 0);
	if (orderDifference) return orderDifference;
	const leftKey = String(left.key || '');
	const rightKey = String(right.key || '');
	return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function resultLimit(value) {
	if (value === undefined) return AUDIO_EDITOR_SEARCH_RESULT_LIMIT;
	const number = Number(value);
	if (!Number.isFinite(number)) return AUDIO_EDITOR_SEARCH_RESULT_LIMIT;
	return Math.max(0, Math.min(AUDIO_EDITOR_SEARCH_RESULT_LIMIT, Math.floor(number)));
}

function safeStartOrder(value) {
	const number = Number(value ?? 0);
	return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function arrayOrEmpty(value) {
	return Array.isArray(value) ? value : [];
}

function textValue(value) {
	if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
	return '';
}

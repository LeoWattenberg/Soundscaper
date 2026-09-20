/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertProducts, compareText, page, productNames, table } from './markdown.mjs';

const APPLICATION_MENU_ENTRY_KINDS = new Set(['command', 'setting', 'link']);

export function renderCommandReference({
	manifest,
	implementedStatus,
	products,
	source,
	isProductCommandDisabled,
	applicationMenuEntries = [],
}) {
	assertProducts(products);
	if (!manifest || typeof manifest !== 'object') throw new TypeError('The action manifest is required.');
	if (typeof isProductCommandDisabled !== 'function') throw new TypeError('The product command filter is required.');
	if (!source?.commit || !source?.url || !source?.version) throw new TypeError('Audacity source provenance is required.');
	if (!Array.isArray(applicationMenuEntries)) throw new TypeError('Local application-menu entries must be an array.');

	const commands = [];
	const manifestDefinitions = Object.values(manifest);
	for (const definition of manifestDefinitions) {
		if (definition?.status !== implementedStatus || definition.menuVisible === false) continue;
		if (typeof definition.id !== 'string' || typeof definition.label !== 'string') {
			throw new TypeError('Every implemented action must have an id and label.');
		}
		const availableProducts = products.filter((product) => !isProductCommandDisabled(
			definition.id,
			product.shortcuts?.disabledCommandIds ?? [],
		));
		if (availableProducts.length === 0) continue;
		commands.push({
			id: definition.id,
			label: definition.label,
			shortcut: definition.shortcut || '—',
			locations: Array.isArray(definition.locations) ? definition.locations.join('; ') : '—',
			products: productNames(availableProducts),
			origin: definition.origin === 'upstream' ? 'Audacity' : 'Soundscaper local',
		});
	}
	commands.push(...localApplicationMenuCommands(applicationMenuEntries, manifestDefinitions, products));
	commands.sort((left, right) => compareText(left.label, right.label) || compareText(left.id, right.id));

	const shortCommit = source.commit.slice(0, 12);
	const hasApplicationMenuEntries = applicationMenuEntries.length > 0;
	const body = [
		`This inventory contains commands marked as implemented in the runtime action manifest. Audacity-derived entries are reviewed against Audacity ${source.version} at [\`${shortCommit}\`](${source.url}). Local entries are identified separately.`,
		...(hasApplicationMenuEntries
			? ['', 'Local application-menu entries come from the reviewed menu reference registry.']
			: []),
		'',
		hasApplicationMenuEntries
			? 'Product availability follows each product profile’s command filters and each local menu entry’s declared product list. “—” means that no default shortcut is assigned; it does not mean the command is unavailable.'
			: 'Product availability follows each product profile’s command filters. “—” means that no default shortcut is assigned; it does not mean the command is unavailable.',
		'',
		table(
			['Command', 'Command ID', 'Default shortcut', 'Menu location', 'Products', 'Origin'],
			commands.map((command) => [
				command.label,
				`\`${command.id}\``,
				command.shortcut,
				command.locations,
				command.products,
				command.origin,
			]),
		),
	].join('\n');
	return page({
		title: 'Commands and shortcuts',
		description: 'Implemented commands, default shortcuts, product availability, and source provenance.',
		order: 1,
		body,
	});
}

function localApplicationMenuCommands(entries, manifestDefinitions, products) {
	const manifestIds = new Set(manifestDefinitions.map((definition) => definition?.id).filter(Boolean));
	const productById = new Map(products.map((product) => [product.id, product]));
	const seen = new Set();
	return entries.map((entry) => {
		if (!entry || typeof entry !== 'object'
			|| typeof entry.id !== 'string' || entry.id.trim().length === 0
			|| typeof entry.label !== 'string' || entry.label.trim().length === 0) {
			throw new TypeError('Every local application-menu entry needs a non-empty id and label.');
		}
		if (manifestIds.has(entry.id)) {
			throw new RangeError(`Local application-menu entry duplicates action manifest id ${entry.id}.`);
		}
		if (seen.has(entry.id)) throw new RangeError(`Duplicate local application-menu id ${entry.id}.`);
		seen.add(entry.id);
		if (!Array.isArray(entry.locations) || entry.locations.length === 0
			|| entry.locations.some((location) => typeof location !== 'string' || location.trim().length === 0)) {
			throw new TypeError(`Local application-menu entry ${entry.id} needs at least one menu location.`);
		}
		if (!Array.isArray(entry.products) || entry.products.length === 0
			|| entry.products.some((productId) => typeof productId !== 'string' || productId.length === 0)) {
			throw new TypeError(`Local application-menu entry ${entry.id} needs at least one product id.`);
		}
		const declaredProducts = new Set(entry.products);
		if (declaredProducts.size !== entry.products.length) {
			throw new RangeError(`Local application-menu entry ${entry.id} repeats a product id.`);
		}
		for (const productId of declaredProducts) {
			if (!productById.has(productId)) {
				throw new RangeError(`Local application-menu entry ${entry.id} names unknown product ${productId}.`);
			}
		}
		if (!APPLICATION_MENU_ENTRY_KINDS.has(entry.kind)) {
			throw new RangeError(`Local application-menu entry ${entry.id} has unsupported kind ${String(entry.kind)}.`);
		}
		const availableProducts = products.filter((product) => declaredProducts.has(product.id));
		return {
			id: entry.id,
			label: entry.label,
			shortcut: '—',
			locations: entry.locations.join('; '),
			products: productNames(availableProducts),
			origin: 'Soundscaper local',
		};
	});
}

/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertProducts, compareText, page, productNames, table } from './markdown.mjs';

export function renderCommandReference({
	manifest,
	implementedStatus,
	products,
	source,
	isProductCommandDisabled,
}) {
	assertProducts(products);
	if (!manifest || typeof manifest !== 'object') throw new TypeError('The action manifest is required.');
	if (typeof isProductCommandDisabled !== 'function') throw new TypeError('The product command filter is required.');
	if (!source?.commit || !source?.url || !source?.version) throw new TypeError('Audacity source provenance is required.');

	const commands = [];
	for (const definition of Object.values(manifest)) {
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
	commands.sort((left, right) => compareText(left.label, right.label) || compareText(left.id, right.id));

	const shortCommit = source.commit.slice(0, 12);
	const body = [
		`This inventory contains commands marked as implemented in the runtime action manifest. Audacity-derived entries are reviewed against Audacity ${source.version} at [\`${shortCommit}\`](${source.url}). Local entries are identified separately.`,
		'',
		'Product availability follows each product profile’s command filters. “—” means that no default shortcut is assigned; it does not mean the command is unavailable.',
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

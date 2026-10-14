/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repositoryRevision } from './e2e-coverage-integrity.mjs';
import { webBuildRouting } from './product-web-routing.mjs';
import { fileDigest, recordVerifiedInputTree, verifyInputTree } from './verified-ci-input-tree.ts';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../..');
interface HandbookOptions {
	readonly repositoryRoot?: string;
	readonly buildRoot?: string;
	readonly receipt?: string;
	readonly sourceRevision?: string;
}

function options(value: HandbookOptions) {
	const repositoryRoot = resolve(value.repositoryRoot ?? REPOSITORY_ROOT);
	const routing = webBuildRouting({ SCAPE_PRODUCT: 'soundscaper' });
	const identity = JSON.stringify({ schemaVersion: 1, productId: routing.productId,
		sourceRevision: value.sourceRevision ?? repositoryRevision(repositoryRoot),
		origin: routing.site.origin, handbook: routing.handbook,
		inputs: ['.nvmrc', 'package-lock.json', 'handbook/astro.config.mjs',
			'scripts/lib/product-web-routing.mjs', 'scripts/lib/ci-handbook-build.ts',
			'scripts/lib/verified-ci-input-tree.ts'].map(file => [file, fileDigest(resolve(repositoryRoot, file))]),
	});
	return { root: resolve(value.buildRoot ?? resolve(repositoryRoot, 'handbook/dist')),
		receipt: resolve(value.receipt ?? resolve(repositoryRoot, 'handbook/.ci-build.json')),
		identity, preserveModes: false, routing };
}

export function recordCiHandbookBuild(value: HandbookOptions = {}): void {
	const selected = options(value);
	const document = readFileSync(resolve(selected.root, 'index.html'), 'utf8');
	const canonical = /<link\b[^>]*\brel="canonical"[^>]*\bhref="([^"]+)"/u.exec(document)?.[1];
	if (canonical !== new URL(selected.routing.handbook.scope, selected.routing.site.origin).href
		|| !document.includes(`"${selected.routing.handbook.assetScope}`)) {
		throw new Error('The checked handbook was built for another product or routing.');
	}
	recordVerifiedInputTree(selected);
}

export function verifyCiHandbookBuild(value: HandbookOptions = {}): void {
	if (!verifyInputTree(options(value))) {
		throw new Error('The checked Soundscaper handbook artifact changed or belongs to another source revision.');
	}
}

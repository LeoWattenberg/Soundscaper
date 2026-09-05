// @ts-check
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { chunkGroups, workerChunkGroups } from './scripts/lib/build-chunk-groups.mjs';
import {
	emitDesktopRendererProductPublicAssets,
	enforceDesktopRendererProductIsolation,
} from './scripts/lib/desktop-renderer-product-isolation.mjs';
import { productResolveAliases } from './scripts/lib/product-aliases.mjs';
import {
	readProductReleaseLinesSync,
	resolveProductApplicationVersion,
} from './scripts/lib/product-release-lines.mjs';
import { authoredWildcardResponseHeaders } from './scripts/lib/static-response-headers.mjs';
import { enforceStartupGraphBudgets } from './scripts/lib/startup-graph-budget.mjs';
import scopeAudacityDesignSystemCss, {
	getScopedDesignSystemFiles,
	isDesignSystemCssFile,
	normalizeDesignSystemCssFile,
	resetScopedDesignSystemFileCount,
} from './scripts/postcss-audacity-design-system.mjs';
import { createPffftNodeModuleBrowserShim } from './scripts/vite-pffft-browser-shim.mjs';
import { PRODUCT_IDS, normalizeProductId } from './src/common/product-identities.js';

const productId = resolveBuiltProductId(process.env.SCAPE_PRODUCT);
const applicationVersion = resolveProductApplicationVersion(
	productId, readProductReleaseLinesSync(import.meta.dirname),
);
const desktopCodecComposition = process.env.SCAPE_DESKTOP_CODEC_RUNTIME === 'main-process';

/**
 * The one product this build emits, named by SCAPE_PRODUCT.
 *
 * Each product is deployed from its own Cloudflare Pages project built from this
 * one repository, so the product is a build input rather than a runtime guess. An
 * unset value still means Soundscaper, because that is what every existing
 * invocation of `npm run build` means. Anything else that is not a registered
 * product id fails here: a two-way ternary would answer an unrecognized value by
 * quietly emitting a Soundscaper bundle and deploying it to the other origin.
 *
 * @param {string | undefined} value
 * @returns {'soundscaper' | 'framescaper'}
 */
function resolveBuiltProductId(value) {
	const requested = value === undefined || value === '' ? 'soundscaper' : value;
	if (!PRODUCT_IDS.includes(requested)) {
		throw new Error(
			`SCAPE_PRODUCT must name a built product (${PRODUCT_IDS.join(', ')}); received ${JSON.stringify(value)}.`,
		);
	}
	// `normalizeProductId` re-admits the id against the shared product table; the
	// cast only narrows its `string` return to the two ids just checked above.
	return /** @type {'soundscaper' | 'framescaper'} */ (normalizeProductId(requested));
}

/** @returns {import('vite').Plugin} */
function assertDesignSystemCssScoped() {
	const transformed = new Set();
	return {
		name: 'kw-assert-design-system-css-scoped',
		apply: 'build',
		buildStart() {
			transformed.clear();
			resetScopedDesignSystemFileCount();
		},
		transform(_code, id) {
			if (isDesignSystemCssFile(id)) transformed.add(normalizeDesignSystemCssFile(id));
			return null;
		},
		closeBundle() {
			const expected = [...transformed].sort();
			const scoped = getScopedDesignSystemFiles();
			if (!expected.length || JSON.stringify(scoped) !== JSON.stringify(expected)) {
				const missing = expected.filter((file) => !scoped.includes(file));
				const unexpected = scoped.filter((file) => !transformed.has(file));
				throw new Error(
					'Design-system CSS scoping did not match Vite\'s exact transformed inventory. '
					+ `Missing: ${missing.join(', ') || 'none'}. Unexpected: ${unexpected.join(', ') || 'none'}.`,
				);
			}
		},
	};
}
export default defineConfig({
	appType: 'spa',
	// The Playwright suite serves a real production build through `vite preview`,
	// which does not apply `public/_headers` because that is a Cloudflare Pages
	// artifact. Handing the preview server the authored wildcard rule is what
	// makes the suite exercise the shipped content security policy and the
	// cross-origin isolation the editor depends on, instead of a configuration no
	// user ever gets.
	preview: { headers: authoredWildcardResponseHeaders() },
	publicDir: productId === 'soundscaper' && desktopCodecComposition ? false : 'public',
	plugins: [
		createPffftNodeModuleBrowserShim(),
		react(),
		assertDesignSystemCssScoped(),
		enforceStartupGraphBudgets(productId),
		...(productId === 'soundscaper' && desktopCodecComposition
			? [emitDesktopRendererProductPublicAssets(import.meta.dirname, productId)]
			: []),
		...(desktopCodecComposition ? [enforceDesktopRendererProductIsolation(productId)] : []),
	],
	resolve: {
		// File-targeted public aliases plus an app-internal deep component alias.
		// Public deep subpath imports remain unsupported. The product substitution
		// rows live in scripts/lib/product-aliases.mjs so the export-parity guard
		// reads the same table this build resolves through.
		//
		// Only the design-system rows are mirrored in tsconfig.base.json "paths",
		// and the substitution rows cannot join them: `paths` is consulted for
		// non-relative specifiers only, while every substitution row keys on the
		// relative specifier its importer wrote, and one `paths` map could not
		// answer two products' substitutions in opposite directions anyway. So
		// tsc, editors, dependency-cruiser and tsx-run node tests all see the
		// default (unsubstituted) target, and the stand-ins are analysed against
		// no consumer. tests/build-product-alias-export-parity.test.ts is what
		// stands in for the check the compiler cannot make.
		alias: productResolveAliases({
			productId,
			desktopCodecComposition,
			repositoryRoot: import.meta.dirname,
		}),
	},
	envPrefix: ['VITE_', 'PUBLIC_'],
	define: {
		__SCAPE_PRODUCT__: JSON.stringify(productId),
		__SCAPE_VERSION__: JSON.stringify(applicationVersion),
	},
	worker: {
		format: 'es',
		plugins: () => [createPffftNodeModuleBrowserShim()],
		rolldownOptions: {
			output: {
				codeSplitting: {
					groups: workerChunkGroups,
					minSize: 20_000,
				},
				strictExecutionOrder: true,
			},
		},
	},
	build: {
		manifest: '.offline-build-manifest.json',
		assetsInlineLimit: 0,
		rolldownOptions: {
			output: {
				codeSplitting: {
					groups: chunkGroups,
					minSize: 20_000,
				},
				strictExecutionOrder: true,
			},
		},
	},
	css: {
		postcss: {
			plugins: [scopeAudacityDesignSystemCss()],
		},
	},
});

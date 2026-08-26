// @ts-check
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { chunkGroups, workerChunkGroups } from './scripts/lib/build-chunk-groups.mjs';
import { enforceStartupGraphBudgets } from './scripts/lib/startup-graph-budget.mjs';
import scopeAudacityDesignSystemCss, {
	getScopedDesignSystemFiles,
	isDesignSystemCssFile,
	normalizeDesignSystemCssFile,
	resetScopedDesignSystemFileCount,
} from './scripts/postcss-audacity-design-system.mjs';
import { createPffftNodeModuleBrowserShim } from './scripts/vite-pffft-browser-shim.mjs';

if (Object.hasOwn(process.env, 'PUBLIC_FFMPEG_CORE_BASE_URL')) {
	throw new Error(
		'PUBLIC_FFMPEG_CORE_BASE_URL is unsupported; production FFmpeg must use the full-manifest-digest release.',
	);
}

const productId = process.env.SCAPE_PRODUCT === 'framescaper' ? 'framescaper' : 'soundscaper';
const vendoredDesignSystem = resolve(import.meta.dirname, 'vendor/audacity-design-system');
const desktopCodecComposition = process.env.SCAPE_DESKTOP_CODEC_RUNTIME === 'main-process';
const ffmpegRuntimeManifestBytes = readFileSync(resolve(import.meta.dirname, 'config/ffmpeg-runtime-manifest.json'));
const ffmpegRuntimeManifestSha256 = createHash('sha256').update(ffmpegRuntimeManifestBytes).digest('hex');

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
	plugins: [
		createPffftNodeModuleBrowserShim(),
		react(),
		assertDesignSystemCssScoped(),
		enforceStartupGraphBudgets(),
	],
	resolve: {
		// File-targeted public aliases plus an app-internal deep component alias.
		// Public deep subpath imports remain unsupported. Mirrored in
		// tsconfig.base.json "paths" for tsc, editors, and tsx-run node tests.
		alias: [
			...(desktopCodecComposition ? [
				{
					find: /^\.\/editor-codec-runtime\.ts$/u,
					replacement: resolve(import.meta.dirname, 'src/common/editor/editor-codec-runtime.desktop.ts'),
				},
				{
					find: /^\.\/OfflineRuntimePreferencePanel\.tsx$/u,
					replacement: resolve(import.meta.dirname, 'src/common/editor/ui/dialogs/OfflineRuntimePreferencePanel.desktop.tsx'),
				},
			] : []),
			{
				find: /^@soundscaper\/design-system\/(.+)$/u,
				replacement: resolve(vendoredDesignSystem, 'components/src/$1'),
			},
			{ find: '@dilsonspickles/components', replacement: resolve(vendoredDesignSystem, 'components/src/index.ts') },
			{ find: '@audacity-ui/core', replacement: resolve(vendoredDesignSystem, 'core/src/index.ts') },
			{ find: '@audacity-ui/tokens', replacement: resolve(vendoredDesignSystem, 'tokens/src/index.ts') },
		],
	},
	envPrefix: ['VITE_', 'PUBLIC_'],
	define: {
		__SCAPE_PRODUCT__: JSON.stringify(productId),
		__FFMPEG_RUNTIME_MANIFEST_SHA256__: JSON.stringify(ffmpegRuntimeManifestSha256),
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

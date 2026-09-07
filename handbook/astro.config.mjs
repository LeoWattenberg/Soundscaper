import sitemap from '@astrojs/sitemap';
import { unified } from '@astrojs/markdown-remark';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import rehypeAccessibleTables from './src/plugins/rehype-accessible-tables.mjs';
import rehypeHandbookBase from './src/plugins/rehype-handbook-base.mjs';
import rehypeHandbookHeadingIds from './src/plugins/rehype-handbook-heading-ids.mjs';
import rehypeVerdictTables from './src/plugins/rehype-verdict-tables.mjs';
import { chromeLabel, chromeRecord } from '../scripts/lib/handbook-chrome.mjs';
import { starlightLocaleConfig } from '../scripts/lib/handbook-locales.mjs';
import { handbookPlan } from '../scripts/lib/product-web-routing.mjs';
import { SOUNDSCAPER_GUIDE_GROUPS } from './guides/soundscaper.mjs';

export default defineConfig({
	// The handbook is a path on the product origin, not a subdomain of its own:
	// `scripts/lib/product-web-routing.mjs` owns that decision and the Cloudflare
	// rules that follow from it, and `scripts/stage-handbook-build.mjs` copies
	// this build into the product's `dist` under the same base path.
	site: 'https://soundscaper.org',
	base: handbookPlan('soundscaper').basePath,
	output: 'static',
	markdown: {
		processor: unified({
			rehypePlugins: [rehypeHandbookHeadingIds, rehypeAccessibleTables, rehypeVerdictTables, rehypeHandbookBase],
		}),
	},
	integrations: [
		sitemap(),
		starlight({
			// The site's own copy and the sidebar headings are the only navigation
			// a page title does not translate on its own, so they come from
			// `scripts/lib/handbook-chrome.mjs` with whatever each language has.
			title: chromeRecord('site.title'),
			// Starlight takes one site description rather than one per language;
			// the description a reader sees is the page's own frontmatter.
			description: 'Guides and reference documentation for Soundscaper and Framescaper.',
			editLink: {
				baseUrl: 'https://github.com/LeoWattenberg/Soundscaper/edit/main/handbook/',
			},
			lastUpdated: true,
			// Which languages exist is decided by the content tree itself; see
			// `scripts/lib/handbook-locales.mjs`. English is the `root` entry, so
			// its pages keep the bare base path and stand in for any page a
			// language has not been translated yet.
			defaultLocale: 'root',
			locales: starlightLocaleConfig(),
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/LeoWattenberg/Soundscaper',
				},
			],
			sidebar: [
				{ ...chromeLabel('sidebar.start'), items: [{ autogenerate: { directory: 'start' } }] },
				{ ...chromeLabel('sidebar.soundscaper'), items: [{ autogenerate: { directory: 'soundscaper' } }] },
				{ ...chromeLabel('sidebar.tutorials'), items: [{ autogenerate: { directory: 'tutorials' } }] },
				// One sidebar group per guide category, built from the same catalog
				// the pages are generated from, so a new category needs no edit here.
				{
					...chromeLabel('sidebar.guides'),
					items: [
						{ ...chromeLabel('sidebar.guides.all'), link: '/guides/' },
						...SOUNDSCAPER_GUIDE_GROUPS.map((group) => ({
							...chromeLabel(`sidebar.guides.${group.slug}`),
							collapsed: true,
							items: [{ autogenerate: { directory: `guides/${group.slug}` } }],
						})),
					],
				},
				{ ...chromeLabel('sidebar.framescaper'), items: [{ autogenerate: { directory: 'framescaper' } }] },
				{ ...chromeLabel('sidebar.projects-and-data'), items: [{ autogenerate: { directory: 'projects-and-data' } }] },
				{ ...chromeLabel('sidebar.help'), items: [{ autogenerate: { directory: 'help' } }] },
				{
					...chromeLabel('sidebar.reference'),
					items: [
						{ ...chromeLabel('sidebar.reference.overview'), link: '/reference/' },
						{ ...chromeLabel('sidebar.reference.commands'), link: '/reference/generated/commands/' },
						{ ...chromeLabel('sidebar.reference.formats'), link: '/reference/generated/formats/' },
						{ ...chromeLabel('sidebar.reference.product-capabilities'), link: '/reference/generated/product-capabilities/' },
						{ ...chromeLabel('sidebar.reference.audio-effects'), link: '/reference/generated/audio-effects/' },
						{ ...chromeLabel('sidebar.reference.video-effects'), link: '/reference/generated/video-effects/' },
						{ ...chromeLabel('sidebar.reference.nyquist-plugins'), link: '/reference/generated/nyquist-plugins/' },
						{ ...chromeLabel('sidebar.reference.macro-programs'), link: '/reference/macro-programs/' },
						{ ...chromeLabel('sidebar.reference.local-assistance'), link: '/reference/generated/local-assistance/' },
						{ ...chromeLabel('sidebar.reference.workspaces'), link: '/reference/generated/workspaces/' },
						{ ...chromeLabel('sidebar.reference.project-files'), link: '/reference/generated/project-files/' },
						{ ...chromeLabel('sidebar.reference.languages'), link: '/reference/generated/languages/' },
						{ ...chromeLabel('sidebar.reference.platforms'), link: '/reference/generated/platforms/' },
					],
				},
			],
			customCss: ['./src/styles/custom.css'],
		}),
	],
});

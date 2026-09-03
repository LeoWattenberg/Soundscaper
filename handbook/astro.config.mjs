import sitemap from '@astrojs/sitemap';
import { unified } from '@astrojs/markdown-remark';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import rehypeAccessibleTables from './src/plugins/rehype-accessible-tables.mjs';
import rehypeHandbookBase from './src/plugins/rehype-handbook-base.mjs';
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
		processor: unified({ rehypePlugins: [rehypeAccessibleTables, rehypeHandbookBase] }),
	},
	integrations: [
		sitemap(),
		starlight({
			title: 'Soundscaper Handbook',
			description: 'Guides and reference documentation for Soundscaper and Framescaper.',
			editLink: {
				baseUrl: 'https://github.com/LeoWattenberg/Soundscaper/edit/main/handbook/',
			},
			lastUpdated: true,
			locales: {
				root: {
					label: 'English',
					lang: 'en',
				},
			},
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/LeoWattenberg/Soundscaper',
				},
			],
			sidebar: [
				{ label: 'Start here', items: [{ autogenerate: { directory: 'start' } }] },
				{ label: 'Soundscaper', items: [{ autogenerate: { directory: 'soundscaper' } }] },
				{ label: 'Tutorials', items: [{ autogenerate: { directory: 'tutorials' } }] },
				// One sidebar group per guide category, built from the same catalog
				// the pages are generated from, so a new category needs no edit here.
				{
					label: 'How-to guides',
					items: [
						{ label: 'All guides', link: '/guides/' },
						...SOUNDSCAPER_GUIDE_GROUPS.map((group) => ({
							label: group.title,
							collapsed: true,
							items: [{ autogenerate: { directory: `guides/${group.slug}` } }],
						})),
					],
				},
				{ label: 'Framescaper', items: [{ autogenerate: { directory: 'framescaper' } }] },
				{ label: 'Projects and data', items: [{ autogenerate: { directory: 'projects-and-data' } }] },
				{ label: 'Help', items: [{ autogenerate: { directory: 'help' } }] },
				{
					label: 'Reference',
					items: [
						{ label: 'Overview', link: '/reference/' },
						{ label: 'Commands and shortcuts', link: '/reference/generated/commands/' },
						{ label: 'Export formats', link: '/reference/generated/formats/' },
						{ label: 'Product capabilities', link: '/reference/generated/product-capabilities/' },
						{ label: 'Audio effects', link: '/reference/generated/audio-effects/' },
						{ label: 'Video effects', link: '/reference/generated/video-effects/' },
						{ label: 'Nyquist plug-ins', link: '/reference/generated/nyquist-plugins/' },
						{ label: 'Local assistance', link: '/reference/generated/local-assistance/' },
						{ label: 'Workspaces and panels', link: '/reference/generated/workspaces/' },
						{ label: 'Project and label files', link: '/reference/generated/project-files/' },
						{ label: 'Languages', link: '/reference/generated/languages/' },
						{ label: 'Platforms and packages', link: '/reference/generated/platforms/' },
					],
				},
			],
			customCss: ['./src/styles/custom.css'],
		}),
	],
});

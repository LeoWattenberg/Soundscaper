import sitemap from '@astrojs/sitemap';
import { unified } from '@astrojs/markdown-remark';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import rehypeAccessibleTables from './src/plugins/rehype-accessible-tables.mjs';

export default defineConfig({
	site: 'https://docs.soundscaper.org',
	output: 'static',
	markdown: {
		processor: unified({ rehypePlugins: [rehypeAccessibleTables] }),
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
					],
				},
			],
			customCss: ['./src/styles/custom.css'],
		}),
	],
});

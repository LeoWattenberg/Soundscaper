import type {
	DesktopNightlyTestsEnvironment,
	DesktopNightlyTestsStaticServer,
} from './desktop-nightly-tests-runtime.mjs';

export interface DesktopNightlyTestsProductSites {
	readonly origins: Readonly<{
		readonly soundscaper: string;
		readonly framescaper: string;
	}>;
	readonly browserEnvironment: DesktopNightlyTestsEnvironment;
	close(): Promise<void>;
}

export interface DesktopNightlyTestsProductSitePlan {
	readonly host: '127.0.0.1';
	readonly origin: string;
	readonly port: number;
	readonly productId: 'soundscaper' | 'framescaper';
	readonly root: string;
}

export function loadDesktopNightlyTestsProductSitePlans(
	payloadRoot: string,
): Promise<readonly DesktopNightlyTestsProductSitePlan[]>;

export function startDesktopNightlyTestsProductSites(options: {
	readonly payloadRoot: string;
	readonly environment?: DesktopNightlyTestsEnvironment;
	readonly startStaticServer: (options: {
		readonly root: string;
		readonly host: string;
		readonly port: number;
	}) => Promise<DesktopNightlyTestsStaticServer>;
}): Promise<DesktopNightlyTestsProductSites>;

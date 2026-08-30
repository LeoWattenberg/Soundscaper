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

export function startDesktopNightlyTestsProductSites(options: {
	readonly payloadRoot: string;
	readonly environment?: DesktopNightlyTestsEnvironment;
	readonly startStaticServer: (options: {
		readonly root: string;
	}) => Promise<DesktopNightlyTestsStaticServer>;
}): Promise<DesktopNightlyTestsProductSites>;

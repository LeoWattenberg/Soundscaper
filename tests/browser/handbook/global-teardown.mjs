import { stopHandbookPreview } from './global-setup.mjs';

export default function globalTeardown() {
	stopHandbookPreview();
}

export function isAllowedHost(hostname: string, allowedHosts: string[]) {
	const normalizedHost = hostname.toLowerCase();
	return allowedHosts.some(entry => {
		const normalizedEntry = normalizeAllowedHost(entry);
		if (!normalizedEntry) {
			return false;
		}
		if (normalizedEntry.startsWith('*.')) {
			return normalizedHost.endsWith(normalizedEntry.slice(1));
		}
		return normalizedHost === normalizedEntry;
	});
}

export function normalizeAllowedHost(entry: string) {
	const trimmed = entry.trim().toLowerCase();
	if (!trimmed) {
		return undefined;
	}
	if (trimmed.includes('://')) {
		return new URL(trimmed).hostname;
	}
	return trimmed.split('/')[0];
}
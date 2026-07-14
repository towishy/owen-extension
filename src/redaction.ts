export type RedactionProfile = 'off' | 'standard' | 'strict';

export function redactSensitiveText(value: string | undefined, profile: RedactionProfile, customPatterns: string[] = [], onInvalidPattern?: (pattern: string) => void) {
	if (!value || profile === 'off') {
		return value;
	}

	let redacted = value
		.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
		.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted-ip]')
		.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[redacted-guid]')
		.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted-token]')
		.replace(/(access_token|refresh_token|id_token|sessionid|session_id|sid)=([^\s&]+)/gi, '$1=[redacted-token]');

	if (profile === 'strict') {
		redacted = redacted
			.replace(/\b(?:[A-Za-z0-9+/]{20,}={0,2})\b/g, '[redacted-long-token]')
			.replace(/\b(?:[0-9a-f]{32,})\b/gi, '[redacted-hex-token]');
	}

	for (const pattern of customPatterns) {
		try {
			redacted = redacted.replace(new RegExp(pattern, 'g'), '[redacted-custom]');
		} catch {
			onInvalidPattern?.(pattern);
		}
	}

	return redacted;
}
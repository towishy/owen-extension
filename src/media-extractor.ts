import { load } from 'cheerio';

export type MediaKind = 'image' | 'video' | 'audio';
export type MediaFilter = 'all' | MediaKind;
export type MediaCandidateSource = 'element' | 'metadata' | 'json-ld' | 'script' | 'css' | 'network' | 'platform';

export type MediaCandidate = {
	url: string;
	kind: MediaKind;
	source: MediaCandidateSource;
	mimeType?: string;
	thumbnailUrl?: string;
	width?: number;
	height?: number;
	durationSeconds?: number;
	platform?: string;
	ephemeral: boolean;
};

export type PublicMediaExtraction = {
	pageUrl: string;
	pageTitle?: string;
	candidates: MediaCandidate[];
	strategies: string[];
	warnings: string[];
	complete: boolean;
	truncated: boolean;
};

type FetchLike = typeof fetch;

const MEDIA_EXTENSIONS = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp|m4a|mp3|ogg|oga|wav|aac|flac|m3u8|mp4|m4v|mov|webm|ogv|mpd)(?:$|[?#])/i;
const VIDEO_EXTENSIONS = /\.(?:m3u8|mp4|m4v|mov|webm|ogv|mpd)(?:$|[?#])/i;
const AUDIO_EXTENSIONS = /\.(?:m4a|mp3|ogg|oga|wav|aac|flac)(?:$|[?#])/i;
const SIGNED_QUERY_KEYS = ['expires', 'expiry', 'exp', 'oe', 'oh', 'signature', 'sig', 'token', 'policy', 'key-pair-id'];

export function parseInstagramPostUrl(value: string) {
	const url = parsePublicHttpUrl(value);
	if (!/(^|\.)instagram\.com$/i.test(url.hostname)) {
		return undefined;
	}
	const match = url.pathname.match(/^\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)(?:\/|$)/);
	if (!match) {
		return undefined;
	}
	return {
		shortcode: match[1],
		embedUrl: `https://www.instagram.com/p/${match[1]}/embed/captioned/`
	};
}

export function decodeInstagramContextJson(html: string): unknown {
	const match = html.match(/"contextJSON"\s*:\s*"((?:\\.|[^"\\])*)"/);
	if (!match) {
		throw new Error('Instagram embed response did not contain contextJSON. The post may be private, restricted, unavailable, or the response format may have changed.');
	}

	let decoded: unknown;
	try {
		decoded = JSON.parse(`"${match[1]}"`);
		return JSON.parse(String(decoded));
	} catch {
		throw new Error('Instagram contextJSON was present but could not be decoded.');
	}
}

export function extractInstagramMedia(html: string, pageUrl: string): MediaCandidate[] {
	const payload = decodeInstagramContextJson(html) as {
		gql_data?: {
			shortcode_media?: Record<string, unknown>;
		};
	};
	const media = payload.gql_data?.shortcode_media;
	if (!media) {
		throw new Error('Instagram contextJSON did not contain gql_data.shortcode_media.');
	}

	const sidecar = media.edge_sidecar_to_children as { edges?: Array<{ node?: Record<string, unknown> }> } | undefined;
	const nodes = Array.isArray(sidecar?.edges) && sidecar.edges.length > 0
		? sidecar.edges.map(edge => edge.node)
		: [media];
	const candidates = nodes.map((node, index) => {
		if (!node) {
			throw new Error(`Instagram carousel item ${index + 1} did not contain a media node.`);
		}
		const isVideo = node.is_video === true;
		const url = isVideo ? node.video_url : node.display_url;
		if (typeof url !== 'string' || !url.trim()) {
			throw new Error(`Instagram ${isVideo ? 'video' : 'image'} item ${index + 1} did not contain its original media URL.`);
		}
		const dimensions = node.dimensions as { width?: unknown; height?: unknown } | undefined;
		return createCandidate({
			url,
			kind: isVideo ? 'video' : 'image',
			source: 'platform',
			thumbnailUrl: isVideo && typeof node.display_url === 'string' ? node.display_url : undefined,
			width: finiteNumber(dimensions?.width),
			height: finiteNumber(dimensions?.height),
			platform: 'instagram'
		}, pageUrl);
	});

	return candidates;
}

export function extractMediaFromHtml(html: string, pageUrl: string): PublicMediaExtraction {
	const baseUrl = parsePublicHttpUrl(pageUrl);
	const $ = load(html);
	const candidates: MediaCandidate[] = [];
	const warnings: string[] = [];
	const strategies = new Set<string>();
	const add = (value: Partial<MediaCandidate> & Pick<MediaCandidate, 'url' | 'kind' | 'source'>) => {
		try {
			candidates.push(createCandidate(value, baseUrl.href));
			strategies.add(value.source);
		} catch {
			warnings.push(`Ignored an invalid ${value.kind} URL from ${value.source}.`);
		}
	};

	$('meta[property], meta[name], meta[itemprop]').each((_, element) => {
		const key = ($(element).attr('property') || $(element).attr('name') || $(element).attr('itemprop') || '').toLowerCase();
		const content = $(element).attr('content');
		const kind = metadataKind(key);
		if (content && kind) {
			add({ url: content, kind, source: 'metadata' });
		}
	});

	$('img, video, audio, source, embed, object').each((_, element) => {
		const tag = element.tagName.toLowerCase();
		const parentTag = $(element).parent().prop('tagName')?.toLowerCase();
		const kind: MediaKind = tag === 'audio' || parentTag === 'audio' ? 'audio' : tag === 'video' || parentTag === 'video' ? 'video' : 'image';
		for (const attribute of ['src', 'srcset', 'poster', 'data-src', 'data-lazy-src', 'data-original', 'data'] as const) {
			const value = $(element).attr(attribute);
			for (const url of attribute === 'srcset' ? parseSrcset(value) : value ? [value] : []) {
				add({ url, kind: attribute === 'poster' ? 'image' : kind, source: 'element', mimeType: $(element).attr('type') });
			}
		}
	});

	$('script[type="application/ld+json"]').each((_, element) => {
		try {
			collectJsonLd(JSON.parse($(element).text()), add);
			strategies.add('json-ld');
		} catch {
			warnings.push('Ignored malformed JSON-LD while extracting media.');
		}
	});

	$('a[href]').each((_, element) => {
		const href = $(element).attr('href');
		if (href && MEDIA_EXTENSIONS.test(href)) {
			add({ url: href, kind: inferKind(href), source: 'element' });
		}
	});

	$('script:not([type="application/ld+json"])').each((_, element) => {
		for (const url of extractScriptMediaUrls($(element).text())) {
			add({ url, kind: inferKind(url), source: 'script' });
		}
	});

	return {
		pageUrl: baseUrl.href,
		pageTitle: $('title').first().text().trim() || undefined,
		candidates: deduplicateCandidates(candidates),
		strategies: [...strategies],
		warnings,
		complete: warnings.length === 0,
		truncated: false
	};
}

export async function extractPublicMediaFromUrl(pageUrl: string, options: {
	mediaType?: MediaFilter;
	maxItems?: number;
	timeoutMs?: number;
	fetchImpl?: FetchLike;
} = {}): Promise<PublicMediaExtraction> {
	const sourceUrl = parsePublicHttpUrl(pageUrl);
	const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 30000, 1000), 120000);
	const maxItems = Math.min(Math.max(Math.trunc(options.maxItems ?? 100), 1), 500);
	const fetchImpl = options.fetchImpl ?? fetch;
	const instagram = parseInstagramPostUrl(sourceUrl.href);
	const requestUrl = instagram?.embedUrl ?? sourceUrl.href;
	const response = await fetchImpl(requestUrl, {
		headers: {
			'User-Agent': 'Mozilla/5.0',
			Accept: 'text/html,application/xhtml+xml'
		},
		redirect: 'follow',
		signal: AbortSignal.timeout(timeoutMs)
	});
	if (response.url) {
		parsePublicHttpUrl(response.url);
	}
	if (!response.ok) {
		throw new Error(`Public media source request failed with HTTP ${response.status}. Private or restricted content is not bypassed.`);
	}
	const contentLength = Number(response.headers.get('content-length') || 0);
	const contentType = response.headers.get('content-type') || '';
	if (contentType && !/(?:text\/html|application\/xhtml\+xml)/i.test(contentType)) {
		throw new Error(`Public media source returned unsupported content type: ${contentType}.`);
	}
	if (contentLength > 5_000_000) {
		throw new Error('Public media source response exceeded the 5 MB HTML safety limit.');
	}
	const html = await response.text();
	if (html.length > 5_000_000) {
		throw new Error('Public media source response exceeded the 5 MB HTML safety limit.');
	}

	const extraction = instagram
		? {
			pageUrl: sourceUrl.href,
			candidates: extractInstagramMedia(html, sourceUrl.href),
			strategies: ['platform-adapter:instagram'],
			warnings: [] as string[],
			complete: true,
			truncated: false
		}
		: extractMediaFromHtml(html, sourceUrl.href);
	const filtered = extraction.candidates.filter(candidate => !options.mediaType || options.mediaType === 'all' || candidate.kind === options.mediaType);
	if (filtered.length === 0) {
		throw new Error(`No ${options.mediaType && options.mediaType !== 'all' ? options.mediaType : 'media'} URLs were found in the public source response.`);
	}
	const truncated = filtered.length > maxItems;
	const candidates = filtered.slice(0, maxItems);
	const warnings = [...extraction.warnings];
	if (truncated) {
		warnings.push(`Media results were limited to ${maxItems} items.`);
	}
	if (candidates.some(candidate => candidate.ephemeral)) {
		warnings.push('One or more media URLs appear signed or short-lived. Download them promptly through an operator-reviewed workflow.');
	}
	return { ...extraction, candidates, warnings, truncated, complete: extraction.complete && !truncated };
}

export function deduplicateCandidates(candidates: MediaCandidate[]) {
	const byUrl = new Map<string, MediaCandidate>();
	for (const candidate of candidates) {
		const existing = byUrl.get(candidate.url);
		if (!existing || sourcePriority(candidate.source) > sourcePriority(existing.source)) {
			byUrl.set(candidate.url, candidate);
		}
	}
	return [...byUrl.values()];
}

function createCandidate(value: Partial<MediaCandidate> & Pick<MediaCandidate, 'url' | 'kind' | 'source'>, pageUrl: string): MediaCandidate {
	const url = new URL(value.url.replace(/\\u0026/gi, '&').replace(/\\\//g, '/'), pageUrl);
	if (!['http:', 'https:', 'blob:', 'data:'].includes(url.protocol)) {
		throw new Error(`Unsupported media URL protocol: ${url.protocol}`);
	}
	return {
		url: url.href,
		kind: value.kind,
		source: value.source,
		mimeType: value.mimeType,
		thumbnailUrl: value.thumbnailUrl ? new URL(value.thumbnailUrl, pageUrl).href : undefined,
		width: value.width,
		height: value.height,
		durationSeconds: value.durationSeconds,
		platform: value.platform,
		ephemeral: value.ephemeral ?? isEphemeralUrl(url)
	};
}

function parsePublicHttpUrl(value: string) {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error('mediaExtract requires a valid absolute URL.');
	}
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
		throw new Error('mediaExtract accepts only public HTTP(S) URLs without embedded credentials.');
	}
	if (isPrivateHostname(url.hostname)) {
		throw new Error('mediaExtract public source enrichment refuses localhost, private, loopback, and link-local addresses.');
	}
	return url;
}

function isPrivateHostname(value: string) {
	const hostname = value.toLowerCase().replace(/^\[|\]$/g, '');
	if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname === '::1') {
		return true;
	}
	if (/^(?:fc|fd)[0-9a-f]{2}:/i.test(hostname) || /^fe[89ab][0-9a-f]:/i.test(hostname)) {
		return true;
	}
	const octets = hostname.split('.').map(Number);
	if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
		return false;
	}
	return octets[0] === 10
		|| octets[0] === 127
		|| (octets[0] === 169 && octets[1] === 254)
		|| (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
		|| (octets[0] === 192 && octets[1] === 168)
		|| octets[0] === 0;
}

function metadataKind(key: string): MediaKind | undefined {
	if (/^(?:(?:og|twitter):image(?::src|:url|:secure_url)?|image|thumbnailurl)$/.test(key)) { return 'image'; }
	if (/^(?:(?:og|twitter):video(?::url|:secure_url)?|twitter:player:stream|video|contenturl)$/.test(key)) { return 'video'; }
	if (/^og:audio(?::url|:secure_url)?$/.test(key)) { return 'audio'; }
	return undefined;
}

function collectJsonLd(value: unknown, add: (candidate: Pick<MediaCandidate, 'url' | 'kind' | 'source'> & Partial<MediaCandidate>) => void, inheritedKind?: MediaKind) {
	if (Array.isArray(value)) {
		for (const item of value) { collectJsonLd(item, add, inheritedKind); }
		return;
	}
	if (!value || typeof value !== 'object') { return; }
	const record = value as Record<string, unknown>;
	const type = String(record['@type'] || '').toLowerCase();
	const kind: MediaKind | undefined = type.includes('video') ? 'video' : type.includes('audio') ? 'audio' : type.includes('image') ? 'image' : inheritedKind;
	for (const [key, item] of Object.entries(record)) {
		const keyLower = key.toLowerCase();
		const keyKind: MediaKind | undefined = keyLower.includes('video') ? 'video' : keyLower.includes('audio') ? 'audio' : keyLower.includes('image') || keyLower.includes('thumbnail') ? 'image' : kind;
		if (typeof item === 'string' && keyKind && ['contenturl', 'embedurl', 'thumbnailurl', 'image', 'video', 'audio', 'url'].includes(keyLower)) {
			add({ url: item, kind: keyKind, source: 'json-ld' });
		} else {
			collectJsonLd(item, add, keyKind);
		}
	}
}

function parseSrcset(value: string | undefined) {
	return value?.split(',').map(item => item.trim().split(/\s+/)[0]).filter(Boolean) ?? [];
}

function extractScriptMediaUrls(value: string) {
	const matches = value.match(/https?:\\?\/\\?\/[^\s"'<>]+/gi) ?? [];
	return matches
		.map(item => item.replace(/\\u0026/gi, '&').replace(/\\\//g, '/').replace(/[),;]+$/, ''))
		.filter(item => MEDIA_EXTENSIONS.test(item));
}

function inferKind(url: string): MediaKind {
	if (VIDEO_EXTENSIONS.test(url)) { return 'video'; }
	if (AUDIO_EXTENSIONS.test(url)) { return 'audio'; }
	return 'image';
}

function finiteNumber(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isEphemeralUrl(url: URL) {
	const keys = new Set([...url.searchParams.keys()].map(key => key.toLowerCase()));
	return SIGNED_QUERY_KEYS.some(key => keys.has(key)) || /(?:cdninstagram|fbcdn)\./i.test(url.hostname);
}

function sourcePriority(source: MediaCandidateSource) {
	return source === 'platform' ? 7 : source === 'element' ? 6 : source === 'network' ? 5 : source === 'json-ld' ? 4 : source === 'metadata' ? 3 : source === 'css' ? 2 : 1;
}
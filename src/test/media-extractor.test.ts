import * as assert from 'node:assert';
import {
    decodeInstagramContextJson,
    extractInstagramMedia,
    extractMediaFromHtml,
    extractPublicMediaFromUrl
} from '../media-extractor';

suite('Media Extractor', () => {
	test('extracts and deduplicates standard HTML media sources', () => {
		const result = extractMediaFromHtml(`
			<html><head>
				<title>Media page</title>
				<meta property="og:image" content="/cover.jpg">
				<meta property="og:image:secure_url" content="/cover.jpg">
				<script type="application/ld+json">{"@type":"VideoObject","contentUrl":"https://cdn.example.test/movie.mp4","thumbnailUrl":"/cover.jpg"}</script>
			</head><body>
				<img src="/cover.jpg"><img data-lazy-src="/lazy.webp">
				<video controls><source src="/movie.mp4" type="video/mp4"></video>
				<a href="/audio.mp3">audio</a>
			</body></html>
		`, 'https://example.test/post/1');

		assert.strictEqual(result.pageTitle, 'Media page');
		assert.deepStrictEqual(result.candidates.map(item => [item.kind, item.url]), [
			['image', 'https://example.test/cover.jpg'],
			['image', 'https://example.test/lazy.webp'],
			['video', 'https://example.test/movie.mp4'],
			['video', 'https://cdn.example.test/movie.mp4'],
			['audio', 'https://example.test/audio.mp3']
		]);
	});

	test('double-decodes Instagram contextJSON and normalizes carousel videos', () => {
		const payload = {
			gql_data: {
				shortcode_media: {
					edge_sidecar_to_children: {
						edges: [
							{ node: { is_video: false, display_url: 'https://cdninstagram.example/photo.jpg', dimensions: { width: 1080, height: 1080 } } },
							{ node: { is_video: true, display_url: 'https://cdninstagram.example/cover.jpg', video_url: 'https://cdninstagram.example/video.mp4?oe=123' } }
						]
					}
				}
			}
		};
		const escaped = JSON.stringify(JSON.stringify(payload)).slice(1, -1);
		const html = `<script>window.__additionalDataLoaded({"contextJSON":"${escaped}"});</script>`;

		assert.deepStrictEqual(decodeInstagramContextJson(html), payload);
		const candidates = extractInstagramMedia(html, 'https://www.instagram.com/p/ABC123/');
		assert.strictEqual(candidates.length, 2);
		assert.strictEqual(candidates[1].kind, 'video');
		assert.strictEqual(candidates[1].url, 'https://cdninstagram.example/video.mp4?oe=123');
		assert.strictEqual(candidates[1].thumbnailUrl, 'https://cdninstagram.example/cover.jpg');
		assert.strictEqual(candidates[1].ephemeral, true);
	});

	test('fails explicitly when an Instagram carousel item lacks original media', () => {
		const payload = { gql_data: { shortcode_media: { edge_sidecar_to_children: { edges: [{ node: { is_video: true, display_url: 'https://example.test/cover.jpg' } }] } } } };
		const escaped = JSON.stringify(JSON.stringify(payload)).slice(1, -1);
		assert.throws(
			() => extractInstagramMedia(`{"contextJSON":"${escaped}"}`, 'https://www.instagram.com/p/ABC123/'),
			/original media URL/
		);
	});

	test('uses a minimal user agent and rejects empty filtered results', async () => {
		let userAgent = '';
		const fetchImpl: typeof fetch = async (_input, init) => {
			userAgent = String(new Headers(init?.headers).get('user-agent'));
			return new Response('<meta property="og:image" content="https://example.test/photo.jpg">', {
				status: 200,
				headers: { 'content-type': 'text/html' }
			});
		};

		await assert.rejects(
			() => extractPublicMediaFromUrl('https://example.test/post', { mediaType: 'video', fetchImpl }),
			/No video URLs/
		);
		assert.strictEqual(userAgent, 'Mozilla/5.0');
	});

	test('refuses private and loopback public-source URLs before fetch', async () => {
		let requested = false;
		const fetchImpl: typeof fetch = async () => {
			requested = true;
			return new Response('<html></html>');
		};

		await assert.rejects(
			() => extractPublicMediaFromUrl('http://127.0.0.1/private', { fetchImpl }),
			/refuses localhost, private, loopback, and link-local/
		);
		await assert.rejects(
			() => extractPublicMediaFromUrl('http://192.168.1.10/private', { fetchImpl }),
			/refuses localhost, private, loopback, and link-local/
		);
		assert.strictEqual(requested, false);
	});
});
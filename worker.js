const STATS_EXCLUDED_IDS = new Map([
	['1923990111', "Used as the example link, excluded so it doesn't inflate view counts."]
]);

// view beacons from user agents that look automated (crawlers, scripted
// clients, headless browsers) are ignored, so only real visits count. App
// names (discord, slack, twitter...) are deliberately absent: their preview
// bots run no JS so never beacon, but their in-app browsers are real users
const BOT_UA_PATTERN = /bot|crawl|spider|slurp|facebookexternalhit|embedly|headless|phantom|puppeteer|playwright|selenium|lighthouse|curl|wget|python|go-http-client|java\/|okhttp|node-fetch|axios|undici|libwww|httpclient|postman|insomnia/i;

// one counted view per IP per item in this window
const VIEW_DEDUPE_SECONDS = 1800;

// outbound fetch timeouts, so a hung upstream can't pin a request open
const STEAM_API_TIMEOUT_MS = 5000;
const IMAGE_PROBE_TIMEOUT_MS = 2000;

// inline styles stay allowed (a few elements still use style=""), scripts are same-origin only
const SECURITY_HEADERS = {
	"Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"Permissions-Policy": "camera=(), microphone=(), geolocation=(), browsing-topics=()",
	"Strict-Transport-Security": "max-age=31536000",
	"Cross-Origin-Opener-Policy": "same-origin"
};

function htmlHeaders(cacheControl) {
	return {
		...SECURITY_HEADERS,
		"Content-Type": "text/html; charset=utf-8",
		"Cache-Control": cacheControl
	};
}

// plain-text error bodies; nosniff keeps browsers from guessing them into HTML
function textResponse(body, status) {
	return new Response(body, {
		status,
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"X-Content-Type-Options": "nosniff"
		}
	});
}

const LANDING_DESCRIPTION = "Share Steam Workshop items in Discord with direct client links";
const STATS_DESCRIPTION = "See how often SteamRelink links get opened, broken down by Workshop item and game";

function workshopPageUrl(id) {
	return `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;
}

function escapeHtml(str) {
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

// server-rendered fallback for /stats "Last Viewed"
function formatLastViewedFallback(iso) {
	const d = new Date(iso);
	if (!iso || isNaN(d)) return 'Never';

	const pad = n => String(n).padStart(2, '0');
	const date = `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;
	let hours = d.getUTCHours();
	const ampm = hours >= 12 ? 'PM' : 'AM';
	hours = hours % 12 || 12;
	const time = `${pad(hours)}:${pad(d.getUTCMinutes())} ${ampm} UTC`;

	return `<span class="lv-date">${date}</span><span class="lv-time">${time}</span>`;
}

// shared <head>; extra = page-specific tags
function renderHead(title, extra = "") {
	return `<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>${title}</title>
	<meta name="theme-color" content="#171a21">
	${extra}
	<link rel="icon" type="image/png" sizes="32x32" href="/images/SteamRelink-32x32.png">
	<link rel="icon" type="image/png" sizes="16x16" href="/images/SteamRelink-16x16.png">
	<link rel="stylesheet" href="/styles.css">`;
}

function renderFooter() {
	return `<a href="https://github.com/Nonunon/SteamRelink" target="_blank" rel="noopener" class="credit">
		<img src="/images/SteamRelink-32x32.png" alt="">
		<span>SteamRelink on GitHub</span>
	</a>`;
}

// wraps content in the .rectangle card, with the title floated on top of it
function renderCard(innerHtml, extraClass = "") {
	return `<div class="card">
		<div class="rectangle${extraClass ? ' ' + extraClass : ''}">
			${innerHtml}
		</div>
		<a href="/" class="title" id="title">SteamRelink</a>
	</div>`;
}

function renderIntro() {
	return `<div class="text">
			This page helps redirect <b><i>Steam Workshop</i></b> links for use in <b><i>Discord</i></b>, where direct linking via <u>steam://</u> is restricted. This should open the <b><i>Steam</i></b> item directly in your Steam client.
		</div>`;
}

// countdownSeconds: pass a number for the live workshop-page countdown, omit for the static landing-page text
function renderInstructions(countdownSeconds = null) {
	const step6 = countdownSeconds !== null
		? `<b><span id='countdown'>${countdownSeconds}</span> seconds</b>`
		: `<b>10 seconds</b>`;

	return `<p><b>How to Use SteamRelink:</b></p>
			<ol class="steps">
				<li>Go to the <i>Steam Workshop</i> item you want to share.</li>
				<li>Copy the Workshop ID in the URL after <code>?id=</code>.</li>
				<li>Add it to this page's URL as <code>?id=WORKSHOP_ID</code>.</li>
				<li>Open the URL in your browser.</li>
				<li>This page will open the item in your <i>Steam</i> client.</li>
				<li>If <i>Steam</i> is closed, it will redirect to the Workshop page in ${step6}.</li>
			</ol>`;
}

// resolves an app ID to its game name via IStoreBrowseService/GetItems, cached permanently
async function getGameName(appId, env, ctx) {
	if (!appId) return null;
	const cacheKey = `game:${appId}`;

	if (env.WORKSHOP_CACHE) {
		try {
			const cached = await env.WORKSHOP_CACHE.get(cacheKey);
			if (cached) return JSON.parse(cached).name || null;
		} catch (error) {
			console.error("Game name cache read error:", error);
		}
	}

	try {
		const inputJson = JSON.stringify({
			ids: [{ appid: Number(appId) }],
			context: { country_code: "US" }
		});
		const response = await fetch(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(inputJson)}`, {
			signal: AbortSignal.timeout(STEAM_API_TIMEOUT_MS)
		});
		if (!response.ok) throw new Error(`GetItems returned ${response.status}`);
		const json = await response.json();
		const name = json?.response?.store_items?.[0]?.name || null;

		if (env.WORKSHOP_CACHE) {
			ctx.waitUntil(
				env.WORKSHOP_CACHE.put(cacheKey, JSON.stringify({ name }), name ? {} : { expirationTtl: 3600 })
					.catch(error => console.error("Game name cache write error:", error))
			);
		}

		return name;
	} catch (error) {
		console.error("Game name lookup error:", error);
		// store API down: cache the miss for 1h too, so cached items retrying
		// a blank game name don't hit the store on every view during an outage
		if (env.WORKSHOP_CACHE) {
			ctx.waitUntil(
				env.WORKSHOP_CACHE.put(cacheKey, JSON.stringify({ name: null }), { expirationTtl: 3600 })
					.catch(() => {})
			);
		}
		return null;
	}
}

// reads an image's own header for its real pixel dimensions, since Steam's preview_width/preview_height can be missing or stale
async function probeImageDimensions(url) {
	if (!url) return null;

	try {
		const response = await fetch(url, {
			headers: { Range: "bytes=0-131071" },
			// also aborts the body stream below, which throws into the catch
			signal: AbortSignal.timeout(IMAGE_PROBE_TIMEOUT_MS)
		});
		if (!response.ok || !response.body) return null;

		// stop at ~128KB even if the origin ignores Range and streams the whole image back
		const CAP = 131072;
		const reader = response.body.getReader();
		const chunks = [];
		let total = 0;

		while (total < CAP) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			total += value.length;
		}
		reader.cancel().catch(() => {});

		const bytes = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.length;
		}

		return parseImageDimensions(bytes);
	} catch (error) {
		console.error("Image dimension probe error:", error);
		return null;
	}
}

// supports PNG, GIF, WEBP, JPEG: the formats Steam's preview CDN actually serves
function parseImageDimensions(bytes) {
	if (bytes.length < 24) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

	// PNG: 8-byte signature, then an IHDR chunk with width/height as big-endian uint32s
	if (view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
		return { width: view.getUint32(16), height: view.getUint32(20) };
	}

	// GIF87a/89a: width/height are little-endian uint16s right after the 6-byte signature
	if (view.getUint32(0) === 0x47494638 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
		return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
	}

	// WEBP: RIFF/WEBP header, then a VP8/VP8L/VP8X chunk, each encoding dimensions differently
	if (view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250) {
		const chunkType = view.getUint32(12);
		if (chunkType === 0x56503820) { // "VP8 "
			return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
		}
		if (chunkType === 0x5650384c) { // "VP8L"
			const bits = view.getUint32(21, true);
			return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
		}
		if (chunkType === 0x56503858) { // "VP8X"
			return {
				width: (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1,
				height: (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1
			};
		}
		return null;
	}

	// JPEG: walk marker segments for a SOFn marker; its payload starts with height then width
	if (view.getUint16(0) === 0xffd8) {
		let offset = 2;
		while (offset + 9 < bytes.length) {
			if (view.getUint8(offset) !== 0xff) break;
			const marker = view.getUint8(offset + 1);
			// SOF0-SOF15, excluding DHT/JPG/DAC which share the range but aren't SOF markers
			if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
				return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
			}
			offset += 2 + view.getUint16(offset + 2);
		}
		return null;
	}

	return null;
}

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		if (url.pathname === '/stats') {
			return handleStats(request, env, ctx);
		}

		if (url.pathname === '/sitemap.xml') {
			return new Response(generateSitemap(url.origin), {
				headers: {
					"Content-Type": "application/xml; charset=utf-8",
					"Cache-Control": "public, max-age=86400",
					"X-Content-Type-Options": "nosniff"
				}
			});
		}

		if (url.pathname === '/api/view') {
			return handleView(request, url, env, ctx);
		}

		const workshopId = url.searchParams.get("id");
		// undocumented: a URL with no "?" before it, like /&fast?id=123, puts
		// "&fast" literally into the pathname instead of the query string
		// (there's no real "?" yet for "&" to mean anything), so it needs its
		// own check here rather than showing up in searchParams
		const fast = url.searchParams.has("fast") || url.pathname === "/&fast";

		if (!workshopId) {
			// only the homepage gets the landing page; anything else without an id
			// (robots.txt, favicon.ico, typos) is a real 404 instead of a copy of it
			if (url.pathname !== "/" && url.pathname !== "/&fast") {
				return new Response(generateNotFoundPage(), {
					status: 404,
					headers: htmlHeaders("public, max-age=3600")
				});
			}

			const landingHTML = generateLandingPage(url.origin);
			return new Response(landingHTML, {
				headers: htmlHeaders("public, max-age=3600")
			});
		}

		// IDs are uint64, which tops out at 20 digits (current ones are 10), so
		// this can't reject a real ID; it just stops junk from reaching Steam
		if (!/^\d{1,20}$/.test(workshopId)) {
			return errorResponse(400, "Invalid Link", `That doesn't look like a Workshop ID. SteamRelink links look like <code style="white-space: nowrap;">/?id=WORKSHOP_ID</code>, where the ID is only digits.`);
		}

		const notFoundItem = () => errorResponse(404, "Item Not Found", "This Workshop item doesn't exist, was removed, or is private or friends-only. Steam might still show it if you have access.", workshopId);

		// negative cache for missing/private ids lives in the edge cache, not KV,
		// so junk ids cost no KV writes. Per Cloudflare location, which is fine
		// for its job of keeping repeat hits off the Steam API
		const notFoundKey = new Request(`${url.origin}/__notfound/${workshopId}`);
		if (await caches.default.match(notFoundKey)) {
			return notFoundItem();
		}

		let cachedData = null;
		if (env.WORKSHOP_CACHE) {
			try {
				const cached = await env.WORKSHOP_CACHE.get(workshopId);
				if (cached) {
					cachedData = JSON.parse(cached);
				}
			} catch (error) {
				console.error("KV cache read error:", error);
			}
		}

		// TODO(after 2026-10-06): dead code once every entry cached before 2026-09-29 has expired (7d TTL). Safe to delete then.
		// entries cached before visibility/screenshot detection get refetched
		// once, so items already sitting in the cache still get caught (this
		// also covers old KV "notFound" markers, which lack both fields)
		if (cachedData && !('visibility' in cachedData && 'isScreenshot' in cachedData)) {
			cachedData = null;
		}

		// a failed game-name lookup would otherwise stay blank for the item's
		// whole 7d cache. getGameName caches failures for 1h, so this retries
		// the store API at most hourly per game, not on every view
		if (cachedData && cachedData.gameId && !cachedData.gameName) {
			const gameName = await getGameName(cachedData.gameId, env, ctx);
			if (gameName) {
				cachedData.gameName = gameName;
				// screenshot titles are built from the game name
				if (cachedData.isScreenshot && cachedData.title === "Steam Screenshot") {
					cachedData.title = `${gameName} Screenshot`;
				}
				ctx.waitUntil(
					env.WORKSHOP_CACHE.put(workshopId, JSON.stringify(cachedData), { expirationTtl: 604800 })
						.catch(error => console.error("KV cache write error:", error))
				);
			}
		}

		// rate limit only applies to uncached requests. Uses the Workers
		// rate-limiting binding ([[ratelimits]] in wrangler.toml), which costs no
		// KV writes. It's approximate and per Cloudflare location (a probe let
		// through several times the configured limit under a burst), but it still
		// throttles a sustained scraper. Without the binding, lookups are unlimited
		if (!cachedData && env.LOOKUP_LIMITER) {
			const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
			try {
				const { success } = await env.LOOKUP_LIMITER.limit({ key: clientIP });
				if (!success) {
					return errorResponse(429, "Slow Down", "Too many new links opened in a short time. Wait a minute and try again, or open the item on Steam directly.", workshopId, { "Retry-After": "60" });
				}
			} catch (error) {
				// fail open: a limiter hiccup shouldn't take the site down
				console.error("Rate limit check error:", error);
			}
		}

		let workshopData;

		if (cachedData) {
			workshopData = cachedData;
		} else {
			const steamApiUrl = `https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/`;

			const formData = new URLSearchParams();
			formData.append("itemcount", "1");
			formData.append("publishedfileids[0]", workshopId);

			let steamData;
			try {
				const response = await fetch(steamApiUrl, {
					method: "POST",
					body: formData,
					headers: {
						"Content-Type": "application/x-www-form-urlencoded"
					},
					signal: AbortSignal.timeout(STEAM_API_TIMEOUT_MS)
				});

				if (!response.ok) {
					throw new Error(`Steam API returned ${response.status}`);
				}

				const json = await response.json();

				if (!json.response || !json.response.publishedfiledetails || !json.response.publishedfiledetails[0]) {
					return errorResponse(502, "Steam Error", "Steam sent back something unexpected. Try again in a bit, or open the item on Steam directly.", workshopId);
				}

				steamData = json.response.publishedfiledetails[0];

				if (steamData.result !== 1) {
					// negative cache so repeat hits on a bad link skip the API
					ctx.waitUntil(
						caches.default.put(notFoundKey, new Response(null, { headers: { "Cache-Control": "max-age=300" } }))
							.catch(error => console.error("Negative cache write error:", error))
					);
					return notFoundItem();
				}

			} catch (error) {
				console.error("Steam API fetch error:", error);
				// details stay in the logs, not the public response
				return errorResponse(502, "Steam Unavailable", "Couldn't reach Steam to look this item up. Try again in a bit, or open the item on Steam directly.", workshopId);
			}

			const previewUrl = steamData.preview_url || "";

			// consumer_app_id = the game this item is used in
			const appId = steamData.consumer_app_id || steamData.creator_app_id || null;

			// screenshots share Workshop's ID space and filedetails pages. They're
			// published by app 760 (Steam's own screenshot uploader, which no game
			// publishes Workshop content under) with a "<appid>/screenshots/" file
			// path. Both must match, so a real Workshop item can't be caught by this
			const isScreenshot = steamData.creator_app_id === 760 && /\/screenshots\//.test(steamData.filename || "");

			const [gameName, probedDimensions] = await Promise.all([
				appId ? getGameName(appId, env, ctx) : Promise.resolve(null),
				probeImageDimensions(previewUrl)
			]);

			// screenshots have no title field, only an optional caption
			const title = steamData.title
				|| (isScreenshot ? `${gameName || "Steam"} Screenshot` : "Untitled Workshop Item");

			let imageWidth = probedDimensions?.width || steamData.preview_width;
			let imageHeight = probedDimensions?.height || steamData.preview_height;

			if (!imageWidth || !imageHeight || imageWidth <= 0 || imageHeight <= 0) {
				imageWidth = 1280;
				imageHeight = 720;
			}

			workshopData = {
				title,
				previewUrl,
				imageWidth,
				imageHeight,
				gameId: appId,
				gameName,
				// 0 = public, 3 = unlisted; friends-only and private never get here (result !== 1)
				visibility: steamData.visibility ?? null,
				isScreenshot
			};

			if (env.WORKSHOP_CACHE) {
				ctx.waitUntil(
					env.WORKSHOP_CACHE.put(
						workshopId,
						JSON.stringify(workshopData),
						{ expirationTtl: 604800 } // 7d
					).catch(error => console.error("KV cache write error:", error))
				);

				// views are counted by the client beacon (POST /api/view), not here,
				// so bots and repeat loads of a cached page can't spend KV writes.
				// This only cleans up rows for items that must not be counted. Only
				// fresh fetches check: a stale row gets purged at the latest when
				// the 7d item cache expires and refetches, so cached views stay
				// KV-read free. get() first so a purge only deletes when a row exists
				if (!(workshopData.visibility === 0 && !workshopData.isScreenshot)) {
					const statsKey = `stats:${workshopId}`;
					ctx.waitUntil(
						env.WORKSHOP_CACHE.get(statsKey).then(existing => {
							if (existing) return env.WORKSHOP_CACHE.delete(statsKey);
						}).catch(error => {
							console.error("Uncounted stats purge error:", error);
						})
					);
				}
			}
		}

		const html = generateWorkshopHTML({ ...workshopData, workshopId, fast });

		return new Response(html, {
			headers: htmlHeaders("public, max-age=3600")
		});
	}
};

// POST /api/view?id=N, the client beacon that counts a view. Always 204 for a
// well-formed request so the response says nothing about whether it counted.
// Never calls Steam: only items already in the KV item cache can be counted
async function handleView(request, url, env, ctx) {
	if (request.method !== 'POST') {
		return new Response(null, { status: 405, headers: { "Allow": "POST", "X-Content-Type-Options": "nosniff" } });
	}

	const workshopId = url.searchParams.get("id");
	if (!workshopId || !/^\d{1,20}$/.test(workshopId)) {
		return textResponse("Invalid workshop ID format", 400);
	}

	const done = () => new Response(null, { status: 204, headers: { "X-Content-Type-Options": "nosniff" } });
	if (!env.WORKSHOP_CACHE) return done();

	const userAgent = request.headers.get("User-Agent");
	if (!userAgent || BOT_UA_PATTERN.test(userAgent)) return done();

	// browsers label cross-site requests; a beacon forged from another site isn't a visit.
	// Older browsers don't send it, so absent is allowed
	const site = request.headers.get("Sec-Fetch-Site");
	if (site && site !== "same-origin") return done();

	ctx.waitUntil(
		countView(workshopId, request, url, env).catch(error => {
			console.error("View beacon error:", error);
		})
	);
	return done();
}

async function countView(workshopId, request, url, env) {
	// dedupe lives in the edge cache (no KV writes). The IP is hashed so raw
	// addresses are never stored
	const ip = request.headers.get("CF-Connecting-IP") || 'unknown';
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
	const ipHash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
	const dedupeKey = new Request(`${url.origin}/__viewed/${workshopId}/${ipHash}`);

	if (await caches.default.match(dedupeKey)) return;
	// marked before the KV work so concurrent beacons from one IP count once
	await caches.default.put(dedupeKey, new Response(null, { headers: { "Cache-Control": `max-age=${VIEW_DEDUPE_SECONDS}` } }));

	const cached = await env.WORKSHOP_CACHE.get(workshopId);
	if (!cached) return;

	let workshopData;
	try {
		workshopData = JSON.parse(cached);
	} catch {
		return;
	}

	// only public Workshop items are counted; unlisted items and screenshots stay off /stats
	if (!workshopData || workshopData.visibility !== 0 || workshopData.isScreenshot) return;

	await recordView(workshopId, workshopData, env);
}

async function recordView(workshopId, workshopData, env) {
	const statsKey = `stats:${workshopId}`;
	const data = await env.WORKSHOP_CACHE.get(statsKey);
	const currentData = data ? JSON.parse(data) : { count: 0, title: workshopData.title, lastViewed: null };
	currentData.count += 1;
	currentData.title = workshopData.title;
	if (workshopData.gameId) currentData.gameId = workshopData.gameId;
	if (workshopData.gameName) currentData.gameName = workshopData.gameName;
	currentData.lastViewed = new Date().toISOString();
	// no TTL: view totals are permanent. Metadata lets /stats read
	// every row from list() alone instead of one get() per row
	const metadata = statsMetadata(currentData);
	await env.WORKSHOP_CACHE.put(statsKey, JSON.stringify(currentData), metadata ? { metadata } : {});
}

// the subset of a stats row that /stats renders, stored as KV metadata so list() returns it directly
function statsMetadata(stats) {
	const metadata = {
		count: stats.count,
		title: stats.title,
		lastViewed: stats.lastViewed,
		gameName: stats.gameName || null
	};
	// KV caps metadata at 1024 bytes of serialized JSON; oversized rows skip
	// it and /stats falls back to reading the value for them
	return new TextEncoder().encode(JSON.stringify(metadata)).length <= 1024 ? metadata : null;
}

async function handleStats(request, env, ctx) {
	if (!env.WORKSHOP_CACHE) {
		return errorResponse(503, "Stats Unavailable", "Statistics aren't available on this deployment.");
	}

	// serve repeat loads from the edge cache (honors the max-age below) so they
	// don't re-list KV. Custom domains only, which is why workers_dev is off in wrangler.toml
	const origin = new URL(request.url).origin;
	const cache = caches.default;
	const cacheKey = new Request(`${origin}/stats`);
	const cachedResponse = await cache.match(cacheKey);
	if (cachedResponse) return cachedResponse;

	try {
		// one list() call stops at 1000 keys, so follow the cursor
		const keys = [];
		let cursor;
		do {
			const page = await env.WORKSHOP_CACHE.list({ prefix: 'stats:', cursor });
			keys.push(...page.keys);
			cursor = page.list_complete ? null : page.cursor;
		} while (cursor);

		const statsPromises = keys.map(async key => {
			// rows written since metadata was added come back with list() itself;
			// older rows need one get() each until their next view rewrites them
			let statsData = key.metadata;
			if (!statsData) {
				try {
					const data = await env.WORKSHOP_CACHE.get(key.name);
					if (!data) return null;
					statsData = JSON.parse(data);
				} catch (error) {
					console.error("Stats row read error:", key.name, error);
					return null;
				}
			}

			const workshopId = key.name.replace('stats:', '');

			return {
				id: workshopId,
				title: statsData.title || 'Unknown',
				count: statsData.count || 0,
				lastViewed: statsData.lastViewed || 'Never',
				url: workshopPageUrl(workshopId),
				gameName: statsData.gameName || null
			};
		});

		const fetchedStats = (await Promise.all(statsPromises)).filter(s => s !== null);
		const allStats = fetchedStats.filter(s => !STATS_EXCLUDED_IDS.has(s.id));
		allStats.sort((a, b) => b.count - a.count);

		const totalViews = allStats.reduce((sum, item) => sum + item.count, 0);
		const totalItems = allStats.length;
		const uniqueGames = [...new Set(fetchedStats.map(s => s.gameName).filter(Boolean))].sort();

		// excluded ids don't count toward the leaderboard, but still get a masked, grayed-out row at the bottom so the example link's page
		const excludedIds = [...STATS_EXCLUDED_IDS.keys()];
		const excludedStats = (await Promise.all(excludedIds.map(async id => {
			const fromStats = fetchedStats.find(s => s.id === id);
			if (fromStats) return { ...fromStats, reason: STATS_EXCLUDED_IDS.get(id) };

			try {
				const cached = await env.WORKSHOP_CACHE.get(id);
				const data = cached ? JSON.parse(cached) : {};
				return {
					id,
					title: data.title || 'Unknown',
					gameName: data.gameName || null,
					url: workshopPageUrl(id),
					reason: STATS_EXCLUDED_IDS.get(id)
				};
			} catch (error) {
				console.error("Excluded item cache read error:", error);
				return null;
			}
		}))).filter(s => s !== null);

		// item.title is untrusted, always escape it
		const html = `<!DOCTYPE html>
<html lang="en">
<head>
	${renderHead("SteamRelink - Statistics", `<meta name="description" content="${STATS_DESCRIPTION}">
	<meta property="og:type" content="website">
	<meta property="og:title" content="SteamRelink - Statistics">
	<meta property="og:description" content="${STATS_DESCRIPTION}">
	<meta property="og:image" content="${origin}/images/SteamRelink-512x512.png">
	<meta name="twitter:card" content="summary">
	<link rel="stylesheet" href="/vendor/simplebar.min.css">`)}
	<script src="/vendor/simplebar.min.js" defer></script>
</head>
<body class="stats-body">
	<div class="stats-container">
		<div class="stats-header">
			<a href="/" class="title">SteamRelink Statistics</a>
		</div>

		<div class="stats-summary">
			<div class="stat-card">
				<div class="stat-number">${totalViews.toLocaleString()}</div>
				<div class="stat-label">Total Views</div>
			</div>
			<div class="stat-card">
				<div class="stat-number">${totalItems.toLocaleString()}</div>
				<div class="stat-label">Unique Items</div>
			</div>
			<div class="stat-card">
				<div class="stat-number">${totalItems > 0 ? Math.round(totalViews / totalItems) : 0}</div>
				<div class="stat-label">Avg Views per Item</div>
			</div>
		</div>

		${(allStats.length > 0 || excludedStats.length > 0) ? `
		<div class="stats-filter">
			<!-- custom listbox rather than a native select, so the open list matches the page on every platform -->
			<div class="game-filter" id="game-filter">
				<button type="button" class="game-filter-button" aria-haspopup="listbox" aria-expanded="false" aria-label="Filter by game">
					<span class="game-filter-label">All</span>
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
				</button>
				<ul class="game-filter-menu" role="listbox" hidden>
					<li role="option" tabindex="-1" data-value="all" aria-selected="true">All</li>
					${uniqueGames.map(g => `<li role="option" tabindex="-1" data-value="${escapeHtml(g)}" aria-selected="false">${escapeHtml(g)}</li>`).join('')}
				</ul>
			</div>
		</div>
		<div class="table-wrapper">
		<table class="stats-table">
			<thead>
				<tr>
					<th class="col-rank" data-sort="rank">Rank</th>
					<th data-sort="title">Workshop Item</th>
					<th class="col-views" data-sort="views">Views</th>
					<th class="col-lastviewed" data-sort="lastviewed">Last Viewed</th>
				</tr>
			</thead>
			<tbody>
				${allStats.map((item, index) => `
				<tr data-game="${escapeHtml(item.gameName || '')}" data-rank="${index + 1}" data-title="${escapeHtml(item.title)}" data-views="${item.count}">
					<td class="rank col-rank">#${index + 1}</td>
					<td class="item-cell"><a href="${item.url}" target="_blank" class="item-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</a></td>
					<td class="col-views">${item.count}</td>
					<td class="last-viewed col-lastviewed" data-iso="${escapeHtml(item.lastViewed)}">${formatLastViewedFallback(item.lastViewed)}</td>
				</tr>
				`).join('')}
				${excludedStats.map(item => `
				<tr class="excluded-row" data-excluded="true" data-game="${escapeHtml(item.gameName || '')}" data-title="${escapeHtml(item.title)}">
					<td class="rank col-rank"><span class="excluded-mark" title="${escapeHtml(item.reason)}">#??</span></td>
					<td class="item-cell"><a href="${item.url}" target="_blank" class="item-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</a></td>
					<td class="col-views"><span class="excluded-mark" title="${escapeHtml(item.reason)}">??</span></td>
					<td class="last-viewed col-lastviewed" data-iso="${escapeHtml(item.lastViewed || '')}">${formatLastViewedFallback(item.lastViewed)}</td>
				</tr>
				`).join('')}
			</tbody>
		</table>
		</div>
		` : '<p style="text-align: center; color: #c7d5e0;">No statistics available yet.</p>'}

		<div class="back-link">
			<a href="/" class="nav-button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>Back to SteamRelink</a>
		</div>
	</div>

	${renderFooter()}
	<script src="/js/stats.js" defer></script>
</body>
</html>`;

		const response = new Response(html, {
			headers: htmlHeaders("public, max-age=900")
		});
		ctx.waitUntil(cache.put(cacheKey, response.clone()));
		return response;

	} catch (error) {
		console.error("Stats error:", error);
		return errorResponse(500, "Stats Unavailable", "Failed to load statistics. Please try again later.");
	}
}

function generateLandingPage(origin) {
	const extraHead = `<meta name="description" content="${LANDING_DESCRIPTION}">
	<meta property="og:type" content="website">
	<meta property="og:title" content="SteamRelink - Steam Workshop Link Helper">
	<meta property="og:description" content="${LANDING_DESCRIPTION}">
	<meta property="og:image" content="${origin}/images/SteamRelink-512x512.png">
	<meta name="twitter:card" content="summary">
	<link rel="dns-prefetch" href="//steamcommunity.com">
	<link rel="preconnect" href="https://steamcommunity.com">`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
	${renderHead("SteamRelink - Steam Workshop Link Helper", extraHead)}
</head>
<body>
	<a href="/stats" class="nav-button stats-corner-link"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"></line><line x1="18" y1="20" x2="18" y2="4"></line><line x1="6" y1="20" x2="6" y2="16"></line></svg>Stats</a>
	${renderCard(`
		${renderIntro()}
		<div class="instructions">
			${renderInstructions()}
			<p style="margin-top: 20px;"><b>Example:</b></p>
			<div class="code-row">
				<code>${origin}/?id=1923990111</code>
				<button class="copy-btn" data-copy="${origin}/?id=1923990111" title="Copy" aria-label="Copy example URL"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>
			</div>
			<p style="margin-top: 20px;"><b>Fast mode</b> (skips the 10-second wait):</p>
			<div class="code-row">
				<code>${origin}/?id=1923990111&fast</code>
				<button class="copy-btn" data-copy="${origin}/?id=1923990111&fast" title="Copy" aria-label="Copy fast mode URL"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>
			</div>
			<p class="fast-hint">Fast mode fires the Steam launch immediately, no countdown. The <a href="https://github.com/Nonunon/SteamRelink" target="_blank">SteamRelink userscript</a> can also auto-close the tab afterward.</p>
			<p style="margin-top: 20px;"><b>Not sure your browser will let this through?</b></p>
			<p>This just fires the "Open in Steam?" prompt on its own, no countdown or redirect attached,<br><span class="fast-hint">So you can check (or tick "Always allow")</span></p>
			<button type="button" id="test-steam-btn" class="nav-button">Test Steam Link</button>
		</div>
	`)}
	<div class="rectangle converter-box">
		<div class="converter-label">Convert a Workshop link</div>
		<div class="converter-input-row">
			<input type="text" id="converter-input" class="converter-input" placeholder="https://steamcommunity.com/sharedfiles/filedetails/?id=EXAMPLE" autocomplete="off">
			<button class="copy-btn" id="converter-copy-btn" title="Copy" aria-label="Copy converted URL" hidden><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>
		</div>
		<div class="converter-options">
			<label class="fast-toggle">
				<input type="checkbox" id="fast-toggle-input">
				<span class="fast-toggle-track"><span class="fast-toggle-thumb"></span></span>
				Fast mode
			</label>
			<button type="button" id="convert-btn" class="nav-button">Convert</button>
		</div>
		<div id="converter-error" class="converter-error" hidden></div>
	</div>
	${renderFooter()}
	<script src="/js/landing.js" defer></script>
</body>
</html>`;
}

// styled error page; messageHtml is trusted markup, workshopId (already
// validated as digits) adds a link to the item's Steam page
function generateErrorPage(heading, messageHtml, workshopId = null) {
	const steamButton = workshopId
		? `<a href="${workshopPageUrl(workshopId)}" class="nav-button">View on Steam</a>`
		: '';

	return `<!DOCTYPE html>
<html lang="en">
<head>
	${renderHead(`SteamRelink - ${heading}`, '<meta name="robots" content="noindex">')}
</head>
<body>
	${renderCard(`
		<div class="text">
			${messageHtml}
		</div>
		<div style="display: flex; justify-content: center; flex-wrap: wrap; gap: 8px; margin-top: 10px;">
			${steamButton}
			<a href="/" class="nav-button">Back to SteamRelink</a>
		</div>
	`)}
	${renderFooter()}
</body>
</html>`;
}

function errorResponse(status, heading, messageHtml, workshopId = null, extraHeaders = {}) {
	return new Response(generateErrorPage(heading, messageHtml, workshopId), {
		status,
		headers: { ...htmlHeaders("no-store"), ...extraHeaders }
	});
}

function generateNotFoundPage() {
	return generateErrorPage("Not Found", `There's nothing here. SteamRelink links look like <code style="white-space: nowrap;">/?id=WORKSHOP_ID</code>.`);
}

function generateSitemap(origin) {
	return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
	<url><loc>${origin}/</loc></url>
	<url><loc>${origin}/stats</loc></url>
</urlset>`;
}

function generateWorkshopHTML(data) {
	const { title, previewUrl, imageWidth, imageHeight, workshopId, fast } = data;
	const workshopUrl = workshopPageUrl(workshopId);

	const safeTitle = escapeHtml(title);
	const safePreviewUrl = escapeHtml(previewUrl);
	const refreshDelay = fast ? 2 : 10;

	// no preview means no image tags at all: an empty og:image can get resolved
	// to the page's own URL by some scrapers, a missing one is just a text embed
	const ogImage = previewUrl ? `
	<meta property="og:image" content="${safePreviewUrl}">
	<meta property="og:image:width" content="${imageWidth}">
	<meta property="og:image:height" content="${imageHeight}">` : '';

	const extraHead = `<meta property="og:type" content="website">
	<meta property="og:title" content="SteamRelink::${safeTitle}">${ogImage}
	<meta property="og:url" content="${workshopUrl}">
	<!-- summary was tried to dodge Discord's crop box, looked worse, don't re-try -->
	<meta name="twitter:card" content="summary_large_image">
	<!-- keeps item pages out of search results; link-preview bots don't read this -->
	<meta name="robots" content="noindex">
	<meta http-equiv="refresh" content="${refreshDelay};url=${workshopUrl}">`;

	return `<!DOCTYPE html>
<html lang="en">
<head>
	${renderHead(`SteamRelink::${safeTitle}`, extraHead)}
</head>
<body data-workshop-id="${workshopId}" data-fast="${fast ? 1 : 0}" data-delay="${refreshDelay}">
	${renderCard(`
		${renderIntro()}
		<div class="link-section" id="link-section">
			<p>Opening <a href="${workshopUrl}" target="_blank">
			<strong>${safeTitle}</strong></a> in Steam...</p>
			${previewUrl ? `<img src="${safePreviewUrl}" alt="${safeTitle}" style="max-width: 100%; margin-top: 10px; height: auto;" />` : ''}
		</div>
		<div class="instructions">
			${renderInstructions(refreshDelay)}
		</div>
	`)}
	${renderFooter()}
	<script src="/js/workshop.js" defer></script>
</body>
</html>`;
}

const id = document.body.dataset.workshopId;
const fastRequested = document.body.dataset.fast === '1';

// &fast links get shared publicly, so whoever opens one may never have seen
// the "Open Steam?" prompt. A browser's first SteamRelink visit ignores &fast
// for the redirect (the countdown gives the prompt room); every later visit
// honors it. Storage that throws counts as seen, so blocked site data doesn't
// mean slow mode forever
const SEEN_KEY = 'sr-seen';
let seen = true;
try {
	seen = localStorage.getItem(SEEN_KEY) === '1';
	localStorage.setItem(SEEN_KEY, '1');
} catch {}
const fast = fastRequested && seen;
// first visit on a fast link: steam:// still fires right away, since the
// userscript closes fast tabs at ~150ms and would beat a 1s delay
const firstFast = fastRequested && !seen;
// matches the worker's normal-mode refreshDelay
const delay = firstFast ? 10 : Number(document.body.dataset.delay);

// first thing, before any timer: the userscript closes fast-mode tabs after
// ~150ms. webdriver check skips automated browsers (they can't be told apart
// from real ones by UA alone); the server filters bots and duplicates itself
if (!navigator.webdriver && navigator.sendBeacon) navigator.sendBeacon('/api/view?id=' + encodeURIComponent(id));

const steamClientUrl = `steam://url/CommunityFilePage/${id}`;
const workshopUrl = `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;

// fast mode used to leave after 300ms, which killed a first-time "Open Steam?"
// prompt that hadn't appeared yet. This is long enough for the prompt to show
// up and blur the page (which holds the fallback, see below)
const FAST_FALLBACK_MS = 1500;
// after the page gets focus back (prompt answered, or back from Steam), wait
// this long before leaving. Leaving after "Open" doesn't undo the launch
const REFOCUS_GRACE_MS = 300;

const status = document.getElementById('redirect-status');
if (firstFast) {
	// the worker rendered the fast-mode line, which has no countdown
	status.innerHTML = `Opening the Workshop page in <b id="countdown">${delay}</b>...`;
}
const countdownElement = document.getElementById('countdown');

// &fast only: a loud overlay for visitors who are likely looking at the
// browser's "Open Steam?" prompt. "first" and "unfocused" can't be sure a
// prompt is up (steam:// may have no handler, or be allowed already), so they
// say "if"; "prompt" is a first-timer whose page just blurred, so something
// did take focus. The fixed copy below is trusted, hence innerHTML
const OVERLAY_COPY = {
	first: {
		title: 'Opening in Steam',
		body: 'If your browser asks to open Steam, tick <b>Always allow</b> and click <b>Open</b>. Fast links open instantly from then on.'
	},
	prompt: {
		title: 'Your browser is asking to open Steam',
		body: 'Tick <b>Always allow</b>, then click <b>Open</b>. Fast links open instantly from then on.'
	},
	unfocused: {
		title: 'Waiting for Steam',
		body: 'If your browser asks to open Steam, click <b>Open</b>. The Workshop page opens here once that\'s done.'
	}
};

let overlay = null;
let statusHome = null;

function showOverlay(mode) {
	if (stopped) return;
	if (!overlay) {
		overlay = document.createElement('div');
		overlay.className = 'steam-overlay';
		overlay.setAttribute('role', 'dialog');
		overlay.setAttribute('aria-modal', 'true');
		overlay.setAttribute('aria-labelledby', 'steam-overlay-title');
		overlay.innerHTML = `
			<svg class="steam-overlay-arrow" aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"></path><path d="M5 12l7-7 7 7"></path></svg>
			<div class="steam-overlay-card">
				<h2 class="steam-overlay-title" id="steam-overlay-title" aria-live="polite"></h2>
				<p class="steam-overlay-body"></p>
			</div>`;
		// no buttons in here: Firefox's prompt is tab-modal and blocks the page
		// under it, and once it's answered the page leaves within 300ms anyway
		// the real status line moves in, so the countdown and "Waiting for
		// Steam..." stay one live element instead of a copy that drifts
		statusHome = document.createComment('redirect-status');
		status.replaceWith(statusHome);
		overlay.querySelector('.steam-overlay-card').appendChild(status);
		document.body.appendChild(overlay);
	}
	overlay.querySelector('.steam-overlay-title').textContent = OVERLAY_COPY[mode].title;
	overlay.querySelector('.steam-overlay-body').innerHTML = OVERLAY_COPY[mode].body;
}

function hideOverlay() {
	if (!overlay) return;
	statusHome.replaceWith(status);
	overlay.remove();
	overlay = null;
}

let steamFired = false;
let stopped = false;
let held = false;
let fallbackTimer = null;
let countdownInterval = null;
let countdown = delay;

if (firstFast) showOverlay('first');

// replace, not href: this page must not stay in history, or pressing Back on
// the Workshop page reloads it, which fires steam:// and bounces forward again
function scheduleFallback(ms) {
	clearTimeout(fallbackTimer);
	fallbackTimer = setTimeout(() => {
		window.location.replace(workshopUrl);
	}, ms);
}

function tick() {
	countdown--;
	countdownElement.textContent = countdown;
	countdownElement.classList.remove('tick');
	void countdownElement.offsetWidth; // forces reflow so the animation replays
	countdownElement.classList.add('tick');
	if (countdown <= 3) {
		countdownElement.classList.add('urgent');
	}
	if (countdown <= 0) {
		clearInterval(countdownInterval);
	}
}

function startCountdown() {
	if (!countdownElement) return;
	clearInterval(countdownInterval);
	countdownInterval = setInterval(tick, 1000);
}

// not for Discord's scraper (reads raw og: tags, no JS); gives the
// browser's async steam:// permission check time to resolve before
// the fallback navigation below can cancel it mid-flight
const steamTimer = setTimeout(() => {
	steamFired = true;
	window.location.href = steamClientUrl;
	// a tab that opened without focus (browser behind another window) never
	// blurs, so the prompt would get no hold. Hold from the start instead and
	// let the first focus release it, same as coming back from the prompt
	if (fastRequested && !document.hasFocus()) hold('unfocused');
}, fastRequested ? 0 : 1000);

scheduleFallback(fast ? FAST_FALLBACK_MS : delay * 1000);
startCountdown();

// &fast links only; normal links keep their plain countdown. No API says
// "the protocol prompt is open", but the prompt (or Steam taking focus) blurs
// the page. Leaving while blurred would cancel a prompt the visitor hasn't
// answered yet, so hold the fallback until focus comes back. If steam:// has
// no handler at all, nothing blurs and the fallback runs as usual, which is
// the right outcome for that visitor
function hold(reason) {
	if (!fastRequested || !steamFired || stopped || held) return;
	held = true;
	clearTimeout(fallbackTimer);
	clearInterval(countdownInterval);
	status.textContent = 'Waiting for Steam...';
	// a returning visitor's page blurring is usually Steam itself opening,
	// so only first-timers and unfocused tabs get the overlay
	if (reason === 'unfocused') showOverlay(firstFast ? 'first' : 'unfocused');
	else if (firstFast) showOverlay('prompt');
}

window.addEventListener('blur', () => hold('blur'));

// back from the prompt (Open or Cancel) or from Steam: the prompt is settled,
// so the rest of the countdown has nothing left to protect
window.addEventListener('focus', () => {
	if (!held || stopped) return;
	held = false;
	status.textContent = 'Opening the Workshop page...';
	scheduleFallback(REFOCUS_GRACE_MS);
});

// the link itself fires steam://, this just gets the timers out of its way: the
// fallback landing mid-prompt would cancel it, which is why it was clicked
function stopRedirect() {
	stopped = true;
	clearTimeout(steamTimer);
	clearTimeout(fallbackTimer);
	clearInterval(countdownInterval);
	hideOverlay();
	status.textContent = 'Redirect paused';
	status.classList.add('paused');
}

document.getElementById('open-steam').addEventListener('click', stopRedirect);

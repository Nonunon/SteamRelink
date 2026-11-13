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
	const hint = document.createElement('p');
	hint.className = 'fast-hint first-visit-hint';
	hint.textContent = 'First time here? If your browser asks to open Steam, tick "Always allow" and fast links will open instantly from now on.';
	status.after(hint);
}
const countdownElement = document.getElementById('countdown');

let steamFired = false;
let stopped = false;
let held = false;
let fallbackTimer = null;
let countdownInterval = null;
let countdown = delay;

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
	if (fastRequested && !document.hasFocus()) hold();
}, fastRequested ? 0 : 1000);

scheduleFallback(fast ? FAST_FALLBACK_MS : delay * 1000);
startCountdown();

// &fast links only; normal links keep their plain countdown. No API says
// "the protocol prompt is open", but the prompt (or Steam taking focus) blurs
// the page. Leaving while blurred would cancel a prompt the visitor hasn't
// answered yet, so hold the fallback until focus comes back. If steam:// has
// no handler at all, nothing blurs and the fallback runs as usual, which is
// the right outcome for that visitor
function hold() {
	if (!fastRequested || !steamFired || stopped || held) return;
	held = true;
	clearTimeout(fallbackTimer);
	clearInterval(countdownInterval);
	status.textContent = 'Waiting for Steam...';
}

window.addEventListener('blur', hold);

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
document.getElementById('open-steam').addEventListener('click', () => {
	stopped = true;
	clearTimeout(steamTimer);
	clearTimeout(fallbackTimer);
	clearInterval(countdownInterval);
	status.textContent = 'Redirect paused';
	status.classList.add('paused');
});

const id = document.body.dataset.workshopId;
const fast = document.body.dataset.fast === '1';
const delay = Number(document.body.dataset.delay);

// first thing, before any timer: the userscript closes fast-mode tabs after
// ~150ms. webdriver check skips automated browsers (they can't be told apart
// from real ones by UA alone); the server filters bots and duplicates itself
if (!navigator.webdriver && navigator.sendBeacon) navigator.sendBeacon('/api/view?id=' + encodeURIComponent(id));

const steamClientUrl = `steam://url/CommunityFilePage/${id}`;
const workshopUrl = `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;

// not for Discord's scraper (reads raw og: tags, no JS); gives the
// browser's async steam:// permission check time to resolve before
// the fallback navigation below can cancel it mid-flight
setTimeout(() => {
	window.location.href = steamClientUrl;
}, fast ? 0 : 1000);

setTimeout(() => {
	window.location.href = workshopUrl;
}, fast ? 300 : delay * 1000);

if (!fast) {
	let countdown = delay;
	const countdownElement = document.getElementById('countdown');
	const countdownInterval = setInterval(() => {
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
	}, 1000);
}

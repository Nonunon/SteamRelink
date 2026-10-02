document.querySelectorAll('.copy-btn').forEach(btn => {
	btn.addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(btn.dataset.copy);
			btn.classList.add('copied');
			setTimeout(() => btn.classList.remove('copied'), 1200);
		} catch (error) {
			console.error('Copy failed:', error);
		}
	});
});

// steam://open/main just focuses the Steam client, harmless either way
document.getElementById('test-steam-btn')?.addEventListener('click', () => {
	window.location.href = 'steam://open/main';
});

function extractWorkshopId(raw) {
	const trimmed = raw.trim();
	if (!trimmed) return null;
	if (/^\d+$/.test(trimmed)) return trimmed;
	const match = trimmed.match(/[?&]id=(\d+)/);
	return match ? match[1] : null;
}

const converterInput = document.getElementById('converter-input');
const convertBtn = document.getElementById('convert-btn');
const converterBox = document.querySelector('.converter-box');
const converterError = document.getElementById('converter-error');
const converterCopyBtn = document.getElementById('converter-copy-btn');
const fastToggle = document.getElementById('fast-toggle-input');

function runConvert() {
	const id = extractWorkshopId(converterInput.value);
	if (!id) {
		converterError.textContent = "Couldn't find a workshop ID in that. Paste the full Workshop URL or just the numeric ID.";
		converterError.hidden = false;
		return;
	}
	converterError.hidden = true;
	const converted = window.location.origin + '/?id=' + id + (fastToggle.checked ? '&fast' : '');
	converterInput.value = converted;
	converterCopyBtn.dataset.copy = converted;
	converterCopyBtn.hidden = false;
	converterBox.classList.add('expanded');

	// best-effort auto-copy; the visible button is still a manual fallback
	navigator.clipboard.writeText(converted).then(() => {
		converterCopyBtn.classList.add('copied');
		setTimeout(() => converterCopyBtn.classList.remove('copied'), 1200);
	}).catch(error => {
		console.error('Auto-copy failed:', error);
	});
}

convertBtn.addEventListener('click', runConvert);
converterInput.addEventListener('keydown', (e) => {
	if (e.key === 'Enter') runConvert();
});

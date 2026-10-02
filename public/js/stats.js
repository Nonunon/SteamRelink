// game filter: button + listbox, keyboard works like a native select
(() => {
	const filter = document.getElementById('game-filter');
	if (!filter) return;
	const button = filter.querySelector('.game-filter-button');
	const label = filter.querySelector('.game-filter-label');
	const menu = filter.querySelector('.game-filter-menu');
	const options = [...menu.querySelectorAll('[role="option"]')];

	const isOpen = () => !menu.hidden;
	const selectedOption = () => options.find(o => o.getAttribute('aria-selected') === 'true') || options[0];

	const open = () => {
		menu.hidden = false;
		button.setAttribute('aria-expanded', 'true');
		selectedOption().focus();
	};
	const close = (refocus) => {
		menu.hidden = true;
		button.setAttribute('aria-expanded', 'false');
		if (refocus) button.focus();
	};

	const choose = (option) => {
		options.forEach(o => o.setAttribute('aria-selected', o === option ? 'true' : 'false'));
		label.textContent = option.textContent;
		const selected = option.dataset.value;
		document.querySelectorAll('.stats-table tbody tr').forEach(row => {
			row.style.display = (selected === 'all' || row.dataset.game === selected) ? '' : 'none';
		});
		close(true);
	};

	button.addEventListener('click', () => (isOpen() ? close(false) : open()));
	button.addEventListener('keydown', (e) => {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			open();
		}
	});

	options.forEach(option => option.addEventListener('click', () => choose(option)));

	menu.addEventListener('keydown', (e) => {
		const index = options.indexOf(document.activeElement);
		const move = (to) => options[Math.max(0, Math.min(options.length - 1, to))].focus();
		if (e.key === 'ArrowDown') move(index + 1);
		else if (e.key === 'ArrowUp') move(index - 1);
		else if (e.key === 'Home') move(0);
		else if (e.key === 'End') move(options.length - 1);
		else if (e.key === 'Enter' || e.key === ' ') { if (index >= 0) choose(options[index]); }
		else if (e.key === 'Escape') close(true);
		else if (e.key === 'Tab') { close(false); return; }
		else return;
		e.preventDefault();
	});

	document.addEventListener('pointerdown', (e) => {
		if (isOpen() && !filter.contains(e.target)) close(false);
	});
})();

// click-to-sort headers. No icons except a tiny arrow on the active column
(() => {
	const tbody = document.querySelector('.stats-table tbody');
	if (!tbody) return;

	// comparators read the row's own data-* attributes, set server-side
	const getters = {
		rank: row => Number(row.dataset.rank),
		title: row => row.dataset.title || '',
		views: row => Number(row.dataset.views),
		// 'Never' sorts as the oldest possible date
		lastviewed: row => {
			const iso = row.querySelector('.last-viewed')?.dataset.iso;
			const time = iso ? new Date(iso).getTime() : NaN;
			return isNaN(time) ? 0 : time;
		}
	};

	// direction the first click on each column starts with
	const defaultDirection = { rank: 'asc', title: 'asc', views: 'desc', lastviewed: 'desc' };

	const applySort = (column, direction) => {
		const getter = getters[column];
		const rows = [...tbody.querySelectorAll('tr')];
		rows.sort((a, b) => {
			// excluded rows (masked rank/views, not counted toward the
			// leaderboard) always sort last, regardless of column/direction
			const aExcluded = a.dataset.excluded === 'true';
			const bExcluded = b.dataset.excluded === 'true';
			if (aExcluded !== bExcluded) return aExcluded ? 1 : -1;
			if (aExcluded && bExcluded) return (a.dataset.title || '').localeCompare(b.dataset.title || '');

			const av = getter(a);
			const bv = getter(b);
			const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
			return direction === 'asc' ? cmp : -cmp;
		});
		rows.forEach(row => tbody.appendChild(row));

		// scroll position was meaningful for the old row order, not the new one
		const contentWrapper = document.querySelector('.table-wrapper .simplebar-content-wrapper');
		if (contentWrapper) contentWrapper.scrollTop = 0;
	};

	const setArrow = th => {
		document.querySelectorAll('.stats-table thead th[data-sort] .sort-arrow').forEach(el => el.remove());
		if (!th) return;
		const arrow = document.createElement('span');
		arrow.className = 'sort-arrow';
		arrow.textContent = th.dataset.currentDirection === 'asc' ? ' ▲' : ' ▼';
		th.appendChild(arrow);
	};

	// 3-click cycle: default direction, opposite, then back to rank
	// ascending with no arrow shown
	let activeColumn = null;
	let clickStep = 0;

	document.querySelectorAll('.stats-table thead th[data-sort]').forEach(th => {
		th.addEventListener('click', () => {
			const column = th.dataset.sort;
			if (column !== activeColumn) clickStep = 0;
			clickStep = (clickStep + 1) % 3;
			activeColumn = column;

			if (clickStep === 0) {
				applySort('rank', 'asc');
				setArrow(null);
				activeColumn = null;
				return;
			}

			const direction = clickStep === 1 ? defaultDirection[column] : (defaultDirection[column] === 'asc' ? 'desc' : 'asc');
			applySort(column, direction);
			th.dataset.currentDirection = direction;
			setArrow(th);
		});
	});
})();

// formatted here, not server-side, so it reflects the viewer's own timezone
document.querySelectorAll('.last-viewed[data-iso]').forEach(cell => {
	const iso = cell.dataset.iso;
	const d = new Date(iso);
	if (!iso || isNaN(d)) {
		cell.textContent = 'Never';
		return;
	}
	const date = d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: 'numeric' });
	const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	cell.innerHTML = '<span class="lv-date"></span><span class="lv-time"></span>';
	cell.querySelector('.lv-date').textContent = date;
	cell.querySelector('.lv-time').textContent = time;
});

// waiting for DOMContentLoaded guarantees the deferred SimpleBar script
// has run. Scoped to just this element, not the page-wide auto-init.
document.addEventListener('DOMContentLoaded', () => {
	const wrapper = document.querySelector('.table-wrapper');
	if (!wrapper || !window.SimpleBar) return;

	new SimpleBar(wrapper);

	// the sticky <thead> is inside SimpleBar's scrolled content, so its
	// track would otherwise span the header row too; offset it to start
	// below the header instead
	const thead = wrapper.querySelector('thead');
	const track = wrapper.querySelector('.simplebar-track.simplebar-vertical');
	if (thead && track) {
		const syncTrackOffset = () => {
			track.style.top = thead.offsetHeight + 'px';
		};
		syncTrackOffset();
		new ResizeObserver(syncTrackOffset).observe(thead);
	}
});

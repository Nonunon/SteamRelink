// ==UserScript==
// @name         SteamRelink Button
// @namespace    https://steamre.link
// @version      2.7
// @description  Adds a button to redirect Steam Workshop links to the custom SteamRelink page, and auto-closes SteamRelink fast-mode tabs shortly after steam:// fires (toggleable via the script manager's menu)
// @icon         https://steamre.link/images/SteamRelink-32x32.png
// @updateURL    https://raw.githubusercontent.com/Nonunon/SteamRelink/refs/heads/main/SteamRelink.user.js
// @downloadURL  https://raw.githubusercontent.com/Nonunon/SteamRelink/refs/heads/main/SteamRelink.user.js
// @match        *://steamcommunity.com/sharedfiles/filedetails/*
// @match        *://steamcommunity.com/workshop/filedetails/*
// @match        https://steamre.link/*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        window.close
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.setClipboard
// @grant        GM.registerMenuCommand
// ==/UserScript==

(async function() {
    'use strict';

    // Greasemonkey 4 only has the async GM.* API, while Tampermonkey and
    // Violentmonkey also have GM_*. Prefer GM_*, fall back to GM.*, and fall
    // back again to plain browser APIs where GM4 has no equivalent at all.
    // typeof is safe on undeclared names, so these checks never throw.
    const gm = typeof GM !== 'undefined' ? GM : {};

    const getValue = async (key, fallback) => {
        if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
        if (gm.getValue) return gm.getValue(key, fallback);
        return fallback;
    };

    const setValue = (key, value) => {
        if (typeof GM_setValue === 'function') return GM_setValue(key, value);
        if (gm.setValue) return gm.setValue(key, value);
    };

    const setClipboard = (text) => {
        if (typeof GM_setClipboard === 'function') return GM_setClipboard(text);
        if (gm.setClipboard) return gm.setClipboard(text);
        return navigator.clipboard.writeText(text);
    };

    const addStyle = (css) => {
        if (typeof GM_addStyle === 'function') return GM_addStyle(css);
        const style = document.createElement('style');
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    };

    const registerMenuCommand = (label, fn) => {
        if (typeof GM_registerMenuCommand === 'function') return GM_registerMenuCommand(label, fn);
        if (gm.registerMenuCommand) return gm.registerMenuCommand(label, fn);
        // no menu API (Greasemonkey 4): the toggle just isn't offered
    };

    const FAST_CLOSE_KEY = 'sr-fast-close-enabled';
    // defaults on to preserve existing behavior; flip off via the script manager's menu
    const fastCloseEnabled = await getValue(FAST_CLOSE_KEY, true);

    registerMenuCommand(
        fastCloseEnabled ? 'Disable Fast-Close' : 'Enable Fast-Close',
        () => {
            setValue(FAST_CLOSE_KEY, !fastCloseEnabled);
            // label only updates on next page load; that's a normal
            // limitation of GM_registerMenuCommand, not a bug
        }
    );

    const hostname = window.location.hostname;

    if (hostname === 'steamcommunity.com') {
        const url = window.location.href;
        // id doesn't have to be the first query param (e.g. ?searchtext=&id=123)
        const match = url.match(/steamcommunity\.com\/(?:sharedfiles|workshop)\/filedetails\/\?(?:[^#]*&)?id=(\d+)/);

        if (match && match[1]) {
            const workshopId = match[1];
            const normalUrl = `https://steamre.link/?id=${workshopId}`;
            const fastUrl   = `https://steamre.link/?id=${workshopId}&fast`;

            addStyle(`
                #sr-wrapper {
                    position: fixed;
                    top: 10px;
                    right: 10px;
                    z-index: 9999;
                    display: inline-block;
                    font-family: Arial, sans-serif;
                }

                #sr-main-btn {
                    display: block;
                    width: 100%;
                    padding: 8px 14px;
                    background: linear-gradient(135deg, #4a8a4f, #66b266);
                    color: #ffffff;
                    font-family: Arial, sans-serif;
                    font-weight: bold;
                    font-size: 14px;
                    border: 1px solid #2a2a2a;
                    border-radius: 5px;
                    box-shadow: 2px 2px 5px rgba(0,0,0,0.35);
                    cursor: pointer;
                    white-space: nowrap;
                    text-align: center;
                }

                #sr-main-btn:hover {
                    background: linear-gradient(135deg, #559155, #70c270);
                }

                #sr-dropdown {
                    display: none;
                    position: absolute;
                    top: calc(100% + 3px);
                    right: 0;
                    min-width: 100%;
                    background: #1b2838;
                    border: 1px solid #2a2a2a;
                    border-radius: 5px;
                    box-shadow: 2px 4px 8px rgba(0,0,0,0.5);
                    overflow: hidden;
                    white-space: nowrap;
                }

                .sr-divider {
                    height: 1px;
                    background: #2a475e;
                    margin: 0;
                }

                .sr-item {
                    display: block;
                    width: 100%;
                    padding: 8px 14px;
                    background: transparent;
                    color: #c7d5e0;
                    font-family: Arial, sans-serif;
                    font-size: 13px;
                    font-weight: normal;
                    border: none;
                    cursor: pointer;
                    text-align: left;
                    box-sizing: border-box;
                }

                .sr-item:hover {
                    background: #2a475e;
                    color: #ffffff;
                }

                .sr-item.sr-fast {
                    color: #66c0f4;
                }

                .sr-item.sr-fast:hover {
                    color: #ffffff;
                }

                .sr-item.sr-copy {
                    font-size: 12px;
                    color: #8f98a0;
                }

                .sr-item.sr-copy:hover {
                    color: #ffffff;
                }

                #sr-main-btn:focus-visible,
                .sr-item:focus-visible {
                    outline: 2px solid #66c0f4;
                    outline-offset: -2px;
                }

                .sr-item:focus-visible {
                    background: #2a475e;
                    color: #ffffff;
                }

                .sr-feedback {
                    display: block;
                    padding: 5px 14px 7px;
                    font-size: 11px;
                    color: #66b266;
                    font-family: Arial, sans-serif;
                    text-align: left;
                    pointer-events: none;
                }
            `);

            const wrapper = document.createElement('div');
            wrapper.id = 'sr-wrapper';

            const mainBtn = document.createElement('button');
            mainBtn.id = 'sr-main-btn';
            mainBtn.textContent = 'SteamRelink';
            // set on touch pointerdown further down; a first tap opens the menu instead
            let touchTapOnClosedMenu = false;
            mainBtn.addEventListener('click', () => {
                if (touchTapOnClosedMenu) {
                    touchTapOnClosedMenu = false;
                    showDropdown();
                    return;
                }
                window.location.href = normalUrl;
            });

            const dropdown = document.createElement('div');
            dropdown.id = 'sr-dropdown';

            const fastItem = document.createElement('button');
            fastItem.className = 'sr-item sr-fast';
            fastItem.textContent = 'Fast Redirect';
            fastItem.addEventListener('click', () => {
                window.location.href = fastUrl;
            });

            const divider1 = document.createElement('div');
            divider1.className = 'sr-divider';

            const copyItem = document.createElement('button');
            copyItem.className = 'sr-item sr-copy';
            copyItem.textContent = 'Copy Redirect Link';

            const copyFastItem = document.createElement('button');
            copyFastItem.className = 'sr-item sr-copy';
            copyFastItem.textContent = 'Copy Fast Redirect Link';

            // shared between both copy buttons below
            const feedback = document.createElement('span');
            feedback.className = 'sr-feedback';
            feedback.style.display = 'none';

            let feedbackTimer;
            const showFeedback = (msg) => {
                clearTimeout(feedbackTimer);
                feedback.textContent = msg;
                feedback.style.display = 'block';
                feedbackTimer = setTimeout(() => {
                    feedback.style.display = 'none';
                }, 2000);
            };

            copyItem.addEventListener('click', (e) => {
                e.stopPropagation();
                setClipboard(normalUrl);
                showFeedback('Copied to clipboard.');
            });

            copyFastItem.addEventListener('click', (e) => {
                e.stopPropagation();
                setClipboard(fastUrl);
                showFeedback('Copied to clipboard.');
            });

            dropdown.appendChild(fastItem);
            dropdown.appendChild(divider1);
            dropdown.appendChild(copyItem);
            dropdown.appendChild(copyFastItem);
            dropdown.appendChild(feedback);

            let hideTimer;
            const isOpen = () => dropdown.style.display === 'block';
            const showDropdown = () => {
                clearTimeout(hideTimer);
                dropdown.style.display = 'block';
                mainBtn.setAttribute('aria-expanded', 'true');
            };
            const hideNow = () => {
                clearTimeout(hideTimer);
                dropdown.style.display = 'none';
                feedback.style.display = 'none';
                mainBtn.setAttribute('aria-expanded', 'false');
            };
            const hideDropdown = () => {
                hideTimer = setTimeout(hideNow, 150);
            };

            mainBtn.setAttribute('aria-haspopup', 'true');
            mainBtn.setAttribute('aria-expanded', 'false');

            // mouse: hover, same as always
            wrapper.addEventListener('mouseenter', showDropdown);
            wrapper.addEventListener('mouseleave', hideDropdown);

            // keyboard: tabbing onto the button opens the menu, tabbing past
            // the last item closes it, Escape closes and returns to the button
            wrapper.addEventListener('focusin', showDropdown);
            wrapper.addEventListener('focusout', (e) => {
                if (!wrapper.contains(e.relatedTarget)) hideDropdown();
            });
            wrapper.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && isOpen()) {
                    hideNow();
                    mainBtn.focus();
                }
            });

            // touch has no hover, so the first tap opens the menu and a second
            // tap on the button redirects. Recorded at pointerdown because the
            // browser's emulated mouseenter/focus open the menu before click fires
            mainBtn.addEventListener('pointerdown', (e) => {
                touchTapOnClosedMenu = e.pointerType === 'touch' && !isOpen();
            });
            document.addEventListener('pointerdown', (e) => {
                if (isOpen() && !wrapper.contains(e.target)) hideNow();
            });

            wrapper.appendChild(mainBtn);
            wrapper.appendChild(dropdown);
            document.body.appendChild(wrapper);
        }
    } else if (hostname === 'steamre.link') {
        if (!fastCloseEnabled) return;

        // empirical, not documented: 150ms works reliably in practice. If
        // steam:// starts silently failing to launch, raise this before
        // assuming something else broke.
        const CLOSE_DELAY_MS = 150;

        const params = new URLSearchParams(window.location.search);
        const isRedirectPage = params.has('id');
        const isFast = params.has('fast') || window.location.pathname === '/&fast';

        if (isRedirectPage && isFast) {
            setTimeout(() => {
                window.close();
            }, CLOSE_DELAY_MS);
        }
    }
})();

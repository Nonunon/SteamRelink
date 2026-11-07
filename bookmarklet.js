(function() {
    const url = window.location.href;
    const match = url.match(/steamcommunity\.com\/(?:sharedfiles|workshop)\/filedetails\/\?(?:[^#]*&)?id=(\d+)/);
    if (match && match[1]) {
        const workshopId = match[1];
        const redirectUrl = `https://steamre.link/?id=${workshopId}`;
        window.location.href = redirectUrl;
    } else {
        const toast = document.createElement('div');
        toast.textContent = "This is not a valid Steam Workshop link.";
        toast.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;padding:10px 14px;background:#1b2838;color:#c7d5e0;border:1px solid #2a475e;border-radius:6px;font:14px Arial,sans-serif;box-shadow:0 4px 10px rgba(0,0,0,.5)';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }
})();
document.addEventListener("DOMContentLoaded", function () {
    const container = document.getElementById("bookmark-container");
    const searchInput = document.getElementById("search");
    const viewToggle = document.getElementById("view-toggle");
    const refreshButton = document.getElementById("refresh-cache");

    // Configuration
    const FALLBACK_IMAGE = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4=';
    const CACHE_KEY = 'bookmarkCache';
    const CACHE_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days
    const FETCH_TIMEOUT = 5000; // 5 seconds timeout

    let bookmarks = [];
    let currentView = localStorage.getItem("bookmarkView") || "card";
    let currentSortKey = 'title';
    let isAscending = true;

    // Initialize
    loadBookmarks();
    viewToggle.addEventListener("click", toggleView);
    searchInput.addEventListener("input", debounce(handleSearch, 300));
    refreshButton.addEventListener("click", () => {
        localStorage.removeItem(CACHE_KEY);
        location.reload();
    });

    async function loadBookmarks() {
        try {
            const response = await fetch('links.txt');
            if (!response.ok) throw new Error('Failed to load links.txt');

            const text = await response.text();
            const urls = text.split('\n')
                .map(url => url.trim())
                .filter(url => url.length > 0 && isValidUrl(url));

            if (urls.length === 0) {
                throw new Error('No valid URLs found in links.txt');
            }

            let cachedBookmarks = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');

            function isCacheValid(bookmark) {
                return bookmark && bookmark.timestamp && (Date.now() - bookmark.timestamp) < CACHE_EXPIRY;
            }

            bookmarks = [];
            for (const url of urls) {
                let cachedBookmark = cachedBookmarks.find(item => item.url === url);
                let shouldScrape = !cachedBookmark || !isCacheValid(cachedBookmark);

                if (shouldScrape) {
                    console.log(`Scraping new or expired data for ${url}`);
                    try {
                        const meta = await fetchMetadataWithTimeout(url, FETCH_TIMEOUT);
                        const bookmarkData = {
                            title: sanitizeString(meta.title || new URL(url).hostname),
                            shortDescription: sanitizeString(meta.shortDescription || meta.title || `Visit ${new URL(url).hostname}`),
                            longDescription: sanitizeString(meta.longDescription || meta.description || `Explore more at ${new URL(url).hostname}`),
                            preview: meta.image || FALLBACK_IMAGE,
                            link: url,
                            domain: new URL(url).hostname.replace('www.', '')
                        };
                        bookmarks.push(bookmarkData);
                    } catch (error) {
                        console.error(`Error processing ${url}:`, error.message);
                        container.innerHTML += `<div class="error-message">Failed to load ${url}: ${error.message}</div>`;
                        bookmarks.push({
                            title: new URL(url).hostname,
                            shortDescription: `Visit ${new URL(url).hostname}`,
                            longDescription: `Explore more at ${new URL(url).hostname}`,
                            preview: FALLBACK_IMAGE,
                            link: url,
                            domain: new URL(url).hostname.replace('www.', '')
                        });
                    }
                } else {
                    console.log(`Using cached data for ${url}`);
                    bookmarks.push(cachedBookmark.data);
                }
            }

            cachedBookmarks = urls.map((url, index) => ({
                url: url,
                timestamp: Date.now(),
                data: bookmarks[index] || {}
            }));
            localStorage.setItem(CACHE_KEY, JSON.stringify(cachedBookmarks));

            if (bookmarks.length === 0) {
                throw new Error('No valid bookmarks found');
            }

            container.classList.remove('loading');
            renderBookmarks(bookmarks);
        } catch (error) {
            console.error('Bookmark loading failed:', error);
            container.innerHTML = `<div class="error-message">Error loading bookmarks: ${error.message}</div>`;
        }
    }

    function isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch (_) {
            console.warn(`Invalid URL detected: ${string}`);
            return false;
        }
    }

    function sanitizeString(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/[\r\n]+/g, ' ').trim();
    }

    async function fetchMetadataWithTimeout(url, timeout) {
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Request timed out')), timeout);
        });

        const fetchPromise = fetchMetadata(url);

        return Promise.race([fetchPromise, timeoutPromise]);
    }

    async function fetchMetadata(url) {
        try {
            const controller = new AbortController();
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                },
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            let image = doc.querySelector('meta[property="og:image"]')?.content ||
                       doc.querySelector('link[rel="apple-touch-icon"]')?.href ||
                       doc.querySelector('link[rel="icon"]')?.href;

            const title = doc.querySelector('meta[property="og:title"]')?.content ||
                         doc.querySelector('title')?.textContent?.trim() ||
                         doc.querySelector('h1')?.textContent?.trim() ||
                         new URL(url).hostname;

            const ogDescription = doc.querySelector('meta[property="og:description"]')?.content ||
                                doc.querySelector('meta[name="description"]')?.content;
            const paragraphs = Array.from(doc.querySelectorAll('p'))
                .map(p => p.textContent.trim())
                .filter(p => p.length > 0 && p.length < 500);

            const shortDescription = ogDescription || (paragraphs[0] || `Visit ${new URL(url).hostname}`).slice(0, 100);
            const longDescription = ogDescription || paragraphs.slice(0, 2).join(' ') || `Explore more at ${new URL(url).hostname}`;

            return { 
                title: sanitizeString(title), 
                shortDescription: sanitizeString(shortDescription), 
                longDescription: sanitizeString(longDescription), 
                image: image ? sanitizeString(image) : null 
            };
        } catch (error) {
            throw new Error(`Fetch failed for ${url}: ${error.message}`);
        }
    }

    function renderTableView(bookmarks) {
        container.innerHTML = '';

        if (bookmarks.length === 0) {
            container.innerHTML = '<div class="error-message">No bookmarks match your search</div>';
            return;
        }

        const header = createTableHeader();
        container.appendChild(header);

        bookmarks.forEach(bookmark => {
            const row = document.createElement("div");
            row.className = "bookmark-row";
            row.innerHTML = `
                <div class="bookmark-cell title">
                    <a href="${bookmark.link}" target="_blank" rel="noopener">${bookmark.title}</a>
                </div>
                <div class="bookmark-cell description">${bookmark.shortDescription}</div>
                <div class="bookmark-cell link">${bookmark.domain}</div>
                <div class="bookmark-cell preview">
                    <div class="bookmark-preview-image">
                        <img src="${bookmark.preview}" alt="${bookmark.title} Preview"
                             loading="lazy"
                             onerror="this.src='${FALLBACK_IMAGE}'">
                    </div>
                </div>
            `;
            container.appendChild(row);
        });
    }

    function renderCardView(bookmarks) {
        container.innerHTML = '';

        if (bookmarks.length === 0) {
            container.innerHTML = '<div class="error-message">No bookmarks to display.</div>';
            return;
        }

        const cardContainer = document.createElement("div");
        cardContainer.className = "card-container";

        bookmarks.forEach(bookmark => {
            const card = document.createElement("div");
            card.className = "bookmark-card";
            card.innerHTML = `
                <div class="bookmark-content">
                    <h3><a href="${bookmark.link}" target="_blank" rel="noopener">${bookmark.title}</a></h3>
                    <p class="bookmark-short-description">${bookmark.shortDescription}</p>
                    <p class="bookmark-long-description">${bookmark.longDescription}</p>
                    <p class="bookmark-url">${bookmark.link}</p>
                </div>
                <div class="bookmark-preview">
                    <div class="bookmark-preview-image">
                        <img src="${bookmark.preview}"
                             alt="${bookmark.title} Preview"
                             loading="lazy"
                             onerror="this.onerror=null; this.src='${FALLBACK_IMAGE}';">
                    </div>
                </div>
            `;
            cardContainer.appendChild(card);
        });

        container.appendChild(cardContainer);
    }

    function createTableHeader() {
        const header = document.createElement("div");
        header.className = "bookmark-header";
        header.innerHTML = `
            <div class="header-item title" data-sort="title">Title</div>
            <div class="header-item description" data-sort="description">Description</div>
            <div class="header-item link" data-sort="link">Link</div>
            <div class="header-item preview">Preview</div>
        `;
        header.querySelectorAll('[data-sort]').forEach(item => {
            item.addEventListener('click', () => {
                if (currentSortKey === item.dataset.sort) {
                    isAscending = !isAscending;
                } else {
                    currentSortKey = item.dataset.sort;
                    isAscending = true;
                }
                renderFilteredBookmarks();
            });
        });
        return header;
    }

    function handleSearch() {
        renderFilteredBookmarks();
    }

    function renderFilteredBookmarks() {
        const searchTerm = searchInput.value.toLowerCase();
        const filtered = bookmarks.filter(bookmark =>
            bookmark.title.toLowerCase().includes(searchTerm) ||
            bookmark.shortDescription.toLowerCase().includes(searchTerm) ||
            bookmark.longDescription.toLowerCase().includes(searchTerm) ||
            bookmark.link.toLowerCase().includes(searchTerm)
        );
        renderBookmarks(sortBookmarks(filtered, currentSortKey, isAscending));
    }

    function sortBookmarks(bookmarksToSort, sortKey, ascending) {
        return [...bookmarksToSort].sort((a, b) => {
            if (a[sortKey] < b[sortKey]) return ascending ? -1 : 1;
            if (a[sortKey] > b[sortKey]) return ascending ? 1 : -1;
            return 0;
        });
    }

    function renderBookmarks(sortedBookmarks) {
        container.innerHTML = '';
        if (currentView === "table") {
            renderTableView(sortedBookmarks);
        } else {
            renderCardView(sortedBookmarks);
        }
    }

    function toggleView() {
        currentView = currentView === "table" ? "card" : "table";
        localStorage.setItem("bookmarkView", currentView);
        viewToggle.textContent = currentView === "table" ? "Card View" : "Table View";
        renderFilteredBookmarks();
    }

    function debounce(func, timeout = 300) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => { func.apply(this, args); }, timeout);
        };
    }
});

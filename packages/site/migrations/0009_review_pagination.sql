-- Seek by a stable (time, slug) cursor within each admin list. NULL upload times sort first.
CREATE INDEX item_pending_page ON item (COALESCE(uploaded_at, ''), slug) WHERE status = 'pending';
CREATE INDEX item_live_page ON item (published_at DESC, slug DESC) WHERE status = 'published';

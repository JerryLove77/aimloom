-- popularAvailable asks for the oldest month across all items; (slug, month) cannot seek it.
CREATE INDEX download_monthly_month ON download_monthly (month);

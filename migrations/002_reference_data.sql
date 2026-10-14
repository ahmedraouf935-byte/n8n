-- Reference data: known data sources and integrations with their honest access status.
-- Nothing here is "enabled" until credentials are configured and a live check succeeds.

INSERT INTO data_sources (code, name, platform, kind, access_status, daily_request_limit, notes) VALUES
  ('manual_entry',        'إدخال يدوي من المالك',             'manual',        'manual',      'enabled', 1000, 'Owner-entered records via dashboard forms'),
  ('csv_import',          'استيراد CSV',                        'csv',           'csv',         'enabled', 50,   'Owner-uploaded CSV research files'),
  ('owner_screenshot',    'لقطات شاشة من المالك',               'manual',        'manual',      'enabled', 200,  'Owner transcribes evidence from screenshots; screenshot URL kept as evidence'),
  ('n8n_webhook',         'n8n (Webhook موثّق)',                'n8n',           'webhook',     'enabled', 500,  'Authenticated pushes from n8n workflows'),
  ('telegram_suppliers',  'قنوات موردين تيليجرام',             'telegram',      'telegram',    'pending_credentials', 2000, 'Bot must be an admin of each channel or a member of each group with privacy mode configured'),
  ('google_trends',       'Google Trends (مصر)',                'google_trends', 'manual',      'not_available', 0, 'No official public API. Use manual export (CSV) from trends.google.com'),
  ('tiktok_creative',     'TikTok Creative Center',             'tiktok',        'manual',      'not_available', 0, 'No public API for Creative Center. Owner records observations manually with URL'),
  ('tiktok_research_api', 'TikTok Research API',                'tiktok',        'api',         'not_available', 0, 'Restricted to approved academic researchers in eligible regions'),
  ('meta_ad_library',     'Meta Ad Library',                    'facebook',      'api',         'not_available', 0, 'API covers political/issue ads (and EU-delivered ads). Commercial ads in Egypt: manual review of the web UI only'),
  ('meta_graph',          'Meta Graph API (صفحة/إنستجرام)',     'facebook',      'api',         'pending_credentials', 200, 'Own Page and IG professional account only: publishing + own insights'),
  ('instagram_hashtag',   'Instagram Hashtag Search',           'instagram',     'api',         'pending_credentials', 30,  'Requires IG professional account + app review; 30 unique hashtags / 7 days'),
  ('amazon_eg',           'Amazon.eg (يدوي)',                   'amazon_eg',     'manual',      'enabled', 200, 'Manual price capture with URL. PA-API requires an approved Associates account'),
  ('noon_eg',             'Noon مصر (يدوي)',                    'noon',          'manual',      'enabled', 200, 'Manual price capture with URL'),
  ('jumia_eg',            'Jumia مصر (يدوي)',                   'jumia',         'manual',      'enabled', 200, 'Manual price capture with URL'),
  ('anthropic_ai',        'Claude AI',                          'ai',            'api',         'pending_credentials', 500, 'Extraction, classification and copywriting. Optional: rule-based fallback exists');

INSERT INTO integration_status (code, name, status, details) VALUES
  ('database',  'قاعدة البيانات',         'connected',           '{}'),
  ('n8n',       'n8n Cloud',               'pending_credentials', '{"needs":["N8N_WEBHOOK_SECRET","SAFQA_PUBLIC_URL in n8n"]}'),
  ('telegram',  'Telegram Bot',            'pending_credentials', '{"needs":["TELEGRAM_BOT_TOKEN","TELEGRAM_OWNER_CHAT_ID"]}'),
  ('meta',      'Meta Graph API',          'pending_credentials', '{"needs":["META_PAGE_ID","META_PAGE_ACCESS_TOKEN","META_IG_USER_ID (optional)"]}'),
  ('ai',        'Claude API',              'pending_credentials', '{"needs":["ANTHROPIC_API_KEY"]}'),
  ('google_sheets', 'Google Sheets (تصدير)', 'disabled',          '{"note":"Optional backup via n8n Google Sheets node"}');

INSERT INTO app_settings (key, value) VALUES
  ('capital', '{"initial_capital": 5000, "allocations": {"inventory": 2500, "advertising": 1200, "packaging_transport": 500, "contingency": 800}}'),
  ('risk', '{"max_concurrent_tests": 2, "max_test_spend_per_product": 1500, "min_margin_pct": 15, "require_compliance_ack_for": ["cosmetics","medical","electronics","food","children","regulated"], "blocked_categories": ["prohibited"]}'),
  ('scoring', '{"weights": {"demand": 30, "profit": 30, "supplier": 20, "risk": 10, "competition": 10}, "bands": {"high_priority": 80, "manual_review": 65}}'),
  ('freshness', '{"supplier_offer_stale_days": 7, "verification_valid_days": 3, "retail_offer_fresh_days": 14, "trend_fresh_days": 21}'),
  ('unit_economics_defaults', '{"packaging_per_order": 8, "carrier_cost_per_order": 60, "shipping_fee_charged": 50, "cod_fee_pct": 1, "cod_fee_fixed": 0, "ad_cost_per_order": 40, "failed_delivery_rate": 0.15, "failed_delivery_cost": 30, "return_rate": 0.05, "return_cost": 30, "resellable_return_rate": 0.8, "discount_per_order": 0, "tax_pct": 0, "other_cost_per_unit": 0, "pickup_cost_total": 50}'),
  ('research', '{"daily_candidate_limit": 10, "top_recommendations": 3, "schedule_cron": "0 7 * * *"}'),
  ('publishing', '{"require_owner_approval": true, "auto_publish_in_stock_only": true}'),
  ('ai', '{"monthly_budget_usd": 5, "model": "claude-opus-5-5"}');

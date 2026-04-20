-- Seed data for DevOps Agent Demo Environment
-- Populates the products table with the trigger item and normal products
-- Uses ON CONFLICT DO NOTHING for idempotent execution

-- Trigger item: purchasing this activates EBS fault injection
INSERT INTO products (id, name, description, price, image_url, category, is_trigger)
VALUES (
  'TRIGGER_ITEM',
  'Mystery Box of Chaos',
  'Buy this item to trigger a system failure demo',
  9999,
  '/images/mystery-box.png',
  'special',
  TRUE
) ON CONFLICT (id) DO NOTHING;

-- Normal products
INSERT INTO products (id, name, description, price, image_url, category, is_trigger)
VALUES (
  'PROD-001',
  'Wireless Bluetooth Headphones',
  'High-quality over-ear headphones with noise cancellation',
  4999,
  '/images/headphones.png',
  'electronics',
  FALSE
) ON CONFLICT (id) DO NOTHING;

INSERT INTO products (id, name, description, price, image_url, category, is_trigger)
VALUES (
  'PROD-002',
  'Classic Cotton T-Shirt',
  'Comfortable everyday t-shirt available in multiple colors',
  1999,
  '/images/tshirt.png',
  'clothing',
  FALSE
) ON CONFLICT (id) DO NOTHING;

INSERT INTO products (id, name, description, price, image_url, category, is_trigger)
VALUES (
  'PROD-003',
  'The Pragmatic Programmer',
  'Essential reading for software developers — 20th anniversary edition',
  3499,
  '/images/pragmatic-programmer.png',
  'books',
  FALSE
) ON CONFLICT (id) DO NOTHING;

INSERT INTO products (id, name, description, price, image_url, category, is_trigger)
VALUES (
  'PROD-004',
  'Stainless Steel Water Bottle',
  'Insulated 750ml bottle keeps drinks cold for 24 hours',
  2499,
  '/images/water-bottle.png',
  'accessories',
  FALSE
) ON CONFLICT (id) DO NOTHING;

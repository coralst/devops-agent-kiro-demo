-- Database initialization for DevOps Agent Demo Environment
-- Creates products and orders tables with constraints
-- Uses IF NOT EXISTS for idempotent execution

CREATE TABLE IF NOT EXISTS products (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price INTEGER NOT NULL CHECK (price > 0),
  image_url VARCHAR(512),
  category VARCHAR(100),
  is_trigger BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(36) PRIMARY KEY,
  product_id VARCHAR(36) REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  total_price INTEGER NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

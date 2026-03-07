#!/usr/bin/env ts-node
/**
 * Database initialization script
 * Run this script to set up the SQLite database schema
 * 
 * Usage: npm run init-db
 * or: ts-node scripts/init-db.ts [database-path]
 */

import { initializeDatabase } from '../src/session/database';
import path from 'path';

// Get database path from command line argument or environment variable
const dbPath = process.argv[2] || process.env.DATABASE_PATH || './data/sessions.db';

console.log('Initializing database...');
console.log(`Database path: ${path.resolve(dbPath)}`);

try {
  const db = initializeDatabase(dbPath);
  
  // Verify tables were created
  const tables = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' 
    ORDER BY name
  `).all();
  
  console.log('\n✓ Database initialized successfully!');
  console.log('\nCreated tables:');
  tables.forEach((table: any) => {
    console.log(`  - ${table.name}`);
  });
  
  // Verify indexes were created
  const indexes = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='index' AND name LIKE 'idx_%'
    ORDER BY name
  `).all();
  
  console.log('\nCreated indexes:');
  indexes.forEach((index: any) => {
    console.log(`  - ${index.name}`);
  });
  
  db.close();
  console.log('\n✓ Database connection closed.');
  
} catch (error) {
  console.error('\n✗ Error initializing database:', error);
  process.exit(1);
}

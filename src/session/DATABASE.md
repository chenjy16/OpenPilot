# Database Schema Documentation

## Overview

The AI Assistant MVP uses SQLite for persistent storage of conversation sessions and messages. The database is managed using the `better-sqlite3` library.

## Schema

### Sessions Table

Stores conversation session metadata.

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata TEXT NOT NULL
)
```

**Columns:**
- `id`: Unique session identifier (TEXT)
- `created_at`: Session creation timestamp in milliseconds (INTEGER)
- `updated_at`: Last update timestamp in milliseconds (INTEGER)
- `metadata`: JSON string containing session metadata (model, totalTokens, cost)

### Messages Table

Stores individual messages within sessions.

```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  tool_calls TEXT,
  tool_results TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
)
```

**Columns:**
- `id`: Auto-incrementing message ID (INTEGER)
- `session_id`: Reference to parent session (TEXT, FOREIGN KEY)
- `role`: Message role - must be 'user', 'assistant', or 'system' (TEXT with CHECK constraint)
- `content`: Message content (TEXT)
- `timestamp`: Message timestamp in milliseconds (INTEGER)
- `tool_calls`: JSON string of tool calls (TEXT, nullable)
- `tool_results`: JSON string of tool results (TEXT, nullable)

**Constraints:**
- Foreign key to sessions table with CASCADE DELETE
- CHECK constraint on role field

### Indexes

For efficient query performance:

```sql
CREATE INDEX idx_messages_session_id ON messages(session_id)
CREATE INDEX idx_messages_timestamp ON messages(session_id, timestamp)
```

## Initialization

### Using the Script

Run the initialization script to set up the database:

```bash
npm run init-db
```

Or specify a custom database path:

```bash
npm run init-db /path/to/database.db
```

### Programmatic Initialization

```typescript
import { initializeDatabase } from './session/database';

const db = initializeDatabase('./data/sessions.db');
```

### Environment Configuration

Set the database path in your `.env` file:

```
DATABASE_PATH=./data/sessions.db
```

## Usage Examples

### Insert a Session

```typescript
const db = getDatabase();

db.prepare(`
  INSERT INTO sessions (id, created_at, updated_at, metadata)
  VALUES (?, ?, ?, ?)
`).run(
  'session-123',
  Date.now(),
  Date.now(),
  JSON.stringify({ model: 'gpt-4', totalTokens: 0, cost: 0 })
);
```

### Insert a Message

```typescript
db.prepare(`
  INSERT INTO messages (session_id, role, content, timestamp, tool_calls, tool_results)
  VALUES (?, ?, ?, ?, ?, ?)
`).run(
  'session-123',
  'user',
  'Hello, AI!',
  Date.now(),
  null,
  null
);
```

### Query Messages by Session

```typescript
const messages = db.prepare(`
  SELECT * FROM messages 
  WHERE session_id = ? 
  ORDER BY timestamp ASC
`).all('session-123');
```

### Delete a Session (Cascade Delete)

```typescript
// This will automatically delete all associated messages
db.prepare(`DELETE FROM sessions WHERE id = ?`).run('session-123');
```

## Data Types

### Metadata JSON Format

```json
{
  "model": "gpt-4",
  "totalTokens": 1500,
  "cost": 0.045
}
```

### Tool Calls JSON Format

```json
[
  {
    "id": "call_123",
    "name": "readFile",
    "arguments": {
      "path": "config.json"
    }
  }
]
```

### Tool Results JSON Format

```json
[
  {
    "id": "call_123",
    "result": "{ \"key\": \"value\" }"
  }
]
```

## Performance Considerations

- **Indexes**: The `idx_messages_session_id` and `idx_messages_timestamp` indexes ensure efficient message retrieval
- **Foreign Keys**: Enabled for data integrity with CASCADE DELETE for automatic cleanup
- **Connection Pooling**: Use the singleton `getDatabase()` function to reuse connections
- **Transactions**: Use transactions for bulk operations to improve performance

## Maintenance

### Backup

```bash
sqlite3 data/sessions.db ".backup backup.db"
```

### Vacuum (Optimize)

```bash
sqlite3 data/sessions.db "VACUUM"
```

### Check Integrity

```bash
sqlite3 data/sessions.db "PRAGMA integrity_check"
```

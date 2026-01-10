const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB = path.join(__dirname, 'data.sqlite');
const db = new sqlite3.Database(DB, sqlite3.OPEN_READONLY, (err) => {
  if (err) return console.error('Failed to open DB:', err.message);
});

db.get('SELECT * FROM state WHERE id = 1', (err, row) => {
  if (err) {
    console.error('Query error:', err.message);
    db.close();
    return;
  }
  if (!row) {
    console.log('No state row found.');
    db.close();
    return;
  }

  let blocked = [];
  let names = {};
  try { blocked = JSON.parse(row.blocked || '[]'); } catch(e) { blocked = row.blocked; }
  try { names = JSON.parse(row.names || '{}'); } catch(e) { names = row.names; }

  console.log('rows:', row.rows, 'cols:', row.cols);
  console.log('blocked:', blocked);
  console.log('names:', names);
  db.close();
});

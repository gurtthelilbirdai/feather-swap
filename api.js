// Feather Swap API: a shared board where birds offer things and trade them.
// SQLite storage for listings, requests and events.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dir = path.join(__dirname, 'data');
fs.mkdirSync(dir, { recursive: true });
const db = new Database(path.join(dir, 'swap.db'));
db.pragma('journal_mode = WAL');

db.exec(`CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  bird TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT DEFAULT 'thing',
  description TEXT DEFAULT '',
  wants TEXT DEFAULT '',
  place TEXT DEFAULT 'the perch',
  status TEXT DEFAULT 'open',
  created TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  bird TEXT NOT NULL,
  offer TEXT DEFAULT '',
  note TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  created TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  by_bird TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS listing_status ON listings(status);`);

const now = () => new Date().toISOString();
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 100000) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { resolve({}); } });
  });
}
function listingRow(r) {
  const requests = db.prepare('SELECT * FROM requests WHERE listing_id=? ORDER BY created ASC').all(r.id)
    .map(q => ({ id: q.id, bird: q.bird, offer: q.offer, note: q.note, status: q.status, created: q.created }));
  const events = db.prepare('SELECT * FROM events WHERE listing_id=? ORDER BY created ASC').all(r.id)
    .map(e => ({ kind: e.kind, by_bird: e.by_bird, note: e.note, created: e.created }));
  return { id: r.id, bird: r.bird, title: r.title, kind: r.kind, description: r.description,
           wants: r.wants, place: r.place, status: r.status, created: r.created, requests, events };
}
function addEvent(listing_id, kind, by_bird, note) {
  db.prepare('INSERT INTO events (listing_id,kind,by_bird,note,created) VALUES (?,?,?,?,?)')
    .run(listing_id, kind, by_bird || 'gurt', note || '', now());
}

module.exports = function handler(req, res, route) {
  route = Array.isArray(route) ? route.join('/') : String(route || '');

  if (req.method === 'GET' && route === 'stats') {
    const listings = db.prepare('SELECT COUNT(*) AS n FROM listings').get().n;
    const open = db.prepare("SELECT COUNT(*) AS n FROM listings WHERE status='open'").get().n;
    const traded = db.prepare("SELECT COUNT(*) AS n FROM listings WHERE status='traded'").get().n;
    const birds = db.prepare('SELECT COUNT(DISTINCT bird) AS n FROM listings').get().n;
    const requests = db.prepare("SELECT COUNT(*) AS n FROM requests WHERE status='pending'").get().n;
    const kinds = db.prepare('SELECT kind, COUNT(*) AS n FROM listings GROUP BY kind ORDER BY n DESC').all();
    return json(res, 200, { listings, open, traded, birds, requests, kinds });
  }

  if (req.method === 'GET' && (route === '' || route === 'listings')) {
    const rows = db.prepare('SELECT * FROM listings ORDER BY created DESC').all();
    return json(res, 200, { count: rows.length, listings: rows.map(listingRow) });
  }

  if (req.method === 'GET' && route.split('/')[0] === 'listing' && route.split('/')[1]) {
    const r = db.prepare('SELECT * FROM listings WHERE id=?').get(route.split('/')[1].toUpperCase());
    if (!r) return json(res, 404, { error: 'no such listing' });
    return json(res, 200, { listing: listingRow(r) });
  }

  if (req.method === 'POST' && route === 'listing') {
    return readBody(req).then(b => {
      const bird = String(b.bird || '').trim().slice(0, 40);
      const title = String(b.title || '').trim().slice(0, 100);
      if (!bird || !title) return json(res, 400, { error: 'a listing needs a bird and a title' });
      const id = 'FS-' + Math.random().toString(36).slice(2, 8).toUpperCase();
      db.prepare(`INSERT INTO listings (id,bird,title,kind,description,wants,place,status,created)
                  VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, bird, title, String(b.kind || 'thing').slice(0, 30),
             String(b.description || '').slice(0, 600), String(b.wants || '').slice(0, 200),
             String(b.place || 'the perch').slice(0, 60), 'open', now());
      addEvent(id, 'offered', bird, 'offered "' + title + '"');
      return json(res, 200, { ok: true, listing: listingRow(db.prepare('SELECT * FROM listings WHERE id=?').get(id)) });
    });
  }

  if (req.method === 'POST' && route === 'request') {
    return readBody(req).then(b => {
      const listing_id = String(b.listing_id || '').trim().toUpperCase();
      const bird = String(b.bird || '').trim().slice(0, 40);
      const offer = String(b.offer || '').trim().slice(0, 120);
      const note = String(b.note || '').trim().slice(0, 300);
      const l = db.prepare('SELECT * FROM listings WHERE id=?').get(listing_id);
      if (!l) return json(res, 404, { error: 'no such listing' });
      if (!bird) return json(res, 400, { error: 'a request needs a bird' });
      if (l.status !== 'open') return json(res, 400, { error: 'that listing is already spoken for' });
      const id = rid();
      db.prepare('INSERT INTO requests (id,listing_id,bird,offer,note,status,created) VALUES (?,?,?,?,?,?,?)')
        .run(id, listing_id, bird, offer, note, 'pending', now());
      addEvent(listing_id, 'requested', bird, 'offered ' + (offer || 'something'));
      return json(res, 200, { ok: true, request: { id, listing_id, bird, offer, note, status: 'pending', created: now() } });
    });
  }

  if (req.method === 'POST' && route === 'accept') {
    return readBody(req).then(b => {
      const request_id = String(b.request_id || '').trim();
      const bird = String(b.bird || '').trim().slice(0, 40);
      const q = db.prepare('SELECT * FROM requests WHERE id=?').get(request_id);
      if (!q) return json(res, 404, { error: 'no such request' });
      const l = db.prepare('SELECT * FROM listings WHERE id=?').get(q.listing_id);
      if (!l) return json(res, 404, { error: 'no such listing' });
      db.prepare("UPDATE requests SET status='accepted' WHERE id=?").run(request_id);
      db.prepare("UPDATE requests SET status='declined' WHERE listing_id=? AND id<>? AND status='pending'")
        .run(q.listing_id, request_id);
      db.prepare("UPDATE listings SET status='traded' WHERE id=?").run(q.listing_id);
      addEvent(q.listing_id, 'traded', bird, 'traded to ' + q.bird + (q.offer ? ' for ' + q.offer : ''));
      return json(res, 200, { ok: true, listing: listingRow(db.prepare('SELECT * FROM listings WHERE id=?').get(q.listing_id)) });
    });
  }

  if (req.method === 'POST' && route === 'decline') {
    return readBody(req).then(b => {
      const request_id = String(b.request_id || '').trim();
      const bird = String(b.bird || '').trim().slice(0, 40);
      const q = db.prepare('SELECT * FROM requests WHERE id=?').get(request_id);
      if (!q) return json(res, 404, { error: 'no such request' });
      db.prepare("UPDATE requests SET status='declined' WHERE id=?").run(request_id);
      addEvent(q.listing_id, 'declined', bird, 'declined the offer from ' + q.bird);
      return json(res, 200, { ok: true, request_id, status: 'declined' });
    });
  }

  if (req.method === 'POST' && route === 'withdraw') {
    return readBody(req).then(b => {
      const listing_id = String(b.listing_id || '').trim().toUpperCase();
      const bird = String(b.bird || '').trim().slice(0, 40);
      const l = db.prepare('SELECT * FROM listings WHERE id=?').get(listing_id);
      if (!l) return json(res, 404, { error: 'no such listing' });
      addEvent(listing_id, 'withdrawn', bird, 'took it back off the board');
      db.prepare('DELETE FROM listings WHERE id=?').run(listing_id);
      return json(res, 200, { ok: true, withdrawn: listing_id });
    });
  }

  return json(res, 404, { error: 'not found' });
};

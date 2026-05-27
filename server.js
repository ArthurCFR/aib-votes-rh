const express = require('express');
const session = require('express-session');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, '.storage');
const DB_PATH = path.join(STORAGE_DIR, 'votes.db');

fs.mkdirSync(STORAGE_DIR, { recursive: true });

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'aib-rh-votes-2026',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

const FEATURES = [
  {
    id: 1,
    emoji: '🔍',
    name: 'AutoSource',
    description: "Scanne automatiquement LinkedIn et les CVs pour identifier les candidats idéaux en fonction des offres actives."
  },
  {
    id: 2,
    emoji: '🤝',
    name: 'OnboardBot',
    description: "Accompagne les nouveaux collaborateurs pendant leurs 90 premiers jours avec des check-ins personnalisés et des ressources adaptées."
  },
  {
    id: 3,
    emoji: '📡',
    name: 'RetentionRadar',
    description: "Détecte les signaux de désengagement et alerte les RH avant qu'un talent clé ne décide de partir."
  },
  {
    id: 4,
    emoji: '🧠',
    name: 'SkillPath',
    description: "Génère des parcours de formation personnalisés basés sur les lacunes détectées et les objectifs de carrière individuels."
  },
  {
    id: 5,
    emoji: '🕊️',
    name: 'TeamHarmony',
    description: "Analyse les dynamiques d'équipe et identifie les tensions émergentes avant qu'elles n'impactent la performance collective."
  }
];

const VOTE_OPTIONS = [
  { value: 'indispensable', label: 'Indispensable', emoji: '🎯' },
  { value: 'utile', label: 'Utile', emoji: '👍' },
  { value: 'pas_urgent', label: 'Pas urgent', emoji: '🕐' }
];

let db;

function saveDb() {
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

function getResults() {
  const results = {};
  FEATURES.forEach(f => {
    results[f.id] = { indispensable: 0, utile: 0, pas_urgent: 0, total: 0 };
    const rows = db.exec(
      `SELECT vote_value, COUNT(*) as count FROM votes WHERE feature_id = ${f.id} GROUP BY vote_value`
    );
    if (rows.length > 0) {
      rows[0].values.forEach(([vote_value, count]) => {
        if (Object.prototype.hasOwnProperty.call(results[f.id], vote_value)) {
          results[f.id][vote_value] = count;
          results[f.id].total += count;
        }
      });
    }
  });
  return results;
}

app.get('/api/state', (req, res) => {
  const results = getResults();
  const rows = db.exec('SELECT COUNT(DISTINCT session_id) as c FROM votes');
  const voterCount = rows.length > 0 ? rows[0].values[0][0] : 0;

  res.json({
    hasVoted: !!req.session.hasVoted,
    features: FEATURES,
    voteOptions: VOTE_OPTIONS,
    results,
    voterCount
  });
});

app.post('/api/vote', (req, res) => {
  if (req.session.hasVoted) {
    return res.status(400).json({ error: 'Vous avez déjà voté dans cette session.' });
  }

  const { votes } = req.body;

  if (!votes || typeof votes !== 'object') {
    return res.status(400).json({ error: 'Format de vote invalide.' });
  }

  const validValues = ['indispensable', 'utile', 'pas_urgent'];
  for (const f of FEATURES) {
    if (!votes[f.id] || !validValues.includes(votes[f.id])) {
      return res.status(400).json({ error: `Vote manquant pour la fonctionnalité ${f.id}.` });
    }
  }

  const sessionId = req.sessionID;
  const stmt = db.prepare('INSERT INTO votes (session_id, feature_id, vote_value) VALUES (?, ?, ?)');
  FEATURES.forEach(f => stmt.run([sessionId, f.id, votes[f.id]]));
  stmt.free();

  saveDb();
  req.session.hasVoted = true;

  const results = getResults();
  const rows = db.exec('SELECT COUNT(DISTINCT session_id) as c FROM votes');
  const voterCount = rows.length > 0 ? rows[0].values[0][0] : 0;

  res.json({ success: true, results, voterCount });
});

async function start() {
  const SQL = await initSqlJs();
  db = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();

  db.run(`CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    feature_id INTEGER NOT NULL,
    vote_value TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  saveDb();

  app.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}`));
}

start().catch(err => {
  console.error('Erreur démarrage:', err);
  process.exit(1);
});

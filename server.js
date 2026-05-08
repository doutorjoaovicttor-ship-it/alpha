const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const PORT = process.env.PORT || 3333;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const DATA = path.join(ROOT, "data");
const DB_PATH = path.join(DATA, "alpha.db");
const sessions = new Map();

fs.mkdirSync(DATA, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = ON");

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const candidate = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), candidate);
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS company_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      company_name TEXT NOT NULL,
      email TEXT,
      whatsapp TEXT,
      logo TEXT,
      address TEXT
    );
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pendente',
      payment_method TEXT,
      service_date TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      cleaning_type TEXT NOT NULL,
      address TEXT,
      employee TEXT,
      status TEXT NOT NULL DEFAULT 'agendado',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      service_id INTEGER,
      amount REAL NOT NULL DEFAULT 0,
      payment_method TEXT,
      payment_date TEXT,
      status TEXT NOT NULL DEFAULT 'pendente',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL
    );
  `);

  const userCount = db.prepare("SELECT COUNT(*) AS total FROM users").get().total;
  if (!userCount) {
    db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)").run(
      "admin@alpha.com",
      hashPassword("Alpha@2026")
    );
  }

  const settings = db.prepare("SELECT COUNT(*) AS total FROM company_settings").get().total;
  if (!settings) {
    db.prepare(`
      INSERT INTO company_settings (id, company_name, email, whatsapp, logo, address)
      VALUES (1, ?, ?, ?, ?, ?)
    `).run("Alpha Serviços de Limpeza", "suportegrupoalphadf@gmail.com", "(61) 92002-8417", "A", "Brasília - DF");
  }
}

migrate();

function send(res, status, body, headers = {}) {
  const isObject = typeof body === "object" && body !== null && !Buffer.isBuffer(body);
  const payload = isObject ? JSON.stringify(body) : body;
  res.writeHead(status, {
    "Content-Type": isObject ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    ...headers
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function cookie(req, name) {
  const header = req.headers.cookie || "";
  return header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.split("=")[1];
}

function currentUser(req) {
  const sid = cookie(req, "alpha_sid");
  return sid ? sessions.get(sid) : null;
}

function requireAuth(req, res) {
  const user = currentUser(req);
  if (!user) {
    send(res, 401, { error: "Não autenticado" });
    return null;
  }
  return user;
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const filePath = path.normalize(path.join(PUBLIC, urlPath === "/" ? "index.html" : urlPath));
  if (!filePath.startsWith(PUBLIC)) return send(res, 403, "Acesso negado");
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return send(res, 404, "Arquivo não encontrado");
  const ext = path.extname(filePath);
  const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".svg": "image/svg+xml" };
  res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function list(table, order = "id DESC") {
  return db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all();
}

function monthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

async function api(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = url.pathname;
  const method = req.method;

  if (route === "/api/login" && method === "POST") {
    const body = await readBody(req);
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(body.email || "");
    if (!user || !verifyPassword(body.password || "", user.password_hash)) {
      return send(res, 401, { error: "Email ou senha inválidos" });
    }
    const sid = crypto.randomBytes(24).toString("hex");
    sessions.set(sid, { id: user.id, email: user.email });
    return send(res, 200, { ok: true }, { "Set-Cookie": `alpha_sid=${sid}; HttpOnly; SameSite=Lax; Path=/` });
  }

  if (route === "/api/logout" && method === "POST") {
    const sid = cookie(req, "alpha_sid");
    if (sid) sessions.delete(sid);
    return send(res, 200, { ok: true }, { "Set-Cookie": "alpha_sid=; Max-Age=0; Path=/" });
  }

  if (route === "/api/session") {
    return send(res, 200, { user: currentUser(req) });
  }

  if (!requireAuth(req, res)) return;

  if (route === "/api/dashboard") {
    const totalClients = db.prepare("SELECT COUNT(*) AS total FROM clients").get().total;
    const receivedMonth = db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE status='pago' AND payment_date >= ?").get(monthStart()).total;
    const scheduled = db.prepare("SELECT COUNT(*) AS total FROM services WHERE status='agendado'").get().total;
    const completed = db.prepare("SELECT COUNT(*) AS total FROM services WHERE status='concluído'").get().total;
    const pending = db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE status IN ('pendente','atrasado')").get().total;
    const chart = db.prepare("SELECT status, COUNT(*) AS total FROM services GROUP BY status").all();
    const totalServices = db.prepare("SELECT COUNT(*) AS total FROM services").get().total;
    const completionRate = totalServices ? Math.round((completed / totalServices) * 100) : 0;
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    const todayAppointments = db.prepare(`
      SELECT appointments.*, clients.name AS client_name
      FROM appointments JOIN clients ON clients.id=appointments.client_id
      WHERE date = ?
      ORDER BY time LIMIT 6
    `).all(today);
    const overdueServices = db.prepare(`
      SELECT services.*, clients.name AS client_name
      FROM services JOIN clients ON clients.id=services.client_id
      WHERE service_date < ? AND status NOT IN ('concluído','cancelado')
      ORDER BY service_date ASC LIMIT 6
    `).all(today);
    const latestPayments = db.prepare(`
      SELECT payments.*, clients.name AS client_name, services.type AS service_type
      FROM payments JOIN clients ON clients.id=payments.client_id
      LEFT JOIN services ON services.id=payments.service_id
      ORDER BY payment_date DESC, payments.id DESC LIMIT 6
    `).all();
    const activeEmployees = db.prepare(`
      SELECT employee, COUNT(*) AS total
      FROM appointments
      WHERE COALESCE(employee,'') <> '' AND status NOT IN ('cancelado')
      GROUP BY employee ORDER BY total DESC LIMIT 5
    `).all();
    const revenueChart = db.prepare(`
      SELECT substr(payment_date, 1, 7) AS label, COALESCE(SUM(amount),0) AS total
      FROM payments
      WHERE status='pago' AND COALESCE(payment_date,'') <> ''
      GROUP BY label ORDER BY label DESC LIMIT 6
    `).all().reverse();
    const weeklyChart = db.prepare(`
      SELECT service_date AS label, COUNT(*) AS total
      FROM services
      WHERE COALESCE(service_date,'') >= ?
      GROUP BY service_date ORDER BY service_date
    `).all(weekAgo);
    const recentActivities = [
      ...db.prepare("SELECT 'Cliente cadastrado' AS title, name AS detail, created_at FROM clients ORDER BY created_at DESC LIMIT 4").all(),
      ...db.prepare("SELECT 'Serviço registrado' AS title, type AS detail, created_at FROM services ORDER BY created_at DESC LIMIT 4").all(),
      ...db.prepare("SELECT 'Pagamento lançado' AS title, status AS detail, created_at FROM payments ORDER BY created_at DESC LIMIT 4").all()
    ].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 8);
    return send(res, 200, {
      totalClients,
      receivedMonth,
      scheduled,
      completed,
      pending,
      chart,
      totalServices,
      completionRate,
      todayAppointments,
      overdueServices,
      latestPayments,
      activeEmployees,
      revenueChart,
      weeklyChart,
      recentActivities,
      notifications: {
        overdue: overdueServices.length,
        pendingPayments: db.prepare("SELECT COUNT(*) AS total FROM payments WHERE status IN ('pendente','atrasado')").get().total,
        todayAppointments: todayAppointments.length
      }
    });
  }

  if (route === "/api/settings") {
    if (method === "GET") return send(res, 200, db.prepare("SELECT * FROM company_settings WHERE id=1").get());
    const b = await readBody(req);
    db.prepare("UPDATE company_settings SET company_name=?, email=?, whatsapp=?, logo=?, address=? WHERE id=1")
      .run(b.company_name, b.email, b.whatsapp, b.logo, b.address);
    return send(res, 200, { ok: true });
  }

  const idMatch = route.match(/^\/api\/(clients|services|appointments|payments)(?:\/(\d+))?$/);
  if (!idMatch) return send(res, 404, { error: "Rota não encontrada" });
  const [, resource, id] = idMatch;

  if (method === "GET") {
    if (resource === "clients") {
      const q = `%${url.searchParams.get("q") || ""}%`;
      return send(res, 200, db.prepare("SELECT * FROM clients WHERE name LIKE ? OR phone LIKE ? OR email LIKE ? ORDER BY name").all(q, q, q));
    }
    if (resource === "services") return send(res, 200, db.prepare("SELECT services.*, clients.name AS client_name FROM services JOIN clients ON clients.id=services.client_id ORDER BY service_date DESC, id DESC").all());
    if (resource === "appointments") return send(res, 200, db.prepare("SELECT appointments.*, clients.name AS client_name FROM appointments JOIN clients ON clients.id=appointments.client_id ORDER BY date, time").all());
    if (resource === "payments") return send(res, 200, db.prepare("SELECT payments.*, clients.name AS client_name, services.type AS service_type FROM payments JOIN clients ON clients.id=payments.client_id LEFT JOIN services ON services.id=payments.service_id ORDER BY payment_date DESC, id DESC").all());
  }

  const b = await readBody(req);
  if (resource === "clients") {
    if (method === "POST") db.prepare("INSERT INTO clients (name, phone, email, address, notes) VALUES (?, ?, ?, ?, ?)").run(b.name, b.phone, b.email, b.address, b.notes);
    if (method === "PUT") db.prepare("UPDATE clients SET name=?, phone=?, email=?, address=?, notes=? WHERE id=?").run(b.name, b.phone, b.email, b.address, b.notes, id);
  }
  if (resource === "services") {
    if (method === "POST") db.prepare("INSERT INTO services (client_id, type, amount, status, payment_method, service_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?)").run(b.client_id, b.type, b.amount, b.status, b.payment_method, b.service_date, b.notes);
    if (method === "PUT") db.prepare("UPDATE services SET client_id=?, type=?, amount=?, status=?, payment_method=?, service_date=?, notes=? WHERE id=?").run(b.client_id, b.type, b.amount, b.status, b.payment_method, b.service_date, b.notes, id);
  }
  if (resource === "appointments") {
    if (method === "POST") db.prepare("INSERT INTO appointments (client_id, date, time, cleaning_type, address, employee, status) VALUES (?, ?, ?, ?, ?, ?, ?)").run(b.client_id, b.date, b.time, b.cleaning_type, b.address, b.employee, b.status);
    if (method === "PUT") db.prepare("UPDATE appointments SET client_id=?, date=?, time=?, cleaning_type=?, address=?, employee=?, status=? WHERE id=?").run(b.client_id, b.date, b.time, b.cleaning_type, b.address, b.employee, b.status, id);
  }
  if (resource === "payments") {
    if (method === "POST") db.prepare("INSERT INTO payments (client_id, service_id, amount, payment_method, payment_date, status) VALUES (?, ?, ?, ?, ?, ?)").run(b.client_id, b.service_id || null, b.amount, b.payment_method, b.payment_date, b.status);
    if (method === "PUT") db.prepare("UPDATE payments SET client_id=?, service_id=?, amount=?, payment_method=?, payment_date=?, status=? WHERE id=?").run(b.client_id, b.service_id || null, b.amount, b.payment_method, b.payment_date, b.status, id);
  }
  if (method === "DELETE") db.prepare(`DELETE FROM ${resource} WHERE id=?`).run(id);
  send(res, 200, { ok: true });
}

http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    api(req, res).catch((error) => send(res, 500, { error: error.message }));
  } else {
    serveStatic(req, res);
  }
}).listen(PORT, () => {
  console.log(`Alpha Sistema rodando em http://localhost:${PORT}`);
  console.log("Login inicial: admin@alpha.com / Alpha@2026");
});

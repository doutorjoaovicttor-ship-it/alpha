const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

let getStore;
try {
  ({ getStore } = require("@netlify/blobs"));
} catch {
  getStore = null;
}

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@alpha.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Alpha@2026";
const SESSION_SECRET = process.env.SESSION_SECRET || "alpha-local-secret-change-in-netlify";
const FALLBACK_FILE = path.join(process.cwd(), "data", "netlify-state.json");
const isServerlessRuntime = () => Boolean(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);

const defaultState = () => ({
  settings: {
    id: 1,
    company_name: "Alpha Serviços de Limpeza",
    email: "suportegrupoalphadf@gmail.com",
    whatsapp: "(61) 92002-8417",
    logo: "A",
    address: "Brasília - DF"
  },
  clients: [],
  services: [],
  appointments: [],
  payments: []
});

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    },
    body: JSON.stringify(body)
  };
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header.split(";").map((item) => item.trim()).filter(Boolean).map((item) => {
      const index = item.indexOf("=");
      return [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
    })
  );
}

function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verify(token) {
  if (!token || !token.includes(".")) return null;
  const [data, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  if (payload.exp < Date.now()) return null;
  return payload;
}

async function loadState() {
  if (getStore && isServerlessRuntime()) {
    const store = getStore({ name: "alpha-sistema", consistency: "strong" });
    const saved = await store.get("state", { type: "json" });
    return saved || defaultState();
  }
  fs.mkdirSync(path.dirname(FALLBACK_FILE), { recursive: true });
  if (!fs.existsSync(FALLBACK_FILE)) fs.writeFileSync(FALLBACK_FILE, JSON.stringify(defaultState(), null, 2));
  return JSON.parse(fs.readFileSync(FALLBACK_FILE, "utf8"));
}

async function saveState(state) {
  if (getStore && isServerlessRuntime()) {
    const store = getStore({ name: "alpha-sistema", consistency: "strong" });
    await store.setJSON("state", state);
    return;
  }
  fs.mkdirSync(path.dirname(FALLBACK_FILE), { recursive: true });
  fs.writeFileSync(FALLBACK_FILE, JSON.stringify(state, null, 2));
}

function routePath(event) {
  const raw = event.path || "/";
  if (raw.startsWith("/api")) return raw;
  return `/api/${raw.replace(/^\/\.netlify\/functions\/api\/?/, "")}`.replace(/\/$/, "");
}

function nextId(rows) {
  return rows.reduce((max, row) => Math.max(max, Number(row.id || 0)), 0) + 1;
}

function now() {
  return new Date().toISOString();
}

function monthStart() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

function joinServices(state) {
  return state.services.map((service) => ({
    ...service,
    client_name: state.clients.find((client) => Number(client.id) === Number(service.client_id))?.name || "Cliente removido"
  })).sort((a, b) => String(b.service_date || "").localeCompare(String(a.service_date || "")) || b.id - a.id);
}

function joinAppointments(state) {
  return state.appointments.map((appointment) => ({
    ...appointment,
    client_name: state.clients.find((client) => Number(client.id) === Number(appointment.client_id))?.name || "Cliente removido"
  })).sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.time || "").localeCompare(String(b.time || "")));
}

function joinPayments(state) {
  return state.payments.map((payment) => {
    const service = state.services.find((item) => Number(item.id) === Number(payment.service_id));
    return {
      ...payment,
      client_name: state.clients.find((client) => Number(client.id) === Number(payment.client_id))?.name || "Cliente removido",
      service_type: service?.type || null
    };
  }).sort((a, b) => String(b.payment_date || "").localeCompare(String(a.payment_date || "")) || b.id - a.id);
}

function dashboard(state) {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const services = joinServices(state);
  const appointments = joinAppointments(state);
  const payments = joinPayments(state);
  const completed = state.services.filter((service) => service.status === "concluído").length;
  const totalServices = state.services.length;
  const receivedMonth = state.payments
    .filter((payment) => payment.status === "pago" && String(payment.payment_date || "") >= monthStart())
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const pending = state.payments
    .filter((payment) => ["pendente", "atrasado"].includes(payment.status))
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const statusCount = {};
  state.services.forEach((service) => statusCount[service.status] = (statusCount[service.status] || 0) + 1);
  const byMonth = {};
  state.payments.filter((payment) => payment.status === "pago" && payment.payment_date).forEach((payment) => {
    const label = String(payment.payment_date).slice(0, 7);
    byMonth[label] = (byMonth[label] || 0) + Number(payment.amount || 0);
  });
  const byWeek = {};
  state.services.filter((service) => String(service.service_date || "") >= weekAgo).forEach((service) => {
    byWeek[service.service_date] = (byWeek[service.service_date] || 0) + 1;
  });
  const employees = {};
  state.appointments.filter((item) => item.employee && item.status !== "cancelado").forEach((item) => {
    employees[item.employee] = (employees[item.employee] || 0) + 1;
  });
  const recentActivities = [
    ...state.clients.map((item) => ({ title: "Cliente cadastrado", detail: item.name, created_at: item.created_at })),
    ...state.services.map((item) => ({ title: "Serviço registrado", detail: item.type, created_at: item.created_at })),
    ...state.payments.map((item) => ({ title: "Pagamento lançado", detail: item.status, created_at: item.created_at }))
  ].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))).slice(0, 8);
  const overdueServices = services.filter((service) => service.service_date < today && !["concluído", "cancelado"].includes(service.status)).slice(0, 6);
  const todayAppointments = appointments.filter((appointment) => appointment.date === today).slice(0, 6);
  return {
    totalClients: state.clients.length,
    receivedMonth,
    scheduled: state.services.filter((service) => service.status === "agendado").length,
    completed,
    pending,
    chart: Object.entries(statusCount).map(([status, total]) => ({ status, total })),
    totalServices,
    completionRate: totalServices ? Math.round((completed / totalServices) * 100) : 0,
    todayAppointments,
    overdueServices,
    latestPayments: payments.slice(0, 6),
    activeEmployees: Object.entries(employees).map(([employee, total]) => ({ employee, total })).sort((a, b) => b.total - a.total).slice(0, 5),
    revenueChart: Object.entries(byMonth).map(([label, total]) => ({ label, total })).sort((a, b) => a.label.localeCompare(b.label)).slice(-6),
    weeklyChart: Object.entries(byWeek).map(([label, total]) => ({ label, total })).sort((a, b) => a.label.localeCompare(b.label)),
    recentActivities,
    notifications: {
      overdue: overdueServices.length,
      pendingPayments: state.payments.filter((payment) => ["pendente", "atrasado"].includes(payment.status)).length,
      todayAppointments: todayAppointments.length
    }
  };
}

exports.handler = async (event) => {
  try {
    const method = event.httpMethod;
    const pathName = routePath(event);
    const body = event.body ? JSON.parse(event.body) : {};
    const cookies = parseCookies(event.headers.cookie || event.headers.Cookie || "");
    const user = verify(cookies.alpha_token);

    if (pathName === "/api/login" && method === "POST") {
      if (body.email !== ADMIN_EMAIL || body.password !== ADMIN_PASSWORD) {
        return json(401, { error: "Email ou senha inválidos" });
      }
      const token = sign({ email: body.email, exp: Date.now() + 1000 * 60 * 60 * 12 });
      const secure = isServerlessRuntime() ? " Secure;" : "";
      return json(200, { ok: true }, { "Set-Cookie": `alpha_token=${encodeURIComponent(token)}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=43200` });
    }

    if (pathName === "/api/logout" && method === "POST") {
      const secure = isServerlessRuntime() ? " Secure;" : "";
      return json(200, { ok: true }, { "Set-Cookie": `alpha_token=; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=0` });
    }

    if (pathName === "/api/session") {
      return json(200, { user: user ? { email: user.email } : null });
    }

    if (!user) return json(401, { error: "Não autenticado" });

    const state = await loadState();
    if (pathName === "/api/dashboard") return json(200, dashboard(state));
    if (pathName === "/api/settings") {
      if (method === "GET") return json(200, state.settings);
      state.settings = { id: 1, ...body };
      await saveState(state);
      return json(200, { ok: true });
    }

    const match = pathName.match(/^\/api\/(clients|services|appointments|payments)(?:\/(\d+))?$/);
    if (!match) return json(404, { error: "Rota não encontrada" });
    const [, resource, id] = match;
    const rows = state[resource];

    if (method === "GET") {
      if (resource === "clients") {
        const query = String(event.queryStringParameters?.q || "").toLowerCase();
        return json(200, rows.filter((client) => [client.name, client.phone, client.email].some((field) => String(field || "").toLowerCase().includes(query))).sort((a, b) => a.name.localeCompare(b.name)));
      }
      if (resource === "services") return json(200, joinServices(state));
      if (resource === "appointments") return json(200, joinAppointments(state));
      if (resource === "payments") return json(200, joinPayments(state));
    }

    if (method === "DELETE") {
      state[resource] = rows.filter((row) => Number(row.id) !== Number(id));
      if (resource === "clients") {
        state.services = state.services.filter((row) => Number(row.client_id) !== Number(id));
        state.appointments = state.appointments.filter((row) => Number(row.client_id) !== Number(id));
        state.payments = state.payments.filter((row) => Number(row.client_id) !== Number(id));
      }
      await saveState(state);
      return json(200, { ok: true });
    }

    if (method === "POST") {
      rows.push({ id: nextId(rows), ...body, created_at: now() });
      await saveState(state);
      return json(200, { ok: true });
    }

    if (method === "PUT") {
      const index = rows.findIndex((row) => Number(row.id) === Number(id));
      if (index === -1) return json(404, { error: "Registro não encontrado" });
      rows[index] = { ...rows[index], ...body, id: Number(id) };
      await saveState(state);
      return json(200, { ok: true });
    }

    return json(405, { error: "Método não permitido" });
  } catch (error) {
    return json(500, { error: error.message });
  }
};

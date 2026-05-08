const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  clients: [],
  services: [],
  appointments: [],
  payments: [],
  settings: {}
};

const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const api = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || `Erro na requisição (${response.status})`);
  return data;
};

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function fillForm(form, data) {
  Object.entries(data).forEach(([key, value]) => {
    if (form.elements[key]) form.elements[key].value = value ?? "";
  });
}

function resetForm(id) {
  const form = $(`#${id}`);
  form.reset();
  if (form.elements.id) form.elements.id.value = "";
}

function showForm(id) {
  $(`#${id}`).classList.remove("hidden");
}

function hideForm(id) {
  resetForm(id);
  $(`#${id}`).classList.add("hidden");
}

async function loadAll() {
  const [settings, dashboard, clients, services, appointments, payments] = await Promise.all([
    api("/api/settings"),
    api("/api/dashboard"),
    api("/api/clients"),
    api("/api/services"),
    api("/api/appointments"),
    api("/api/payments")
  ]);
  Object.assign(state, { settings, clients, services, appointments, payments });
  renderSettings();
  renderDashboard(dashboard);
  renderClientOptions();
  renderClients(clients);
  renderServices();
  renderAppointments();
  renderPayments();
}

function renderSettings() {
  $("#brandName").textContent = state.settings.company_name || "Alpha Serviços";
  $("#brandLogo").textContent = (state.settings.logo || "A").slice(0, 2);
  $("#companyWhatsapp").textContent = state.settings.whatsapp || "";
  fillForm($("#settingsForm"), state.settings);
}

function renderDashboard(d) {
  $("#mClients").textContent = d.totalClients;
  $("#mReceived").textContent = money(d.receivedMonth);
  $("#mScheduled").textContent = d.scheduled;
  $("#mCompletion").textContent = `${d.completionRate || 0}%`;
  $("#mDone").textContent = `${d.completed} concluídos`;
  $("#mPending").textContent = `Pendente: ${money(d.pending)}`;
  const max = Math.max(Number(d.receivedMonth), Number(d.pending), 1);
  $("#barReceived").style.width = `${Math.max(8, (d.receivedMonth / max) * 100)}%`;
  $("#barPending").style.width = `${Math.max(8, (d.pending / max) * 100)}%`;
  $("#completionRing").style.setProperty("--progress", `${d.completionRate || 0}%`);
  $("#completionRing strong").textContent = `${d.completionRate || 0}%`;

  const chart = $("#statusChart");
  chart.innerHTML = "";
  const statuses = ["pendente", "agendado", "concluído", "cancelado"];
  const rows = Object.fromEntries(d.chart.map((item) => [item.status, item.total]));
  const high = Math.max(...statuses.map((s) => rows[s] || 0), 1);
  statuses.forEach((status) => {
    chart.insertAdjacentHTML("beforeend", `<div><i style="height:${Math.max(12, ((rows[status] || 0) / high) * 100)}%"></i><span>${status}</span></div>`);
  });

  renderMiniBars("#revenueChart", d.revenueChart || [], "total", (item) => `${item.label}<br>${money(item.total)}`);
  renderMiniBars("#weeklyChart", d.weeklyChart || [], "total", (item) => `${formatDate(item.label)}<br>${item.total} serv.`);
  $("#notifications").innerHTML = `
    <div><strong>${d.notifications?.todayAppointments || 0}</strong><span>serviços hoje</span></div>
    <div><strong>${d.notifications?.pendingPayments || 0}</strong><span>pagamentos pendentes</span></div>
    <div><strong>${d.notifications?.overdue || 0}</strong><span>serviços atrasados</span></div>
  `;
  renderDashList("#todayAppointments", d.todayAppointments, (a) => `
    <div class="dash-item"><b>${a.time || "--:--"}</b><span>${a.client_name}</span><em>${a.cleaning_type} - ${a.employee || "sem responsável"}</em></div>
  `, "Nenhum serviço para hoje.");
  renderDashList("#overdueServices", d.overdueServices, (s) => `
    <div class="dash-item danger"><b>${formatDate(s.service_date)}</b><span>${s.client_name}</span><em>${s.type} - ${money(s.amount)}</em></div>
  `, "Nenhum serviço atrasado.");
  renderDashList("#latestPayments", d.latestPayments, (p) => `
    <div class="dash-item"><b>${money(p.amount)}</b><span>${p.client_name}</span><em>${p.status} - ${p.payment_method || "sem forma"}</em></div>
  `, "Nenhum pagamento lançado.");
  renderDashList("#recentActivities", d.recentActivities, (a) => `
    <div class="dash-item"><b>${a.title}</b><span>${a.detail || ""}</span><em>${formatDateTime(a.created_at)}</em></div>
  `, "Sem atividades recentes.");
  renderDashList("#activeEmployees", d.activeEmployees, (e) => `
    <div class="dash-item"><b>${e.employee}</b><span>${e.total} agendamento(s)</span><em>ativo na operação</em></div>
  `, "Nenhum funcionário vinculado.");
}

function renderMiniBars(selector, rows, field, label) {
  const element = $(selector);
  const max = Math.max(...rows.map((row) => Number(row[field] || 0)), 1);
  element.innerHTML = rows.length ? rows.map((row) => `
    <div><i style="height:${Math.max(10, (Number(row[field] || 0) / max) * 100)}%"></i><span>${label(row)}</span></div>
  `).join("") : `<p class="empty">Sem dados ainda.</p>`;
}

function renderDashList(selector, rows = [], template, empty) {
  $(selector).innerHTML = rows.length ? rows.map(template).join("") : `<p class="empty">${empty}</p>`;
}

function formatDate(value) {
  if (!value) return "--";
  const [year, month, day] = String(value).slice(0, 10).split("-");
  return day && month ? `${day}/${month}` : value;
}

function formatDateTime(value) {
  if (!value) return "--";
  return String(value).replace("T", " ").slice(0, 16);
}

function renderClientOptions() {
  $$("select[name='client_id']").forEach((select) => {
    const selected = select.value;
    select.innerHTML = `<option value="">Selecione</option>` + state.clients.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
    select.value = selected;
  });
  const serviceSelect = $("#paymentForm select[name='service_id']");
  serviceSelect.innerHTML = `<option value="">Sem vínculo</option>` + state.services.map((s) => `<option value="${s.id}">${s.client_name} - ${s.type} (${money(s.amount)})</option>`).join("");
}

function renderClients(rows = state.clients) {
  $("#clientsTable").innerHTML = rows.map((c) => `
    <tr>
      <td>${c.name}</td><td>${c.phone || ""}</td><td>${c.email || ""}</td><td>${c.address || ""}</td>
      <td class="actions"><button onclick='editClient(${JSON.stringify(c)})'>Editar</button><button onclick="removeItem('clients', ${c.id})">Excluir</button></td>
    </tr>
  `).join("");
}

function renderServices() {
  $("#servicesTable").innerHTML = state.services.map((s) => `
    <tr>
      <td>${s.client_name}</td><td>${s.type}</td><td>${money(s.amount)}</td><td><span class="badge ${s.status}">${s.status}</span></td><td>${s.service_date || ""}</td>
      <td class="actions"><button onclick='editService(${JSON.stringify(s)})'>Editar</button><button onclick="removeItem('services', ${s.id})">Excluir</button></td>
    </tr>
  `).join("");
}

function renderAppointments() {
  $("#appointmentsList").innerHTML = state.appointments.map((a) => `
    <article>
      <strong>${a.date || ""}<br>${a.time || ""}</strong>
      <div><b>${a.client_name}</b><br><span>${a.cleaning_type} - ${a.address || "Endereço não informado"}</span><br><em>${a.employee || "Funcionário a definir"}</em></div>
      <div class="actions"><span class="badge ${a.status}">${a.status}</span><button onclick='editAppointment(${JSON.stringify(a)})'>Editar</button><button onclick="removeItem('appointments', ${a.id})">Excluir</button></div>
    </article>
  `).join("");
}

function renderPayments() {
  const received = state.payments.filter((p) => p.status === "pago").reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const pending = state.payments.filter((p) => p.status !== "pago").reduce((sum, p) => sum + Number(p.amount || 0), 0);
  $("#fReceived").textContent = money(received);
  $("#fPending").textContent = money(pending);
  $("#paymentsTable").innerHTML = state.payments.map((p) => `
    <tr>
      <td>${p.client_name}</td><td>${p.service_type || "Manual"}</td><td>${money(p.amount)}</td><td>${p.payment_method || ""}</td><td>${p.payment_date || ""}</td><td><span class="badge ${p.status}">${p.status}</span></td>
      <td class="actions"><button onclick='editPayment(${JSON.stringify(p)})'>Editar</button><button onclick="removeItem('payments', ${p.id})">Excluir</button></td>
    </tr>
  `).join("");
}

window.editClient = (data) => { fillForm($("#clientForm"), data); showForm("clientForm"); };
window.editService = (data) => { fillForm($("#serviceForm"), data); showForm("serviceForm"); };
window.editAppointment = (data) => { fillForm($("#appointmentForm"), data); showForm("appointmentForm"); };
window.editPayment = (data) => { fillForm($("#paymentForm"), data); showForm("paymentForm"); };
window.removeItem = async (resource, id) => {
  if (!confirm("Excluir este registro?")) return;
  await api(`/api/${resource}/${id}`, { method: "DELETE" });
  await loadAll();
};

async function saveResource(resource, form, formId) {
  const data = formData(form);
  const id = data.id;
  delete data.id;
  try {
    await api(`/api/${resource}${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", body: JSON.stringify(data) });
    hideForm(formId);
    await loadAll();
  } catch (error) {
    alert(`Não foi possível salvar: ${error.message}`);
  }
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify(formData(event.currentTarget)) });
    $("#loginScreen").classList.add("hidden");
    $("#app").classList.remove("hidden");
    await loadAll();
  } catch (error) {
    $("#loginMessage").textContent = error.message;
  }
});

$("#logoutBtn").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  location.reload();
});

$("#refreshBtn").addEventListener("click", loadAll);

$$(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    $$(".nav-item").forEach((item) => item.classList.remove("active"));
    $$(".page").forEach((page) => page.classList.remove("active"));
    button.classList.add("active");
    $(`#page-${button.dataset.page}`).classList.add("active");
    $("#pageTitle").textContent = button.textContent;
  });
});

$$("[data-page-jump]").forEach((button) => {
  button.addEventListener("click", () => {
    const nav = $(`.nav-item[data-page="${button.dataset.pageJump}"]`);
    if (nav) nav.click();
  });
});

$$("[data-open]").forEach((button) => button.addEventListener("click", () => showForm(button.dataset.open)));
$$("[data-close]").forEach((button) => button.addEventListener("click", () => hideForm(button.dataset.close)));

$("#clientSearch").addEventListener("input", async (event) => {
  renderClients(await api(`/api/clients?q=${encodeURIComponent(event.target.value)}`));
});

$("#clientForm").addEventListener("submit", (event) => { event.preventDefault(); saveResource("clients", event.currentTarget, "clientForm"); });
$("#serviceForm").addEventListener("submit", (event) => { event.preventDefault(); saveResource("services", event.currentTarget, "serviceForm"); });
$("#appointmentForm").addEventListener("submit", (event) => { event.preventDefault(); saveResource("appointments", event.currentTarget, "appointmentForm"); });
$("#paymentForm").addEventListener("submit", (event) => { event.preventDefault(); saveResource("payments", event.currentTarget, "paymentForm"); });
$("#settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await api("/api/settings", { method: "PUT", body: JSON.stringify(formData(event.currentTarget)) });
  await loadAll();
});

(async function boot() {
  const session = await api("/api/session");
  if (session.user) {
    $("#loginScreen").classList.add("hidden");
    $("#app").classList.remove("hidden");
    await loadAll();
  }
})();

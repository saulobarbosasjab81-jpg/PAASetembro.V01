const CONFIG = {
  planningUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRFO5I2IkYLgaisfniLVjlPFyTAaPVPCFji4zA3-AQ3NWhAfVhDFt08jk3Ayee4Zw/pub?gid=1491304880&single=true&output=csv',
  executionUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRFO5I2IkYLgaisfniLVjlPFyTAaPVPCFji4zA3-AQ3NWhAfVhDFt08jk3Ayee4Zw/pub?gid=30813009&single=true&output=csv',
  planningLocal: 'data/base-line.csv',
  executionLocal: 'data/executivo.csv',
  planningGid: '1491304880',
  executionGid: '30813009',
  services: ['Escavação drenagem para canaletas', 'Lastro de concreto drenagem para canaletas', 'Assentamento de canaletas', 'Arremates de juntas canaletas', 'Terraplenagem faixa de pista: faixa 20mx60m', 'Base solo vermelho (preparação para o TSD - Lado Dir do acostamento)', 'Camada do TSD no acostamento', 'Escavação para caixa separadora de água e óleo', 'Armação da estrutura da caixa separadora de água e óleo', 'Concretagem tampas das canaletas na lateral do pátio (75cmx45cm)', 'Infra do balizamento', 'Conferência geral no projeto de balizamento'],
  start: new Date(2026, 8, 14), end: new Date(2026, 9, 11)
};
const charts = {};
const state = { data: null, selectedService: 0 };
const $ = (id) => document.getElementById(id);
const number = (value) => { const normalized = String(value ?? '').replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.'); const parsed = Number(normalized); return Number.isFinite(parsed) ? parsed : 0; };
const formatNumber = (value) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value);
const shortDate = (date) => date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const normalize = (text) => String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function parseCsvFallback(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += character;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  return rows;
}
function parseCsv(text) { return window.Papa ? Papa.parse(text, { skipEmptyLines: false }).data : parseCsvFallback(text); }
function readMatrix(matrix) {
  const rows = matrix.filter(row => row.some(cell => String(cell ?? '').trim() !== ''));
  const dateRowIndex = rows.findIndex(row => row.some(cell => /^\d{1,2}[\/]\d{1,2}[\/]\d{2,4}$/.test(String(cell).trim())));
  const dateRow = dateRowIndex >= 0 ? rows[dateRowIndex] : [];
  const dateColumns = dateRow.map((value, index) => { const match = String(value).trim().match(/^(\d{1,2})[\/]([0-9]{1,2})[\/]([0-9]{2,4})$/); return match ? { index, date: new Date(Number(match[3].length === 2 ? `20${match[3]}` : match[3]), Number(match[2]) - 1, Number(match[1])) } : null; }).filter(Boolean).slice(0, 28);
  const serviceRows = CONFIG.services.map(service => { const targetName = normalize(service); const row = rows.find(candidate => { const candidateName = normalize(candidate[0]); return candidateName && (candidateName.includes(targetName) || targetName.includes(candidateName)); }); return { name: service, values: dateColumns.map(column => number(row?.[column.index])) }; });
  const rainRow = rows.find(row => normalize(row[0]).includes('chuva') || normalize(row[0]).includes('precipit'));
  return { dates: dateColumns.map(item => item.date), services: serviceRows, rain: dateColumns.map(column => number(rainRow?.[column.index])) };
}
function cumulative(values) { let total = 0; return values.map(value => (total += value)); }
function latestIndex(data) { const today = new Date(); const inside = data.dates.findIndex(date => date >= CONFIG.start && date <= today); if (inside >= 0) return inside; const available = data.services.reduce((max, service) => { const last = service.actual.reduce((index, value, indexValue) => value > 0 ? indexValue : index, -1); return Math.max(max, last); }, -1); return available >= 0 ? available : Math.min(data.dates.length - 1, 0); }
function serviceStats(service, data, index) { const planCumulative = cumulative(service.plan); const actualCumulative = cumulative(service.actual); const planTotal = planCumulative.at(-1) || 0; const actualTotal = actualCumulative.at(-1) || 0; const planAtDate = planTotal ? (planCumulative[index] || 0) / planTotal * 100 : 0; const actualAtDate = planTotal ? (actualCumulative[index] || 0) / planTotal * 100 : 0; const deviation = actualAtDate - planAtDate; let status = 'atrasado'; if (actualAtDate >= 99.5 && planAtDate >= 99.5) status = 'concluido'; else if (deviation > 0) status = 'adiantado'; else if (deviation >= -5) status = 'risco'; return { planCumulative, actualCumulative, planTotal, actualTotal, planAtDate, actualAtDate, deviation, status }; }
function buildData(planning, execution) { const plan = readMatrix(planning); const real = readMatrix(execution); return { dates: plan.dates.length ? plan.dates : real.dates, services: plan.services.map((service, index) => ({ name: service.name, plan: service.values, actual: real.services[index]?.values || Array(service.values.length).fill(0) })), rain: real.rain.length ? real.rain : plan.rain }; }
function setText(id, value) { $(id).textContent = value; }
function statusLabel(status) { return { concluido: 'Concluído', adiantado: 'Adiantado', risco: 'Risco', atrasado: 'Atrasado' }[status]; }
function updateKpis(data, index, stats) { const totalDays = data.dates.length || 28; const elapsed = Math.max(0, Math.min(totalDays, index + 1)); const counts = stats.reduce((acc, item) => { acc[item.status] += 1; return acc; }, { concluido: 0, adiantado: 0, risco: 0, atrasado: 0 }); setText('kpi-elapsed', `${Math.round(elapsed / totalDays * 100)}%`); setText('kpi-elapsed-detail', `${elapsed} de ${totalDays} dias monitorados`); setText('kpi-completed', counts.concluido); setText('kpi-ahead', counts.adiantado); setText('kpi-risk', counts.risco); setText('kpi-late', counts.atrasado); const rainTotal = data.rain.slice(0, index + 1).reduce((sum, value) => sum + value, 0); setText('kpi-rain', `${formatNumber(rainTotal)} mm`); setText('kpi-rain-detail', `${elapsed} dias monitorados`); setText('last-update', `${new Date().toLocaleDateString('pt-BR')} · Dia ${elapsed} de ${totalDays}`); }
function renderTable(data, stats) { $('service-table').innerHTML = data.services.map((service, index) => { const item = stats[index]; const unit = item.actualTotal > 999 ? 'un.' : ''; return `<tr><td>${service.name}</td><td><div class="dual-bars"><div class="bar-row"><span class="bar-label">Planejado</span><div class="bar-track"><div class="bar-fill plan" style="width:${Math.min(item.planAtDate, 100)}%"></div></div><span class="bar-value">${formatNumber(item.planAtDate)}%</span></div><div class="bar-row"><span class="bar-label">Executado</span><div class="bar-track"><div class="bar-fill actual" style="width:${Math.min(item.actualAtDate, 100)}%"></div></div><span class="bar-value">${formatNumber(item.actualAtDate)}%</span></div></div></td><td class="service-percent">${formatNumber(item.actualAtDate)}%</td><td class="accumulated">${formatNumber(item.actualTotal)} ${unit}</td><td><span class="badge ${item.status}">${statusLabel(item.status)}</span></td></tr>`; }).join(''); }
const chartDefaults = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: '#16232e', borderColor: '#314653', borderWidth: 1, padding: 10, titleFont: { family: 'IBM Plex Mono' }, bodyFont: { family: 'Manrope' } } }, scales: { x: { grid: { color: '#26364266' }, ticks: { color: '#83949e', font: { family: 'IBM Plex Mono', size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } }, y: { grid: { color: '#26364288' }, ticks: { color: '#83949e', font: { family: 'IBM Plex Mono', size: 9 } }, beginAtZero: true } } };
function makeChart(id, config) { if (charts[id]) charts[id].destroy(); charts[id] = new Chart($(id), config); }
function renderCharts(data, index, stats) { const labels = data.dates.map(shortDate); const planCurve = labels.map((_, day) => stats.reduce((sum, item) => sum + (item.planCumulative[day] / (item.planTotal || 1) * 100), 0) / stats.length); const actualCurve = labels.map((_, day) => stats.reduce((sum, item) => sum + (item.actualCumulative[day] / (item.planTotal || 1) * 100), 0) / stats.length); makeChart('s-curve-chart', { type: 'line', data: { labels, datasets: [{ label: 'Planejado', data: planCurve, borderColor: '#68a7ff', backgroundColor: '#68a7ff18', fill: true, tension: .35, pointRadius: 2 }, { label: 'Executado', data: actualCurve, borderColor: '#6ce0a6', backgroundColor: 'transparent', tension: .35, pointRadius: 2 }] }, options: { ...chartDefaults, plugins: { ...chartDefaults.plugins, legend: { display: true, labels: { color: '#83949e', usePointStyle: true, boxWidth: 7, font: { family: 'Manrope', size: 10 } } } }, scales: { ...chartDefaults.scales, y: { ...chartDefaults.scales.y, max: 100, ticks: { ...chartDefaults.scales.y.ticks, callback: value => `${value}%` } } } } }); const statusCounts = ['concluido', 'adiantado', 'risco', 'atrasado'].map(status => stats.filter(item => item.status === status).length); makeChart('status-chart', { type: 'doughnut', data: { labels: ['Concluído', 'Adiantado', 'Risco', 'Atrasado'], datasets: [{ data: statusCounts, backgroundColor: ['#6ce0a6', '#68a7ff', '#f2ca61', '#f07878'], borderColor: '#111b24', borderWidth: 4 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '70%', plugins: { legend: { display: false } } } }); $('status-summary').innerHTML = ['concluido', 'adiantado', 'risco', 'atrasado'].map((status, i) => `<span>${statusLabel(status)} <b>${statusCounts[i]}</b></span>`).join(''); const production = data.services.slice(0, 5); makeChart('production-chart', { type: 'bar', data: { labels, datasets: production.map((service, serviceIndex) => ({ label: service.name, data: service.actual, backgroundColor: ['#5bd6df', '#68a7ff', '#6ce0a6', '#f2ca61', '#f19b62'][serviceIndex], borderRadius: 2, barPercentage: .7, categoryPercentage: .75 })) }, options: { ...chartDefaults, plugins: { ...chartDefaults.plugins, legend: { display: true, labels: { color: '#83949e', usePointStyle: true, boxWidth: 7, font: { size: 9 } } } } } }); makeChart('rain-chart', { type: 'bar', data: { labels, datasets: [{ data: data.rain, backgroundColor: '#79b9e7aa', borderColor: '#79b9e7', borderWidth: 1, borderRadius: 2 }] }, options: { ...chartDefaults, scales: { ...chartDefaults.scales, y: { ...chartDefaults.scales.y, title: { display: true, text: 'mm', color: '#83949e', font: { family: 'IBM Plex Mono', size: 10 } } } } } }); }
function renderExecutive(data, stats) { $('executive-summary').innerHTML = data.services.map((service, index) => { const item = stats[index]; return `<div class="exec-item"><strong title="${service.name}">${service.name}</strong><div class="exec-data"><b>${formatNumber(item.actualTotal)}</b><span>/ ${formatNumber(item.planTotal)}</span><b class="${item.deviation >= 0 ? 'positive' : 'negative'}">${item.deviation >= 0 ? '+' : ''}${formatNumber(item.deviation)} pp</b></div></div>`; }).join(''); }
function renderSelected(data, index) { const service = data.services[state.selectedService]; const stats = serviceStats(service, data, index); setText('selected-total', formatNumber(stats.actualTotal)); setText('selected-meta', service.name); setText('selected-real', `${formatNumber(stats.actualAtDate)}%`); setText('selected-plan', `${formatNumber(stats.planAtDate)}%`); makeChart('selected-chart', { type: 'bar', data: { labels: data.dates.map(shortDate), datasets: [{ label: 'Executado', data: service.actual, backgroundColor: '#5bd6dfaa', borderColor: '#5bd6df', borderWidth: 1, borderRadius: 2 }] }, options: { ...chartDefaults, plugins: { ...chartDefaults.plugins, legend: { display: false } } } }); }
function populateSelect(data) { $('service-select').innerHTML = data.services.map((service, index) => `<option value="${index}">${service.name}</option>`).join(''); $('service-select').addEventListener('change', event => { state.selectedService = Number(event.target.value); renderSelected(data, latestIndex(data)); }); }
function render(data) { state.data = data; const index = latestIndex(data); const stats = data.services.map(service => serviceStats(service, data, index)); updateKpis(data, index, stats); renderTable(data, stats); renderCharts(data, index, stats); renderExecutive(data, stats); populateSelect(data); renderSelected(data, index); }
async function fetchCsv(url, gid, localUrl) {
  try {
    const localResponse = await fetch(localUrl, { cache: 'no-store' });
    if (localResponse.ok) return localResponse.text();
  } catch (localError) {
    console.info('Snapshot local indisponível; tentando planilha remota.', localError);
  }
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`CSV indisponível (${response.status})`);
    return response.text();
  } catch (directError) {
    const fallbackUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const fallbackResponse = await fetch(fallbackUrl, { cache: 'no-store' });
    if (!fallbackResponse.ok) throw directError;
    return fallbackResponse.text();
  }
}
async function loadDashboard() { try { showToast('Atualizando dados...'); const [planningCsv, executionCsv] = await Promise.all([fetchCsv(CONFIG.planningUrl, CONFIG.planningGid, CONFIG.planningLocal), fetchCsv(CONFIG.executionUrl, CONFIG.executionGid, CONFIG.executionLocal)]); render(buildData(parseCsv(planningCsv), parseCsv(executionCsv))); showToast('Dados atualizados com sucesso.'); } catch (error) { console.error(error); showToast('Falha ao carregar os CSVs. Verifique a publicação das planilhas.'); $('service-table').innerHTML = '<tr><td colspan="5" class="loading-cell">Não foi possível carregar os dados remotos. Confira a conexão e tente novamente.</td></tr>'; } }
function showToast(message) { const toast = $('toast'); toast.textContent = message; toast.classList.add('visible'); window.clearTimeout(showToast.timer); showToast.timer = window.setTimeout(() => toast.classList.remove('visible'), 3500); }
document.addEventListener('DOMContentLoaded', () => { $('refresh-button').addEventListener('click', loadDashboard); loadDashboard(); window.setInterval(loadDashboard, 5 * 60 * 1000); });

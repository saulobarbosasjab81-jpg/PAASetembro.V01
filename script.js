const CONFIG = {
  planningUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRFO5I2IkYLgaisfniLVjlPFyTAaPVPCFji4zA3-AQ3NWhAfVhDFt08jk3Ayee4Zw/pub?gid=1491304880&single=true&output=csv',
  executionUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRFO5I2IkYLgaisfniLVjlPFyTAaPVPCFji4zA3-AQ3NWhAfVhDFt08jk3Ayee4Zw/pub?gid=30813009&single=true&output=csv',
  planningLocal: 'data/base-line.csv',
  executionLocal: 'data/executivo.csv',
  planningGid: '1491304880',
  executionGid: '30813009',
  responsible: ['Sgt Talles / Sgt Tilman', 'Sgt Talles / Sgt Tilman', 'Sgt Talles / Sgt Tilman', 'Sgt Talles / Sgt Tilman', 'SO Soares / Sgt Rita', 'SO Soares / Sgt Rita', 'SO Soares', 'Sgt Anderson / Sgt Rita', 'Civil Belém (Sandro)', 'Civil Local (líder de equipe)', 'Sgt Jefferson', 'Sgt Jefferson'],
  services: ['Escavação drenagem para canaletas', 'Lastro de concreto drenagem para canaletas', 'Assentamento de canaletas', 'Arremates de juntas canaletas', 'Terraplenagem faixa de pista: faixa 20mx60m', 'Base solo vermelho (preparação para o TSD - Lado Dir do acostamento)', 'Camada do TSD no acostamento', 'Escavação para caixa separadora de água e óleo', 'Armação da estrutura da caixa separadora de água e óleo', 'Concretagem tampas das canaletas na lateral do pátio (75cmx45cm)', 'Infra do balizamento', 'Conferência geral no projeto de balizamento'],
  start: new Date(2026, 8, 14),
  end: new Date(2026, 9, 11)
};

const charts = {};
const state = { data: null, selectedService: 0 };
const $ = (id) => document.getElementById(id);
const number = (value) => {
  const normalized = String(value ?? '').replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};
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
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }

  return rows;
}

function parseCsv(text) {
  return window.Papa ? Papa.parse(text, { skipEmptyLines: false }).data : parseCsvFallback(text);
}

function isNumericCell(value) {
  const text = String(value ?? '').trim();
  if (!text) return false;
  const normalized = normalize(text);
  if (normalized.includes('recebimento') || normalized.includes('indefinido') || normalized.includes('value')) return false;
  const cleaned = text.replace(/\s/g, '').replace(/\./g, '').replace(',', '.').replace('%', '');
  return cleaned !== '' && !Number.isNaN(Number(cleaned));
}

function readMatrix(matrix) {
  const rows = matrix.filter(row => row.some(cell => String(cell ?? '').trim() !== ''));
  const dateRowIndex = rows.findIndex(row => row.some(cell => /^\d{1,2}[\/]\d{1,2}[\/]\d{2,4}$/.test(String(cell).trim())));
  const dateRow = dateRowIndex >= 0 ? rows[dateRowIndex] : [];
  const dateColumns = dateRow.map((value, index) => {
    const match = String(value).trim().match(/^(\d{1,2})[\/]([0-9]{1,2})[\/]([0-9]{2,4})$/);
    return match ? { index, date: new Date(Number(match[3].length === 2 ? `20${match[3]}` : match[3]), Number(match[2]) - 1, Number(match[1])) } : null;
  }).filter(Boolean).slice(0, 28);

  const rainRow = rows.find(row => {
    const label = normalize(row[0]);
    return label === 'chuva (mm)' || label.startsWith('precipitacao');
  }) || [];
  const rainValues = dateColumns.map(column => number(rainRow?.[column.index]));
  const dailyRainTotal = rainValues.reduce((sum, value) => sum + value, 0);
  const accumulatedRain = isNumericCell(rainRow[30]) ? number(rainRow[30]) : 0;
  const rainTotal = Math.max(accumulatedRain, dailyRainTotal);

  const serviceRows = CONFIG.services.map((service, index) => {
    const targetName = normalize(service);
    const row = rows.find(candidate => {
      const candidateName = normalize(candidate[0]);
      return candidateName && (candidateName.includes(targetName) || targetName.includes(candidateName));
    }) || [];

    return {
      name: service,
      responsible: CONFIG.responsible[index] || 'Não informado',
      values: dateColumns.map(column => {
        const currentValue = row[column.index];
        return isNumericCell(currentValue) ? number(currentValue) : 0;
      })
    };
  });

  return {
    dates: dateColumns.map(item => item.date),
    services: serviceRows,
    rain: rainValues,
    rainTotal
  };
}

function cumulative(values) {
  let total = 0;
  return values.map(value => (total += value));
}

function latestIndex(data) {
  const lastFilled = data.services.reduce((max, service) => {
    return Math.max(max, latestServiceIndex(service));
  }, -1);

  return lastFilled >= 0 ? lastFilled : Math.min(data.dates.length - 1, 0);
}

function latestServiceIndex(service) {
  let lastFilled = -1;
  for (let index = 0; index < service.actual.length; index += 1) {
    if (service.actual[index] > 0) lastFilled = index;
  }
  return lastFilled;
}

function serviceStats(service, data) {
  const planCumulative = cumulative(service.plan);
  const actualCumulative = cumulative(service.actual);
  const planTotal = planCumulative.at(-1) || 0;
  const actualTotal = actualCumulative.at(-1) || 0;
  const index = latestServiceIndex(service) >= 0 ? latestServiceIndex(service) : 0;
  const safeIndex = Math.min(index, Math.max(planCumulative.length - 1, 0));
  const planAtDateVolume = planCumulative[safeIndex] || 0;
  const actualAtDateVolume = actualCumulative[safeIndex] || 0;
  const planAtDate = planTotal ? planAtDateVolume / planTotal * 100 : 0;
  const actualAtDate = planTotal ? actualAtDateVolume / planTotal * 100 : 0;
  const deviation = actualAtDate - planAtDate;

  let status = 'noPrazo';
  if (actualAtDate >= 99.5 && planAtDate >= 99.5) status = 'concluido';
  else if (deviation > 1) status = 'adiantado';
  else if (deviation >= -1) status = 'noPrazo';
  else if (deviation >= -5) status = 'risco';
  else if (deviation >= -1000) status = 'atrasado';

  return {
    planCumulative,
    actualCumulative,
    planTotal,
    actualTotal,
    planAtDateVolume,
    actualAtDateVolume,
    planAtDate,
    actualAtDate,
    deviation,
    status
  };
}

function buildData(planning, execution) {
  const plan = readMatrix(planning);
  const real = readMatrix(execution);
  return {
    dates: plan.dates.length ? plan.dates : real.dates,
    services: plan.services.map((service, index) => ({
      name: service.name,
      responsible: service.responsible,
      plan: service.values,
      actual: real.services[index]?.values || Array(service.values.length).fill(0)
    })),
    rain: real.rain.length ? real.rain : plan.rain,
    rainTotal: Number.isFinite(real.rainTotal) ? real.rainTotal : plan.rainTotal
  };
}

function setText(id, value) {
  $(id).textContent = value;
}

function statusLabel(status) {
  return { concluido: 'Concluído', adiantado: 'Adiantado', noPrazo: 'No prazo', risco: 'Risco de atraso', atrasado: 'Atrasado' }[status];
}

function updateKpis(data, index, stats) {
  const totalDays = data.dates.length || 28;
  const elapsed = Math.max(0, Math.min(totalDays, index + 1));
  const counts = stats.reduce((acc, item) => {
    acc[item.status] += 1;
    return acc;
  }, { concluido: 0, adiantado: 0, noPrazo: 0, risco: 0, atrasado: 0 });

  setText('kpi-elapsed', `${Math.round(elapsed / totalDays * 100)}%`);
  setText('kpi-elapsed-detail', `${elapsed} de ${totalDays} dias monitorados`);
  setText('kpi-completed', counts.concluido);
  setText('kpi-ahead', counts.adiantado);
  setText('kpi-on-time', counts.noPrazo);
  setText('kpi-risk', counts.risco);
  setText('kpi-late', counts.atrasado);

  const effectiveRain = Number.isFinite(data.rainTotal) ? data.rainTotal : (Array.isArray(data.rain) && data.rain.length ? data.rain[data.rain.length - 1] : 0);
  const rainTotal = Number.isFinite(effectiveRain) ? effectiveRain : 0;
  setText('kpi-rain', `${formatNumber(rainTotal)} mm`);
  setText('kpi-rain-detail', `${elapsed} dias monitorados`);

  const lastDate = data.dates[Math.min(index, data.dates.length - 1)] || new Date();
  setText('last-update', `${lastDate.toLocaleDateString('pt-BR')} · Dia ${elapsed} de ${totalDays}`);
}

function renderTable(data, stats) {
  $('service-table').innerHTML = data.services.map((service, index) => {
    const item = stats[index];
    const unit = item.actualTotal > 999 ? 'un.' : '';
    return `<tr><td>${service.name}</td><td class="responsible">${service.responsible}</td><td><div class="dual-bars"><div class="bar-row"><span class="bar-label">Planejado</span><div class="bar-track"><div class="bar-fill plan" style="width:${Math.min(item.planAtDate, 100)}%"></div></div><span class="bar-value">${formatNumber(item.planAtDate)}%</span></div><div class="bar-row"><span class="bar-label">Executado</span><div class="bar-track"><div class="bar-fill actual" style="width:${Math.min(item.actualAtDate, 100)}%"></div></div><span class="bar-value">${formatNumber(item.actualAtDate)}%</span></div></div></td><td class="service-percent"><strong>${formatNumber(item.actualAtDate)}%</strong></td><td class="accumulated"><span class="quantity-plan">Previsto ${formatNumber(item.planAtDateVolume)} ${unit}</span><span class="quantity-actual">Realizado ${formatNumber(item.actualAtDateVolume)} ${unit}</span></td><td><span class="badge ${item.status}">${statusLabel(item.status)}</span></td></tr>`;
  }).join('');
}

const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#16232e',
      borderColor: '#314653',
      borderWidth: 1,
      padding: 10,
      titleFont: { family: 'IBM Plex Mono' },
      bodyFont: { family: 'Manrope' }
    }
  },
  scales: {
    x: {
      grid: { color: '#26364266' },
      ticks: { color: '#83949e', font: { family: 'IBM Plex Mono', size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }
    },
    y: {
      grid: { color: '#26364288' },
      ticks: { color: '#83949e', font: { family: 'IBM Plex Mono', size: 9 } },
      beginAtZero: true
    }
  }
};

function makeChart(id, config) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart($(id), config);
}

function renderCharts(data, index, stats) {
  const labels = data.dates.map(shortDate);
  const lastActualDay = data.services.reduce((max, service) => {
    let last = -1;
    for (let day = 0; day < service.actual.length; day += 1) {
      if (service.actual[day] > 0) last = day;
    }
    return Math.max(max, last);
  }, -1);

  const planCurve = labels.map((_, day) => {
    const total = stats.reduce((sum, item) => sum + (item.planCumulative[day] / (item.planTotal || 1) * 100), 0);
    return total / stats.length;
  });

  const actualCurve = labels.map((_, day) => {
    const total = stats.reduce((sum, item) => sum + (item.actualCumulative[day] / (item.planTotal || 1) * 100), 0);
    return total / stats.length;
  });

  const executedCurve = actualCurve.map((value, day) => (day <= lastActualDay ? value : null));

  makeChart('s-curve-chart', {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Planejado', data: planCurve, borderColor: '#68a7ff', backgroundColor: '#68a7ff18', fill: true, tension: .35, pointRadius: 2 },
        { label: 'Executado', data: executedCurve, borderColor: '#6ce0a6', backgroundColor: 'transparent', tension: .35, pointRadius: 2, spanGaps: false }
      ]
    },
    options: {
      ...chartDefaults,
      plugins: {
        ...chartDefaults.plugins,
        legend: {
          display: true,
          labels: { color: '#83949e', usePointStyle: true, boxWidth: 7, font: { family: 'Manrope', size: 10 } }
        }
      },
      scales: {
        ...chartDefaults.scales,
        y: {
          ...chartDefaults.scales.y,
          max: 100,
          ticks: { ...chartDefaults.scales.y.ticks, callback: value => `${value}%` }
        }
      }
    }
  });

  const statusCounts = ['concluido', 'adiantado', 'noPrazo', 'risco', 'atrasado'].map(status => stats.filter(item => item.status === status).length);
  makeChart('status-chart', {
    type: 'doughnut',
    data: {
      labels: ['Concluído', 'Adiantado', 'No prazo', 'Risco de atraso', 'Atrasado'],
      datasets: [{
        data: statusCounts,
        backgroundColor: ['#6ce0a6', '#68a7ff', '#83949e', '#f2ca61', '#f07878'],
        borderColor: '#111b24',
        borderWidth: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: { legend: { display: false } }
    }
  });

  $('status-summary').innerHTML = ['concluido', 'adiantado', 'noPrazo', 'risco', 'atrasado']
    .map((status, i) => `<span>${statusLabel(status)} <b>${statusCounts[i]}</b></span>`)
    .join('');

  const production = data.services.slice(0, 4);
  const productionColors = ['#68a7ff', '#6ce0a6', '#f2ca61', '#f07878', '#7fdaf7'];
  makeChart('production-chart', {
    type: 'bar',
    data: {
      labels,
      datasets: production.map((service, serviceIndex) => ({
        label: service.name,
        data: service.actual,
        backgroundColor: productionColors[serviceIndex % productionColors.length],
        borderRadius: 3
      }))
    },
    options: {
      ...chartDefaults,
      plugins: { ...chartDefaults.plugins, legend: { display: false } },
      scales: {
        ...chartDefaults.scales,
        x: {
          ...chartDefaults.scales.x,
          ticks: { ...chartDefaults.scales.x.ticks, autoSkip: false, maxTicksLimit: undefined, maxRotation: 60, minRotation: 60 }
        }
      }
    }
  });

  $('production-legend').innerHTML = production
    .map((service, serviceIndex) => `<span><i style="background:${productionColors[serviceIndex % productionColors.length]}"></i>${service.name}</span>`)
    .join('');

  makeChart('rain-chart', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: data.rain,
        backgroundColor: '#79b9e7aa',
        borderColor: '#79b9e7',
        borderWidth: 1,
        borderRadius: 2
      }]
    },
    options: {
      ...chartDefaults,
      plugins: { ...chartDefaults.plugins, legend: { display: false } },
      scales: {
        ...chartDefaults.scales,
        y: {
          ...chartDefaults.scales.y,
          ticks: { ...chartDefaults.scales.y.ticks, callback: value => `${value} mm` }
        }
      }
    }
  });
}

function renderSelected(data, index) {
  const service = data.services[state.selectedService];
  const stats = serviceStats(service, data);
  setText('selected-total', formatNumber(stats.actualTotal));
  setText('selected-meta', service.name);
  setText('selected-real', `${formatNumber(stats.actualAtDate)}%`);
  setText('selected-plan', `${formatNumber(stats.planAtDate)}%`);

  makeChart('selected-chart', {
    type: 'bar',
    data: {
      labels: data.dates.map(shortDate),
      datasets: [{
        label: 'Executado',
        data: service.actual,
        backgroundColor: '#5bd6dfaa',
        borderColor: '#5bd6df',
        borderWidth: 1,
        borderRadius: 2
      }]
    },
    options: {
      ...chartDefaults,
      plugins: { ...chartDefaults.plugins, legend: { display: false } }
    }
  });
}

function populateSelect(data) {
  $('service-select').innerHTML = data.services.map((service, index) => `<option value="${index}">${service.name}</option>`).join('');
  $('service-select').onchange = event => {
    state.selectedService = Number(event.target.value);
    renderSelected(data, latestIndex(data));
  };
}

function render(data) {
  state.data = data;
  const index = latestIndex(data);
  const stats = data.services.map(service => serviceStats(service, data));

  updateKpis(data, index, stats);
  renderTable(data, stats);
  renderCharts(data, index, stats);
  populateSelect(data);
  renderSelected(data, index);
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function fetchCsv(url, gid, localUrl) {
  try {
    const response = await fetchText(`${url}&_=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`CSV indisponível (${response.status})`);
    return response.text();
  } catch (directError) {
    try {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
      const proxyResponse = await fetchText(proxyUrl, { cache: 'no-store' });
      if (proxyResponse.ok) return proxyResponse.text();
    } catch (proxyError) {
      console.info('Planilha remota indisponível; tentando snapshot local.', proxyError);
    }

    const localResponse = await fetch(localUrl, { cache: 'no-store' });
    if (!localResponse.ok) throw directError;
    return localResponse.text();
  }
}

async function loadDashboard() {
  try {
    showToast('Atualizando dados...');
    const [planningCsv, executionCsv] = await Promise.all([
      fetchCsv(CONFIG.planningUrl, CONFIG.planningGid, CONFIG.planningLocal),
      fetchCsv(CONFIG.executionUrl, CONFIG.executionGid, CONFIG.executionLocal)
    ]);

    render(buildData(parseCsv(planningCsv), parseCsv(executionCsv)));
    showToast('Dados atualizados com sucesso.');
  } catch (error) {
    console.error(error);
    showToast('Falha ao carregar os CSVs. Verifique a publicação das planilhas.');
    $('service-table').innerHTML = '<tr><td colspan="6" class="loading-cell">Não foi possível carregar os dados remotos. Confira a conexão e tente novamente.</td></tr>';
  }
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('visible'), 3500);
}

document.addEventListener('DOMContentLoaded', () => {
  $('refresh-button').addEventListener('click', loadDashboard);
  loadDashboard();
  window.setInterval(loadDashboard, 5 * 60 * 1000);
});

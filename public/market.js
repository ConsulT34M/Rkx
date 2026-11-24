window.marketUI = (() => {
  const $ = selector => document.querySelector(selector);
  const state = { market: 'KRW-BTC', interval: '1d', tickers: [], candles: [], hover: -1, detailVersion: 0, chartVersion: 0, historyVersion: 0 };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const number = value => {
    const price = Number(value) || 0, magnitude = Math.abs(price);
    const digits = magnitude >= 1000 ? 0 : magnitude >= 100 ? 2 : magnitude >= 1 ? 4 : 8;
    return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: digits }).format(price);
  };
  const krw = value => `${number(value)}원`;
  const signed = value => `${Number(value) >= 0 ? '+' : ''}${(Number(value) * 100).toFixed(2)}%`;
  const amount = value => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 4 }).format(Number(value) || 0);
  const time = value => new Date(Number(value)).toLocaleTimeString('ko-KR', { timeZone:'Asia/Seoul', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
  const changeClass = value => Number(value) > 0 ? 'up' : Number(value) < 0 ? 'down' : '';
  async function get(url) {
    const response = await fetch(url, { credentials:'same-origin' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || '시세를 가져오지 못했습니다.');
    return data;
  }
  function active() { return $('#view-market').classList.contains('active'); }
  function selectedTicker() { return state.tickers.find(item => item.market === state.market); }

  function renderHome() {
    const btc = state.tickers.find(item => item.market === 'KRW-BTC');
    if (btc) {
      $('#heroPrice').textContent = krw(btc.price);
      $('#heroChange').textContent = `${signed(btc.changeRate)} 전일 대비 · BITHUMB`;
      $('#heroChange').className = `price-change ${changeClass(btc.changeRate)}`;
    }
    $('#tickerStrip').innerHTML = state.tickers.slice(0, 5).map(item => `<span class="strip-item"><strong>${esc(item.market.slice(4))}</strong><span>${krw(item.price)}</span><small class="${changeClass(item.changeRate)}">${signed(item.changeRate)}</small></span>`).join('');
  }
  function renderMarketList() {
    const search = $('#marketSearch').value.trim().toLowerCase();
    const matches = state.tickers.filter(item => !search || item.market.toLowerCase().includes(search) || item.name.toLowerCase().includes(search));
    $('#marketCount').textContent = `${matches.length} 종목`;
    $('#marketListRows').innerHTML = matches.length ? matches.map(item => `<button class="market-list-row ${item.market === state.market ? 'selected' : ''}" data-market="${esc(item.market)}"><span class="market-list-name"><strong>${esc(item.name)}</strong><small>${esc(item.market.slice(4))}/KRW</small></span><span class="market-list-price ${changeClass(item.changeRate)}">${number(item.price)}</span><span class="market-list-change ${changeClass(item.changeRate)}">${signed(item.changeRate)}</span></button>`).join('') : '<p class="market-empty">검색 결과가 없습니다.</p>';
  }
  function renderQuote(ticker, at) {
    if (!ticker) return;
    const symbol = ticker.market.slice(4);
    $('#marketAssetName').textContent = ticker.name;
    $('#marketAssetCode').textContent = `${symbol}/KRW`;
    $('#marketAssetIcon').textContent = symbol === 'BTC' ? '₿' : symbol.slice(0, 1);
    $('#marketMainPrice').textContent = krw(ticker.price);
    $('#marketMainPrice').className = changeClass(ticker.changeRate);
    $('#marketMainChange').textContent = `${signed(ticker.changeRate)}  ${Number(ticker.changePrice) >= 0 ? '▲' : '▼'} ${krw(Math.abs(Number(ticker.changePrice)))}`;
    $('#marketMainChange').className = changeClass(ticker.changeRate);
    $('#marketHigh').textContent = krw(ticker.high);
    $('#marketLow').textContent = krw(ticker.low);
    $('#marketVolume').textContent = `${amount(ticker.amount24h)} ${symbol}`;
    $('#marketValue').textContent = krw(ticker.volume24h);
    $('#marketUpdated').textContent = `${new Date(at).toLocaleString('ko-KR', { timeZone:'Asia/Seoul', month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' })} 기준`;
    $('#chartPairLabel').textContent = `${symbol}/KRW · ${intervalLabel(state.interval)} · BITHUMB`;
  }
  async function refreshOverview() {
    try {
      const data = await get('/api/market');
      state.tickers = data.tickers;
      if (!selectedTicker()) state.market = 'KRW-BTC';
      renderHome(); renderMarketList(); renderQuote(selectedTicker(), data.at);
    } catch (error) {
      if (!state.tickers.length) {
        $('#heroPrice').textContent = '시세 연결 지연';
        $('#heroChange').textContent = '잠시 후 다시 확인해 주세요';
        $('#tickerStrip').textContent = '빗썸 시세 연결 지연';
        $('#marketListRows').innerHTML = `<p class="market-empty">${esc(error.message)}</p>`;
      }
    }
  }
  function renderOrderbook(book, price) {
    const asks = book.asks.slice(-9), bids = book.bids.slice(0, 9);
    const largest = Math.max(1, ...asks.map(row => row.size), ...bids.map(row => row.size));
    const row = (item, side) => `<div class="depth-row ${side}" style="--depth:${Math.min(100, Number(item.size) / largest * 100).toFixed(1)}%"><strong>${number(item.price)}</strong><span>${amount(item.size)}</span><small>${side === 'ask' ? '매도' : '매수'}</small></div>`;
    $('#orderbookRows').innerHTML = asks.map(item => row(item, 'ask')).join('') + `<div class="depth-current">현재가 <strong>${krw(price)}</strong></div>` + bids.map(item => row(item, 'bid')).join('');
  }
  function renderTrades(trades) {
    $('#tradeRows').innerHTML = trades.length ? trades.slice(0, 18).map(item => `<div class="trade-row"><span>${time(item.timestamp)}</span><strong class="${item.side === 'BID' ? 'up' : 'down'}">${number(item.price)}</strong><span>${amount(item.volume)}</span></div>`).join('') : '<p>최근 체결 내역이 없습니다.</p>';
  }
  async function refreshDetail() {
    const version = ++state.detailVersion;
    try {
      const data = await get(`/api/market/detail?market=${encodeURIComponent(state.market)}`);
      if (version !== state.detailVersion) return;
      renderQuote(data.ticker, data.at);
      renderOrderbook(data.orderbook, data.ticker.price);
      renderTrades(data.trades);
      $('#orderbookUpdated').textContent = '실시간 호가 스냅샷';
      $('#tradesUpdated').textContent = '최근 체결';
    } catch (error) {
      if (version !== state.detailVersion) return;
      $('#orderbookRows').innerHTML = `<p>${esc(error.message)}</p>`;
      $('#tradeRows').innerHTML = `<p>${esc(error.message)}</p>`;
    }
  }
  function intervalLabel(value) { return ({'1m':'1분','30m':'30분','1h':'1시간','4h':'4시간','1d':'일','1w':'주','1M':'월'})[value] || '일'; }
  function dateLabel(value) { return state.interval.endsWith('m') || state.interval.endsWith('h') ? value.slice(5, 16).replace('T', ' ') : value.slice(5, 10); }
  function setSummary(candle) {
    if (!candle) return;
    $('#chartOhlc').innerHTML = `시 <b>${krw(candle.open)}</b> 고 <b>${krw(candle.high)}</b> 저 <b>${krw(candle.low)}</b> 종 <b class="${changeClass(candle.close - candle.open)}">${krw(candle.close)}</b> <span>거래량 ${amount(candle.volume)}</span>`;
  }
  function drawCandles() {
    const canvas = $('#candleCanvas'), stage = canvas.parentElement, candles = state.candles;
    if (!candles.length) return;
    const width = Math.max(320, stage.clientWidth), height = stage.clientWidth < 650 ? 430 : 500;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.height = `${height}px`;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
    const visible = candles.slice(-Math.min(candles.length, width < 650 ? 36 : 70));
    state.visibleCandles = visible;
    const left = 18, right = width - 92, top = 32, priceBottom = height - 134, volumeTop = height - 112, volumeBottom = height - 46;
    const max = Math.max(...visible.map(c => Number(c.high))), min = Math.min(...visible.map(c => Number(c.low)));
    const padding = Math.max((max - min) * .08, max * .002), high = max + padding, low = min - padding;
    const yPrice = price => priceBottom - (Number(price) - low) / (high - low) * (priceBottom - top);
    const step = (right - left) / visible.length, bodyWidth = Math.max(3, Math.min(11, step * .62));
    ctx.font = '12px sans-serif'; ctx.textAlign = 'left';
    for (let i = 0; i <= 5; i++) {
      const y = top + (priceBottom - top) * i / 5;
      ctx.strokeStyle = '#e9edf1'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
      ctx.fillStyle = '#8c949d'; ctx.fillText(number(high - (high - low) * i / 5), right + 8, y + 4);
    }
    ctx.strokeStyle = '#e9edf1'; ctx.beginPath(); ctx.moveTo(left, volumeTop - 8); ctx.lineTo(right, volumeTop - 8); ctx.stroke();
    const maxVolume = Math.max(1, ...visible.map(c => Number(c.volume)));
    visible.forEach((c, index) => {
      const x = left + index * step + step / 2, rising = Number(c.close) >= Number(c.open);
      const color = rising ? '#e94d52' : '#2777df';
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.35;
      ctx.beginPath(); ctx.moveTo(x, yPrice(c.high)); ctx.lineTo(x, yPrice(c.low)); ctx.stroke();
      const bodyTop = Math.min(yPrice(c.open), yPrice(c.close)), bodyHeight = Math.max(2, Math.abs(yPrice(c.open) - yPrice(c.close)));
      ctx.fillRect(x - bodyWidth / 2, bodyTop, bodyWidth, bodyHeight);
      ctx.globalAlpha = .55; ctx.fillRect(x - bodyWidth / 2, volumeBottom - Number(c.volume) / maxVolume * (volumeBottom - volumeTop), bodyWidth, Number(c.volume) / maxVolume * (volumeBottom - volumeTop)); ctx.globalAlpha = 1;
    });
    const latest = visible.at(-1), currentY = yPrice(latest.close);
    ctx.setLineDash([3, 3]); ctx.strokeStyle = '#f97316'; ctx.beginPath(); ctx.moveTo(left, currentY); ctx.lineTo(right, currentY); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#f97316'; ctx.fillRect(right, currentY - 11, width - right, 22); ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.fillText(number(latest.close), right + 5, currentY + 4);
    ctx.font = '12px sans-serif'; ctx.fillStyle = '#8c949d';
    for (let i = 0; i < 5; i++) {
      const index = Math.min(visible.length - 1, Math.round(i * (visible.length - 1) / 4));
      const x = left + index * step + step / 2;
      ctx.fillText(dateLabel(visible[index].time), Math.max(left, Math.min(right - 72, x - 26)), height - 17);
    }
    if (state.hover >= 0 && state.hover < visible.length) {
      const x = left + state.hover * step + step / 2, candle = visible[state.hover];
      ctx.setLineDash([4, 4]); ctx.strokeStyle = '#9199a4'; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, volumeBottom); ctx.stroke(); ctx.setLineDash([]);
      setSummary(candle);
    } else setSummary(latest);
    state.chartGeometry = { left, right, step, width };
  }
  async function refreshChart() {
    const version = ++state.chartVersion;
    $('#chartLoading').classList.remove('hidden'); $('#chartLoading').textContent = '차트를 불러오고 있습니다.';
    try {
      const data = await get(`/api/market/chart?market=${encodeURIComponent(state.market)}&interval=${encodeURIComponent(state.interval)}`);
      if (version !== state.chartVersion) return;
      state.candles = data.candles; state.hover = -1;
      $('#chartPairLabel').textContent = `${state.market.slice(4)}/KRW · ${intervalLabel(state.interval)} · BITHUMB`;
      $('#chartLoading').classList.add('hidden'); drawCandles();
    } catch (error) { if (version === state.chartVersion) $('#chartLoading').textContent = error.message; }
  }
  async function refreshHistory() {
    const version = ++state.historyVersion, market = state.market;
    try {
      const { candles } = await get(`/api/market/chart?market=${encodeURIComponent(market)}&interval=1d`);
      if (version !== state.historyVersion) return;
      const rows = candles.slice(-10).reverse();
      $('#historyRows').innerHTML = rows.map((c, index) => {
        const previous = candles[candles.length - 2 - index], delta = previous ? Number(c.close) - Number(previous.close) : 0;
        return `<tr><td>${esc(c.time.slice(5, 10))}</td><td class="${changeClass(delta)}">${krw(c.close)}</td><td class="${changeClass(delta)}">${delta >= 0 ? '+' : ''}${krw(delta)} ${previous ? `(${signed(delta / Number(previous.close))})` : ''}</td><td>${amount(c.volume)}</td></tr>`;
      }).join('');
    } catch (error) { if (version === state.historyVersion) $('#historyRows').innerHTML = `<tr><td colspan="4">${esc(error.message)}</td></tr>`; }
  }
  async function selectMarket(market) {
    if (!state.tickers.some(item => item.market === market)) return;
    state.market = market; state.hover = -1; renderMarketList();
    renderQuote(selectedTicker(), new Date().toISOString());
    $('#orderbookRows').innerHTML = '<p>호가를 불러오는 중입니다.</p>';
    $('#tradeRows').innerHTML = '<p>체결 내역을 불러오는 중입니다.</p>';
    await Promise.allSettled([refreshDetail(), refreshChart(), refreshHistory()]);
  }
  async function enter() {
    if (!state.tickers.length) await refreshOverview();
    await Promise.allSettled([refreshDetail(), refreshChart(), refreshHistory()]);
  }
  function init() {
    $('#marketSearch').addEventListener('input', renderMarketList);
    $('#marketListRows').addEventListener('click', event => {
      const row = event.target.closest('[data-market]'); if (row) selectMarket(row.dataset.market);
    });
    document.querySelectorAll('[data-chart-interval]').forEach(button => button.addEventListener('click', () => {
      state.interval = button.dataset.chartInterval;
      document.querySelectorAll('[data-chart-interval]').forEach(item => item.classList.toggle('active', item === button));
      refreshChart();
    }));
    $('#refreshMarket').addEventListener('click', () => { refreshOverview(); if (active()) { refreshDetail(); refreshChart(); refreshHistory(); } });
    $('#candleCanvas').addEventListener('mousemove', event => {
      const geometry = state.chartGeometry; if (!geometry || !state.visibleCandles?.length) return;
      const rect = event.currentTarget.getBoundingClientRect(), x = event.clientX - rect.left;
      const index = Math.floor((x - geometry.left) / geometry.step);
      if (index < 0 || index >= state.visibleCandles.length) return;
      state.hover = index; drawCandles();
      const candle = state.visibleCandles[index], tip = $('#candleTooltip');
      tip.innerHTML = `<strong>${esc(candle.time.replace('T', ' '))}</strong><span>시 ${krw(candle.open)} · 종 ${krw(candle.close)}</span><span>고 ${krw(candle.high)} · 저 ${krw(candle.low)}</span><span>거래량 ${amount(candle.volume)}</span>`;
      tip.style.left = `${Math.min(rect.width - 220, Math.max(12, x + 14))}px`;
      tip.classList.remove('hidden');
    });
    $('#candleCanvas').addEventListener('mouseleave', () => { state.hover = -1; $('#candleTooltip').classList.add('hidden'); drawCandles(); });
    new ResizeObserver(() => { if (active()) drawCandles(); }).observe($('#candleCanvas').parentElement);
    refreshOverview();
    setInterval(() => { refreshOverview(); if (active()) refreshDetail(); }, 15000);
  }
  return { init, enter, refreshOverview };
})();

/*
 * Minimal SVG charts. One series per chart, one y-axis, recessive grid,
 * 2px line, crosshair + tooltip on hover/touch.
 */
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  function niceTicks(min, max, count = 4) {
    if (min === max) { min -= 1; max += 1; }
    const span = max - min, step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || 10 * mag;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
    return ticks;
  }

  /**
   * points: [{x: ms, y: number, label: string}]
   * opts: { format(y), dateFormat(ms), zeroLine, stepped, height, ariaLabel }
   */
  function lineChart(container, points, opts = {}) {
    container.innerHTML = '';
    if (points.length < 2) {
      container.innerHTML = `<div class="empty">${opts.emptyText || '資料點還不夠，之後會自動累積'}</div>`;
      return;
    }
    const W = Math.max(300, Math.round(container.clientWidth - 32) || 640), H = opts.height || 200, padL = 52, padR = 12, padT = 12, padB = 26;
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const yMin = Math.min(...ys, opts.zeroLine ? 0 : Infinity), yMax = Math.max(...ys, opts.zeroLine ? 0 : -Infinity);
    const ticks = niceTicks(yMin, yMax);
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const sx = x => padL + (x1 === x0 ? 0.5 : (x - x0) / (x1 - x0)) * (W - padL - padR);
    const sy = y => padT + (1 - (y - y0) / (y1 - y0)) * (H - padT - padB);
    const fmt = opts.format || (v => String(v));
    const dfmt = opts.dateFormat || (ms => new Date(ms).toISOString().slice(5, 10));

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', opts.ariaLabel || '折線圖');
    let html = '<g class="grid">';
    for (const t of ticks) html += `<line x1="${padL}" x2="${W - padR}" y1="${sy(t)}" y2="${sy(t)}"/>`;
    html += '</g><g class="axis">';
    for (const t of ticks) html += `<text x="${padL - 8}" y="${sy(t) + 4}" text-anchor="end">${fmt(t, true)}</text>`;
    const labelIdx = [0, Math.floor((points.length - 1) / 2), points.length - 1].filter((v, i, a) => a.indexOf(v) === i);
    for (const i of labelIdx) html += `<text x="${sx(points[i].x)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}">${dfmt(points[i].x)}</text>`;
    html += '</g>';
    if (opts.zeroLine && y0 < 0 && y1 > 0) html += `<line class="zero" x1="${padL}" x2="${W - padR}" y1="${sy(0)}" y2="${sy(0)}"/>`;
    let d = '';
    points.forEach((p, i) => {
      const X = sx(p.x), Y = sy(p.y);
      if (i === 0) d += `M${X},${Y}`;
      else d += opts.stepped ? `H${X}V${Y}` : `L${X},${Y}`;
    });
    const base = sy(Math.max(y0, Math.min(0, y1)));
    html += `<path class="area" d="${d}V${base}H${sx(points[0].x)}Z"/>`;
    html += `<path class="line" d="${d}"/>`;
    const last = points[points.length - 1];
    html += `<circle class="marker" r="4" cx="${sx(last.x)}" cy="${sy(last.y)}"/>`;
    html += `<line class="cross" y1="${padT}" y2="${H - padB}" x1="-10" x2="-10" visibility="hidden"/><circle class="marker hover" r="5" cx="-10" cy="-10" visibility="hidden"/>`;
    html += `<rect x="${padL}" y="0" width="${W - padL - padR}" height="${H}" fill="transparent"/>`;
    svg.innerHTML = html;
    container.appendChild(svg);

    const tip = document.createElement('div');
    tip.className = 'tooltip'; tip.hidden = true;
    container.appendChild(tip);
    const cross = svg.querySelector('.cross'), dot = svg.querySelector('.hover');
    const move = ev => {
      const rect = svg.getBoundingClientRect();
      const cx = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left) / rect.width * W;
      let best = 0;
      for (let i = 1; i < points.length; i++) if (Math.abs(sx(points[i].x) - cx) < Math.abs(sx(points[best].x) - cx)) best = i;
      const p = points[best], X = sx(p.x), Y = sy(p.y);
      cross.setAttribute('x1', X); cross.setAttribute('x2', X); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', X); dot.setAttribute('cy', Y); dot.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.innerHTML = `${p.label || dfmt(p.x)}<br><strong>${fmt(p.y)}</strong>`;
      const left = X / W * rect.width + 16;
      tip.style.left = Math.min(Math.max(left, 60), rect.width - 40) + 'px';
      tip.style.top = (Y / H * rect.height) + 'px';
    };
    const leave = () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hidden = true; };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', leave);
  }

  root.Charts = { lineChart, niceTicks };
})(typeof globalThis !== 'undefined' ? globalThis : this);

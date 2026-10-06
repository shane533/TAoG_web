/* 共享的小工具：DOM 辅助与提示条。 */

export const $ = (sel) => document.querySelector(sel);

export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

let toastTimer = null;
export function toast(msg, kind = '') {
  const node = document.getElementById('toast');
  if (!node) return;
  node.textContent = msg;
  node.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.className = ''; }, 1900);
}

/** 把形状的行字符串画成小 SVG */
export function shapeSvg(rows, cell = 13) {
  const w = Math.max(1, ...rows.map((r) => r.length)) * cell;
  const h = Math.max(1, rows.length) * cell;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== '#') continue;
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', c * cell + 1);
      rect.setAttribute('y', r * cell + 1);
      rect.setAttribute('width', cell - 2);
      rect.setAttribute('height', cell - 2);
      rect.setAttribute('rx', 2);
      rect.setAttribute('fill', '#e0b955');
      rect.setAttribute('stroke', '#4a3d2c');
      rect.setAttribute('stroke-width', '1');
      svg.appendChild(rect);
    }
  });
  return svg;
}

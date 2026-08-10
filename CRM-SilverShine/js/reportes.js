/* ═══════════════════════════════════════════════════════════
   reportes.js — Motor de reportes para el contador.
   Un reporte = secciones [{titulo?, columnas, filas, totales?}]
   con tres salidas: CSV (abre en Excel), impresión (y de ahí
   "Guardar como PDF" del navegador) y PDF directo (jsPDF,
   paginado, vertical u horizontal).
   columnas: [{t: 'Título', w: ancho_pt, a: 'left'|'right'}]
   ═══════════════════════════════════════════════════════════ */
const Reportes = (() => {
  const GRIS = [102, 102, 102], SLATE = [40, 40, 40], ROSA = [207, 155, 144];

  /* ── CSV con BOM (acentos correctos en Excel) ── */
  function descargarCSV(nombre, secciones) {
    const celda = v => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lineas = [];
    for (const sec of secciones) {
      if (sec.titulo) lineas.push(celda(sec.titulo));
      lineas.push(sec.columnas.map(c => celda(c.t)).join(','));
      for (const f of sec.filas) lineas.push(f.map(celda).join(','));
      if (sec.totales) lineas.push(sec.totales.map(celda).join(','));
      lineas.push('');
    }
    const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(a.href);
    UI.toast('📥 ' + nombre + ' descargado');
  }

  /* ── Impresión (usa el área y estilos de las facturas) ── */
  async function imprimir(titulo, sub, secciones) {
    const emp = await UI.getEmpresa();
    const esc = UI.esc;
    const datosEmp = [
      [emp.razon, emp.rnc && 'RNC ' + emp.rnc].filter(Boolean).join(' · '),
      [emp.telefono && 'Tel. ' + emp.telefono, emp.correo, emp.web].filter(Boolean).join(' · '),
    ].filter(Boolean).join('<br>');
    const tabla = sec => `
      ${sec.titulo ? `<h3 style="font-size:.9rem;margin:20px 0 6px;text-transform:uppercase;letter-spacing:1px;color:#B07F74">${esc(sec.titulo)}</h3>` : ''}
      <table class="p-tabla">
        <tr>${sec.columnas.map(c => `<th class="${c.a === 'right' ? 'num' : ''}">${esc(c.t)}</th>`).join('')}</tr>
        ${sec.filas.map(f => `<tr>${f.map((v, i) =>
          `<td class="${sec.columnas[i] && sec.columnas[i].a === 'right' ? 'num' : ''}">${esc(String(v ?? ''))}</td>`).join('')}</tr>`).join('')}
        ${sec.totales ? `<tr>${sec.totales.map((v, i) =>
          `<td class="${sec.columnas[i] && sec.columnas[i].a === 'right' ? 'num' : ''}"><b>${esc(String(v ?? ''))}</b></td>`).join('')}</tr>` : ''}
      </table>`;
    UI.$('#printArea').innerHTML = `
      <div class="p-head">
        <img src="logo.png" class="p-logo" alt="${esc(emp.nombre)}">
        <div class="p-empresa">${datosEmp}</div>
      </div>
      <div class="p-meta">
        <div><b>${esc(titulo).toUpperCase()}</b><br>${esc(sub)}</div>
        <div style="text-align:right">Generado: ${UI.fmtFecha(new Date().toISOString().slice(0, 10))}</div>
      </div>
      ${secciones.map(tabla).join('')}
      ${emp.pie ? `<div class="p-pie">${esc(emp.pie)}</div>` : ''}
    `;
    await UI.imprimirArea();
  }

  /* ── PDF directo, paginado ──
     Tamaño CARTA (8.5×11, el papel del usuario) y las columnas se
     escalan solas para llenar el ancho útil sin salirse del margen. */
  async function pdf(nombre, titulo, sub, secciones, opts = {}) {
    const emp = await UI.getEmpresa();
    const L = PDFDoc.limpiar;
    const doc = new jspdf.jsPDF({ unit: 'pt', format: 'letter', orientation: opts.horizontal ? 'landscape' : 'portrait' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 30;
    let y = 0;

    const cabecera = () => {
      doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...SLATE);
      doc.text(L(titulo), M, 40);
      doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...GRIS);
      doc.text(L([emp.razon, emp.rnc && 'RNC ' + emp.rnc].filter(Boolean).join(' · ')), M, 54);
      doc.text(L(sub), M, 66);
      doc.text('Generado: ' + new Date().toLocaleDateString('es-DO'), W - M, 40, { align: 'right' });
      doc.setDrawColor(...ROSA).setLineWidth(1).line(M, 74, W - M, 74);
      y = 92;
    };

    const filaTexto = (cols, xs, valores, bold) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      valores.forEach((v, i) => {
        const c = cols[i];
        if (!c) return;
        const maxChars = Math.floor(c.w / 4.3);
        let s = L(String(v ?? ''));
        if (s.length > maxChars) s = s.slice(0, maxChars - 1) + '.';
        doc.text(s, c.a === 'right' ? xs[i] + c.w - 4 : xs[i], y, { align: c.a === 'right' ? 'right' : 'left' });
      });
      y += 13;
    };

    const encabezadoCols = (cols, xs) => {
      doc.setFontSize(7.5).setTextColor(...GRIS);
      filaTexto(cols, xs, cols.map(c => c.t.toUpperCase()), true);
      doc.setDrawColor(...ROSA).setLineWidth(0.6).line(M, y - 9, W - M, y - 9);
      doc.setFontSize(8).setTextColor(...SLATE);
      y += 2;
    };

    cabecera();
    for (const sec of secciones) {
      /* Escalar las columnas al ancho útil: ni se salen del margen
         ni dejan media página vacía a la derecha */
      const util = W - 2 * M;
      const suma = sec.columnas.reduce((s, c) => s + c.w, 0);
      const factor = Math.min(util / suma, 1.3);
      const cols = sec.columnas.map(c => ({ ...c, w: c.w * factor }));

      const xs = [];
      let x = M;
      for (const c of cols) { xs.push(x); x += c.w; }
      if (y > H - 80) { doc.addPage(); cabecera(); }
      if (sec.titulo) {
        doc.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(...SLATE);
        doc.text(L(sec.titulo), M, y); y += 15;
      }
      encabezadoCols(cols, xs);
      for (const f of sec.filas) {
        if (y > H - 40) { doc.addPage(); cabecera(); encabezadoCols(cols, xs); }
        filaTexto(cols, xs, f, false);
      }
      if (sec.totales) {
        if (y > H - 40) { doc.addPage(); cabecera(); encabezadoCols(cols, xs); }
        doc.setDrawColor(...ROSA).setLineWidth(0.6).line(M, y - 10, W - M, y - 10);
        filaTexto(cols, xs, sec.totales, true);
      }
      y += 14;
    }
    doc.save(nombre);
    UI.toast('📄 ' + nombre + ' descargado');
  }

  return { descargarCSV, imprimir, pdf };
})();

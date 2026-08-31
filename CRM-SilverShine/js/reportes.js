/* ═══════════════════════════════════════════════════════════
   reportes.js — Motor de reportes para el contador.
   Un reporte = secciones [{titulo?, columnas, filas, totales?}]
   con tres salidas: Excel de verdad (.xlsx armado a mano, sin
   librerías), impresión (y de ahí "Guardar como PDF" del
   navegador) y PDF directo (jsPDF, paginado). El CSV viejo
   queda disponible pero ya no se usa desde los botones.
   columnas: [{t: 'Título', w: ancho_pt, a: 'left'|'right'}]
   ═══════════════════════════════════════════════════════════ */
const Reportes = (() => {
  const GRIS = [102, 102, 102], SLATE = [40, 40, 40], ROSA = [207, 155, 144];

  /* ── CSV con BOM (acentos correctos en Excel) ──
     Los montos formateados ("1,234.56") van como número crudo (1234.56)
     para que Excel los sume; y las celdas que parezcan fórmula (=, +, @)
     se neutralizan para que no se ejecuten al abrir el archivo. */
  function descargarCSV(nombre, secciones) {
    const celda = v => {
      const s = String(v ?? '');
      if (/^-?[\d,]+\.\d{2}$/.test(s)) return s.replace(/,/g, '');   // número de verdad
      const seguro = /^[=+@]/.test(s) ? "'" + s : s;
      return /[",\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
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

  /* ── Excel DE VERDAD (.xlsx) ──
     El CSV perdía todo al re-guardar (es texto plano). Un .xlsx es un
     ZIP de XMLs: aquí se arma a mano (ZIP sin compresión + SpreadsheetML
     mínimo) — títulos y totales en negrita, encabezados sombreados,
     anchos de columna y montos como NÚMEROS con formato #,##0.00, para
     que el contador edite y guarde sin que se desconfigure nada. */
  const XLSX = (() => {
    const enc = new TextEncoder();
    const TABLA_CRC = (() => {
      const t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
      }
      return t;
    })();
    const crc32 = buf => {
      let c = 0xFFFFFFFF;
      for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
      return (c ^ 0xFFFFFFFF) >>> 0;
    };
    /* ZIP con entradas almacenadas (sin comprimir): suficiente y simple */
    function zip(entradas) {
      const ahora = new Date();
      const dosHora = (ahora.getHours() << 11) | (ahora.getMinutes() << 5) | (ahora.getSeconds() >> 1);
      const dosFecha = ((ahora.getFullYear() - 1980) << 9) | ((ahora.getMonth() + 1) << 5) | ahora.getDate();
      const partes = [], centro = [];
      let offset = 0;
      const u16 = v => [v & 255, (v >> 8) & 255];
      const u32 = v => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
      for (const [nombre, xml] of entradas) {
        const nom = enc.encode(nombre);
        const data = enc.encode(xml);
        const crc = crc32(data);
        const cab = new Uint8Array([
          ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0),
          ...u16(dosHora), ...u16(dosFecha), ...u32(crc),
          ...u32(data.length), ...u32(data.length), ...u16(nom.length), ...u16(0),
        ]);
        partes.push(cab, nom, data);
        centro.push({ nom, crc, tam: data.length, offset });
        offset += cab.length + nom.length + data.length;
      }
      const inicioCentro = offset;
      for (const e of centro) {
        partes.push(new Uint8Array([
          ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0),
          ...u16(dosHora), ...u16(dosFecha), ...u32(e.crc),
          ...u32(e.tam), ...u32(e.tam), ...u16(e.nom.length),
          ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(e.offset),
        ]), e.nom);
        offset += 46 + e.nom.length;
      }
      partes.push(new Uint8Array([
        ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(centro.length), ...u16(centro.length),
        ...u32(offset - inicioCentro), ...u32(inicioCentro), ...u16(0),
      ]));
      return new Blob(partes, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }

    const xesc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

    /* estilos: 0 normal · 1 negrita · 2 número · 3 número negrita · 4 encabezado */
    const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF7ECE8"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

    function generar(secciones) {
      const esNum = s => /^-?[\d,]+\.\d{2}$/.test(String(s ?? ''));
      const celda = (v, estilo) => {
        const s = String(v ?? '');
        if (esNum(s)) return `<c s="${estilo >= 1 ? 3 : 2}"><v>${s.replace(/,/g, '')}</v></c>`;
        if (s === '') return `<c s="${estilo}"/>`;
        return `<c s="${estilo}" t="inlineStr"><is><t xml:space="preserve">${xesc(s)}</t></is></c>`;
      };
      const filas = [];
      const anchos = [];
      for (const sec of secciones) {
        sec.columnas.forEach((c, i) => { anchos[i] = Math.max(anchos[i] || 9, Math.round((c.w || 60) / 5.4)); });
        if (sec.titulo) filas.push(`<row>${celda(sec.titulo, 1)}</row>`);
        filas.push(`<row>${sec.columnas.map(c => celda(c.t, 4)).join('')}</row>`);
        for (const f of sec.filas) filas.push(`<row>${f.map(v => celda(v, 0)).join('')}</row>`);
        if (sec.totales) filas.push(`<row>${sec.totales.map(v => celda(v, 1)).join('')}</row>`);
        filas.push('<row/>');
      }
      const cols = anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
      const hoja = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${cols}</cols><sheetData>${filas.join('')}</sheetData></worksheet>`;

      return zip([
        ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`],
        ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`],
        ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Reporte" sheetId="1" r:id="rId1"/></sheets></workbook>`],
        ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`],
        ['xl/styles.xml', STYLES],
        ['xl/worksheets/sheet1.xml', hoja],
      ]);
    }
    return { generar };
  })();

  function descargarXLSX(nombre, secciones) {
    const blob = XLSX.generar(secciones);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    a.click();
    URL.revokeObjectURL(a.href);
    UI.toast('📥 ' + nombre + ' descargado');
  }

  /* ── Impresión (usa el área y estilos de las facturas) ──
     Los reportes anchos (muchas columnas) se imprimen APAISADOS:
     se inyecta @page landscape solo durante esta impresión. */
  async function imprimir(titulo, sub, secciones, opts = {}) {
    const emp = await UI.getEmpresa();
    const esc = UI.esc;
    const datosEmp = [
      [emp.razon, emp.rnc && 'RNC ' + emp.rnc].filter(Boolean).join(' · '),
      [emp.telefono && 'Tel. ' + emp.telefono, emp.correo, emp.web].filter(Boolean).join(' · '),
    ].filter(Boolean).join('<br>');
    const tabla = sec => `
      ${sec.titulo ? `<h3 style="font-size:.9rem;margin:20px 0 6px;text-transform:uppercase;letter-spacing:1px;color:#B07F74">${esc(sec.titulo)}</h3>` : ''}
      <table class="p-tabla p-rep">
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
        <div style="text-align:right">Generado: ${UI.fmtFecha(UI.fechaISO())}</div>
      </div>
      ${secciones.map(tabla).join('')}
      ${emp.pie ? `<div class="p-pie">${esc(emp.pie)}</div>` : ''}
    `;
    let estiloPagina = null;
    if (opts.horizontal) {
      estiloPagina = document.createElement('style');
      estiloPagina.textContent = '@page { size: letter landscape; }';
      document.head.appendChild(estiloPagina);
    }
    try { await UI.imprimirArea(); }
    finally { if (estiloPagina) estiloPagina.remove(); }
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

  return { descargarCSV, descargarXLSX, imprimir, pdf };
})();

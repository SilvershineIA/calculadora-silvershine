/* ═══════════════════════════════════════════════════════════
   pdf.js — Genera el PDF de facturas y cotizaciones con el
   mismo diseño de la versión impresa, y lo envía por correo:
   · Celular: menú de compartir con el PDF ya adjunto.
   · PC: descarga el PDF y abre el correo listo para adjuntarlo.
   ═══════════════════════════════════════════════════════════ */
const PDFDoc = (() => {
  const ROSA = [207, 155, 144], ROSA_SUAVE = [247, 236, 232];
  const SLATE = [40, 40, 40], GRIS = [102, 102, 102], ROJO = [187, 23, 27], VERDE = [46, 125, 50];
  const ANCHO = 595, MARGEN = 45, DERECHA = ANCHO - MARGEN;

  let logoCache = null;
  async function cargarLogo() {
    if (logoCache) return logoCache;
    // JPEG reducido: el PNG directo infla el PDF a varios MB
    const blob = await (await fetch('logo.png')).blob();
    const img = await createImageBitmap(blob);
    const w = 600, h = Math.round(w * img.height / img.width);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    logoCache = c.toDataURL('image/jpeg', 0.85);
    return logoCache;
  }

  const money = (v, m) => (m === 'USD' ? 'US$' : 'RD$') +
    Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /* Las fuentes estándar del PDF solo dibujan latin-1: se sustituyen
     símbolos comunes y se eliminan emojis para que nada salga ilegible */
  const limpiar = s => String(s ?? '')
    .replace(/[✦★☆✨💎]/g, '·')
    .replace(/[—–]/g, '-')
    .replace(/≈/g, '~')
    .replace(/[^\x20-\x7E\xA1-\xFF\n]/g, '')
    .replace(/  +/g, ' ')
    .trim();

  /* Cabecera común: logo + datos de la empresa + doble línea rosa */
  async function cabecera(doc, emp) {
    const logo = await cargarLogo();
    const props = doc.getImageProperties(logo);
    const w = 150, h = w * props.height / props.width;
    doc.addImage(logo, 'JPEG', (ANCHO - w) / 2, 34, w, h);
    let y = 34 + h + 12;
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...GRIS);
    const lineas = [
      [emp.razon, emp.rnc && 'RNC ' + emp.rnc].filter(Boolean).join(' · '),
      emp.direccion,
      [emp.telefono && 'Tel. ' + emp.telefono, emp.correo, emp.web].filter(Boolean).join(' · '),
    ].filter(Boolean);
    for (const l of lineas) { doc.text(limpiar(l), ANCHO / 2, y, { align: 'center' }); y += 11; }
    y += 4;
    doc.setDrawColor(...ROSA).setLineWidth(1.2).line(MARGEN, y, DERECHA, y);
    doc.setLineWidth(0.6).line(MARGEN, y + 2.5, DERECHA, y + 2.5);
    return y + 22;
  }

  /* Meta: título/números a la izquierda, cliente a la derecha */
  function meta(doc, y, lineasIzq, lineasDer) {
    doc.setFontSize(11).setFont('helvetica', 'bold').setTextColor(...SLATE);
    doc.text(limpiar(lineasIzq[0]), MARGEN, y);
    doc.text(limpiar(lineasDer[0] || ''), DERECHA, y, { align: 'right' });
    doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(...GRIS);
    const n = Math.max(lineasIzq.length, lineasDer.length);
    for (let i = 1; i < n; i++) {
      if (lineasIzq[i]) doc.text(limpiar(lineasIzq[i]), MARGEN, y + i * 13);
      if (lineasDer[i]) doc.text(limpiar(lineasDer[i]), DERECHA, y + i * 13, { align: 'right' });
    }
    return y + n * 13 + 12;
  }

  /* Tabla de líneas */
  function tabla(doc, y, lineas, m, impuesto) {
    const xCant = 385, xPrecio = 470, xImp = DERECHA;
    doc.setFontSize(7.5).setFont('helvetica', 'bold').setTextColor(...GRIS);
    doc.text('DESCRIPCIÓN', MARGEN, y);
    doc.text('CANT.', xCant, y, { align: 'right' });
    doc.text('PRECIO', xPrecio, y, { align: 'right' });
    doc.text('IMPORTE', xImp, y, { align: 'right' });
    y += 5;
    doc.setDrawColor(...SLATE).setLineWidth(1).line(MARGEN, y, DERECHA, y);
    y += 15;
    doc.setFontSize(9.5).setFont('helvetica', 'normal').setTextColor(...SLATE);
    for (const l of lineas) {
      const desc = doc.splitTextToSize(limpiar(l.descripcion), 280);
      doc.text(desc, MARGEN, y);
      doc.text(String(l.cantidad), xCant, y, { align: 'right' });
      doc.text(money(l.precio, m), xPrecio, y, { align: 'right' });
      doc.text(money(l.cantidad * l.precio, m), xImp, y, { align: 'right' });
      y += desc.length * 12 + 4;
      doc.setDrawColor(221, 221, 221).setLineWidth(0.4).line(MARGEN, y - 8, DERECHA, y - 8);
    }
    if (impuesto) {
      doc.text('ITBIS (18%)', xPrecio, y, { align: 'right' });
      doc.text(money(impuesto, m), xImp, y, { align: 'right' });
      y += 16;
    }
    return y + 4;
  }

  /* Caja del total */
  function cajaTotal(doc, y, etiqueta, monto) {
    doc.setFillColor(...ROSA_SUAVE).setDrawColor(...ROSA).setLineWidth(0.8);
    doc.rect(MARGEN, y, DERECHA - MARGEN, 30, 'FD');
    doc.setFontSize(11).setFont('helvetica', 'bold').setTextColor(...SLATE);
    doc.text(etiqueta, MARGEN + 12, y + 19.5);
    doc.setFontSize(14);
    doc.text(monto, DERECHA - 12, y + 20, { align: 'right' });
    return y + 44;
  }

  function bloqueTexto(doc, y, texto, opciones = {}) {
    doc.setFontSize(opciones.tam || 7.5).setFont('helvetica', opciones.estilo || 'normal').setTextColor(...(opciones.color || GRIS));
    const partes = doc.splitTextToSize(limpiar(texto), DERECHA - MARGEN - (opciones.caja ? 20 : 0));
    if (opciones.caja) {
      const alto = partes.length * 9.5 + 14;
      doc.setDrawColor(221, 221, 221).setLineWidth(0.5).rect(MARGEN, y, DERECHA - MARGEN, alto);
      doc.text(partes, MARGEN + 10, y + 13);
      return y + alto + 12;
    }
    doc.text(partes, opciones.centro ? ANCHO / 2 : MARGEN, y, opciones.centro ? { align: 'center' } : {});
    return y + partes.length * 9.5 + 8;
  }

  /* ── PDF de factura ── */
  async function docFactura(f, cliente, emp) {
    const doc = new jspdf.jsPDF({ unit: 'pt', format: 'a4' });
    const t = f.moneda || 'DOP';
    let y = await cabecera(doc, emp);
    y = meta(doc, y,
      [
        `${f.estado === 'anulada' ? 'FACTURA ANULADA' : 'FACTURA'}${f.orden ? ' #' + f.orden : ''}`,
        f.numero ? (f.ncf ? 'NCF: ' : 'No.: ') + f.numero : '',
        'Fecha: ' + UI.fmtFecha(f.fecha),
      ].filter(Boolean),
      [
        f.clienteNombre,
        cliente && cliente.telefono || '',
        cliente && cliente.correo || '',
      ]);
    y = tabla(doc, y, f.lineas, t, f.impuesto);
    y = cajaTotal(doc, y, 'TOTAL', money(f.total, t));
    const abonado = f.total - f.saldo;
    if (abonado > 0.005 && f.saldo > 0.005) {
      doc.setFontSize(10).setFont('helvetica', 'normal').setTextColor(...VERDE);
      doc.text(`Abonado: ${money(abonado, t)}`, DERECHA, y, { align: 'right' });
      y += 14;
      doc.setFont('helvetica', 'bold').setTextColor(...ROJO);
      doc.text(`Pendiente: ${money(f.saldo, t)}`, DERECHA, y, { align: 'right' });
      y += 20;
    }
    if (f.notas) y = bloqueTexto(doc, y, f.notas, { tam: 8.5, estilo: 'italic' });
    if (emp.garantia) y = bloqueTexto(doc, y + 4, emp.garantia, { caja: true });
    if (emp.pie) bloqueTexto(doc, Math.max(y + 6, 790), emp.pie, { centro: true, tam: 8 });
    return doc;
  }

  /* ── PDF de cotización ── */
  async function docCotizacion(c, cliente, emp) {
    const doc = new jspdf.jsPDF({ unit: 'pt', format: 'a4' });
    const t = c.moneda || 'DOP';
    let y = await cabecera(doc, emp);
    y = meta(doc, y,
      [
        'COTIZACIÓN COT-' + (c.numero || ''),
        'Fecha: ' + UI.fmtFecha(c.fecha),
        c.vence ? 'Válida hasta: ' + UI.fmtFecha(c.vence) : '',
      ].filter(Boolean),
      [
        c.clienteNombre,
        cliente && cliente.telefono || '',
        cliente && cliente.correo || '',
      ]);
    y = tabla(doc, y, c.lineas, t, 0);
    y = cajaTotal(doc, y, 'TOTAL', money(c.total, t));
    y = bloqueTexto(doc, y, 'Esta cotización no es una factura. Precio sujeto a cambio según el precio internacional del oro.', { tam: 8.5, estilo: 'italic' });
    if (emp.pie) bloqueTexto(doc, Math.max(y + 6, 790), emp.pie, { centro: true, tam: 8 });
    return doc;
  }

  /* ── PDF de recibo de pago ── */
  async function docRecibo(f, abono, cliente, emp, numRec) {
    const doc = new jspdf.jsPDF({ unit: 'pt', format: 'a4' });
    const t = f.moneda || 'DOP';
    let y = await cabecera(doc, emp);
    y = meta(doc, y,
      ['RECIBO DE PAGO ' + numRec, 'Fecha: ' + UI.fmtFecha(abono.fecha)],
      [f.clienteNombre, cliente && cliente.telefono || '', cliente && cliente.correo || '']);
    y = cajaTotal(doc, y, 'PAGO RECIBIDO', money(abono.monto, t));
    doc.setFontSize(10).setFont('helvetica', 'normal').setTextColor(...GRIS);
    const abonado = Math.round((f.total - f.saldo) * 100) / 100;
    const filas = [
      ['Método de pago', abono.metodo || '—'],
      ['Aplicado a la factura', `${f.orden ? '#' + f.orden : ''}${f.numero ? ' · ' + f.numero : ''}`],
      ['Total de la factura', money(f.total, t)],
      ['Abonado a la fecha', money(abonado, t)],
    ];
    for (const [k, v] of filas) {
      doc.setTextColor(...GRIS).text(limpiar(k), MARGEN, y);
      doc.setTextColor(...SLATE).text(limpiar(v), DERECHA, y, { align: 'right' });
      y += 17;
    }
    doc.setFont('helvetica', 'bold');
    if (f.saldo > 0.005) {
      doc.setTextColor(...GRIS).text('Balance pendiente', MARGEN, y);
      doc.setTextColor(...ROJO).text(money(f.saldo, t), DERECHA, y, { align: 'right' });
    } else {
      doc.setTextColor(...VERDE).text('FACTURA SALDADA — ¡Gracias por su pago!', MARGEN, y);
    }
    y += 24;
    if (emp.pie) bloqueTexto(doc, Math.max(y, 790), emp.pie, { centro: true, tam: 8 });
    return doc;
  }

  /* ── PDF de estado de cuenta ── */
  async function docEstado(cliente, pendientes, pagos, emp) {
    const doc = new jspdf.jsPDF({ unit: 'pt', format: 'a4' });
    let y = await cabecera(doc, emp);
    y = meta(doc, y,
      ['ESTADO DE CUENTA', 'Al ' + UI.fmtFecha(new Date().toISOString().slice(0, 10))],
      [cliente.nombre, cliente.telefono || '', cliente.correo || '']);
    const total = pendientes.reduce((s, f) => s + f.saldo, 0);
    if (pendientes.length) {
      doc.setFontSize(7.5).setFont('helvetica', 'bold').setTextColor(...GRIS);
      doc.text('FACTURA', MARGEN, y);
      doc.text('FECHA', 220, y);
      doc.text('TOTAL', 370, y, { align: 'right' });
      doc.text('ABONADO', 460, y, { align: 'right' });
      doc.text('BALANCE', DERECHA, y, { align: 'right' });
      y += 5;
      doc.setDrawColor(...SLATE).setLineWidth(1).line(MARGEN, y, DERECHA, y);
      y += 14;
      doc.setFontSize(9.5).setFont('helvetica', 'normal');
      for (const f of pendientes) {
        const t = f.moneda || 'DOP';
        doc.setTextColor(...SLATE);
        doc.text(limpiar(`${f.orden ? '#' + f.orden : ''} ${f.numero || ''}`), MARGEN, y);
        doc.text(UI.fmtFecha(f.fecha), 220, y);
        doc.text(money(f.total, t), 370, y, { align: 'right' });
        doc.text(money(f.total - f.saldo, t), 460, y, { align: 'right' });
        doc.setTextColor(...ROJO).text(money(f.saldo, t), DERECHA, y, { align: 'right' });
        y += 16;
        doc.setDrawColor(221, 221, 221).setLineWidth(0.4).line(MARGEN, y - 11, DERECHA, y - 11);
      }
      y += 4;
      y = cajaTotal(doc, y, 'BALANCE TOTAL', money(total, 'DOP'));
    } else {
      doc.setFontSize(11).setFont('helvetica', 'bold').setTextColor(...VERDE);
      doc.text('Su cuenta está al día — ¡gracias por su confianza!', MARGEN, y);
      y += 26;
    }
    if (pagos.length) {
      doc.setFontSize(9).setFont('helvetica', 'bold').setTextColor(...GRIS);
      doc.text('SUS ÚLTIMOS PAGOS', MARGEN, y);
      y += 14;
      doc.setFont('helvetica', 'normal').setFontSize(9.5);
      for (const p of pagos) {
        doc.setTextColor(...SLATE).text(limpiar(`${UI.fmtFecha(p.fecha)}  ·  ${p.metodo || 'Pago'}`), MARGEN, y);
        doc.setTextColor(...VERDE).text(money(p.monto, 'DOP'), DERECHA, y, { align: 'right' });
        y += 15;
      }
    }
    const emp2 = emp;
    if (emp2.pie) bloqueTexto(doc, Math.max(y + 10, 790), emp2.pie, { centro: true, tam: 8 });
    return doc;
  }

  /* ── Compartir un documento ya generado ── */
  async function compartirDoc(doc, nombre, cliente, cuerpo, asunto) {
    const blob = doc.output('blob');
    const file = new File([blob], nombre, { type: 'application/pdf' });

    // Solo en el celular usamos el menú de compartir (PDF adjunto).
    // Ese menú no permite pre-llenar el destinatario, así que copiamos
    // el correo del cliente al portapapeles para pegarlo en "Para:".
    const esMovil = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
    if (esMovil && navigator.canShare && navigator.canShare({ files: [file] })) {
      if (cliente && cliente.correo) {
        try { await navigator.clipboard.writeText(cliente.correo); } catch {}
      }
      try {
        await navigator.share({ files: [file], title: asunto, text: cuerpo });
        return 'compartido';
      } catch (e) {
        if (e.name === 'AbortError') return 'cancelado';
        // si el compartir falla por otra razón, caemos al plan B
      }
    }

    // PC: descargar el PDF y abrir el correo listo
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    if (cliente && cliente.correo) {
      location.href = `mailto:${cliente.correo}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
    }
    return 'descargado';
  }

  /* ── Enviar factura/cotización por correo con su PDF ── */
  async function enviarPorCorreo(tipo, obj, cliente, cuerpo, asunto) {
    const emp = await UI.getEmpresa();
    const doc = tipo === 'factura'
      ? await docFactura(obj, cliente, emp)
      : await docCotizacion(obj, cliente, emp);
    const nombre = `${tipo === 'factura' ? 'Factura' : 'Cotizacion'}-${obj.orden ? obj.orden : (obj.numero || 's-n')}-SilverShine.pdf`;
    return compartirDoc(doc, nombre, cliente, cuerpo, asunto);
  }

  return { docFactura, docCotizacion, docRecibo, docEstado, enviarPorCorreo, compartirDoc };
})();

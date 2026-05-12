const axios = require('axios');

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const isProd = (process.env.PAGBANK_ENV || 'sandbox') === 'production';
const BASE_URL = isProd
  ? 'https://api.pagseguro.com'
  : 'https://sandbox.api.pagseguro.com';
const TOKEN = process.env.PAGBANK_TOKEN;
const APP_URL = process.env.APP_URL || 'https://liga-urologia.onrender.com';

function headers() {
  return {
    Authorization: 'Bearer ' + TOKEN,
    'Content-Type': 'application/json'
  };
}

function fmtExp(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day + 'T23:59:59-03:00';
}

function toExpDate(dataStr) {
  if (!dataStr) return fmtExp(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  if (typeof dataStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dataStr)) {
    return dataStr + 'T23:59:59-03:00';
  }
  return fmtExp(new Date(dataStr));
}

function cpfValido(cpf) {
  const s = (cpf || '').replace(/\D/g, '');
  return s.length === 11 ? s : '12345678909';
}

function centavos(valor) {
  return Math.round(parseFloat(valor) * 100);
}

// ─── CHECKOUT LINK (CARTÃO + PIX via página PagBank) ─────────────────────────
// Gera link externo — cliente escolhe cartão, PIX, etc na página do PagBank

async function criarCheckoutLink({ nome, email, cpf, valor, referencia, descricao, expDate }) {
  if (!TOKEN) return null;

  try {
    const { data } = await axios.post(
      BASE_URL + '/checkouts',
      {
        reference_id: referencia,
        customer: {
          name: nome,
          email: email || 'cliente@ligaurologia.com.br',
          tax_id: cpfValido(cpf)
        },
        items: [{
          reference_id: referencia,
          name: descricao || 'Liga Academica de Urologia — LAURO',
          quantity: 1,
          unit_amount: centavos(valor)
        }],
        payment_methods: [
          { type: 'CREDIT_CARD' },
          { type: 'DEBIT_CARD' }
        ],
        redirect_urls: {
          success: APP_URL + '/pagamento/sucesso',
          failure: APP_URL + '/pagamento/erro'
        },
        notification_urls: [APP_URL + '/webhook/pagbank'],
        expiration_date: expDate || fmtExp(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
      },
      { headers: headers(), timeout: 15000 }
    );

    if (data.links) {
      const pay = data.links.find(l => l.rel === 'PAY' || l.rel === 'CHECKOUT');
      if (pay) { console.log('PagBank checkout link:', pay.href); return pay.href; }
    }
    if (data.id) {
      const base = isProd ? 'https://pagseguro.uol.com.br' : 'https://sandbox.pagseguro.uol.com.br';
      return base + '/checkout/' + data.id;
    }
    return null;
  } catch (err) {
    console.warn('PagBank checkout ERRO (non-fatal):', JSON.stringify(err.response ? err.response.data : err.message).substring(0, 300));
    return null;
  }
}

// ─── PIX MENSALIDADE ──────────────────────────────────────────────────────────
// Para cobranças de membros/ligantes
// Retorna: { ok, charge_id, pix_copia_cola, pix_qr_image, checkout_link }

async function criarCobranca({ membro, valor, vencimento, referencia }) {
  if (!TOKEN) {
    console.warn('PagBank: PAGBANK_TOKEN não configurado');
    return { ok: false, charge_id: null, link: null };
  }

  const valorCents = centavos(valor);
  const expDate = toExpDate(vencimento);

  console.log('PagBank criarCobranca — ref:', referencia, 'valor:', valorCents, 'exp:', expDate);

  try {
    const { data } = await axios.post(
      BASE_URL + '/orders',
      {
        reference_id: referencia,
        customer: {
          name: membro.nome,
          email: membro.email || 'membro@ligaurologia.com.br',
          tax_id: cpfValido(membro.cpf)
        },
        items: [{
          name: 'Mensalidade Liga Academica de Urologia',
          quantity: 1,
          unit_amount: valorCents
        }],
        qr_codes: [{
          amount: { value: valorCents },
          expiration_date: expDate
        }],
        notification_urls: [APP_URL + '/webhook/pagbank']
      },
      { headers: headers(), timeout: 15000 }
    );

    console.log('PagBank cobrança criada:', data.id);

    let pixText = null, pixQrImage = null;

    if (data.qr_codes && data.qr_codes.length > 0) {
      const qr = data.qr_codes[0];
      pixText = qr.text || null;
      if (qr.links) {
        const png = qr.links.find(l => l.rel === 'QRCODE_PNG');
        pixQrImage = png ? png.href : null;
      }
    }

    // Gerar link de checkout para cartão (em paralelo, não bloqueia o PIX)
    const checkoutLink = await criarCheckoutLink({
      nome: membro.nome,
      email: membro.email,
      cpf: membro.cpf,
      valor,
      referencia,
      descricao: 'Mensalidade Liga Academica de Urologia',
      expDate
    });

    return {
      ok: true,
      charge_id: data.id,
      pix_copia_cola: pixText,
      pix_qr_image: pixQrImage,
      checkout_link: checkoutLink,
      link: checkoutLink  // compatibilidade com código antigo
    };

  } catch (err) {
    const status = err.response ? err.response.status : 'sem resposta';
    const detail = JSON.stringify(err.response ? err.response.data : err.message).substring(0, 500);
    console.error('PagBank criarCobranca ERRO', status, detail);
    return { ok: false, charge_id: null, link: null };
  }
}

// ─── PIX EVENTO ───────────────────────────────────────────────────────────────
// Para ingressos de eventos — PIX direto + link cartão
// Retorna: { ok, order_id, pix_copia_cola, pix_qr_image, checkout_link }

async function criarPixEvento({ inscricao, lote, eventoNome }) {
  if (!TOKEN) {
    console.warn('PagBank: PAGBANK_TOKEN não configurado');
    return { ok: false };
  }

  const referencia = 'evento-insc-' + inscricao.id;
  const valorCents = centavos(lote.preco);
  const expDate = fmtExp(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)); // 3 dias

  console.log('PagBank criarPixEvento — ref:', referencia, 'valor:', valorCents);

  try {
    const { data } = await axios.post(
      BASE_URL + '/orders',
      {
        reference_id: referencia,
        customer: {
          name: inscricao.nome,
          email: inscricao.email || 'inscrito@ligaurologia.com.br',
          tax_id: cpfValido(inscricao.cpf)
        },
        items: [{
          name: ('Ingresso — ' + eventoNome + ' — ' + lote.nome).substring(0, 100),
          quantity: 1,
          unit_amount: valorCents
        }],
        qr_codes: [{
          amount: { value: valorCents },
          expiration_date: expDate
        }],
        notification_urls: [APP_URL + '/webhook/pagbank']
      },
      { headers: headers(), timeout: 15000 }
    );

    console.log('PagBank evento order criado:', data.id);

    let pixText = null, pixQrImage = null;

    if (data.qr_codes && data.qr_codes.length > 0) {
      const qr = data.qr_codes[0];
      pixText = qr.text || null;
      if (qr.links) {
        const png = qr.links.find(l => l.rel === 'QRCODE_PNG');
        pixQrImage = png ? png.href : null;
      }
    }

    // Link cartão
    const checkoutLink = await criarCheckoutLink({
      nome: inscricao.nome,
      email: inscricao.email,
      cpf: inscricao.cpf,
      valor: lote.preco,
      referencia,
      descricao: ('Ingresso — ' + eventoNome + ' — ' + lote.nome).substring(0, 100),
      expDate
    });

    return {
      ok: true,
      order_id: data.id,
      pix_copia_cola: pixText,
      pix_qr_image: pixQrImage,
      checkout_link: checkoutLink
    };

  } catch (err) {
    const status = err.response ? err.response.status : 'sem resposta';
    const detail = JSON.stringify(err.response ? err.response.data : err.message).substring(0, 500);
    console.error('PagBank criarPixEvento ERRO', status, detail);
    return { ok: false };
  }
}

// ─── CONSULTAR PAGAMENTO ──────────────────────────────────────────────────────

async function consultarPagamento(orderId) {
  if (!orderId || !TOKEN) return { ok: false };
  try {
    const { data } = await axios.get(
      BASE_URL + '/orders/' + orderId,
      { headers: headers(), timeout: 10000 }
    );
    const pago = data.charges && data.charges.some(c => c.status === 'PAID');
    return { ok: true, status: pago ? 'PAID' : (data.status || 'PENDING'), data };
  } catch (err) {
    console.error('PagBank consultarPagamento ERRO:', err.message);
    return { ok: false };
  }
}

// Alias para compatibilidade com qualquer código que use consultarCobranca
const consultarCobranca = consultarPagamento;

// ─── PROCESSAR WEBHOOK ────────────────────────────────────────────────────────

function processarWebhook(body) {
  try {
    let orderId = null, referencia = null, status = null, pago = false;

    if (body.order) {
      orderId = body.order.id || null;
      referencia = body.order.reference_id || null;
      const charges = body.order.charges || [];
      pago = charges.some(c => c.status === 'PAID') || body.event === 'order.paid';
      status = body.event || body.order.status;
    } else if (body.charge) {
      orderId = body.charge.id || null;
      referencia = body.charge.reference_id || null;
      pago = body.charge.status === 'PAID' || body.event === 'charge.paid';
      status = body.charge.status || body.event;
    } else {
      orderId = body.id || null;
      referencia = body.reference_id || null;
      pago = body.status === 'PAID' || body.event === 'order.paid';
      status = body.status || body.event;
    }

    console.log('PagBank webhook — orderId:', orderId, 'ref:', referencia, 'pago:', pago);
    return { orderId, referencia, status, pago };

  } catch (e) {
    console.error('PagBank processarWebhook ERRO:', e.message);
    return { orderId: null, referencia: null, status: null, pago: false };
  }
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = {
  criarCobranca,      // mensalidades — PIX + checkout cartão
  criarPixEvento,     // ingressos de eventos — PIX + checkout cartão
  criarCheckoutLink,  // checkout cartão avulso
  consultarPagamento, // consulta order
  consultarCobranca,  // alias
  processarWebhook    // interpreta body do webhook
};

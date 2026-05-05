const axios = require('axios');

const MP_BASE_URL = 'https://api.mercadopago.com';

function getHeaders() {
  return {
    'Authorization': 'Bearer ' + process.env.MP_ACCESS_TOKEN,
    'Content-Type': 'application/json',
    'X-Idempotency-Key': Date.now().toString()
  };
}

// Cria pagamento PIX
async function criarPix({ membro, valor, vencimento, referencia }) {
  try {
    const body = {
      transaction_amount: parseFloat(valor),
      description: 'Mensalidade Liga Urologia - ' + membro.nome,
      payment_method_id: 'pix',
      external_reference: referencia,
      date_of_expiration: vencimento + 'T23:59:59.000-03:00',
      payer: {
        email: membro.email || 'membro@liga-urologia.com',
        first_name: membro.nome.split(' ')[0],
        last_name: membro.nome.split(' ').slice(1).join(' ') || 'Liga',
        identification: {
          type: 'CPF',
          number: (membro.cpf || '00000000000').replace(/\D/g, '')
        }
      }
    };

    const { data } = await axios.post(MP_BASE_URL + '/v1/payments', body, { headers: getHeaders() });

    const qrCode = data.point_of_interaction?.transaction_data?.qr_code || null;
    const qrCodeBase64 = data.point_of_interaction?.transaction_data?.qr_code_base64 || null;

    console.log('MP PIX criado:', data.id, 'status:', data.status);

    return {
      ok: true,
      payment_id: String(data.id),
      status: data.status,
      qr_code: qrCode,
      qr_code_base64: qrCodeBase64,
      link: null
    };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    console.error('MP PIX erro:', msg);
    return { ok: false, error: msg };
  }
}

// Cria pagamento Cartão de Crédito (link de checkout)
async function criarPreferencia({ membro, valor, vencimento, referencia }) {
  try {
    const appUrl = process.env.APP_URL || 'https://liga-urologia.onrender.com';

    const body = {
      items: [{
        title: 'Mensalidade Liga Urologia',
        description: 'Mensalidade - ' + membro.nome,
        quantity: 1,
        currency_id: 'BRL',
        unit_price: parseFloat(valor)
      }],
      payer: {
        name: membro.nome.split(' ')[0],
        surname: membro.nome.split(' ').slice(1).join(' ') || 'Liga',
        email: membro.email || 'membro@liga-urologia.com'
      },
      external_reference: referencia,
      expires: true,
      expiration_date_to: vencimento + 'T23:59:59.000-03:00',
      back_urls: {
        success: appUrl + '/cobrancas?pago=sim',
        failure: appUrl + '/cobrancas?pago=nao',
        pending: appUrl + '/cobrancas?pago=pendente'
      },
      auto_return: 'approved',
      notification_url: appUrl + '/webhook/mercadopago',
      payment_methods: {
        excluded_payment_types: [{ id: 'ticket' }], // sem boleto
        installments: 1
      }
    };

    const { data } = await axios.post(MP_BASE_URL + '/checkout/preferences', body, { headers: getHeaders() });

    console.log('MP Preferencia criada:', data.id);

    return {
      ok: true,
      preference_id: data.id,
      link: data.init_point
    };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    console.error('MP Preferencia erro:', msg);
    return { ok: false, error: msg };
  }
}

// Consultar pagamento
async function consultarPagamento(paymentId) {
  try {
    const { data } = await axios.get(MP_BASE_URL + '/v1/payments/' + paymentId, { headers: getHeaders() });
    return { ok: true, status: data.status, data };
  } catch (err) {
    console.error('MP consulta erro:', err.message);
    return { ok: false };
  }
}

// Função unificada — cria PIX + link cartão
async function criarCobranca({ membro, valor, vencimento, referencia }) {
  const pix = await criarPix({ membro, valor, vencimento, referencia });
  const pref = await criarPreferencia({ membro, valor, vencimento, referencia });

  return {
    ok: pix.ok || pref.ok,
    payment_id: pix.payment_id || null,
    preference_id: pref.preference_id || null,
    qr_code: pix.qr_code || null,
    qr_code_base64: pix.qr_code_base64 || null,
    link: pref.link || null,
    charge_id: pix.payment_id || pref.preference_id || null
  };
}

module.exports = { criarCobranca, criarPix, criarPreferencia, consultarPagamento };

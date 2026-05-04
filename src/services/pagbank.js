const axios = require('axios');
require('dotenv').config();

const BASE_URL = process.env.PAGBANK_BASE_URL || 'https://sandbox.api.pagseguro.com';
const TOKEN = process.env.PAGBANK_TOKEN;

async function criarCobranca({ membro, valor, vencimento, referencia }) {
  if (!TOKEN) {
    console.warn('PagBank: PAGBANK_TOKEN nao configurado');
    return { ok: false, charge_id: null, link: null };
  }

  const headers = {
    'Authorization': 'Bearer ' + TOKEN,
    'Content-Type': 'application/json'
  };

  // Expiracao maxima 180 dias
  let expDate;
  try {
    const vencDate = new Date(vencimento + 'T23:59:59-03:00');
    const maxDate = new Date(Date.now() + 179 * 24 * 60 * 60 * 1000);
    const finalDate = vencDate > maxDate ? maxDate : vencDate;
    expDate = finalDate.toISOString().replace('Z', '-03:00').substring(0, 22) + ':00';
  } catch (e) {
    expDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10) + 'T23:59:59-03:00';
  }

  const valorCentavos = Math.round(valor * 100);
  const cpf = (membro.cpf || '').replace(/\D/g, '');
  const cpfValido = cpf.length === 11 ? cpf : '12345678909';
  const emailMembro = membro.email || 'membro@ligaurologia.com.br';

  try {
    const { data, status } = await axios.post(
      BASE_URL + '/orders',
      {
        reference_id: referencia,
        customer: {
          name: membro.nome,
          email: emailMembro,
          tax_id: cpfValido
        },
        items: [{
          name: 'Mensalidade Liga Academica de Urologia',
          quantity: 1,
          unit_amount: valorCentavos
        }],
        qr_codes: [{
          amount: { value: valorCentavos },
          expiration_date: expDate
        }],
        notification_urls: [
          (process.env.APP_URL || 'https://liga-urologia.onrender.com') + '/webhook/pagbank'
        ]
      },
      { headers, timeout: 15000 }
    );

    console.log('PagBank order OK ' + status + ' id:' + data.id);
    console.log('PagBank resposta qr_codes:', JSON.stringify(data.qr_codes).substring(0, 500));

    // Extrai link do QR Code — testa todos os campos possíveis
    let link = null;
    let pixText = null;

    if (data.qr_codes && data.qr_codes.length > 0) {
      const qr = data.qr_codes[0];
      pixText = qr.text || null;

      // Tenta extrair link de várias formas
      if (qr.links && qr.links.length > 0) {
        // Procura link de pagamento ou QR Code PNG
        const payLink = qr.links.find(function(l) { return l.rel === 'PAY' || l.rel === 'pay'; });
        const qrPng = qr.links.find(function(l) { return l.rel === 'QRCODE_PNG' || l.rel === 'qrcode_png'; });
        const anyLink = qr.links[0];
        link = (payLink && payLink.href) || (qrPng && qrPng.href) || (anyLink && anyLink.href) || null;
      }

      // Se não achou link mas tem texto PIX, usa link do sandbox para visualizar
      if (!link && pixText) {
        link = 'https://sandbox.pagseguro.uol.com.br/pagamento/qrcode/' + (qr.id || data.id);
      }

      // Fallback: usa link dos links do pedido
      if (!link && data.links && data.links.length > 0) {
        const payLink = data.links.find(function(l) { return l.rel === 'PAY' || l.rel === 'CHECKOUT'; });
        link = payLink ? payLink.href : data.links[0].href;
      }
    }

    console.log('PagBank link extraido:', link);
    console.log('PagBank pix text:', pixText ? pixText.substring(0, 50) + '...' : 'null');

    return {
      ok: true,
      charge_id: data.id,
      link: link,
      pix_text: pixText
    };

  } catch (err) {
    const s = err.response ? err.response.status : 'sem resposta';
    const d = JSON.stringify(err.response ? err.response.data : err.message).substring(0, 400);
    console.error('PagBank ERRO ' + s + ': ' + d);
    return { ok: false, charge_id: null, link: null };
  }
}

async function consultarCobranca(chargeId) {
  if (!chargeId || !TOKEN) return { ok: false };
  try {
    const { data } = await axios.get(
      BASE_URL + '/orders/' + chargeId,
      { headers: { 'Authorization': 'Bearer ' + TOKEN }, timeout: 10000 }
    );
    const pago = data.charges && data.charges.some(function(c) { return c.status === 'PAID'; });
    return { ok: true, status: pago ? 'PAID' : data.status, data };
  } catch (err) {
    return { ok: false, erro: err.message };
  }
}

module.exports = { criarCobranca, consultarCobranca };

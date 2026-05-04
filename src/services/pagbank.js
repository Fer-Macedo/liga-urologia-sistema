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

  // Expiracao: usa vencimento informado ou 7 dias a partir de hoje
  let expDate;
  try {
    expDate = vencimento + 'T23:59:59-03:00';
    // Verifica se nao passa de 180 dias
    const maxDate = new Date(Date.now() + 179 * 24 * 60 * 60 * 1000);
    const vencDate = new Date(vencimento);
    if (vencDate > maxDate) {
      expDate = maxDate.toISOString().substring(0, 10) + 'T23:59:59-03:00';
    }
  } catch (e) {
    expDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().substring(0, 10) + 'T23:59:59-03:00';
  }

  const valorCentavos = Math.round(valor * 100);
  const cpf = (membro.cpf || '00000000000').replace(/\D/g, '') || '00000000000';

  try {
    const { data, status } = await axios.post(
      BASE_URL + '/orders',
      {
        reference_id: referencia,
        customer: {
          name: membro.nome,
          email: membro.email || 'contato@ligaurologia.com.br',
          tax_id: cpf
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

    // Extrai link do QR Code
    const qrCode = data.qr_codes && data.qr_codes[0];
    const qrLink = qrCode && qrCode.links && qrCode.links.find(function(l) { return l.rel === 'QRCODE_PNG'; });
    const pixText = qrCode && qrCode.text;
    const link = qrLink ? qrLink.href : null;

    return {
      ok: true,
      charge_id: data.id,
      link: link,
      pix_text: pixText,
      qr_id: qrCode ? qrCode.id : null
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
    // Verifica se algum QR Code foi pago
    const pago = data.charges && data.charges.some(function(c) { return c.status === 'PAID'; });
    return { ok: true, status: pago ? 'PAID' : data.status, data };
  } catch (err) {
    return { ok: false, erro: err.message };
  }
}

module.exports = { criarCobranca, consultarCobranca };

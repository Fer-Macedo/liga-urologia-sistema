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

  // Data no formato exato que o PagBank espera: YYYY-MM-DDThh:mm:ss-03:00
  const hoje = new Date();
  const emSeteDias = new Date(hoje.getTime() + 7 * 24 * 60 * 60 * 1000);
  const ano = emSeteDias.getFullYear();
  const mes = String(emSeteDias.getMonth() + 1).padStart(2, '0');
  const dia = String(emSeteDias.getDate()).padStart(2, '0');
  const expDate = ano + '-' + mes + '-' + dia + 'T23:59:59-03:00';

  const valorCentavos = Math.round(valor * 100);
  const cpf = (membro.cpf || '').replace(/\D/g, '');
  const cpfValido = cpf.length === 11 ? cpf : '12345678909';
  const emailMembro = membro.email || 'membro@ligaurologia.com.br';

  console.log('PagBank criando cobranca - exp:', expDate, 'valor:', valorCentavos, 'cpf:', cpfValido);

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
    console.log('PagBank qr_codes:', JSON.stringify(data.qr_codes).substring(0, 600));

    let link = null;
    let pixText = null;

    if (data.qr_codes && data.qr_codes.length > 0) {
      const qr = data.qr_codes[0];
      pixText = qr.text || null;

      if (qr.links && qr.links.length > 0) {
        console.log('PagBank qr links:', JSON.stringify(qr.links));
        const qrPng = qr.links.find(function(l) { return l.rel === 'QRCODE_PNG'; });
        const payLink = qr.links.find(function(l) { return l.rel === 'PAY'; });
        link = (payLink && payLink.href) || (qrPng && qrPng.href) || qr.links[0].href;
      }

      if (!link && pixText) {
        link = 'https://sandbox.pagseguro.uol.com.br/pagamento/qrcode/' + (qr.id || referencia);
      }
    }

    if (!link && data.links && data.links.length > 0) {
      console.log('PagBank order links:', JSON.stringify(data.links));
      link = data.links[0].href;
    }

    console.log('PagBank link final:', link);

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

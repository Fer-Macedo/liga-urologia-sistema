const axios = require('axios');
require('dotenv').config();
 
const BASE_URL = process.env.PAGBANK_BASE_URL || 'https://api.pagseguro.com';
const TOKEN = process.env.PAGBANK_TOKEN;
 
// Tenta 3 endpoints do PagBank em ordem
async function criarCobranca({ membro, valor, vencimento, referencia }) {
  const headers = {
    'Authorization': 'Bearer ' + TOKEN,
    'Content-Type': 'application/json'
  };
 
  // Endpoint 1: Payment Requests (Link de pagamento simples - sem whitelist)
  try {
    const exp = vencimento + 'T23:59:59-03:00';
    const { data, status } = await axios.post(
      BASE_URL + '/payment-requests',
      {
        reference_id: referencia,
        description: 'Mensalidade Liga Academica de Urologia - ' + referencia,
        amount: { value: Math.round(valor * 100), currency: 'BRL' },
        payment_methods: ['PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'BOLETO'],
        expiration_date: exp,
        customer: {
          name: membro.nome,
          email: membro.email || 'contato@ligaurologia.com.br',
          tax_id: (membro.cpf || '00000000000').replace(/\D/g, '')
        }
      },
      { headers, timeout: 15000 }
    );
    console.log('PagBank payment-request OK ' + status);
    const link = data.links ? data.links.find(function(l) { return l.rel === 'PAY'; }) : null;
    return {
      ok: true,
      charge_id: data.id,
      link: link ? link.href : (data.payment_url || null)
    };
  } catch (e1) {
    console.warn('PagBank /payment-requests: ' + e1.response?.status + ' ' + JSON.stringify(e1.response?.data).substring(0, 150));
  }
 
  // Endpoint 2: Charges (requer whitelist)
  try {
    const { data, status } = await axios.post(
      BASE_URL + '/charges',
      {
        reference_id: referencia,
        description: 'Mensalidade Liga Urologia - ' + referencia,
        amount: { value: Math.round(valor * 100), currency: 'BRL' },
        payment_method: { type: 'PIX', installments: 1 },
        expiration_date: vencimento + 'T23:59:59-03:00',
        customer: {
          name: membro.nome,
          email: membro.email || 'contato@ligaurologia.com.br',
          tax_id: (membro.cpf || '00000000000').replace(/\D/g, '')
        }
      },
      { headers, timeout: 15000 }
    );
    console.log('PagBank /charges OK ' + status);
    const link = data.links ? data.links.find(function(l) { return l.rel === 'PAY'; }) : null;
    return {
      ok: true,
      charge_id: data.id,
      link: link ? link.href : null
    };
  } catch (e2) {
    console.warn('PagBank /charges: ' + e2.response?.status + ' ' + JSON.stringify(e2.response?.data).substring(0, 150));
  }
 
  // Fallback: gera link manual do PagBank para o valor
  console.warn('PagBank: usando link manual de fallback');
  const linkManual = 'https://pag.ae/7YK3z5R' + Math.random().toString(36).substring(2, 6);
  return {
    ok: false,
    charge_id: null,
    link: null,
    erro: 'API PagBank nao disponivel - configure acesso a whitelist'
  };
}
 
async function consultarCobranca(chargeId) {
  if (!chargeId) return { ok: false };
  try {
    const { data } = await axios.get(
      BASE_URL + '/charges/' + chargeId,
      { headers: { 'Authorization': 'Bearer ' + TOKEN }, timeout: 10000 }
    );
    return { ok: true, status: data.status, data };
  } catch (err) {
    return { ok: false, erro: err.message };
  }
}
 
module.exports = { criarCobranca, consultarCobranca };

const axios = require('axios');
require('dotenv').config();

const BASE_URL = process.env.PAGBANK_BASE_URL || 'https://api.pagseguro.com';
const TOKEN = process.env.PAGBANK_TOKEN;

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
});

// Cria uma cobrança (link de pagamento) no PagBank
async function criarCobranca({ membro, valor, vencimento, referencia }) {
  try {
    const payload = {
      reference_id: referencia,
      description: `Mensalidade Liga Urologia - ${referencia}`,
      amount: {
        value: Math.round(valor * 100), // em centavos
        currency: 'BRL'
      },
      payment_methods: [
        { type: 'CREDIT_CARD' },
        { type: 'DEBIT_CARD' },
        { type: 'BOLETO' },
        { type: 'PIX' }
      ],
      soft_descriptor: 'LigaUrologia',
      expiration_date: vencimento + 'T23:59:59-03:00',
      customer: {
        name: membro.nome,
        email: membro.email || 'sem@email.com',
        tax_id: (membro.cpf || '').replace(/\D/g, '') || '00000000000'
      },
      notification_urls: [
        `${process.env.APP_URL || 'https://seuapp.railway.app'}/webhook/pagbank`
      ]
    };

    const { data } = await api.post('/charges', payload);
    return {
      ok: true,
      charge_id: data.id,
      link: data.links?.find(l => l.rel === 'PAY')?.href || data.payment_url || null
    };
  } catch (err) {
    console.error('PagBank erro:', err.response?.data || err.message);
    return { ok: false, erro: err.response?.data?.error_messages?.[0]?.description || err.message };
  }
}

// Consulta status de uma cobrança
async function consultarCobranca(chargeId) {
  try {
    const { data } = await api.get(`/charges/${chargeId}`);
    return { ok: true, status: data.status, data };
  } catch (err) {
    return { ok: false, erro: err.message };
  }
}

// Gera um link simples de pagamento (fallback sem API)
function gerarLinkManual({ membro, valor, referencia }) {
  const desc = encodeURIComponent(`Mensalidade Liga Urologia - ${referencia}`);
  return `https://pag.ae/solicitar-pagamento?valor=${valor}&descricao=${desc}`;
}

module.exports = { criarCobranca, consultarCobranca, gerarLinkManual };

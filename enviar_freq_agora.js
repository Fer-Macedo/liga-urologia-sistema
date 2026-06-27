require('dotenv').config();

// Forçar horário permitido temporariamente
process.env.WAPP_HORA_INICIO = '0';
process.env.WAPP_HORA_FIM = '23';

const { enviarFrequenciaMensal } = require('./src/services/agendamentos');
(async () => {
  console.log('Iniciando envio manual de frequências...');
  try {
    await enviarFrequenciaMensal();
    console.log('✅ Frequências enviadas com sucesso!');
  } catch(e) {
    console.error('❌ Erro:', e.message);
  }
  // Aguardar fila processar
  setTimeout(() => process.exit(), 60000);
})();

// Vigia da conexão da W-API.
//
// Por que existe: em 2026-07-20, no primeiro teste do número novo, a instância caiu
// sozinha logo depois da primeira conversa. A queda foi SILENCIOSA — o sistema não
// recebeu erro nenhum, porque uma instância desconectada simplesmente para de chamar o
// webhook. Quem escrevesse para a liga naquele intervalo não seria respondido e ninguém
// ficaria sabendo até alguém reclamar.
//
// A API Oficial da Meta não tem esse modo de falha: ela não depende de um celular
// pareado. A W-API depende, então precisa de vigia.
const { query } = require('../models/database');

// Só avisa na TRANSIÇÃO para desconectado. Sem isso, uma queda de fim de semana viraria
// um e-mail a cada verificação e a equipe passaria a ignorar o alerta.
//
// O estado anterior TEM que sobreviver a um restart do processo (deploy dá `git push`,
// e cada push reinicia o app). Guardado em memória, um restart zera para null — e a
// checagem seguinte, vindo de null, NUNCA dispara "caiu" (exige ter visto true antes).
// Se uma queda coincidir com os minutos logo apos um deploy, o alerta seria perdido em
// silencio — justo a janela que o usuario passou a confiar para monitorar a frequencia
// das quedas. Por isso o estado fica em configuracoes, nao numa variavel do processo.
async function lerUltimoEstado() {
  const r = await query("SELECT valor FROM configuracoes WHERE chave='wapi_ultimo_estado_conectado'");
  if (!r.rows.length || r.rows[0].valor === '') return null;
  return r.rows[0].valor === 'true';
}
async function salvarUltimoEstado(conectado) {
  await query(
    `INSERT INTO configuracoes (chave, valor) VALUES ('wapi_ultimo_estado_conectado', $1)
     ON CONFLICT (chave) DO UPDATE SET valor=$1`,
    [String(conectado)]
  );
}

async function verificar() {
  // Se o atendimento não está na W-API, não há o que vigiar.
  const canal = (process.env.ASSISTENTE_CANAL || 'oficial').toLowerCase();
  if (canal !== 'wapi') return { checado: false };

  const { statusInstancia } = require('./whatsapp-wapi');
  const r = await statusInstancia();

  // Falha na consulta não é o mesmo que desconectado: pode ser rede ou a própria W-API
  // fora do ar. Tratar como queda geraria alarme falso, então só registra.
  if (!r.ok) {
    console.error('[VIGIA W-API] não consegui consultar o status:', JSON.stringify(r.erro));
    return { checado: false };
  }

  const conectado = !!(r.data && r.data.connected);
  const ultimoEstado = await lerUltimoEstado();
  const caiu = ultimoEstado === true && conectado === false;
  const voltou = ultimoEstado === false && conectado === true;
  await salvarUltimoEstado(conectado);

  if (caiu) await avisar();
  if (voltou) {
    console.log('[VIGIA W-API] conexão restabelecida.');
    // Marca o momento da reconexão — whatsapp-wapi.js usa isso pra apertar o teto diário
    // de envios por alguns dias (o número já escalou de restrição pra banimento total
    // justo nos primeiros dias após reconectar, 3 vezes seguidas).
    try {
      await query(
        `INSERT INTO configuracoes (chave, valor) VALUES ('wapi_reconectado_em', $1)
         ON CONFLICT (chave) DO UPDATE SET valor=$1`,
        [new Date().toISOString()]
      );
    } catch (e) { console.error('[VIGIA W-API] falha ao gravar reconectado_em:', e.message); }
  }

  return { checado: true, conectado, caiu, voltou };
}

async function avisar() {
  console.error('[VIGIA W-API] INSTÂNCIA DESCONECTADA — atendimento fora do ar.');
  try {
    const { enviarEmail } = require('./notificacoes');
    // SÓ o admin. A ação aqui é escanear um QR Code no painel da W-API, o que exige o
    // celular do número e o acesso ao painel — quem não tem os dois só recebe um susto
    // que não pode resolver. Alerta técnico para quem não pode agir vira ruído, e ruído
    // treina todo mundo a ignorar o próximo.
    const dest = await query(
      "SELECT DISTINCT email FROM usuarios WHERE ativo=1 AND email IS NOT NULL AND email <> '' AND perfil='admin'"
    );
    if (!dest.rows.length) {
      console.error('[VIGIA W-API] nenhum admin com e-mail — alerta NÃO enviado.');
      return;
    }
    const html = `
      <p>O WhatsApp do atendimento (<strong>+595 994316286</strong>) <strong>desconectou</strong>.
      Enquanto estiver assim, quem escrever para a liga <strong>não recebe resposta</strong> —
      a mensagem nem chega no sistema.</p>
      <p><strong>Como resolver (2 minutos):</strong></p>
      <ol>
        <li>Entre em <a href="https://painel.w-api.app">painel.w-api.app</a></li>
        <li>Na instância <em>liga-urologia</em>, clique em <strong>CONECTAR</strong></li>
        <li>No celular do número: WhatsApp → três pontinhos → <strong>Dispositivos conectados</strong>
            → <strong>Conectar um dispositivo</strong> → escaneie o QR Code</li>
      </ol>
      <p style="font-size:12.5px;color:#64748b">Causas comuns: o celular ficou sem internet, desligou,
      ou o WhatsApp foi fechado por muito tempo. Os disparos de cobrança e aniversário
      <strong>não</strong> são afetados — eles usam a API Oficial, que é independente disso.</p>`;
    await enviarEmail({
      para: dest.rows.map(x => x.email).join(','),
      assunto: '🔴 WhatsApp do atendimento desconectado',
      titulo: 'Atendimento fora do ar',
      faixaLabel: 'ALERTA',
      html
    });
  } catch (e) {
    console.error('[VIGIA W-API] falha ao enviar o alerta:', e.message);
  }
}

module.exports = { verificar, avisar };
